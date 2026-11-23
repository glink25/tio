use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};

pub fn call(path: &str, input: Value) -> Result<Value, &'static str> {
    let action = input["action"].as_str().ok_or("invalid")?;
    if action == "kernelBegin" {
        return crate::kernel_lease::begin(std::path::Path::new(path));
    }
    if action == "kernelEnd" {
        return crate::kernel_lease::end(input["token"].as_str().ok_or("invalid")?);
    }
    if action == "kernelCancelled" {
        return Ok(json!(crate::kernel_lease::cancelled(std::path::Path::new(
            path
        ))));
    }
    if action == "authOrigin" {
        return Ok(json!(env!("TIO_COMPILED_AUTH_URL")));
    }
    if action == "lock" {
        use sha2::{Digest, Sha256};
        use std::{
            collections::HashMap,
            fs::File,
            sync::{Mutex, OnceLock},
        };
        static LOCKS: OnceLock<Mutex<HashMap<String, File>>> = OnceLock::new();
        let locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
        if let Some(token) = input["token"].as_str().filter(|s| !s.is_empty()) {
            locks.lock().map_err(|_| "unavailable")?.remove(token);
            return Ok(Value::Null);
        }
        let name = input["name"].as_str().ok_or("invalid")?;
        if name.is_empty() || name.len() > 2048 {
            return Err("invalid");
        }
        let folder = std::path::Path::new(path)
            .parent()
            .ok_or("invalid")?
            .join("process-locks");
        std::fs::create_dir_all(&folder).map_err(|_| "unavailable")?;
        let file = File::options()
            .create(true)
            .truncate(false)
            .write(true)
            .open(folder.join(format!("{:x}", Sha256::digest(name.as_bytes()))))
            .map_err(|_| "unavailable")?;
        match fs2::FileExt::try_lock_exclusive(&file) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(Value::Null),
            Err(_) => return Err("unavailable"),
        }
        let token = uuid::Uuid::new_v4().to_string();
        locks
            .lock()
            .map_err(|_| "unavailable")?
            .insert(token.clone(), file);
        return Ok(json!(token));
    }
    if action == "replica" {
        return crate::workspace::execute_replica(
            std::path::Path::new(path),
            input["replica"].as_str().ok_or("invalid")?,
            input["space"].as_str().ok_or("invalid")?.to_owned(),
            serde_json::from_value(input["request"].clone()).map_err(|_| "invalid")?,
        );
    }
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|_| "unavailable")?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "unavailable")?;
    match action {
        "read" => {
            let raw: Option<String> = db
                .query_row(
                    "SELECT value FROM settings WHERE key=?1",
                    [input["key"].as_str().ok_or("invalid")?],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|_| "unavailable")?;
            raw.map(|v| serde_json::from_str(&v).map_err(|_| "invalid"))
                .unwrap_or(Ok(Value::Null))
        }
        "write" => {
            db.execute(
                "INSERT OR REPLACE INTO settings VALUES(?1,?2)",
                params![
                    input["key"].as_str().ok_or("invalid")?,
                    input["value"].to_string()
                ],
            )
            .map_err(|_| "unavailable")?;
            Ok(Value::Null)
        }
        "sessions" => {
            let mut statement = db
                .prepare("SELECT value FROM sessions ORDER BY id")
                .map_err(|_| "unavailable")?;
            let rows = statement
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|_| "unavailable")?;
            let mut values = Vec::new();
            for row in rows {
                values.push(
                    serde_json::from_str::<Value>(&row.map_err(|_| "unavailable")?)
                        .map_err(|_| "invalid")?,
                );
            }
            Ok(json!(values))
        }
        _ => Err("invalid"),
    }
}

pub fn reply(path: &str, request: &str) -> String {
    let result = serde_json::from_str(request)
        .map_err(|_| "invalid")
        .and_then(|input| call(path, input));
    match result {
        Ok(value) => json!({"value":value}),
        Err(error) => json!({"error":error}),
    }
    .to_string()
}

#[cfg(target_os = "ios")]
#[no_mangle]
pub unsafe extern "C" fn tio_native_call(
    path: *const std::ffi::c_char,
    request: *const std::ffi::c_char,
) -> *mut std::ffi::c_char {
    let result = reply(
        &std::ffi::CStr::from_ptr(path).to_string_lossy(),
        &std::ffi::CStr::from_ptr(request).to_string_lossy(),
    );
    std::ffi::CString::new(result).unwrap().into_raw()
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_glink25_tio_NativeKernel_nativeCall(
    mut env: jni::JNIEnv,
    _object: jni::objects::JObject,
    path: jni::objects::JString,
    request: jni::objects::JString,
) -> jni::sys::jstring {
    let result = (|| {
        let path: String = env.get_string(&path).ok()?.into();
        let request: String = env.get_string(&request).ok()?.into();
        Some(reply(&path, &request))
    })()
    .unwrap_or_else(|| json!({"error":"invalid"}).to_string());
    env.new_string(result)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}
