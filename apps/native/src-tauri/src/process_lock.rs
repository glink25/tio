use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::File;
use tauri::{AppHandle, Manager, State, Webview};

use crate::window_locks::WindowLocks;

#[derive(Default)]
pub struct ProcessLocks(pub WindowLocks);
#[tauri::command]
pub fn process_lock(
    app: AppHandle,
    webview: Webview,
    locks: State<'_, ProcessLocks>,
    name: String,
    token: Option<String>,
    generation: String,
) -> Result<Value, &'static str> {
    if name.is_empty() || name.len() > 2048 {
        return Err("invalid");
    }
    locks.0.check(webview.label(), &generation)?;
    if let Some(token) = token {
        locks.0.release(&generation, &token)?;
        return Ok(Value::Null);
    }
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "unavailable")?
        .join("process-locks");
    std::fs::create_dir_all(&directory).map_err(|_| "unavailable")?;
    let file = File::options()
        .create(true)
        .truncate(false)
        .write(true)
        .open(directory.join(format!("{:x}", Sha256::digest(name.as_bytes()))))
        .map_err(|_| "unavailable")?;
    match fs2::FileExt::try_lock_exclusive(&file) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(Value::Null),
        Err(_) => return Err("unavailable"),
    }
    Ok(json!(locks.0.hold(webview.label(), generation, file)?))
}
