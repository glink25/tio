use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::Value;
use std::{fs, sync::Mutex};
use tauri::{AppHandle, Manager, State};

pub struct Catalog(pub(crate) Mutex<Connection>);

impl Catalog {
    pub fn open(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let directory = app.path().app_data_dir()?;
        fs::create_dir_all(&directory)?;
        let db = Connection::open(directory.join("catalog.sqlite3"))?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS resource_updates(namespace TEXT PRIMARY KEY,highest INTEGER NOT NULL DEFAULT 0,pending TEXT,trial TEXT,confirmed TEXT);
            CREATE TABLE IF NOT EXISTS folder_grants(id TEXT PRIMARY KEY,path TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS folder_state(grant TEXT,space TEXT,key TEXT,value TEXT NOT NULL,PRIMARY KEY(grant,space,key));
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        crate::workspace::initialize(&db)?;
        Ok(Self(Mutex::new(db)))
    }
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Request {
    Read { key: String },
    Write { key: String, value: Value },
    Sessions,
    SaveSession { id: String, session: Value },
    RemoveSession { id: String },
}

#[tauri::command]
pub fn catalog(state: State<'_, Catalog>, request: Request) -> Result<Value, &'static str> {
    let mut db = state.0.lock().map_err(|_| "unavailable")?;
    let sql_error = |_: rusqlite::Error| "unavailable";
    match request {
        Request::Read { key } => {
            let json: Option<String> = db
                .query_row("SELECT value FROM settings WHERE key=?1", [key], |row| {
                    row.get(0)
                })
                .optional()
                .map_err(sql_error)?;
            match json {
                Some(s) => serde_json::from_str(&s).map_err(|_| "invalid"),
                None => Ok(Value::Null),
            }
        }
        Request::Write { key, value } => {
            db.execute(
                "INSERT OR REPLACE INTO settings VALUES (?1, ?2)",
                params![key, value.to_string()],
            )
            .map_err(sql_error)?;
            Ok(Value::Null)
        }
        Request::Sessions => {
            let mut stmt = db
                .prepare("SELECT value FROM sessions ORDER BY id")
                .map_err(sql_error)?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(sql_error)?;
            let mut sessions = Vec::new();
            for row in rows {
                sessions
                    .push(serde_json::from_str(&row.map_err(sql_error)?).map_err(|_| "invalid")?);
            }
            Ok(Value::Array(sessions))
        }
        Request::SaveSession { id, session } => {
            if session.get("id").and_then(Value::as_str) != Some(&id) {
                return Err("invalid");
            }
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(sql_error)?;
            let closed: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM settings WHERE key=?1 AND value NOT IN ('null','false'))",
                [format!("workspace-lifecycle/{id}")], |row| row.get(0)).map_err(sql_error)?;
            if closed {
                return Err("closed");
            }
            tx.execute(
                "INSERT OR REPLACE INTO sessions VALUES (?1, ?2)",
                params![id, session.to_string()],
            )
            .map_err(sql_error)?;
            tx.commit().map_err(sql_error)?;
            Ok(Value::Null)
        }
        Request::RemoveSession { id } => {
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(sql_error)?;
            tx.execute("DELETE FROM sessions WHERE id=?1", [&id])
                .map_err(sql_error)?;
            tx.execute(
                "DELETE FROM settings WHERE key='active' AND value=?1",
                [Value::String(id).to_string()],
            )
            .map_err(sql_error)?;
            tx.commit().map_err(sql_error)?;
            Ok(Value::Null)
        }
    }
}
