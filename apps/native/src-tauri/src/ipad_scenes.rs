use crate::catalog::Catalog;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use std::ffi::{c_char, c_void, CStr, CString};
use tauri::{AppHandle, Manager, WebviewWindow, Window};

type Supports = unsafe extern "C" fn() -> bool;
type Focus = unsafe extern "C" fn(*const c_char) -> bool;
type Close = unsafe extern "C" fn(*const c_char, *const c_char) -> bool;
type Request = unsafe extern "C" fn(*const c_char, *const c_char);
type Label = unsafe extern "C" fn(*const c_void) -> *mut c_char;
type Free = unsafe extern "C" fn(*mut c_char);
static SCENES: std::sync::OnceLock<(Supports, Focus, Request, Label, Free, Close)> =
    std::sync::OnceLock::new();

#[no_mangle]
pub extern "C" fn tio_register_scenes(
    supports: Supports,
    focus: Focus,
    request: Request,
    label: Label,
    free: Free,
    close: Close,
) {
    let _ = SCENES.set((supports, focus, request, label, free, close));
}

pub fn supported() -> bool {
    SCENES
        .get()
        .is_some_and(|(supports, ..)| unsafe { supports() })
}

pub fn focus(window: &WebviewWindow) -> tauri::Result<()> {
    if let (Some((_, focus, ..)), Ok(id)) =
        (SCENES.get(), window.as_ref().window().scene_identifier())
    {
        let id = CString::new(id).expect("UIKit scene identifiers have no NUL bytes");
        unsafe {
            focus(id.as_ptr());
        }
    }
    Ok(())
}

pub fn identifier(app: &AppHandle, label: &str) -> Option<String> {
    app.get_webview_window(label)?
        .as_ref()
        .window()
        .scene_identifier()
        .ok()
}

pub fn request(window: &WebviewWindow, label: &str) {
    let Some((_, _, request, ..)) = SCENES.get() else {
        return;
    };
    let id = identifier(window.app_handle(), window.label()).and_then(|id| CString::new(id).ok());
    let label = CString::new(label).expect("Tio window labels have no NUL bytes");
    unsafe {
        request(
            id.as_ref().map_or(std::ptr::null(), |id| id.as_ptr()),
            label.as_ptr(),
        );
    }
}

pub fn close(window: &WebviewWindow) -> bool {
    let Some((_, _, _, _, _, close)) = SCENES.get() else {
        return false;
    };
    let Some(id) =
        identifier(window.app_handle(), window.label()).and_then(|id| CString::new(id).ok())
    else {
        return false;
    };
    let label = CString::new(window.label()).expect("Tio window labels have no NUL bytes");
    unsafe { close(id.as_ptr(), label.as_ptr()) }
}

pub fn requested_label(options: *const c_void) -> Option<String> {
    let (_, _, _, label, free, _) = SCENES.get()?;
    unsafe {
        let value = label(options);
        if value.is_null() {
            return None;
        }
        let label = CStr::from_ptr(value).to_string_lossy().into_owned();
        free(value);
        Some(label)
    }
}

pub fn restore(window: &WebviewWindow) -> Option<String> {
    let id = window.as_ref().window().scene_identifier().ok()?;
    let catalog = window.state::<Catalog>();
    let db = catalog.0.lock().ok()?;
    let value: String = db
        .query_row(
            "SELECT value FROM settings WHERE key=?1",
            [format!("scene/{id}")],
            |row| row.get(0),
        )
        .optional()
        .ok()??;
    serde_json::from_str(&value).ok()
}

pub fn remember(app: &AppHandle, label: &str, session: Option<&str>) {
    let Some(id) = identifier(app, label) else {
        return;
    };
    let key = format!("scene/{id}");
    let catalog = app.state::<Catalog>();
    let Ok(db) = catalog.0.lock() else { return };
    let result = if let Some(session) = session {
        db.execute(
            "INSERT OR REPLACE INTO settings VALUES (?1, ?2)",
            params![key, Value::String(session.into()).to_string()],
        )
    } else {
        db.execute("DELETE FROM settings WHERE key=?1", [key])
    };
    if let Err(error) = result {
        eprintln!("Tio scene state unavailable: {error}");
    }
}

pub fn remember_window(window: &Window) {
    let app = window.app_handle();
    if let Some(session) = crate::window_host::assigned_session(app, window.label()) {
        remember(app, window.label(), Some(&session));
    }
}
