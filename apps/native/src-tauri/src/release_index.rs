use crate::{catalog::Catalog, release_http, signed_update};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub url: String,
    pub sha256: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub version: String,
    pub build: u64,
    pub status: String,
    pub manifest: Option<Asset>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub format: u32,
    pub kind: String,
    pub channel: String,
    pub track: String,
    pub revision: i64,
    pub host: Option<Host>,
    #[serde(default)]
    pub runtimes: BTreeMap<String, Asset>,
    #[serde(default)]
    pub contents: BTreeMap<String, Asset>,
}
pub fn track() -> &'static str {
    env!("TIO_COMPILED_UPDATE_TRACK")
}
pub fn valid_url(url: &str) -> bool {
    let Ok(url) = url.parse::<tauri::Url>() else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && percent_encoding::percent_decode_str(url.path())
            .decode_utf8()
            .is_ok_and(|path| path.starts_with("/glink25/tio/releases/download/dist/"))
}
pub async fn download(asset: &Asset, limit: usize) -> Result<Vec<u8>, &'static str> {
    if !valid_url(&asset.url) || asset.sha256.len() != 64 {
        return Err("invalid");
    }
    let bytes = release_http::get(&asset.url, None, limit, 60)
        .await?
        .into_body()?;
    if format!("{:x}", Sha256::digest(&bytes)) != asset.sha256 {
        return Err("signature");
    }
    Ok(bytes)
}
fn verify(raw: &str) -> Result<Index, &'static str> {
    let index: Index = signed_update::decode(raw, 2_000_000, &signed_update::public_key()?)?;
    if index.format != 1
        || index.kind != "release-index"
        || Some(index.channel.as_str()) != signed_update::channel()
        || index.track != track()
        || index.revision < 1
    {
        return Err("incompatible");
    }
    if index.host.as_ref().is_some_and(|host| {
        host.version.is_empty()
            || host.version.len() > 128
            || host.build == 0
            || host.build > 2_100_000_000
            || !matches!(
                host.status.as_str(),
                "processing" | "review" | "available" | "rejected"
            )
    }) {
        return Err("invalid");
    }
    if index
        .runtimes
        .keys()
        .chain(index.contents.keys())
        .any(|id| id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err("invalid");
    }
    for asset in index
        .runtimes
        .values()
        .chain(index.contents.values())
        .chain(index.host.iter().filter_map(|h| h.manifest.as_ref()))
    {
        if !valid_url(&asset.url) || asset.sha256.len() != 64 {
            return Err("invalid");
        }
    }
    Ok(index)
}
// Fetching is shared by runtime, content and host updates. Network failure retains the
// last authenticated index; the high watermark never moves backwards.
pub async fn load(app: &AppHandle, force: bool) -> Result<Option<Index>, &'static str> {
    if env!("TIO_COMPILED_RESOURCE_KEY").is_empty() {
        return Ok(None);
    }
    let namespace = format!(
        "{}/{}",
        track(),
        signed_update::channel().ok_or("incompatible")?
    );
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "unavailable")?
        .as_secs() as i64;
    let (cached, etag, checked): (Option<String>, Option<String>, i64) = {
        let catalog = app.state::<Catalog>();
        let db = catalog.0.lock().map_err(|_| "unavailable")?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS update_indexes(namespace TEXT PRIMARY KEY,highest INTEGER NOT NULL DEFAULT 0,envelope TEXT,etag TEXT,checked INTEGER NOT NULL DEFAULT 0)").map_err(|_|"unavailable")?;
        db.execute(
            "INSERT OR IGNORE INTO update_indexes(namespace) VALUES (?1)",
            [&namespace],
        )
        .map_err(|_| "unavailable")?;
        db.query_row(
            "SELECT envelope,etag,checked FROM update_indexes WHERE namespace=?1",
            [&namespace],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "unavailable")?
    };
    if !force && now.saturating_sub(checked) < 6 * 60 * 60 {
        return cached.as_deref().map(verify).transpose();
    }
    let url =
        format!("https://raw.githubusercontent.com/glink25/tio/release-index/{namespace}.json");
    let response = match release_http::get(&url, etag.as_deref(), 2_000_000, 20).await {
        Ok(response) => response,
        Err("unavailable") => return cached.as_deref().map(verify).transpose(),
        Err(error) => return Err(error),
    };
    if response.status == 304 {
        app.state::<Catalog>()
            .0
            .lock()
            .map_err(|_| "unavailable")?
            .execute(
                "UPDATE update_indexes SET checked=?2 WHERE namespace=?1",
                rusqlite::params![namespace, now],
            )
            .map_err(|_| "unavailable")?;
        return cached.as_deref().map(verify).transpose();
    }
    if !response.is_success() {
        return cached.as_deref().map(verify).transpose();
    }
    let release_http::Response { etag, body, .. } = response;
    let raw = String::from_utf8(body).map_err(|_| "invalid")?;
    let index = verify(&raw)?;
    let catalog = app.state::<Catalog>();
    let db = catalog.0.lock().map_err(|_| "unavailable")?;
    let changed=db.execute("UPDATE update_indexes SET highest=?2,envelope=?3,etag=?4,checked=?5 WHERE namespace=?1 AND highest<?2",rusqlite::params![namespace,index.revision,raw,etag,now]).map_err(|_|"unavailable")?;
    if changed == 0 {
        return cached.as_deref().map(verify).transpose();
    }
    Ok(Some(index))
}
#[tauri::command]
pub async fn update_status(app: AppHandle, check: Option<bool>) -> Result<Value, &'static str> {
    if check == Some(true) {
        let _ = load(&app, true).await?;
    }
    let state = app.try_state::<crate::frontend_update::FrontendState>();
    Ok(
        serde_json::json!({"enabled":!env!("TIO_COMPILED_RESOURCE_KEY").is_empty() && !tauri::is_dev(),"channel":signed_update::channel(),"track":track(),"contractId":env!("TIO_COMPILED_CONTRACT_ID"),"hostVersion":env!("TIO_COMPILED_APP_VERSION"),"hostBuild":env!("TIO_COMPILED_BUILD_NUMBER"),"runtime":state.map(|s|s.diagnostics())}),
    )
}
