use crate::signed_update;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const MAX_APK: u64 = 256 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    format: u32,
    kind: String,
    channel: String,
    application_id: String,
    version: String,
    build: u64,
    sha256: String,
    size: u64,
    url: String,
}
fn verify(raw: &str, app: &AppHandle) -> Result<Manifest, &'static str> {
    let manifest: Manifest = signed_update::decode(raw, 32_768, &signed_update::public_key()?)?;
    let version: semver::Version = manifest.version.parse().map_err(|_| "invalid")?;
    if manifest.format != 1
        || manifest.kind != "android-host"
        || manifest.channel != "android-apk"
        || manifest.application_id != "com.glink25.tio.apk"
        || manifest.sha256.len() != 64
        || !manifest
            .sha256
            .bytes()
            .all(|v| v.is_ascii_hexdigit() && !v.is_ascii_uppercase())
        || !crate::release_index::valid_url(&manifest.url)
        || manifest.size == 0
        || manifest.size > MAX_APK
        || manifest.build > i32::MAX as u64
    {
        return Err("invalid");
    }
    if version < app.package_info().version
        || manifest.build
            <= env!("TIO_COMPILED_BUILD_NUMBER")
                .parse::<u64>()
                .map_err(|_| "invalid")?
    {
        return Err("incompatible");
    }
    Ok(manifest)
}
fn package(directory: &Path, manifest: &Manifest) -> PathBuf {
    directory.join(format!("{}.apk", manifest.sha256))
}
fn valid_file(file: &Path, manifest: &Manifest) -> Result<(), &'static str> {
    if fs::metadata(file).map_err(|_| "unavailable")?.len() != manifest.size {
        return Err("signature");
    }
    let mut input = fs::File::open(file).map_err(|_| "unavailable")?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = input.read(&mut buffer).map_err(|_| "unavailable")?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    if format!("{:x}", digest.finalize()) != manifest.sha256 {
        return Err("signature");
    }
    Ok(())
}
async fn mobile(app: &AppHandle, args: Value) -> Result<Value, &'static str> {
    let reply: Value = app
        .state::<tauri::plugin::PluginHandle<tauri::Wry>>()
        .run_mobile_plugin_async("hostUpdate", args)
        .await
        .map_err(|_| "unavailable")?;
    if let Some(error) = reply["error"].as_str() {
        return Err(match error {
            "invalid" => "invalid",
            "incompatible" => "incompatible",
            "signature" => "signature",
            "permission" => "permission",
            _ => "unavailable",
        });
    }
    Ok(reply["value"].clone())
}
fn cached(app: &AppHandle, directory: &Path) -> Option<(String, Manifest)> {
    let raw = fs::read_to_string(directory.join("pending.json")).ok()?;
    let manifest = verify(&raw, app).ok()?;
    // Availability only needs authenticated metadata. Hash the full APK at the installation boundary.
    if fs::metadata(package(directory, &manifest)).ok()?.len() != manifest.size {
        return None;
    }
    Some((raw, manifest))
}
pub async fn run(
    app: AppHandle,
    action: String,
    version: Option<String>,
) -> Result<Value, &'static str> {
    if signed_update::channel() != Some("android-apk") {
        return Ok(json!({"status":"store"}));
    }
    if env!("TIO_COMPILED_RESOURCE_KEY").is_empty() {
        return Ok(json!({"status":"disabled"}));
    }
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|_| "unavailable")?
        .join("host-updates");
    fs::create_dir_all(&directory).map_err(|_| "unavailable")?;
    let lock = fs::File::options()
        .create(true)
        .truncate(false)
        .write(true)
        .open(directory.join("update.lock"))
        .map_err(|_| "unavailable")?;
    match fs2::FileExt::try_lock_exclusive(&lock) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Err("pending"),
        Err(_) => return Err("unavailable"),
    }
    if action == "capabilities" {
        let pending = cached(&app, &directory);
        if pending.is_none() {
            // A successful host upgrade invalidates its old installation cache.
            if let Ok(raw) = fs::read_to_string(directory.join("pending.json")) {
                if verify(&raw, &app).is_err() {
                    for entry in fs::read_dir(&directory)
                        .map_err(|_| "unavailable")?
                        .flatten()
                    {
                        if entry.file_name() != "update.lock" {
                            let _ = fs::remove_file(entry.path());
                        }
                    }
                }
            }
        }
        return Ok(json!({"status":"enabled","pendingVersion":pending.map(|(_,m)|m.version)}));
    }
    if action == "authorize" {
        return mobile(&app, json!({"action":"authorize"})).await;
    }
    if !matches!(action.as_str(), "check" | "install") {
        return Err("invalid");
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .user_agent("Tio")
        .build()
        .map_err(|_| "unavailable")?;
    let existing = if action == "install" {
        cached(&app, &directory).filter(|(_, m)| Some(m.version.as_str()) == version.as_deref())
    } else {
        None
    };
    let (raw, manifest) = if let Some(value) = existing {
        value
    } else {
        let Some(index) = crate::release_index::load(&app, true).await? else {
            return Ok(json!({"status":"current"}));
        };
        let Some(host) = index.host.filter(|h| h.status == "available") else {
            return Ok(json!({"status":"current"}));
        };
        let asset = host.manifest.ok_or("invalid")?;
        let raw = String::from_utf8(crate::release_index::download(&asset, 32768).await?)
            .map_err(|_| "invalid")?;
        let manifest = match verify(&raw, &app) {
            Ok(value) => value,
            Err("incompatible") => return Ok(json!({"status":"current"})),
            Err(code) => return Err(code),
        };
        (raw, manifest)
    };
    if action == "check" {
        return Ok(json!({"status":"available","version":manifest.version}));
    }
    if version.as_deref() != Some(&manifest.version) {
        return Err("conflict");
    }
    let path = package(&directory, &manifest);
    if valid_file(&path, &manifest).is_err() {
        let url = &manifest.url;
        let mut response = client.get(url).send().await.map_err(|_| "unavailable")?;
        if !response.status().is_success() {
            return Err("unavailable");
        }
        let temporary = directory.join("download.part");
        let result = async {
            let mut file = fs::File::create(&temporary).map_err(|_| "unavailable")?;
            let mut size = 0u64;
            while let Some(chunk) = response.chunk().await.map_err(|_| "unavailable")? {
                size += chunk.len() as u64;
                if size > manifest.size {
                    return Err("signature");
                }
                file.write_all(&chunk).map_err(|_| "unavailable")?;
            }
            file.sync_all().map_err(|_| "unavailable")?;
            drop(file);
            valid_file(&temporary, &manifest)?;
            fs::rename(&temporary, &path).map_err(|_| "unavailable")
        }
        .await;
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result?;
    }
    mobile(
        &app,
        json!({"action":"validate","path":path,"version":manifest.version,"build":manifest.build}),
    )
    .await?;
    let pending = directory.join("pending.part");
    let mut file = fs::File::create(&pending).map_err(|_| "unavailable")?;
    file.write_all(raw.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|_| "unavailable")?;
    drop(file);
    fs::rename(pending, directory.join("pending.json")).map_err(|_| "unavailable")?;
    mobile(
        &app,
        json!({"action":"install","path":path,"version":manifest.version,"build":manifest.build}),
    )
    .await
}
