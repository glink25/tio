#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{AppHandle, State, Url, Webview};

use crate::process_lock::ProcessLocks;

fn parameter(url: &Url, key: &str) -> Result<String, &'static str> {
    let mut values = url.query_pairs().filter(|(name, _)| name == key);
    let value = values.next().ok_or("invalid")?.1.into_owned();
    if value.is_empty() || values.next().is_some() {
        return Err("invalid");
    }
    Ok(value)
}

fn pkce_parameter(url: &Url, key: &str) -> Result<String, &'static str> {
    let value = parameter(url, key)?;
    if value.len() != 43
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("invalid");
    }
    Ok(value)
}

#[tauri::command]
pub async fn authenticate_git(
    webview: Webview,
    locks: State<'_, ProcessLocks>,
    url: String,
    generation: String,
) -> Result<Option<String>, &'static str> {
    let login = Url::parse(&url).map_err(|_| "invalid")?;
    let worker = Url::parse(env!("TIO_COMPILED_AUTH_URL")).map_err(|_| "invalid")?;
    let provider = match login.path() {
        "/api/github/login" => "github",
        "/api/gitee/login" => "gitee",
        _ => return Err("invalid"),
    };
    if login.scheme() != "https"
        || login.origin() != worker.origin()
        || !login.username().is_empty()
        || login.password().is_some()
        || login.fragment().is_some()
    {
        return Err("invalid");
    }
    let redirect = format!("tio://auth/{provider}");
    if parameter(&login, "redirect_uri")? != redirect {
        return Err("invalid");
    }
    let state = pkce_parameter(&login, "state")?;
    pkce_parameter(&login, "code_challenge")?;
    locks.0.check(webview.label(), &generation)?;
    #[cfg(target_os = "android")]
    let reply = crate::splash::mobile_reply(
        webview.app_handle(),
        "authenticateGit",
        serde_json::json!({"url":url,"redirect":redirect,"state":state,"owner":generation}),
    )
    .await
    .map_err(|_| "unavailable")
    .and_then(|reply| match reply["status"].as_str() {
        Some("cancelled") => Ok(None),
        Some("completed") => reply["callback"]
            .as_str()
            .map(|callback| Some(callback.to_owned()))
            .ok_or("invalid"),
        _ => Err("unavailable"),
    })?;
    #[cfg(any(target_os = "ios", target_os = "macos"))]
    let reply = apple::authenticate(&webview, &url, &generation).await?;
    locks.0.check(webview.label(), &generation)?;
    if let Some(callback) = &reply {
        let mut parsed = Url::parse(callback).map_err(|_| "invalid")?;
        if parameter(&parsed, "state")? != state || parsed.fragment().is_some() {
            return Err("invalid");
        }
        parsed.set_query(None);
        if parsed.as_str() != redirect {
            return Err("invalid");
        }
    }
    Ok(reply)
}

pub fn cancel(app: &AppHandle, owner: String) {
    #[cfg(target_os = "android")]
    {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = crate::splash::mobile_reply(
                &app,
                "cancelGitAuthentication",
                serde_json::json!({"owner":owner}),
            )
            .await;
        });
    }
    #[cfg(any(target_os = "ios", target_os = "macos"))]
    apple::cancel(app, owner);
}

#[cfg(any(target_os = "ios", target_os = "macos"))]
mod apple {
    use std::ffi::{c_char, c_void, CStr, CString};

    use tauri::async_runtime::{channel, Sender};
    use tauri::{AppHandle, Webview};

    type Reply = Result<Option<String>, &'static str>;
    type Complete = unsafe extern "C" fn(*mut c_void, i32, *const c_char);
    extern "C" {
        fn tio_start_git_auth(
            webview: *mut c_void,
            url: *const c_char,
            owner: *const c_char,
            context: *mut c_void,
            complete: Complete,
        );
        fn tio_cancel_git_auth(owner: *const c_char);
    }

    unsafe extern "C" fn complete(context: *mut c_void, status: i32, callback: *const c_char) {
        let sender = Box::from_raw(context.cast::<Sender<Reply>>());
        let result = match status {
            0 if !callback.is_null() => CStr::from_ptr(callback)
                .to_str()
                .map(|value| Some(value.to_owned()))
                .map_err(|_| "invalid"),
            1 => Ok(None),
            _ => Err("unavailable"),
        };
        let _ = sender.try_send(result);
    }

    pub async fn authenticate(webview: &Webview, url: &str, owner: &str) -> Reply {
        let url = CString::new(url).map_err(|_| "invalid")?;
        let owner = CString::new(owner).map_err(|_| "invalid")?;
        let (send, mut receive) = channel(1);
        webview
            .with_webview(move |view| unsafe {
                tio_start_git_auth(
                    view.inner(),
                    url.as_ptr(),
                    owner.as_ptr(),
                    Box::into_raw(Box::new(send)).cast(),
                    complete,
                );
            })
            .map_err(|_| "unavailable")?;
        receive.recv().await.ok_or("unavailable")?
    }

    pub fn cancel(app: &AppHandle, owner: String) {
        if let Ok(owner) = CString::new(owner) {
            let _ = app.run_on_main_thread(move || unsafe { tio_cancel_git_auth(owner.as_ptr()) });
        }
    }
}
