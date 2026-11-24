use crate::catalog::Catalog;
use crate::signed_update::{self, VerifyingKey};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct ResourceBoot(Mutex<Option<Value>>);

#[derive(Deserialize)]
struct Pack {
    format: u32,
    kind: String,
    channel: String,
    #[serde(rename = "compatibleRuntimeIds")]
    compatible_runtime_ids: Vec<String>,
    revision: i64,
    translations: BTreeMap<String, BTreeMap<String, String>>,
}

fn verify(
    data: &str,
    channel: &str,
    key: &VerifyingKey,
    runtime: &str,
    translation_keys: &BTreeMap<String, BTreeSet<String>>,
) -> Result<Pack, &'static str> {
    let pack: Pack = signed_update::decode(data, 2_000_000, key)?;
    if pack.channel != channel
        || pack.format != 1
        || pack.kind != "translations"
        || pack.revision < 1
    {
        return Err("invalid");
    }
    if runtime.is_empty() || !pack.compatible_runtime_ids.iter().any(|id| id == runtime) {
        return Err("incompatible");
    }
    if pack.translations.iter().any(|(language, entries)| {
        translation_keys
            .get(language)
            .is_none_or(|keys| entries.keys().any(|key| !keys.contains(key)))
    }) {
        return Err("invalid");
    }
    Ok(pack)
}

#[tauri::command]
pub fn resource_update(
    app: AppHandle,
    state: State<'_, Catalog>,
    action: String,
    channel: String,
    envelope: Option<String>,
    revision: Option<i64>,
) -> Result<Value, &'static str> {
    let target_channel = signed_update::channel().ok_or("incompatible")?;
    if channel != target_channel {
        return Err("incompatible");
    }
    let public = env!("TIO_COMPILED_RESOURCE_KEY");
    if public.is_empty() {
        return Ok(Value::Null);
    };
    let key = signed_update::public_key()?;
    let frontend = app.state::<crate::frontend_update::FrontendState>();
    let runtime = frontend.runtime_id();
    if runtime.is_empty() {
        return Ok(Value::Null);
    }
    let translation_keys = frontend.translation_keys(&app)?;
    let boot = app.state::<ResourceBoot>();
    let mut active_pack = if action == "begin" {
        let pack = boot.0.lock().map_err(|_| "unavailable")?;
        if let Some(value) = pack.as_ref() {
            return Ok(value.clone());
        }
        Some(pack)
    } else {
        None
    };
    let db_error = |_: rusqlite::Error| "unavailable";
    let mut db = state.0.lock().map_err(|_| "unavailable")?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let namespace = format!("{channel}/{runtime}/{}", crate::release_index::track());
    tx.execute(
        "INSERT OR IGNORE INTO resource_updates(namespace) VALUES (?1)",
        [&namespace],
    )
    .map_err(db_error)?;
    let result = match action.as_str() {
        "stage" => {
            let bytes = envelope.ok_or("invalid")?;
            let pack = verify(&bytes, &channel, &key, runtime, &translation_keys)?;
            let changed=tx.execute("UPDATE resource_updates SET pending=?2,highest=?3 WHERE namespace=?1 AND highest<?3",params![namespace,bytes,pack.revision]).map_err(db_error)?;
            json!({"status":if changed==1 {"staged"} else {"ignored"}})
        }
        "begin" => {
            tx.execute(
                "UPDATE resource_updates SET trial=pending,pending=NULL WHERE namespace=?1",
                [&namespace],
            )
            .map_err(db_error)?;
            let data: Option<String> = tx
                .query_row(
                    "SELECT coalesce(trial,confirmed) FROM resource_updates WHERE namespace=?1",
                    [&namespace],
                    |row| row.get(0),
                )
                .map_err(db_error)?;
            if let Some(data) = data {
                let pack = verify(&data, &channel, &key, runtime, &translation_keys)?;
                json!({"revision":pack.revision,"translations":pack.translations})
            } else {
                json!({"revision":0,"translations":{}})
            }
        }
        "confirm" => {
            let data: Option<String> = tx
                .query_row(
                    "SELECT trial FROM resource_updates WHERE namespace=?1 AND trial IS NOT NULL",
                    [&namespace],
                    |row| row.get(0),
                )
                .optional()
                .map_err(db_error)?;
            if let Some(data) = data {
                if Some(verify(&data, &channel, &key, runtime, &translation_keys)?.revision)
                    != revision
                {
                    return Err("invalid");
                }
                tx.execute(
                    "UPDATE resource_updates SET confirmed=trial,trial=NULL WHERE namespace=?1",
                    [&namespace],
                )
                .map_err(db_error)?;
            }
            Value::Null
        }
        _ => return Err("invalid"),
    };
    tx.commit().map_err(db_error)?;
    if let Some(pack) = active_pack.as_mut() {
        **pack = Some(result.clone());
    }
    Ok(result)
}

// Download outside the catalog transaction so editing remains available.
#[tauri::command]
pub async fn download_resources(
    app: AppHandle,
    state: State<'_, Catalog>,
    channel: String,
) -> Result<Value, &'static str> {
    if signed_update::channel() != Some(channel.as_str()) {
        return Err("incompatible");
    }
    if env!("TIO_COMPILED_RESOURCE_KEY").is_empty() {
        return Ok(Value::Null);
    }
    let runtime = app
        .state::<crate::frontend_update::FrontendState>()
        .runtime_id()
        .to_owned();
    let Some(index) = crate::release_index::load(&app, false).await? else {
        return Ok(Value::Null);
    };
    let Some(asset) = index.contents.get(&runtime) else {
        return Ok(Value::Null);
    };
    let envelope = String::from_utf8(crate::release_index::download(asset, 2_000_000).await?)
        .map_err(|_| "invalid")?;
    resource_update(app, state, "stage".into(), channel, Some(envelope), None)
}
