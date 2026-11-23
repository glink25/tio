use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs::File, sync::Mutex};
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct ProcessLocks(Mutex<HashMap<String, File>>);
impl ProcessLocks {
    pub fn reset(&self) {
        if let Ok(mut locks) = self.0.lock() {
            locks.clear();
        }
    }
}
#[tauri::command]
pub fn process_lock(
    app: AppHandle,
    locks: State<'_, ProcessLocks>,
    name: String,
    token: Option<String>,
) -> Result<Value, &'static str> {
    if name.is_empty() || name.len() > 2048 {
        return Err("invalid");
    }
    if let Some(token) = token {
        locks.0.lock().map_err(|_| "unavailable")?.remove(&token);
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
    let token = uuid::Uuid::new_v4().to_string();
    locks
        .0
        .lock()
        .map_err(|_| "unavailable")?
        .insert(token.clone(), file);
    Ok(json!(token))
}
