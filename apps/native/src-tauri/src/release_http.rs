pub struct Response {
    pub status: u16,
    pub etag: Option<String>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn into_body(self) -> Result<Vec<u8>, &'static str> {
        self.is_success().then_some(self.body).ok_or("unavailable")
    }
}

#[cfg(not(target_os = "ios"))]
pub async fn get(
    url: &str,
    etag: Option<&str>,
    limit: usize,
    seconds: u32,
) -> Result<Response, &'static str> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(seconds.into()))
        .build()
        .map_err(|_| "unavailable")?;
    let mut request = client.get(url);
    if let Some(etag) = etag {
        request = request.header("If-None-Match", etag);
    }
    let mut response = request.send().await.map_err(|_| "unavailable")?;
    let mut result = Response {
        status: response.status().as_u16(),
        etag: response
            .headers()
            .get("etag")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned),
        body: Vec::new(),
    };
    if result.is_success() {
        while let Some(chunk) = response.chunk().await.map_err(|_| "unavailable")? {
            if chunk.len() > limit - result.body.len() {
                return Err("invalid");
            }
            result.body.extend_from_slice(&chunk);
        }
    }
    Ok(result)
}

#[cfg(target_os = "ios")]
use std::ffi::{c_char, c_void};

#[cfg(target_os = "ios")]
type Complete = unsafe extern "C" fn(*mut c_void, i32, *const c_char, *const u8, usize);

#[cfg(target_os = "ios")]
type Get = unsafe extern "C" fn(*const c_char, *const c_char, usize, u32, *mut c_void, Complete);

#[cfg(target_os = "ios")]
static GET: std::sync::OnceLock<Get> = std::sync::OnceLock::new();

#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn tio_register_update_http(get: Get) {
    let _ = GET.set(get);
}

#[cfg(target_os = "ios")]
pub async fn get(
    url: &str,
    etag: Option<&str>,
    limit: usize,
    seconds: u32,
) -> Result<Response, &'static str> {
    use std::ffi::{CStr, CString};

    type Reply = Result<Response, &'static str>;
    unsafe extern "C" fn complete(
        context: *mut c_void,
        status: i32,
        etag: *const c_char,
        bytes: *const u8,
        length: usize,
    ) {
        let result = &mut *context.cast::<Reply>();
        *result = match status {
            100..=599 => Ok(Response {
                status: status as u16,
                etag: (!etag.is_null())
                    .then(|| CStr::from_ptr(etag).to_str().ok().map(str::to_owned))
                    .flatten(),
                body: if length == 0 {
                    Vec::new()
                } else {
                    std::slice::from_raw_parts(bytes, length).to_vec()
                },
            }),
            -2 => Err("invalid"),
            _ => Err("unavailable"),
        };
    }

    let get = *GET.get().ok_or("unavailable")?;
    let url = CString::new(url).map_err(|_| "invalid")?;
    let etag = etag.map(CString::new).transpose().map_err(|_| "invalid")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut result: Reply = Err("unavailable");
        // Swift calls back once before returning, with borrowed response buffers.
        unsafe {
            get(
                url.as_ptr(),
                etag.as_ref()
                    .map_or(std::ptr::null(), |value| value.as_ptr()),
                limit,
                seconds,
                std::ptr::from_mut(&mut result).cast(),
                complete,
            );
        }
        result
    })
    .await
    .map_err(|_| "unavailable")?
}
