use crate::catalog::Catalog;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::fs::{self, File};
use tauri::{AppHandle, Manager, Webview};

#[derive(Default)]
pub struct FolderLocks(pub crate::window_locks::WindowLocks);

#[tauri::command]
pub async fn native_folder(
    app: AppHandle,
    webview: Webview,
    generation: String,
    request: Value,
) -> Result<Value, String> {
    app.state::<FolderLocks>()
        .0
        .check(webview.label(), &generation)?;
    let action = request["action"].as_str().ok_or("invalid")?;
    if matches!(
        action,
        "lock" | "unlock" | "stateRead" | "stateWrite" | "stateEntries" | "stateDelete"
    ) {
        return journal(&app, webview.label(), generation, action, &request).map_err(str::to_owned);
    }
    #[cfg(desktop)]
    {
        return desktop::call(&app, action, &request).await;
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
        Err("unsupported".to_owned())
    }
}

fn journal(
    app: &AppHandle,
    label: &str,
    owner: String,
    action: &str,
    request: &Value,
) -> Result<Value, &'static str> {
    let grant = request["grant"].as_str().ok_or("invalid")?;
    let space = request["workspace"].as_str().ok_or("invalid")?;
    if grant.len() != 64
        || !grant.bytes().all(|b| b.is_ascii_hexdigit())
        || space.is_empty()
        || space.len() > 256
        || !space
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Err("invalid");
    }
    let locks = app.state::<FolderLocks>();
    if action == "lock" {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|_| "unavailable")?
            .join("folder-locks")
            .join(grant);
        fs::create_dir_all(&dir).map_err(|_| "unavailable")?;
        let file = File::options()
            .create(true)
            .truncate(false)
            .write(true)
            .open(dir.join(space))
            .map_err(|_| "unavailable")?;
        match fs2::FileExt::try_lock_exclusive(&file) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(Value::Null),
            Err(_) => return Err("unavailable"),
        }
        return Ok(Value::String(locks.0.hold(label, owner, file)?));
    }
    if action == "unlock" {
        locks
            .0
            .release(&owner, request["token"].as_str().ok_or("invalid")?)?;
        return Ok(Value::Null);
    }
    let state = app.state::<Catalog>();
    let mut db = state.0.lock().map_err(|_| "unavailable")?;
    let sql = |_: rusqlite::Error| "unavailable";
    let tx = db.transaction().map_err(sql)?;
    let result = match action {
        "stateRead" => {
            let mut values = Vec::new();
            for key in request["keys"].as_array().ok_or("invalid")? {
                let raw: Option<String> = tx
                    .query_row(
                        "SELECT value FROM folder_state WHERE grant=?1 AND space=?2 AND key=?3",
                        params![grant, space, key.as_str().ok_or("invalid")?],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(sql)?;
                values.push(
                    serde_json::from_str(raw.as_deref().unwrap_or("null"))
                        .map_err(|_| "invalid")?,
                );
            }
            Value::Array(values)
        }
        "stateEntries" => {
            let prefix = request["prefix"].as_str().ok_or("invalid")?;
            let after = request["after"].as_str();
            let mut stmt=tx.prepare("SELECT key,value FROM folder_state WHERE grant=?1 AND space=?2 AND key>=?3 AND key<?4 AND (?5 IS NULL OR key>?5) ORDER BY key LIMIT ?6").map_err(sql)?;
            let rows = stmt
                .query_map(
                    params![
                        grant,
                        space,
                        prefix,
                        format!("{prefix}\u{ffff}"),
                        after,
                        request["limit"].as_i64().unwrap_or(-1)
                    ],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                )
                .map_err(sql)?;
            let mut values = Vec::new();
            for row in rows {
                let (k, v) = row.map_err(sql)?;
                values.push(json!({"key":k,"value":serde_json::from_str::<Value>(&v).map_err(|_|"invalid")?}));
            }
            Value::Array(values)
        }
        "stateWrite" => {
            for key in request["deletes"].as_array().ok_or("invalid")? {
                tx.execute(
                    "DELETE FROM folder_state WHERE grant=?1 AND space=?2 AND key=?3",
                    params![grant, space, key.as_str().ok_or("invalid")?],
                )
                .map_err(sql)?;
            }
            for put in request["puts"].as_array().ok_or("invalid")? {
                tx.execute(
                    "INSERT OR REPLACE INTO folder_state VALUES(?1,?2,?3,?4)",
                    params![
                        grant,
                        space,
                        put["key"].as_str().ok_or("invalid")?,
                        put["value"].to_string()
                    ],
                )
                .map_err(sql)?;
            }
            Value::Null
        }
        "stateDelete" => {
            tx.execute(
                "DELETE FROM folder_state WHERE grant=?1 AND space=?2",
                params![grant, space],
            )
            .map_err(sql)?;
            Value::Null
        }
        _ => return Err("invalid"),
    };
    tx.commit().map_err(sql)?;
    Ok(result)
}

#[cfg(desktop)]
mod desktop {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use cap_std::{ambient_authority, fs::Dir};
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
