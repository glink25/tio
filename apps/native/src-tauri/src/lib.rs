mod assistant_fetch;
mod catalog;
mod clear_storage;
mod credentials;
#[cfg(desktop)]
mod desktop_chrome;
mod folder;
mod frontend_update;
#[cfg(any(target_os = "ios", target_os = "macos", target_os = "android"))]
mod git_auth;
#[cfg(mobile)]
mod headless_io;
mod host_update;
#[cfg(target_os = "ios")]
mod ipad_scenes;
mod kernel_lease;
mod process_lock;
mod release_http;
mod release_index;
#[cfg(target_os = "ios")]
mod shortcuts;
mod signed_update;
#[cfg(mobile)]
mod splash;
mod updates;
mod window_host;
mod window_locks;
mod workspace;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        window_host::focus_existing(app);
    }));
    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .manage(process_lock::ProcessLocks::default())
        .manage(assistant_fetch::AssistantRequests::default())
        .manage(window_host::Windows::default())
        .manage(updates::ResourceBoot::default());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(splash::android_plugin());
    let builder = if !tauri::is_dev() {
        builder.register_uri_scheme_protocol("tauri", |context, request| {
            frontend_update::serve(context.app_handle(), request)
        })
    } else {
        builder
    };
    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("folders")
            .setup(|app, api| {
                app.manage(api.register_android_plugin("com.glink25.tio", "FolderPlugin")?);
                Ok(())
            })
            .build(),
    );
    builder
        .on_page_load(|webview, event| {
            if matches!(event.event(), tauri::webview::PageLoadEvent::Started) {
                window_host::reloading(webview.app_handle(), webview.label());
            }
        })
        .on_window_event(window_host::on_event)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            desktop_chrome::install_app_menu(app.handle())?;
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if !env!("TIO_COMPILED_UPDATER_KEY").is_empty() {
                app.handle().plugin(
                    tauri_plugin_updater::Builder::new()
                        .pubkey(env!("TIO_COMPILED_UPDATER_KEY"))
                        .build(),
                )?;
            }
            app.manage(catalog::Catalog::open(app.handle())?);
            #[cfg(not(target_os = "ios"))]
            app.manage(frontend_update::open(app.handle()).map_err(std::io::Error::other)?);
            #[cfg(target_os = "ios")]
            {
                let _ = IOS_APP.set(app.handle().clone());
                if IOS_ACTIVE.get().is_some_and(|read| read()) {
                    show_ios_app(app.handle())?;
                }
            }
            #[cfg(not(target_os = "ios"))]
            window_host::initial(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            catalog::catalog,
            assistant_fetch::assistant_fetch,
            assistant_fetch::cancel_assistant_fetch,
            window_host::window_host,
            #[cfg(desktop)]
            desktop_chrome::desktop_chrome_state,
            #[cfg(desktop)]
            desktop_chrome::desktop_chrome_title,
            #[cfg(mobile)]
            splash::mobile_startup,
            #[cfg(target_os = "android")]
            splash::set_overlay_back,
            release_index::update_status,
            clear_storage::clear_host_storage,
            frontend_update::frontend_update,
            process_lock::process_lock,
            credentials::git_credentials,
            credentials::open_git_login,
            #[cfg(any(target_os = "ios", target_os = "macos", target_os = "android"))]
            git_auth::authenticate_git,
            workspace::workspace,
            folder::native_folder,
            updates::resource_update,
            updates::download_resources,
            host_update::host_update,
            #[cfg(target_os = "ios")]
            shortcuts::apple_folder
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Tio host")
        .run(|app, event| match event {
            #[cfg(desktop)]
            tauri::RunEvent::ExitRequested { api, code, .. }
                if code != Some(tauri::RESTART_EXIT_CODE) && !app.webview_windows().is_empty() =>
            {
                api.prevent_exit();
                for window in app.webview_windows().into_values() {
                    window_host::request_close(&window);
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => {
                if let Err(error) = window_host::initial(app) {
                    eprintln!("Tio window unavailable: {error}");
                }
            }
            #[cfg(target_os = "ios")]
            tauri::RunEvent::SceneRequested { options, .. } => {
                let requested = ipad_scenes::requested_label(&*options as *const _ as *const _);
                if let Err(error) = window_host::system_scene(app, requested) {
                    eprintln!("Tio scene unavailable: {error}");
                }
            }
            _ => {
                let _ = app;
            }
        });
}

#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn tio_desktop_main() {
    run();
}

#[cfg(target_os = "ios")]
static IOS_APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

#[cfg(target_os = "ios")]
static IOS_ACTIVE: std::sync::OnceLock<extern "C" fn() -> bool> = std::sync::OnceLock::new();

#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn tio_set_foreground_reader(read: extern "C" fn() -> bool) {
    let _ = IOS_ACTIVE.set(read);
}

#[cfg(target_os = "ios")]
fn show_ios_app(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }
    if app.try_state::<frontend_update::FrontendState>().is_none() {
        app.manage(frontend_update::open(app).map_err(std::io::Error::other)?);
    }
    window_host::initial(app)?;
    Ok(())
}

#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn tio_activate_foreground() {
    if let Some(app) = IOS_APP.get() {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(error) = show_ios_app(&handle) {
                eprintln!("Tio foreground unavailable: {error}");
            }
        });
    }
}

#[cfg(target_os = "ios")]
#[no_mangle]
pub unsafe extern "C" fn tio_scene_request_failed(label: *const std::ffi::c_char) {
    if let (Some(app), Ok(label)) = (IOS_APP.get(), std::ffi::CStr::from_ptr(label).to_str()) {
        window_host::scene_failed(app, label);
    }
}

#[cfg(target_os = "ios")]
#[no_mangle]
pub unsafe extern "C" fn tio_scene_close_failed(label: *const std::ffi::c_char) {
    if let (Some(app), Ok(label)) = (IOS_APP.get(), std::ffi::CStr::from_ptr(label).to_str()) {
        window_host::scene_close_failed(app, label);
    }
}
