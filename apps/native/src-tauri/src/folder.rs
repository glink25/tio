use serde_json::Value;
use std::{fs::File, sync::Arc};
use tauri::{AppHandle, Manager, Webview};

pub(crate) fn write_lease(
    app: &AppHandle,
    generation: &str,
    request: &Value,
) -> Result<Option<Arc<File>>, &'static str> {
    if !matches!(request["action"].as_str(), Some("write" | "remove")) {
        return Ok(None);
    }
    let grant = request["grant"].as_str().ok_or("invalid")?;
    let workspace = request["path"]
        .as_str()
        .and_then(|path| path.strip_prefix("workspaces/"))
        .and_then(|path| path.split('/').next())
        .filter(|id| !id.is_empty())
        .ok_or("invalid")?;
    let name = format!("tio-sync-folder-{grant}_{workspace}");
    app.state::<crate::process_lock::ProcessLocks>()
        .0
        .lease(generation, &name)
        .map(Some)
}

#[tauri::command]
pub async fn native_folder(
    app: AppHandle,
    webview: Webview,
    generation: String,
    request: Value,
) -> Result<Value, String> {
    app.state::<crate::process_lock::ProcessLocks>()
        .0
        .check(webview.label(), &generation)?;
    let lease = write_lease(&app, &generation, &request)?;
    tauri::async_runtime::spawn(async move {
        let _lease = lease;
        call(&app, request).await
    })
    .await
    .map_err(|_| "unavailable".to_owned())?
}

async fn call(app: &AppHandle, request: Value) -> Result<Value, String> {
    #[cfg(desktop)]
    {
        let action = request["action"].as_str().ok_or("invalid")?;
        return desktop::call(app, action, &request).await;
    }
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<tauri::plugin::PluginHandle<tauri::Wry>>();
        let reply: Value = handle
            .run_mobile_plugin_async("folder", request)
            .await
            .map_err(|_| "unavailable")?;
        return if let Some(code) = reply["error"].as_str() {
            Err(code.to_owned())
        } else {
            Ok(reply["value"].clone())
        };
    }
    #[cfg(target_os = "ios")]
    {
        let _ = (app, request);
        Err("unsupported".to_owned())
    }
}

#[cfg(desktop)]
mod desktop {
    use super::*;
    use crate::catalog::Catalog;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use cap_std::{ambient_authority, fs::Dir};
    use rusqlite::{params, OptionalExtension};
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use std::{
        io::{self, Write},
        path::Path,
    };
    fn code(err: io::Error) -> String {
        match err.kind() {
            io::ErrorKind::PermissionDenied => "permission",
            io::ErrorKind::NotFound => "missing",
            _ => "unavailable",
        }
        .into()
    }
    fn list(dir: &Dir, prefix: &str, files: &mut Vec<String>) -> io::Result<()> {
        for entry in dir.entries()? {
            let entry = entry?;
            let ty = entry.file_type()?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let path = format!("{prefix}/{name}");
            if ty.is_dir() {
                list(&entry.open_dir()?, &path, files)?
            } else if ty.is_file() {
                files.push(path)
            }
        }
        Ok(())
    }
    pub async fn call(app: &AppHandle, action: &str, request: &Value) -> Result<Value, String> {
        let state = app.state::<Catalog>();
        if action == "pick" {
            let chosen = rfd::AsyncFileDialog::new()
                .pick_folder()
                .await
                .ok_or("cancelled")?;
            let root = chosen.path().canonicalize().map_err(code)?;
            let path = root.to_str().ok_or("invalid")?;
            let id = format!("{:x}", Sha256::digest(path.as_bytes()));
            state
                .0
                .lock()
                .map_err(|_| "unavailable")?
                .execute(
                    "INSERT OR REPLACE INTO folder_grants VALUES (?1,?2)",
                    params![id, path],
                )
                .map_err(|_| "unavailable")?;
            return Ok(json!({"kind":"native-folder","id":id,"name":chosen.file_name()}));
        }
        let path: String = state
            .0
            .lock()
            .map_err(|_| "unavailable")?
            .query_row(
                "SELECT path FROM folder_grants WHERE id=?1",
                [request["grant"].as_str().ok_or("invalid")?],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "unavailable")?
            .ok_or("permission")?;
        let root = Dir::open_ambient_dir(path, ambient_authority()).map_err(code)?;
        if action == "access" {
            return Ok(json!(true));
        }
        if action == "workspaces" {
            let dir = match root.open_dir("workspaces") {
                Ok(d) => d,
                Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(json!([])),
                Err(e) => return Err(code(e)),
            };
            let mut ids = Vec::new();
            for entry in dir.entries().map_err(code)? {
                let entry = entry.map_err(code)?;
                let name = entry.file_name();
                if entry.file_type().map_err(code)?.is_dir() {
                    if let Some(name) = name.to_str() {
                        if name
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
                        {
                            ids.push(name.to_owned())
                        }
                    }
                }
            }
            ids.sort();
            return Ok(json!(ids));
        }
        let rel = request["path"]
            .as_str()
            .ok_or("invalid")?
            .trim_end_matches('/');
        if !rel.starts_with("workspaces/")
            || rel
                .split('/')
                .any(|p| p.is_empty() || p == "." || p == ".." || p.contains(['\\', '\0', ':']))
        {
            return Err("invalid".into());
        }
        match action {
            "read" => match root.read(rel) {
                Ok(bytes) => Ok(json!(STANDARD.encode(bytes))),
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Value::Null),
                Err(e) => Err(code(e)),
            },
            "list" => {
                let mut files = Vec::new();
                match root.open_dir(rel) {
                    Ok(dir) => list(&dir, rel, &mut files).map_err(code)?,
                    Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                    Err(e) => return Err(code(e)),
                };
                files.sort();
                Ok(json!(files))
            }
            "write" => {
                let data = STANDARD
                    .decode(request["data"].as_str().ok_or("invalid")?)
                    .map_err(|_| "invalid")?;
                let path = Path::new(rel);
                let parent = path.parent().ok_or("invalid")?;
                root.create_dir_all(parent).map_err(code)?;
                let dir = root.open_dir(parent).map_err(code)?;
                let temp = format!(".tio-{}.tmp", uuid::Uuid::new_v4());
                let result = (|| {
                    let mut options = cap_std::fs::OpenOptions::new();
                    options.create_new(true).write(true);
                    let mut file = dir.open_with(&temp, &options)?;
                    file.write_all(&data)?;
                    file.sync_all()?;
                    drop(file);
                    dir.rename(&temp, &dir, path.file_name().unwrap())
                })();
                if result.is_err() {
                    let _ = dir.remove_file(&temp);
                }
                result.map_err(code)?;
                Ok(Value::Null)
            }
            "remove" => {
                let res = if rel.split('/').count() == 2 {
                    root.remove_dir_all(rel)
                } else {
                    root.remove_file(rel)
                };
                match res {
                    Ok(()) => {}
                    Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                    Err(e) => return Err(code(e)),
                };
                Ok(Value::Null)
            }
            _ => Err("invalid".into()),
        }
    }
}
