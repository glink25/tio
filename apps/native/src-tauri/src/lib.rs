mod catalog;
mod clear_storage;
mod credentials;
mod folder;
mod frontend_update;
#[cfg(mobile)]
mod headless_io;
mod host_update;
mod kernel_lease;
mod process_lock;
mod release_http;
mod release_index;
#[cfg(target_os = "ios")]
mod shortcuts;
mod signed_update;
mod updates;
mod workspace;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .manage(folder::FolderLocks::default())
        .manage(process_lock::ProcessLocks::default());
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
    #[cfg(not(target_os = "ios"))]
    let builder = builder.on_page_load(|webview, event| {
        if webview.label() == "main"
            && matches!(event.event(), tauri::webview::PageLoadEvent::Started)
        {
            webview.state::<folder::FolderLocks>().reset();
            webview.state::<process_lock::ProcessLocks>().reset();
        }
    });
    #[cfg(target_os = "ios")]
    let builder = builder.on_page_load(|webview, event| {
        if webview.label() == "main"
            && matches!(event.event(), tauri::webview::PageLoadEvent::Started)
        {
            shortcuts::reset_foreground();
            webview.state::<process_lock::ProcessLocks>().reset();
        }
    });
    builder
        .setup(|app| {
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
            #[cfg(target_os = "android")]
            for config in &app.config().app.windows {
                tauri::WebviewWindowBuilder::from_config(app.handle(), config)?.build()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            catalog::catalog,
            release_index::update_status,
            clear_storage::clear_host_storage,
            frontend_update::frontend_update,
            process_lock::process_lock,
            credentials::github_credentials,
            credentials::open_github_login,
            workspace::workspace,
            folder::native_folder,
            updates::resource_update,
            updates::download_resources,
            host_update::host_update,
            #[cfg(target_os = "ios")]
            shortcuts::apple_folder
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Tio");
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
    for config in &app.config().app.windows {
        tauri::WebviewWindowBuilder::from_config(app, config)?.build()?;
    }
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
