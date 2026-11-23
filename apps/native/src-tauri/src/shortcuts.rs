//! C ABI for the app's JavaScriptCore runtime. Callers supply NUL-terminated UTF-8 and
//! release only returned pointers with tio_release_reply.
use crate::workspace::{execute, Request};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::ffi::{c_char, CStr, CString};

#[no_mangle]
pub unsafe extern "C" fn tio_workspace_call(
    path: *const c_char,
    space: *const c_char,
    args: *const c_char,
) -> *mut c_char {
    let run = || -> Result<Value, &'static str> {
        let path = CStr::from_ptr(path).to_str().map_err(|_| "invalid")?;
        let space = CStr::from_ptr(space).to_str().map_err(|_| "invalid")?;
        let request: Request =
            serde_json::from_slice(CStr::from_ptr(args).to_bytes()).map_err(|_| "invalid")?;
        let mut db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|_| "unavailable")?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "unavailable")?;
        execute(&mut db, space.to_owned(), request)
    };
    let reply = match run() {
        Ok(value) => json!({"value": value}),
        Err(code) => json!({"error": code}),
    };
    CString::new(reply.to_string()).unwrap().into_raw()
}

#[no_mangle]
pub unsafe extern "C" fn tio_release_reply(reply: *mut c_char) {
    if !reply.is_null() {
        drop(CString::from_raw(reply));
    }
}

type Call = unsafe extern "C" fn(*const c_char) -> *mut c_char;
type Free = unsafe extern "C" fn(*mut c_char);
type Reset = unsafe extern "C" fn();
static FOLDER: std::sync::OnceLock<(Call, Free, Reset)> = std::sync::OnceLock::new();

#[no_mangle]
pub extern "C" fn tio_register_folder(call: Call, free: Free, reset: Reset) {
    let _ = FOLDER.set((call, free, reset));
}

pub fn reset_foreground() {
    if let Some((_, _, reset)) = FOLDER.get() {
        unsafe { reset() }
    }
}

#[tauri::command]
pub async fn apple_folder(request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || unsafe {
        let input = CString::new(request.to_string()).map_err(|_| "invalid")?;
        let (call, free, _) = FOLDER.get().ok_or("unavailable")?;
        let pointer = call(input.as_ptr());
        if pointer.is_null() {
            return Err("unavailable".into());
        }
        let reply = serde_json::from_slice::<Value>(CStr::from_ptr(pointer).to_bytes());
        free(pointer);
        let reply = reply.map_err(|_| "invalid")?;
        if let Some(code) = reply["error"].as_str() {
            return Err(code.to_owned());
        }
        Ok(reply["value"].clone())
    })
    .await
    .map_err(|_| "unavailable".to_owned())?
}
