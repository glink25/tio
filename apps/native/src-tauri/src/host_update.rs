use serde_json::json;
use serde_json::Value;
use tauri::AppHandle;

#[tauri::command]
pub async fn host_update(
    app: AppHandle,
    action: String,
    version: Option<String>,
) -> Result<Value, &'static str> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        let _ = (app, action, version);
        return Ok(json!({"status":"store"}));
    }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        use tauri_plugin_updater::UpdaterExt;
        if env!("TIO_COMPILED_UPDATER_KEY").is_empty() {
            return Ok(json!({"status":"disabled"}));
        }
        if action == "capabilities" {
            return Ok(json!({"status":"enabled"}));
        }
        if !matches!(action.as_str(), "check" | "install") {
            return Err("invalid");
        }
        let Some(index) = crate::release_index::load(&app, true).await? else {
            return Ok(json!({"status":"current"}));
        };
        let Some(host) = index.host.filter(|host| host.status == "available") else {
            return Ok(json!({"status":"current"}));
        };
        if host.build
            <= env!("TIO_COMPILED_BUILD_NUMBER")
                .parse::<u64>()
                .map_err(|_| "invalid")?
        {
            return Ok(json!({"status":"current"}));
        }
        let Some(manifest) = host.manifest else {
            return Err("invalid");
        };
        let _verified = crate::release_index::download(&manifest, 2_000_000).await?;
        let updater = app
            .updater_builder()
            .endpoints(vec![manifest.url.parse().map_err(|_| "invalid")?])
            .map_err(|_| "invalid")?
            .build()
            .map_err(|_| "unavailable")?;
        let update = updater.check().await.map_err(|_| "unavailable")?;
        let Some(update) = update else {
            return Ok(json!({"status":"current"}));
        };
        if update.version != host.version {
            return Err("conflict");
        }
        if action == "check" {
            return Ok(json!({"status":"available","version":update.version,"notes":update.body}));
        }
        if version.as_deref() != Some(update.version.as_str()) {
            return Err("conflict");
        }
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|_| "unavailable")?;
        Ok(json!({"status":"installed","version":update.version}))
    }
}
