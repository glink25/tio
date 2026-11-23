use crate::catalog::Catalog;
use crate::signed_update::{self, Envelope};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};

const MAX_ARCHIVE: usize = 32 * 1024 * 1024;
const MAX_EXPANDED: u64 = 128 * 1024 * 1024;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    format: u32,
    kind: String,
    channel: String,
    compatible_contract_ids: Vec<String>,
    product_version: String,
    runtime_id: String,
    archive_url: String,
    revision: i64,
    archive_sha256: String,
    kernel_sha256: String,
    files: BTreeMap<String, String>,
}
pub struct FrontendState {
    active: Option<(Manifest, PathBuf)>,
    channel: String,
    staging: std::sync::Mutex<()>,
    boot_lease: std::sync::Mutex<Option<fs::File>>,
}
fn namespace() -> String {
    format!(
        "{}/{}/{}",
        signed_update::channel().unwrap_or_default(),
        env!("TIO_COMPILED_CONTRACT_ID"),
        crate::release_index::track()
    )
}
impl FrontendState {
    pub fn runtime_id(&self) -> &str {
        self.active
            .as_ref()
            .map(|(m, _)| m.runtime_id.as_str())
            .unwrap_or(env!("TIO_COMPILED_RUNTIME_ID"))
    }
    pub fn diagnostics(&self) -> Value {
        json!({"productVersion":self.active.as_ref().map(|(m,_)|m.product_version.as_str()).unwrap_or(env!("TIO_COMPILED_PRODUCT_VERSION")),"revision":self.active.as_ref().map(|(m,_)|m.revision).unwrap_or(0),"runtimeId":self.runtime_id()})
    }
}
fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && !path.contains(':')
        && Path::new(path)
            .components()
            .all(|p| matches!(p, Component::Normal(_)))
}
fn verify(raw: &str, channel: &str) -> Result<Manifest, &'static str> {
    let key = signed_update::public_key()?;
    let manifest: Manifest = signed_update::decode(raw, 2_000_000, &key)?;
    if manifest.format != 1
        || manifest.kind != "frontend-patch"
        || manifest.channel != channel
        || manifest.revision < 1
        || manifest.archive_sha256.len() != 64
        || !manifest
            .archive_sha256
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
        || !manifest.files.contains_key("index.html")
        || manifest.files.len() > 10000
        || manifest.files.iter().any(|(p, h)| {
            !safe_path(p) || h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit())
        })
    {
        return Err("invalid");
    }
    if manifest.files.get("native-kernel.js") != Some(&manifest.kernel_sha256)
        || !manifest
            .compatible_contract_ids
            .iter()
            .any(|id| id == env!("TIO_COMPILED_CONTRACT_ID"))
        || manifest.revision
            < env!("TIO_COMPILED_RUNTIME_REVISION")
                .parse::<i64>()
                .map_err(|_| "invalid")?
        || manifest.runtime_id.len() != 64
        || manifest.product_version.is_empty()
        || !crate::release_index::valid_url(&manifest.archive_url)
    {
        return Err("incompatible");
    }
    Ok(manifest)
}
fn directory(app: &AppHandle, manifest: &Manifest) -> Result<PathBuf, &'static str> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "unavailable")?
        .join("frontend-packs")
        .join(&manifest.archive_sha256))
}
fn validate_files(root: &Path, manifest: &Manifest) -> Result<(), &'static str> {
    for (path, hash) in &manifest.files {
        let path = root.join(path);
        if fs::metadata(&path).map_err(|_| "unavailable")?.len() > MAX_EXPANDED {
            return Err("invalid");
        }
        let bytes = fs::read(path).map_err(|_| "unavailable")?;
        if format!("{:x}", Sha256::digest(bytes)) != *hash {
            return Err("signature");
        }
    }
    Ok(())
}
pub fn open(app: &AppHandle) -> Result<FrontendState, &'static str> {
    let channel = signed_update::channel().unwrap_or_default().to_owned();
    let mut state = FrontendState {
        active: None,
        channel,
        staging: std::sync::Mutex::new(()),
        boot_lease: std::sync::Mutex::new(None),
    };
    if state.channel.is_empty() || env!("TIO_COMPILED_RESOURCE_KEY").is_empty() || tauri::is_dev() {
        return Ok(state);
    }
    let catalog_path = app
        .path()
        .app_data_dir()
        .map_err(|error| {
            eprintln!("Frontend activation failed: {error}");
            "unavailable"
        })?
        .join("catalog.sqlite3");
    let lease = crate::kernel_lease::transition(&catalog_path)?;
    if lease.is_none() {
        state.active = confirmed_bundle(&catalog_path)?;
        if let Some((manifest, root)) = &state.active {
            validate_files(root, manifest)?;
        }
        return Ok(state);
    }
    let catalog = app.state::<Catalog>();
    let mut db = catalog.0.lock().map_err(|error| {
        eprintln!("Frontend activation failed: {error}");
        "unavailable"
    })?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS frontend_updates(namespace TEXT PRIMARY KEY,highest INTEGER NOT NULL DEFAULT 0,pending TEXT,trial TEXT,confirmed TEXT);").map_err(|_|"unavailable")?;
    let namespace = namespace();
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| {
            eprintln!("Frontend activation failed: {error}");
            "unavailable"
        })?;
    tx.execute(
        "INSERT OR IGNORE INTO frontend_updates(namespace) VALUES(?1)",
        [&namespace],
    )
    .map_err(|error| {
        eprintln!("Frontend activation failed: {error}");
        "unavailable"
    })?;
    tx.execute(
        "UPDATE frontend_updates SET trial=pending,pending=NULL WHERE namespace=?1",
        [&namespace],
    )
    .map_err(|error| {
        eprintln!("Frontend activation failed: {error}");
        "unavailable"
    })?;
    let (trial, confirmed): (Option<String>, Option<String>) = tx
        .query_row(
            "SELECT trial,confirmed FROM frontend_updates WHERE namespace=?1",
            [&namespace],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|error| {
            eprintln!("Frontend activation failed: {error}");
            "unavailable"
        })?;
    for (index, raw) in [trial, confirmed].into_iter().enumerate() {
        let Some(raw) = raw else {
            continue;
        };
        if let Ok(manifest) = verify(&raw, &state.channel) {
            if let Ok(root) = directory(app, &manifest) {
                if validate_files(&root, &manifest).is_ok() {
                    state.active = Some((manifest, root));
                    break;
                }
            }
        }
        let field = if index == 0 { "trial" } else { "confirmed" };
        tx.execute(
            &format!("UPDATE frontend_updates SET {field}=NULL WHERE namespace=?1"),
            [&namespace],
        )
        .map_err(|error| {
            eprintln!("Frontend activation failed: {error}");
            "unavailable"
        })?;
    }
    let trial: bool = tx
        .query_row(
            "SELECT trial IS NOT NULL FROM frontend_updates WHERE namespace=?1",
            [&namespace],
            |r| r.get(0),
        )
        .map_err(|error| {
            eprintln!("Frontend activation failed: {error}");
            "unavailable"
        })?;
    tx.commit().map_err(|error| {
        eprintln!("Frontend activation failed: {error}");
        "unavailable"
    })?;
    if trial {
        *state.boot_lease.lock().map_err(|error| {
            eprintln!("Frontend activation failed: {error}");
            "unavailable"
        })? = lease;
    }
    prune(app, &db, true);
    Ok(state)
}
fn stage(
    app: &AppHandle,
    state: &FrontendState,
    envelope: &str,
    bytes: &[u8],
) -> Result<&'static str, &'static str> {
    let _staging = state.staging.lock().map_err(|_| "unavailable")?;
    if bytes.len() > MAX_ARCHIVE {
        return Err("invalid");
    }
    let manifest = verify(envelope, &state.channel)?;
    if manifest.archive_sha256.len() != 64
        || format!("{:x}", Sha256::digest(bytes)) != manifest.archive_sha256
    {
        return Err("signature");
    }
    {
        let catalog = app.state::<Catalog>();
        let db = catalog.0.lock().map_err(|_| "unavailable")?;
        let namespace = namespace();
        let highest: i64 = db
            .query_row(
                "SELECT highest FROM frontend_updates WHERE namespace=?1",
                [namespace],
                |r| r.get(0),
            )
            .map_err(|_| "unavailable")?;
        if manifest.revision <= highest {
            return Ok("ignored");
        }
    }
    let root = directory(app, &manifest)?;
    let parent = root.parent().ok_or("invalid")?;
    fs::create_dir_all(parent).map_err(|_| "unavailable")?;
    let temporary = parent.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir(&temporary).map_err(|_| "unavailable")?;
    let extract = || -> Result<(), &'static str> {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
        let mut found = BTreeMap::new();
        let mut total = 0u64;
        for entry in archive.entries().map_err(|_| "invalid")? {
            let mut entry = entry.map_err(|_| "invalid")?;
            if entry.header().entry_type().is_dir() {
                continue;
            }
            if !entry.header().entry_type().is_file() {
                return Err("invalid");
            }
            let original = entry.path().map_err(|_| "invalid")?;
            if original
                .components()
                .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
            {
                return Err("invalid");
            }
            let normalized: PathBuf = original
                .components()
                .filter(|c| !matches!(c, Component::CurDir))
                .collect();
            let path = normalized.to_str().ok_or("invalid")?.to_owned();
            if !safe_path(&path)
                || !manifest.files.contains_key(&path)
                || found.insert(path.clone(), true).is_some()
            {
                return Err("invalid");
            }
            let size = entry.size();
            total = total.checked_add(size).ok_or("invalid")?;
            if total > MAX_EXPANDED {
                return Err("invalid");
            }
            let target = temporary.join(&path);
            fs::create_dir_all(target.parent().ok_or("invalid")?).map_err(|_| "unavailable")?;
            let mut file = fs::File::create(target).map_err(|_| "unavailable")?;
            if std::io::copy(&mut entry, &mut file).map_err(|_| "unavailable")? != size {
                return Err("invalid");
            }
            file.sync_all().map_err(|_| "unavailable")?;
        }
        if found.len() != manifest.files.len() {
            return Err("invalid");
        }
        validate_files(&temporary, &manifest)?;
        Ok(())
    };
    let result = extract();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&temporary);
        return Err(error);
    }
    if root.exists() && validate_files(&root, &manifest).is_ok() {
        fs::remove_dir_all(&temporary).map_err(|_| "unavailable")?;
    } else {
        if root.exists() {
            fs::remove_dir_all(&root).map_err(|_| "unavailable")?;
        }
        fs::rename(&temporary, &root).map_err(|_| "unavailable")?;
    }
    let catalog = app.state::<Catalog>();
    let db = catalog.0.lock().map_err(|_| "unavailable")?;
    let namespace = namespace();
    let changed = db
        .execute(
            "UPDATE frontend_updates SET pending=?2,highest=?3 WHERE namespace=?1 AND highest<?3",
            params![namespace, envelope, manifest.revision],
        )
        .map_err(|_| "unavailable")?;
    prune(app, &db, false);
    Ok(if changed == 1 { "staged" } else { "ignored" })
}
// Only signed bundle-cache directories are eligible for collection.
fn prune(app: &AppHandle, db: &rusqlite::Connection, temporary: bool) {
    let Ok(mut statement)=db.prepare("SELECT pending FROM frontend_updates UNION ALL SELECT trial FROM frontend_updates UNION ALL SELECT confirmed FROM frontend_updates") else {return;};
    let Ok(rows) = statement.query_map([], |r| r.get::<_, Option<String>>(0)) else {
        return;
    };
    let mut keep = std::collections::BTreeSet::new();
    for raw in rows.flatten().flatten() {
        if let Ok(envelope) = serde_json::from_str::<Envelope>(&raw) {
            if let Ok(bytes) = STANDARD.decode(envelope.payload) {
                if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                    if let Some(hash) = value["archiveSha256"].as_str() {
                        keep.insert(hash.to_owned());
                    }
                }
            }
        }
    }
    let Ok(base) = app.path().app_data_dir() else {
        return;
    };
    let Ok(entries) = fs::read_dir(base.join("frontend-packs")) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let bundle = name.len() == 64 && name.bytes().all(|b| b.is_ascii_hexdigit());
        let orphan = temporary && uuid::Uuid::parse_str(&name).is_ok();
        if (bundle && !keep.contains(&name)) || orphan {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}
#[tauri::command]
pub async fn frontend_update(
    app: AppHandle,
    state: State<'_, FrontendState>,
    action: String,
    envelope: Option<String>,
    archive: Option<Vec<u8>>,
) -> Result<Value, &'static str> {
    if state.channel.is_empty() || env!("TIO_COMPILED_RESOURCE_KEY").is_empty() || tauri::is_dev() {
        return Ok(Value::Null);
    }
    match action.as_str() {
        "confirm" => {
            let mut boot = state.boot_lease.lock().map_err(|_| "unavailable")?;
            if boot.is_some() {
                if let Some((manifest, _)) = &state.active {
                    let catalog = app.state::<Catalog>();
                    let db = catalog.0.lock().map_err(|_| "unavailable")?;
                    let namespace = namespace();
                    // Only the selected verified revision may confirm the current trial.
                    let raw: Option<String> = db
                        .query_row(
                            "SELECT trial FROM frontend_updates WHERE namespace=?1",
                            [&namespace],
                            |r| r.get(0),
                        )
                        .map_err(|_| "unavailable")?;
                    if let Some(raw) = raw {
                        let trial = verify(&raw, &state.channel)?;
                        if trial.revision == manifest.revision
                            && trial.archive_sha256 == manifest.archive_sha256
                        {
                            db.execute("UPDATE frontend_updates SET confirmed=trial,trial=NULL WHERE namespace=?1",[namespace]).map_err(|_|"unavailable")?;
                        }
                    }
                }
            }
            boot.take();
            Ok(json!({"enabled":true}))
        }
        "stage" => Ok(json!({"status":stage(
                &app,
                &state,
                &envelope.ok_or("invalid")?,
                &archive.ok_or("invalid")?,
            )?})),
        "download" => {
            let Some(index) = crate::release_index::load(&app, false).await? else {
                return Ok(Value::Null);
            };
            let Some(asset) = index.runtimes.get(env!("TIO_COMPILED_CONTRACT_ID")) else {
                return Ok(Value::Null);
            };
            let envelope =
                String::from_utf8(crate::release_index::download(asset, 2_000_000).await?)
                    .map_err(|_| "invalid")?;
            let manifest = verify(&envelope, &state.channel)?;
            if manifest.revision
                <= env!("TIO_COMPILED_RUNTIME_REVISION")
                    .parse::<i64>()
                    .map_err(|_| "invalid")?
            {
                return Ok(Value::Null);
            }
            {
                let catalog = app.state::<Catalog>();
                let db = catalog.0.lock().map_err(|_| "unavailable")?;
                let namespace = namespace();
                let highest: i64 = db
                    .query_row(
                        "SELECT highest FROM frontend_updates WHERE namespace=?1",
                        [namespace],
                        |r| r.get(0),
                    )
                    .map_err(|_| "unavailable")?;
                if manifest.revision <= highest {
                    return Ok(Value::Null);
                }
            }
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .map_err(|_| "unavailable")?;
            let response = client
                .get(&manifest.archive_url)
                .send()
                .await
                .map_err(|_| "unavailable")?;
            if !response.status().is_success() {
                return Err("unavailable");
            }
            let bytes = limited(response, MAX_ARCHIVE).await?;
            Ok(json!({"status":stage(&app, &state, &envelope, &bytes)?}))
        }
        _ => Err("invalid"),
    }
}
async fn limited(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, &'static str> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "unavailable")? {
        if bytes.len() + chunk.len() > limit {
            return Err("invalid");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
pub fn serve(
    app: &AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let decoded = percent_encoding::percent_decode_str(request.uri().path()).decode_utf8();
    let Ok(decoded) = decoded else {
        return tauri::http::Response::builder()
            .status(400)
            .body(Vec::new())
            .unwrap();
    };
    let path = decoded.trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    let origin = request
        .headers()
        .get("Origin")
        .and_then(|h| h.to_str().ok())
        .filter(|h| {
            matches!(
                *h,
                "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
            )
        })
        .unwrap_or(if cfg!(target_os = "android") {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        });
    let mut response = tauri::http::Response::builder()
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", origin);
    if !safe_path(path) {
        return response.status(400).body(Vec::new()).unwrap();
    }
    let state = app.state::<FrontendState>();
    if let Some((manifest, root)) = &state.active {
        if let Some(hash) = manifest.files.get(path) {
            if let Ok(bytes) = fs::read(root.join(path)) {
                if format!("{:x}", Sha256::digest(&bytes)) == *hash {
                    if let Some(csp) = app
                        .asset_resolver()
                        .get("index.html".into())
                        .and_then(|asset| asset.csp_header)
                    {
                        response = response.header("Content-Security-Policy", csp);
                    }
                    return response
                        .header(
                            "Content-Type",
                            mime_guess::from_path(path).first_or_octet_stream().as_ref(),
                        )
                        .body(bytes)
                        .unwrap();
                }
            }
        }
        return response.status(404).body(Vec::new()).unwrap();
    }
    if let Some(asset) = app.asset_resolver().get(path.to_owned()) {
        response = response.header("Content-Type", asset.mime_type);
        if let Some(csp) = asset.csp_header {
            response = response.header("Content-Security-Policy", csp);
        }
        return response.body(asset.bytes).unwrap();
    }
    response.status(404).body(Vec::new()).unwrap()
}

fn confirmed_bundle(catalog: &Path) -> Result<Option<(Manifest, PathBuf)>, &'static str> {
    use rusqlite::OptionalExtension;
    let db = rusqlite::Connection::open(catalog).map_err(|_| "unavailable")?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "unavailable")?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS frontend_updates(namespace TEXT PRIMARY KEY,highest INTEGER NOT NULL DEFAULT 0,pending TEXT,trial TEXT,confirmed TEXT);").map_err(|_|"unavailable")?;
    let namespace = namespace();
    let raw: Option<String> = db
        .query_row(
            "SELECT confirmed FROM frontend_updates WHERE namespace=?1",
            [namespace],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| "unavailable")?
        .flatten();
    let Some(raw) = raw else {
        return Ok(None);
    };
    let manifest = verify(&raw, signed_update::channel().unwrap_or_default())?;
    let root = catalog
        .parent()
        .ok_or("invalid")?
        .join("frontend-packs")
        .join(&manifest.archive_sha256);
    Ok(Some((manifest, root)))
}
#[cfg(mobile)]
pub fn confirmed_kernel(catalog: &Path) -> Result<Option<(PathBuf, i64, String)>, &'static str> {
    let Some((manifest, root)) = confirmed_bundle(catalog)? else {
        return Ok(None);
    };
    let path = root.join("native-kernel.js");
    let bytes = fs::read(&path).map_err(|_| "unavailable")?;
    if bytes.len() as u64 > MAX_EXPANDED
        || format!("{:x}", Sha256::digest(bytes)) != manifest.kernel_sha256
    {
        return Err("signature");
    }
    Ok(Some((path, manifest.revision, manifest.kernel_sha256)))
}
