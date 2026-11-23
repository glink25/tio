#[cfg(mobile)]
use serde_json::{json, Value};
#[cfg(mobile)]
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use std::{
    fs::{self, File},
    path::Path,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(mobile)]
static READERS: OnceLock<Mutex<HashMap<String, File>>> = OnceLock::new();

fn now() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
fn lock_file(catalog: &Path) -> Result<File, &'static str> {
    File::options()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(catalog.parent().ok_or("invalid")?.join("kernel.lock"))
        .map_err(|_| "unavailable")
}
#[cfg(mobile)]
pub fn cancelled(catalog: &Path) -> bool {
    let Some(parent) = catalog.parent() else {
        return false;
    };
    let Ok(entries) = fs::read_dir(parent.join("kernel-transitions")) else {
        return false;
    };
    for entry in entries.flatten() {
        if let Ok(value) = fs::read_to_string(entry.path()) {
            if value
                .parse::<u128>()
                .is_ok_and(|deadline| deadline > now() && deadline.saturating_sub(now()) <= 10000)
            {
                return true;
            }
            let _ = fs::remove_file(entry.path());
        }
    }
    false
}
pub fn transition(catalog: &Path) -> Result<Option<File>, &'static str> {
    let file = lock_file(catalog)?;
    match fs2::FileExt::try_lock_exclusive(&file) {
        Ok(()) => return Ok(Some(file)),
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
        Err(error) => {
            eprintln!("Kernel lease failed: {error}");
            return Err("unavailable");
        }
    }
    let directory = catalog
        .parent()
        .ok_or("invalid")?
        .join("kernel-transitions");
    fs::create_dir_all(&directory).map_err(|_| "unavailable")?;
    let marker = directory.join(uuid::Uuid::new_v4().to_string());
    fs::write(&marker, (now() + 7500).to_string()).map_err(|_| "unavailable")?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let result = loop {
        match fs2::FileExt::try_lock_exclusive(&file) {
            Ok(()) => break Ok(Some(file)),
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break Ok(None),
            Err(_) => break Err("unavailable"),
        }
    };
    let _ = fs::remove_file(marker);
    result
}
#[cfg(mobile)]
pub fn begin(catalog: &Path) -> Result<Value, &'static str> {
    if cancelled(catalog) {
        return Err("pending");
    }
    let file = lock_file(catalog)?;
    match fs2::FileExt::try_lock_shared(&file) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Err("pending"),
        Err(error) => {
            eprintln!("Kernel lease failed: {error}");
            return Err("unavailable");
        }
    }
    let selected = if env!("TIO_COMPILED_RESOURCE_KEY").is_empty() || tauri::is_dev() {
        None
    } else {
        crate::frontend_update::confirmed_kernel(catalog)?
    };
    let token = uuid::Uuid::new_v4().to_string();
    let (path, revision, hash) = selected
        .map(|(path, revision, hash)| (Some(path), revision, hash))
        .unwrap_or((None, 0, env!("TIO_COMPILED_KERNEL_HASH").to_owned()));
    READERS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "unavailable")?
        .insert(token.clone(), file);
    Ok(json!({"path":path,"token":token,"revision":revision,"sha256":hash}))
}
#[cfg(mobile)]
pub fn end(token: &str) -> Result<Value, &'static str> {
    READERS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "unavailable")?
        .remove(token);
    Ok(Value::Null)
}
