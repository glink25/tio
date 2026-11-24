use serde::{Deserialize, Serialize};
use tauri::Webview;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StartupStatus {
    Ready,
    Failed,
}

#[tauri::command]
pub async fn mobile_startup(webview: Webview, status: StartupStatus) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let &(_, finish) = IOS_STARTUP.get().ok_or("unavailable")?;
        webview
            .with_webview(move |view| unsafe {
                finish(view.inner(), matches!(status, StartupStatus::Ready));
            })
            .map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        mobile_call(
            webview.app_handle(),
            "startup",
            serde_json::json!({ "status": status }),
        )
        .await?;
    }
    Ok(())
}

#[cfg(target_os = "ios")]
type Show = unsafe extern "C" fn(*mut std::ffi::c_void);
#[cfg(target_os = "ios")]
type Finish = unsafe extern "C" fn(*mut std::ffi::c_void, bool);
#[cfg(target_os = "ios")]
static IOS_STARTUP: std::sync::OnceLock<(Show, Finish)> = std::sync::OnceLock::new();

#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn tio_register_startup(show: Show, finish: Finish) {
    let _ = IOS_STARTUP.set((show, finish));
}

#[cfg(target_os = "ios")]
pub fn show(window: &tauri::WebviewWindow) {
    let Some(&(show, _)) = IOS_STARTUP.get() else {
        return;
    };
    if let Err(error) = window.with_webview(move |view| unsafe { show(view.inner()) }) {
        eprintln!("Tio startup view unavailable: {error}");
    }
}

#[cfg(target_os = "android")]
struct AndroidHostUi(tauri::plugin::PluginHandle<tauri::Wry>);

#[cfg(target_os = "android")]
pub fn android_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri::Manager;
    tauri::plugin::Builder::new("host-ui")
        .setup(|app, api| {
            app.manage(AndroidHostUi(
                api.register_android_plugin("com.glink25.tio", "HostUiPlugin")?,
            ));
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
async fn mobile_call(
    app: &tauri::AppHandle,
    command: &str,
    args: serde_json::Value,
) -> Result<(), String> {
    use tauri::Manager;
    app.state::<AndroidHostUi>()
        .0
        .run_mobile_plugin_async::<serde_json::Value>(command, args)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn set_overlay_back(webview: Webview, available: bool) -> Result<(), String> {
    use tauri::Manager;
    mobile_call(
        webview.app_handle(),
        "setOverlayBack",
        serde_json::json!({"available": available}),
    )
    .await
}
