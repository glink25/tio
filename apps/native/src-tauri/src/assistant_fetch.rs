use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Mutex,
};
use tauri::{ipc::Channel, Manager, State, Url, Webview};

const LIMIT: usize = 64 * 1024;
const METHODS: &[&str] = &["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const RESPONSE_HEADERS: &[&str] = &[
    "cache-control",
    "content-length",
    "content-type",
    "date",
    "etag",
    "last-modified",
    "location",
    "retry-after",
];

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    url: String,
    method: String,
    headers: BTreeMap<String, String>,
    body: Option<String>,
}

impl Request {
    fn validate(&self) -> Result<(), &'static str> {
        let url = Url::parse(&self.url).map_err(|_| "invalid")?;
        if self.url.len() > 4096
            || !matches!(url.scheme(), "http" | "https")
            || url.host().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || !METHODS.contains(&self.method.as_str())
            || self.body.as_ref().is_some_and(|body| {
                body.len() > LIMIT || matches!(self.method.as_str(), "GET" | "HEAD")
            })
            || self.headers.len() > 32
        {
            return Err("invalid");
        }
        for (name, value) in &self.headers {
            if name.is_empty()
                || name.len() > 128
                || !name.bytes().all(|c| {
                    c.is_ascii_lowercase() || c.is_ascii_digit() || b"!#$%&'*+-.^_`|~".contains(&c)
                })
                || value.len() > 4096
                || value.chars().any(|c| c.is_control() && c != '\t')
                || matches!(
                    name.as_str(),
                    "connection"
                        | "content-length"
                        | "cookie"
                        | "cookie2"
                        | "expect"
                        | "host"
                        | "origin"
                        | "referer"
                        | "set-cookie"
                        | "set-cookie2"
                        | "te"
                        | "trailer"
                        | "transfer-encoding"
                        | "upgrade"
                )
                || ["proxy-", "sec-", "access-control-request-"]
                    .iter()
                    .any(|prefix| name.starts_with(prefix))
            {
                return Err("invalid");
            }
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Reply {
    #[serde(rename_all = "camelCase")]
    Completed {
        http_status: u16,
        headers: BTreeMap<String, String>,
        text: String,
        truncated: bool,
    },
    Failed {
        error: Failure,
    },
}

#[derive(Serialize)]
pub struct Failure {
    code: &'static str,
}

struct Pending {
    label: String,
    generation: String,
    token: uuid::Uuid,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Default)]
pub struct AssistantRequests(Mutex<HashMap<String, Pending>>);

impl AssistantRequests {
    pub fn cancel_window(&self, label: &str) {
        if let Ok(mut pending) = self.0.lock() {
            pending.retain(|_, request| {
                if request.label != label {
                    return true;
                }
                request.task.abort();
                false
            });
        }
    }
}

#[tauri::command]
pub fn assistant_fetch(
    webview: Webview,
    requests: State<'_, AssistantRequests>,
    locks: State<'_, crate::process_lock::ProcessLocks>,
    id: String,
    generation: String,
    input: Request,
    done: Channel<Reply>,
) -> Result<(), &'static str> {
    input.validate()?;
    let id = uuid::Uuid::parse_str(&id)
        .map_err(|_| "invalid")?
        .to_string();
    let mut pending = requests.0.lock().map_err(|_| "unavailable")?;
    locks.0.check(webview.label(), &generation)?;
    if pending.contains_key(&id) || pending.len() >= 16 {
        return Err("unavailable");
    }
    let app = webview.app_handle().clone();
    let request_id = id.clone();
    let token = uuid::Uuid::new_v4();
    let task = tauri::async_runtime::spawn(async move {
        let reply = fetch(&token.to_string(), input)
            .await
            .unwrap_or_else(|code| Reply::Failed {
                error: Failure { code },
            });
        let requests = app.state::<AssistantRequests>();
        let Ok(mut pending) = requests.0.lock() else {
            return;
        };
        let current = pending
            .get(&request_id)
            .is_some_and(|entry| entry.token == token);
        if current {
            pending.remove(&request_id);
        }
        drop(pending);
        if current {
            let _ = done.send(reply);
        }
    });
    pending.insert(
        id,
        Pending {
            label: webview.label().into(),
            generation,
            token,
            task,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn cancel_assistant_fetch(
    webview: Webview,
    requests: State<'_, AssistantRequests>,
    id: String,
    generation: String,
) -> Result<(), &'static str> {
    let id = uuid::Uuid::parse_str(&id)
        .map_err(|_| "invalid")?
        .to_string();
    let mut pending = requests.0.lock().map_err(|_| "unavailable")?;
    if pending
        .get(&id)
        .is_some_and(|request| request.label == webview.label() && request.generation == generation)
    {
        if let Some(request) = pending.remove(&id) {
            request.task.abort();
        }
    }
    Ok(())
}

#[cfg(not(target_os = "ios"))]
async fn fetch(_id: &str, input: Request) -> Result<Reply, &'static str> {
    use reqwest::{redirect::Policy, Client, Method};
    let error_code = |error: reqwest::Error| {
        if error.is_timeout() {
            "timeout"
        } else {
            "unavailable"
        }
    };
    let client = Client::builder()
        .redirect(Policy::none())
        .no_proxy()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(error_code)?;
    let mut request = client.request(
        Method::from_bytes(input.method.as_bytes()).map_err(|_| "invalid")?,
        input.url,
    );
    for (name, value) in input.headers {
        request = request.header(name, value);
    }
    if let Some(body) = input.body {
        request = request.body(body);
    }
    let mut response = request.send().await.map_err(error_code)?;
    let http_status = response.status().as_u16();
    let headers = RESPONSE_HEADERS
        .iter()
        .filter_map(|name| {
            Some((
                name.to_string(),
                response.headers().get(*name)?.to_str().ok()?.to_owned(),
            ))
        })
        .collect();
    let mut data = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = response.chunk().await.map_err(error_code)? {
        let remaining = LIMIT - data.len();
        data.extend_from_slice(&chunk[..remaining.min(chunk.len())]);
        if chunk.len() > remaining {
            truncated = true;
            break;
        }
    }
    Ok(Reply::Completed {
        http_status,
        headers,
        text: String::from_utf8_lossy(&data).into_owned(),
        truncated,
    })
}

#[cfg(target_os = "ios")]
mod apple {
    use super::*;
    use std::{
        ffi::{c_char, c_void, CStr, CString},
        sync::OnceLock,
    };
    use tauri::async_runtime::{channel, Sender};

    type Complete = unsafe extern "C" fn(*mut c_void, i32, *const c_char, *const u8, usize, bool);
    type Start = unsafe extern "C" fn(*const c_char, *const c_char, usize, *mut c_void, Complete);
    type Cancel = unsafe extern "C" fn(*const c_char);
    static BRIDGE: OnceLock<(Start, Cancel)> = OnceLock::new();

    #[no_mangle]
    pub extern "C" fn tio_register_assistant_http(start: Start, cancel: Cancel) {
        let _ = BRIDGE.set((start, cancel));
    }

    type ResultSender = Sender<Result<Reply, &'static str>>;

    unsafe extern "C" fn complete(
        context: *mut c_void,
        status: i32,
        headers: *const c_char,
        body: *const u8,
        length: usize,
        truncated: bool,
    ) {
        let sender = Box::from_raw(context.cast::<ResultSender>());
        let result = match status {
            100..=599 if length <= LIMIT => {
                let headers: BTreeMap<String, String> = if headers.is_null() {
                    BTreeMap::new()
                } else {
                    serde_json::from_slice(CStr::from_ptr(headers).to_bytes()).unwrap_or_default()
                };
                let text = if length == 0 {
                    String::new()
                } else {
                    String::from_utf8_lossy(std::slice::from_raw_parts(body, length)).into_owned()
                };
                Ok(Reply::Completed {
                    http_status: status as u16,
                    headers: headers
                        .into_iter()
                        .filter(|(name, _)| RESPONSE_HEADERS.contains(&name.as_str()))
                        .collect(),
                    text,
                    truncated,
                })
            }
            -2 => Err("timeout"),
            _ => Err("unavailable"),
        };
        let _ = sender.try_send(result);
    }

    struct Task(CString, Cancel);
    impl Drop for Task {
        fn drop(&mut self) {
            unsafe { (self.1)(self.0.as_ptr()) };
        }
    }

    pub async fn fetch(id: &str, input: Request) -> Result<Reply, &'static str> {
        let (start, cancel) = *BRIDGE.get().ok_or("unavailable")?;
        let task = Task(CString::new(id).map_err(|_| "invalid")?, cancel);
        let json = CString::new(serde_json::to_vec(&input).map_err(|_| "invalid")?)
            .map_err(|_| "invalid")?;
        let (send, mut receive) = channel(1);
        // Swift owns the sender after this call and completes it once, including on cancellation.
        unsafe {
            start(
                task.0.as_ptr(),
                json.as_ptr(),
                LIMIT,
                Box::into_raw(Box::new(send)).cast(),
                complete,
            );
        }
        let result = receive.recv().await.ok_or("unavailable")?;
        drop(task);
        result
    }
}

#[cfg(target_os = "ios")]
use apple::fetch;
