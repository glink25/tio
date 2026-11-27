use tauri::AppHandle;

#[tauri::command]
pub async fn git_credentials(
    app: AppHandle,
    action: String,
    value: Option<String>,
) -> Result<Option<String>, String> {
    #[cfg(not(target_os = "android"))]
    {
        let service = app.config().identifier.clone();
        tauri::async_runtime::spawn_blocking(move || {
            use keyring::{Entry, Error};
            let entry = Entry::new(&service, "git").map_err(|_| "unavailable".to_owned())?;
            match action.as_str() {
                "read" => match entry.get_password() {
                    Ok(v) => Ok(Some(v)),
                    Err(Error::NoEntry) => Ok(None),
                    Err(_) => Err("unavailable".into()),
                },
                "write" => {
                    entry
                        .set_password(&value.ok_or("invalid")?)
                        .map_err(|_| "unavailable")?;
                    Ok(None)
                }
                "clear" => match entry.delete_credential() {
                    Ok(()) | Err(Error::NoEntry) => Ok(None),
                    Err(_) => Err("unavailable".into()),
                },
                _ => Err("invalid".into()),
            }
        })
        .await
        .map_err(|_| "unavailable".to_owned())?
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let reply: serde_json::Value = app
            .state::<tauri::plugin::PluginHandle<tauri::Wry>>()
            .run_mobile_plugin_async(
                "credential",
                serde_json::json!({"action":action,"value":value}),
            )
            .await
            .map_err(|_| "unavailable")?;
        if reply.get("error").is_some() {
            return Err("unavailable".into());
        }
        Ok(reply["value"].as_str().map(str::to_owned))
    }
}

#[tauri::command]
pub fn open_git_login(app: AppHandle, url: String) -> Result<(), String> {
    #[cfg(any(target_os = "ios", target_os = "macos", target_os = "android"))]
    {
        let _ = (app, url);
        Err("unavailable".into())
    }
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        use tauri_plugin_opener::OpenerExt;
        let parsed = tauri::Url::parse(&url).map_err(|_| "invalid")?;
        if parsed.origin().ascii_serialization() != "https://tio-api.linkai.work"
            || !matches!(parsed.path(), "/api/github/login" | "/api/gitee/login")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.fragment().is_some()
        {
            return Err("invalid".into());
        }
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|_| "unavailable".into())
    }
}
