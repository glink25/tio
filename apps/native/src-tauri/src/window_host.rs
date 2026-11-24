use std::{collections::BTreeMap, sync::Mutex};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

#[derive(Default)]
pub struct Windows(Mutex<Registry>);

#[derive(Default)]
struct Registry {
    windows: BTreeMap<String, WindowEntry>,
    change: Option<ConnectionChange>,
    maintenance_taken: bool,
    leader: Option<String>,
}

struct WindowEntry {
    session: Option<String>,
    pending: Option<String>,
    listening: bool,
    restore_recent: bool,
}

struct ConnectionChange {
    owner: String,
    targets: Vec<String>,
    rejected: bool,
    #[cfg(target_os = "ios")]
    closing: Option<String>,
}

impl Registry {
    fn owner(&self, session: &str) -> Option<&str> {
        self.windows.iter().find_map(|(label, entry)| {
            (entry.session.as_deref() == Some(session) || entry.pending.as_deref() == Some(session))
                .then_some(label.as_str())
        })
    }

    fn insert(&mut self, label: String, session: Option<String>, restore_recent: bool) {
        self.leader.get_or_insert_with(|| label.clone());
        self.windows.insert(
            label,
            WindowEntry {
                session,
                pending: None,
                listening: false,
                restore_recent,
            },
        );
    }
    fn remove(&mut self, label: &str) {
        self.windows.remove(label);
        if self.leader.as_deref() == Some(label) {
            self.leader = self.windows.keys().next().cloned();
        }
    }
}

pub fn build(app: &AppHandle, label: &str) -> tauri::Result<WebviewWindow> {
    let mut config = app.config().app.windows[0].clone();
    config.label = label.into();
    #[cfg(desktop)]
    crate::desktop_chrome::configure(&mut config);
    #[cfg(target_os = "ios")]
    {
        config.visible = false;
        config.focus = false;
        config.disable_input_accessory_view = true;
    }
    let window = tauri::WebviewWindowBuilder::from_config(app, &config)?.build()?;
    #[cfg(desktop)]
    crate::desktop_chrome::install(&window)?;
    #[cfg(target_os = "ios")]
    {
        crate::splash::show(&window);
        window.show()?;
    }
    Ok(window)
}

pub fn initial(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<Windows>();
    // Register before creation: the first page can invoke the host as soon as it loads.
    {
        let mut registry = state.0.lock().unwrap();
        if !registry.windows.is_empty() {
            return Ok(());
        }
        registry.insert("main".into(), None, true);
    }
    if let Err(error) = build(app, "main") {
        state.0.lock().unwrap().remove("main");
        return Err(error);
    }
    Ok(())
}

#[cfg(target_os = "ios")]
pub fn assigned_session(app: &AppHandle, label: &str) -> Option<String> {
    app.state::<Windows>()
        .0
        .lock()
        .ok()?
        .windows
        .get(label)?
        .session
        .clone()
}

#[cfg(target_os = "ios")]
pub fn system_scene(app: &AppHandle, requested: Option<String>) -> tauri::Result<()> {
    if !supports_multiple(app) {
        return Ok(());
    }
    let state = app.state::<Windows>();
    let label = {
        let mut registry = state.0.lock().unwrap();
        if registry.change.is_some() {
            return Ok(());
        }
        if let Some(label) = requested.filter(|label| {
            registry.windows.contains_key(label) && app.get_webview_window(label).is_none()
        }) {
            label
        } else {
            let label = format!("tio-window-{}", uuid::Uuid::new_v4());
            registry.insert(label.clone(), None, false);
            label
        }
    };
    if let Err(error) = build(app, &label) {
        state.0.lock().unwrap().remove(&label);
        return Err(error);
    }
    changed(app);
    Ok(())
}

#[cfg(target_os = "ios")]
pub fn scene_failed(app: &AppHandle, label: &str) {
    if app.get_webview_window(label).is_none() {
        app.state::<Windows>().0.lock().unwrap().remove(label);
        changed(app);
    }
}

fn changed(app: &AppHandle) {
    let _ = app.emit("tio-window-assignments", ());
}

pub fn reset_locks(app: &AppHandle, label: &str) {
    app.state::<crate::process_lock::ProcessLocks>()
        .0
        .renew(label);
    let owner = app.state::<crate::folder::FolderLocks>().0.renew(label);
    #[cfg(target_os = "ios")]
    if let Some(owner) = owner {
        crate::shortcuts::reset_foreground(Some(&owner));
    }
    #[cfg(not(target_os = "ios"))]
    let _ = owner;
}

pub fn reloading(app: &AppHandle, label: &str) {
    reset_locks(app, label);
    let state = app.state::<Windows>();
    if let Some(entry) = state.0.lock().unwrap().windows.get_mut(label) {
        entry.pending = None;
        entry.listening = false;
    };
}

fn destroy(window: &WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "ios")]
    if crate::ipad_scenes::close(window) {
        return Ok(());
    }
    window.destroy()
}

pub fn request_close(window: &WebviewWindow) {
    let app = window.app_handle();
    let listening = app
        .state::<Windows>()
        .0
        .lock()
        .unwrap()
        .windows
        .get(window.label())
        .is_some_and(|entry| entry.listening);
    if listening {
        let _ = window.emit_to(window.label(), "tio-window-close", ());
    } else {
        let _ = destroy(window);
    }
}

#[cfg(target_os = "ios")]
fn advance_scene_close(app: &AppHandle) {
    let (owner, target) = {
        let state = app.state::<Windows>();
        let mut registry = state.0.lock().unwrap();
        let Some(change) = registry.change.as_ref() else {
            return;
        };
        if change.rejected {
            return;
        }
        let target = change
            .targets
            .iter()
            .find(|label| registry.windows.contains_key(*label))
            .cloned();
        let owner = change.owner.clone();
        let change = registry.change.as_mut().unwrap();
        if change.closing == target {
            return;
        }
        change.closing = target.clone();
        (owner, target)
    };
    if let Some(target) = target {
        if let Some(window) = app.get_webview_window(&target) {
            // UIKit suspends the inactive scene's WebView. Resume it before asking it to flush.
            if window.is_focused().unwrap_or(false) {
                request_close(&window);
            } else {
                let _ = focus(app, &target);
            }
        }
    } else {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = focus(&handle, &owner);
            });
        });
    }
}

#[cfg(target_os = "ios")]
pub fn scene_close_failed(app: &AppHandle, label: &str) {
    let state = app.state::<Windows>();
    let mut registry = state.0.lock().unwrap();
    if let Some(change) = registry
        .change
        .as_mut()
        .filter(|change| change.closing.as_deref() == Some(label))
    {
        change.rejected = true;
    }
}

pub fn on_event(window: &tauri::Window, event: &WindowEvent) {
    let app = window.app_handle();
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            if let Some(webview) = app.get_webview_window(window.label()) {
                api.prevent_close();
                request_close(&webview);
            }
        }
        WindowEvent::Destroyed => {
            reset_locks(app, window.label());
            let state = app.state::<Windows>();
            let mut registry = state.0.lock().unwrap();
            registry.remove(window.label());
            if registry
                .change
                .as_ref()
                .is_some_and(|change| change.owner == window.label())
            {
                registry.change = None;
            }
            drop(registry);
            changed(app);
            #[cfg(target_os = "ios")]
            advance_scene_close(app);
        }
        #[cfg(target_os = "ios")]
        WindowEvent::Focused(true) => {
            crate::ipad_scenes::remember_window(window);
            let closing = app
                .state::<Windows>()
                .0
                .lock()
                .unwrap()
                .change
                .as_ref()
                .is_some_and(|change| {
                    !change.rejected && change.closing.as_deref() == Some(window.label())
                });
            if closing {
                if let Some(window) = app.get_webview_window(window.label()) {
                    request_close(&window);
                }
            }
        }

        _ => {}
    }
}

fn supports_multiple(app: &AppHandle) -> bool {
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        return crate::ipad_scenes::supported();
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        cfg!(desktop)
    }
}

fn focus(app: &AppHandle, label: &str) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(label) else {
        return Ok(());
    };
    #[cfg(target_os = "ios")]
    return crate::ipad_scenes::focus(&window);
    #[cfg(desktop)]
    {
        window.unminimize()?;
        window.set_focus()
    }
    #[cfg(target_os = "android")]
    {
        let _ = window;
        Ok(())
    }
}

#[cfg(desktop)]
pub fn focus_existing(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle
            .webview_windows()
            .into_values()
            .find(|window| window.is_focused().unwrap_or(false))
            .or_else(|| handle.get_webview_window("main"))
            .or_else(|| handle.webview_windows().into_values().next())
        {
            let _ = focus(&handle, window.label());
        } else if handle.try_state::<Windows>().is_some() {
            let _ = initial(&handle);
        }
    });
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Request {
    Context,
    Assignments,
    TakeMaintenance,
    CallbackOwner { origin: String },
    Claim { session: String },
    Commit { session: String },
    Cancel,
    Release,
    Open { session: Option<String> },
    Listen,
    Close { allowed: bool },
    BeginChange { session: Option<String> },
    ChangeStatus,
    EndChange,
}

fn run(window: WebviewWindow, request: Request) -> Result<Value, String> {
    let app = window.app_handle();
    let label = window.label();
    let state = app.state::<Windows>();
    let mut registry = state.0.lock().unwrap();
    if !registry.windows.contains_key(label) {
        return Err("closed".into());
    }
    match request {
        Request::Context => {
            #[cfg(target_os = "ios")]
            if registry.windows[label].session.is_none() {
                if let Some(session) = crate::ipad_scenes::restore(&window) {
                    if registry.owner(&session).is_none() {
                        registry.windows.get_mut(label).unwrap().session = Some(session);
                    }
                }
            }
            let entry = &registry.windows[label];
            return Ok(
                json!({"enabled": supports_multiple(app), "session": entry.session,
                "restoreRecent": entry.restore_recent, "desktop": cfg!(desktop),
                "generation": app.state::<crate::process_lock::ProcessLocks>().0.owner(label)?}),
            );
        }
        Request::Assignments => {
            let owned: Vec<_> = registry
                .windows
                .iter()
                .filter_map(|(other, entry)| entry.session.as_ref().map(|session| (session, other)))
                .collect();
            return Ok(json!({"label": label, "leader": registry.leader,
                "sessions": owned.into_iter().collect::<BTreeMap<_, _>>() }));
        }
        Request::CallbackOwner { origin } => {
            return Ok(json!(
                origin == label
                    || (!registry.windows.contains_key(&origin)
                        && registry.leader.as_deref() == Some(label))
            ));
        }
        Request::TakeMaintenance => {
            let take = !registry.maintenance_taken;
            registry.maintenance_taken = true;
            return Ok(json!(take));
        }
        Request::Claim { session } => {
            if registry.change.is_some() {
                return Err("pending".into());
            }
            if let Some(other) = registry.owner(&session).filter(|other| *other != label) {
                let other = other.to_owned();
                drop(registry);
                focus(app, &other).map_err(|_| "unavailable")?;
                return Ok(json!(false));
            }
            registry.windows.get_mut(label).unwrap().pending = Some(session);
            return Ok(json!(true));
        }
        Request::Commit { session } => {
            let entry = registry.windows.get_mut(label).unwrap();
            if entry.pending.as_deref() != Some(&session) {
                return Err("closed".into());
            }
            entry.session = Some(session);
            entry.pending = None;
            entry.restore_recent = false;
        }
        Request::Cancel => {
            registry.windows.get_mut(label).unwrap().pending = None;
            return Ok(Value::Null);
        }

        Request::Release => {
            let entry = registry.windows.get_mut(label).unwrap();
            entry.session = None;
            entry.pending = None;
            entry.restore_recent = false;
        }
        Request::Open { session } => {
            if !supports_multiple(app) {
                return Err("unsupported".into());
            }
            if registry.change.is_some() {
                return Err("pending".into());
            }
            if let Some(other) = session
                .as_deref()
                .and_then(|session| registry.owner(session))
            {
                let other = other.to_owned();
                drop(registry);
                focus(app, &other).map_err(|_| "unavailable")?;
                return Ok(Value::Null);
            }
            let new_label = format!("tio-window-{}", uuid::Uuid::new_v4());
            registry.insert(new_label.clone(), session, false);
            drop(registry);
            #[cfg(target_os = "ios")]
            crate::ipad_scenes::request(&window, &new_label);
            #[cfg(not(target_os = "ios"))]
            if let Err(error) = build(app, &new_label) {
                state.0.lock().unwrap().remove(&new_label);
                if let Some(window) = app.get_webview_window(&new_label) {
                    let _ = window.destroy();
                }
                eprintln!("Tio window unavailable: {error}");
                changed(app);
                return Err("unavailable".into());
            }
            changed(app);
            return Ok(Value::Null);
        }
        Request::Listen => {
            registry.windows.get_mut(label).unwrap().listening = true;
            return Ok(Value::Null);
        }

        Request::Close { allowed } => {
            if !allowed {
                if let Some(change) = registry
                    .change
                    .as_mut()
                    .filter(|change| change.targets.iter().any(|target| target == label))
                {
                    change.rejected = true;
                }
                return Ok(Value::Null);
            }
            drop(registry);
            destroy(&window).map_err(|_| "unavailable")?;
            return Ok(Value::Null);
        }
        Request::BeginChange { session } => {
            if registry.change.is_some() {
                return Err("pending".into());
            }
            let missing: Vec<_> = registry
                .windows
                .keys()
                .filter(|other| other.as_str() != label && app.get_webview_window(other).is_none())
                .cloned()
                .collect();
            for other in missing {
                registry.remove(&other);
            }
            let targets: Vec<_> = registry
                .windows
                .iter()
                .filter_map(|(other, entry)| {
                    (other != label
                        && session.as_ref().is_none_or(|session| {
                            entry.session.as_ref() == Some(session)
                                || entry.pending.as_ref() == Some(session)
                        }))
                    .then_some(other.clone())
                })
                .collect();
            registry.change = Some(ConnectionChange {
                owner: label.into(),
                targets: targets.clone(),
                rejected: false,
                #[cfg(target_os = "ios")]
                closing: None,
            });
            drop(registry);
            #[cfg(target_os = "ios")]
            advance_scene_close(app);
            #[cfg(not(target_os = "ios"))]
            for target in targets {
                if let Some(window) = app.get_webview_window(&target) {
                    request_close(&window);
                }
            }
            return Ok(Value::Null);
        }
        Request::ChangeStatus => {
            let change = registry
                .change
                .as_ref()
                .filter(|change| change.owner == label)
                .ok_or("closed")?;
            if change.rejected {
                return Err("pending".into());
            }
            return Ok(json!(change
                .targets
                .iter()
                .all(|target| !registry.windows.contains_key(target))));
        }
        Request::EndChange => {
            if registry
                .change
                .as_ref()
                .is_some_and(|change| change.owner == label)
            {
                registry.change = None;
            }
            return Ok(Value::Null);
        }
    }
    #[cfg(target_os = "ios")]
    let session = registry.windows[label].session.clone();
    drop(registry);
    #[cfg(target_os = "ios")]
    crate::ipad_scenes::remember(app, label, session.as_deref());
    changed(app);
    Ok(Value::Null)
}

#[tauri::command]
pub async fn window_host(window: WebviewWindow, request: Request) -> Result<Value, String> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let app = window.app_handle().clone();
    app.run_on_main_thread(move || {
        let _ = send.send(run(window, request));
    })
    .map_err(|_| "unavailable")?;
    tauri::async_runtime::spawn_blocking(move || {
        receive.recv().map_err(|_| "unavailable".to_owned())?
    })
    .await
    .map_err(|_| "unavailable".to_owned())?
}
