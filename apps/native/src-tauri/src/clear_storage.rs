use crate::catalog::Catalog;
use std::fs;
use tauri::{AppHandle, Manager};

/// Called only after the host has stopped its editing sessions and sync runners.
#[tauri::command]
pub async fn clear_host_storage(app: AppHandle) -> Result<(), String> {
    let directory = app.path().app_data_dir().map_err(|_| "unavailable")?;
    let catalog = directory.join("catalog.sqlite3");
    let lease_path = catalog.clone();
    let _lease = tauri::async_runtime::spawn_blocking(move || {
        crate::kernel_lease::transition(&lease_path)?.ok_or("pending")
    })
    .await
    .map_err(|_| "unavailable")??;
    crate::credentials::github_credentials(app.clone(), "clear".into(), None).await?;
    #[cfg(target_os = "android")]
    {
        let reply: serde_json::Value = app
            .state::<tauri::plugin::PluginHandle<tauri::Wry>>()
            .run_mobile_plugin_async("clearStorage", serde_json::json!({}))
            .await
            .map_err(|_| "unavailable")?;
        if let Some(code) = reply["error"].as_str() {
            return Err(code.to_owned());
        }
    }
    #[cfg(target_os = "ios")]
    {
        crate::shortcuts::reset_foreground(None);
        crate::shortcuts::call_folder(serde_json::json!({"action":"forgetAll"})).await?;
    }
    #[cfg(not(target_os = "ios"))]
    app.state::<crate::folder::FolderLocks>().0.reset();
    app.state::<crate::process_lock::ProcessLocks>().0.reset();
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        // Signed application resources and their anti-replay state contain no workspace data.
        let catalog = handle.state::<Catalog>();
        let mut db = catalog.0.lock().map_err(|_| "unavailable")?;
        let tables: Vec<String> = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('resource_updates','frontend_updates','update_indexes')")
            .map_err(|_|"unavailable")?.query_map([], |row| row.get(0)).map_err(|_|"unavailable")?
            .collect::<Result<_,_>>().map_err(|_|"unavailable")?;
        let transaction = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_|"unavailable")?;
        for table in tables {
            transaction.execute(&format!("DELETE FROM \"{}\"", table.replace('"', "\"\"")), []).map_err(|_|"unavailable")?;
        }
        transaction.commit().map_err(|_|"unavailable")?;
        for name in ["replicas", "folder-locks", "process-locks"] {
            let path = directory.join(name);
            if path.exists() { fs::remove_dir_all(path).map_err(|_|"unavailable")?; }
        }
        Ok(())
    }).await.map_err(|_| "unavailable")?
}
