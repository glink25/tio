use crate::catalog::Catalog;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

pub fn initialize(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch("
      CREATE TABLE IF NOT EXISTS spaces(space TEXT PRIMARY KEY, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS objects(space TEXT, id TEXT, version INTEGER NOT NULL, entry TEXT NOT NULL, projection TEXT NOT NULL, PRIMARY KEY(space,id));
      CREATE INDEX IF NOT EXISTS changes ON objects(space,version);
      CREATE TABLE IF NOT EXISTS receipts(space TEXT,id TEXT,client TEXT,seq INTEGER,signature TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(space,id));
      CREATE INDEX IF NOT EXISTS client_receipts ON receipts(space,client,seq);
      CREATE TABLE IF NOT EXISTS acknowledgments(space TEXT,client TEXT,seq INTEGER NOT NULL,PRIMARY KEY(space,client));
      CREATE TABLE IF NOT EXISTS assets(space TEXT,id TEXT,staged INTEGER,name TEXT,mime TEXT,bytes BLOB NOT NULL,PRIMARY KEY(space,id,staged));
      CREATE TABLE IF NOT EXISTS recovery(space TEXT,version INTEGER,items TEXT NOT NULL,PRIMARY KEY(space,version));")
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Request {
    Read {
        ids: Option<Vec<String>>,
        since: Option<i64>,
        projection: bool,
        kind: Option<String>,
        database: Option<String>,
        after: Option<String>,
        limit: Option<i64>,
    },
    Publish {
        request: Value,
        entries: Vec<Value>,
        projections: Vec<Value>,
        signature: String,
        baseline: Option<Value>,
    },
    Baseline {
        id: String,
        endpoint: String,
        value: Option<Value>,
    },
    CacheAsset {
        id: String,
        name: String,
        mime: String,
        bytes: Vec<u8>,
    },
    Staged {
        id: String,
    },
    Recover {
        items: Value,
    },
    Receipt {
        id: String,
    },
    Acknowledge {
        client: String,
        sequence: i64,
    },
    Stage {
        id: String,
        name: String,
        mime: String,
        bytes: Vec<u8>,
    },
    ReadAsset {
        id: String,
    },
    ReleaseAsset {
        id: String,
    },
    Delete,
}

#[tauri::command]
pub fn workspace(
    state: State<'_, Catalog>,
    space: String,
    request: Request,
    replica: Option<String>,
) -> Result<Value, &'static str> {
    if let Some(endpoint) = replica {
        let directory = state
            .0
            .lock()
            .map_err(|_| "unavailable")?
            .path()
            .map(std::path::PathBuf::from)
            .ok_or("unavailable")?;
        return execute_replica(&directory, &endpoint, space, request);
    }
    let mut db = state.0.lock().map_err(|_| "unavailable")?;
    execute(&mut db, space, request)
}

pub(crate) fn execute(
    db: &mut Connection,
    space: String,
    request: Request,
) -> Result<Value, &'static str> {
    execute_inner(db, space, request, false)
}

fn execute_inner(
    db: &mut Connection,
    space: String,
    request: Request,
    replica: bool,
) -> Result<Value, &'static str> {
    if space.is_empty()
        || !space
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Err("invalid");
    }
    let sql = |_: rusqlite::Error| "unavailable";
    let read = matches!(
        request,
        Request::Read { .. } | Request::ReadAsset { .. } | Request::Receipt { .. }
    );
    let tx = db
        .transaction_with_behavior(if read {
            TransactionBehavior::Deferred
        } else {
            TransactionBehavior::Immediate
        })
        .map_err(sql)?;
    let closed:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM settings WHERE key=?1 AND value IN ('\"deleting\"','\"deleted\"'))",[format!("workspace-lifecycle/device_{space}")],|r|r.get(0)).map_err(sql)?;
    if closed && !matches!(request, Request::Delete) {
        return Err("closed");
    }
    let version: i64 = tx
        .query_row("SELECT version FROM spaces WHERE space=?1", [&space], |r| {
            r.get(0)
        })
        .optional()
        .map_err(sql)?
        .unwrap_or(0);
    let result = match request {
        Request::Read{ids,since,projection,kind,database,after,limit} => {
            let mut stmt=tx.prepare("SELECT CASE WHEN ?2 THEN projection ELSE entry END FROM objects
               WHERE space=?1 AND (?3 IS NULL OR id IN (SELECT value FROM json_each(?3)))
               AND version>?4 AND id>?5
               AND (?6 IS NULL OR json_extract(projection,'$.projection.type')=?6)
               AND (?7 IS NULL OR json_extract(projection,'$.projection.databaseId')=?7)
               ORDER BY id LIMIT ?8").map_err(sql)?;
            let selected = ids.as_ref().map(|v|json!(v).to_string());
            let rows=stmt.query_map(params![space,projection,selected,since.unwrap_or(-1),after.unwrap_or_default(),kind,database,limit.unwrap_or(-1)],|r|r.get::<_,String>(0)).map_err(sql)?;
            let mut entries=Vec::<Value>::new();
            for row in rows { entries.push(serde_json::from_str(&row.map_err(sql)?).map_err(|_|"invalid")?); }
            json!({"version":version,"entries":entries})
        }
        Request::Receipt{id} => {
            let value:Option<String>=tx.query_row("SELECT result FROM receipts WHERE space=?1 AND id=?2",params![space,id],|r|r.get(0)).optional().map_err(sql)?;
            serde_json::from_str(value.as_deref().unwrap_or("null")).map_err(|_|"invalid")?
        }
        Request::Publish{request, entries, projections,signature,baseline} => {
            let id=request["id"].as_str().ok_or("invalid")?;
            let client=request["clientId"].as_str();
            let seq=request["sequence"].as_i64();
            if let Some((old,result))=tx.query_row("SELECT signature,result FROM receipts WHERE space=?1 AND id=?2",params![space,id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional().map_err(sql)? {
                if old!=signature { return Err("invalid") }
                return serde_json::from_str(&result).map_err(|_|"invalid")
            }
            let watermark:i64=tx.query_row("SELECT seq FROM acknowledgments WHERE space=?1 AND client=?2",params![space,client],|r|r.get(0)).optional().map_err(sql)?.unwrap_or(0);
            if seq.is_some_and(|s|s<=watermark) {return Ok(json!({"status":"compacted","version":version}))}
            if request["expectedVersion"].as_i64()!=Some(version) {return Ok(json!({"status":"conflict","version":version}))}
            if entries.len()!=projections.len() || entries.len()!=request["changes"].as_array().ok_or("invalid")?.len() {return Err("invalid")}
            for asset in request["assetIds"].as_array().ok_or("invalid")? {
                let asset=asset.as_str().ok_or("invalid")?;
                tx.execute("INSERT OR REPLACE INTO assets SELECT space,id,0,name,mime,bytes FROM assets WHERE space=?1 AND id=?2 AND staged=1",params![space,asset]).map_err(sql)?;
                tx.execute("DELETE FROM assets WHERE space=?1 AND id=?2 AND staged=1",params![space,asset]).map_err(sql)?;
                if !tx.query_row("SELECT EXISTS(SELECT 1 FROM assets WHERE space=?1 AND id=?2 AND staged=0)",params![space,asset],|r|r.get::<_,bool>(0)).map_err(sql)? {return Err("invalid")}
            }
            for (entry, projection) in entries.iter().zip(projections) {
                let object=&entry["object"];
                if object["workspaceId"].as_str()!=Some(&space) {return Err("invalid")}
                let oid=object["id"].as_str().ok_or("invalid")?;
                let previous: Option<String> = if replica {tx.query_row("SELECT entry FROM objects WHERE space=?1 AND id=?2",params![space,oid],|row|row.get(0)).optional().map_err(sql)?}else{None};
                let remote_asset=replica && (request["origin"]=="sync" || previous.is_some());
                if object["type"]=="asset" && object["deleted"]!=true && !remote_asset && !tx.query_row("SELECT EXISTS(SELECT 1 FROM assets WHERE space=?1 AND id=?2 AND staged=0)",params![space,oid],|r|r.get::<_,bool>(0)).map_err(sql)? {return Err("invalid")}
                let mut stored=entry.clone();
                if replica {
                    let previous=previous.as_deref().map(serde_json::from_str::<Value>).transpose().map_err(|_|"invalid")?;
                    stored["sync"]=previous.and_then(|old|old.get("sync").cloned()).unwrap_or_else(||json!({}));
                    if let Some(b)=&baseline {
                        let endpoint=b["endpoint"].as_str().ok_or("invalid")?;
                        if b["base"]["id"]!=object["id"] || b["base"]["workspaceId"]!=space{return Err("invalid")}
                        stored["sync"][endpoint]=json!({"base":b["base"],"revision":if b["clean"]==true {entry["revision"].clone()} else {json!(0)}});
                    }
                }
                tx.execute("INSERT OR REPLACE INTO objects VALUES (?1,?2,?3,?4,?5)",params![space,oid,version+1,stored.to_string(),projection.to_string()]).map_err(sql)?;
            }
            let result=json!({"status":"committed","version":version+1,"entries":entries});
            tx.execute("INSERT OR REPLACE INTO spaces VALUES (?1,?2)",params![space,version+1]).map_err(sql)?;
            tx.execute("INSERT INTO receipts VALUES (?1,?2,?3,?4,?5,?6)",params![space,id,client,seq,signature,result.to_string()]).map_err(sql)?;
            if let Some(items)=request.get("recovery") { tx.execute("INSERT INTO recovery VALUES (?1,?2,?3)",params![space,version+1,items.to_string()]).map_err(sql)?; }
            result
        }
        Request::Baseline{id,endpoint,value}=>{
            if !replica{return Err("invalid")}
            let raw:Option<String>=tx.query_row("SELECT entry FROM objects WHERE space=?1 AND id=?2",params![space,id],|r|r.get(0)).optional().map_err(sql)?;
            if let Some(raw)=raw {
                let mut entry:Value=serde_json::from_str(&raw).map_err(|_|"invalid")?;
                if let Some(base)=value {
                    if base["base"]["id"]!=id || base["base"]["workspaceId"]!=space {return Err("invalid")}
                    entry["sync"][endpoint]=base;
                } else if let Some(sync)=entry["sync"].as_object_mut(){sync.remove(&endpoint);}
                tx.execute("UPDATE objects SET entry=?3 WHERE space=?1 AND id=?2",params![space,id,entry.to_string()]).map_err(sql)?;
            }
            Value::Null
        }
        Request::CacheAsset{id,name,mime,bytes}=>{
            if !replica || bytes.len()>20*1024*1024{return Err("invalid")}
            tx.execute("INSERT OR REPLACE INTO assets VALUES(?1,?2,0,?3,?4,?5)",params![space,id,name,mime,bytes]).map_err(sql)?;
            Value::Null
        }
        Request::Staged{id}=>json!(tx.query_row("SELECT EXISTS(SELECT 1 FROM assets WHERE space=?1 AND id=?2 AND staged=1)",params![space,id],|r|r.get::<_,bool>(0)).map_err(sql)?),
        Request::Recover{items}=>{
            tx.execute("INSERT INTO recovery VALUES(?1,(SELECT min(coalesce(min(version),0),0)-1 FROM recovery WHERE space=?1),?2)",params![space,items.to_string()]).map_err(sql)?;
            Value::Null
        }
        Request::Acknowledge{client,sequence}=>{
            tx.execute("INSERT INTO acknowledgments VALUES(?1,?2,?3) ON CONFLICT(space,client) DO UPDATE SET seq=max(seq,excluded.seq)",params![space,client,sequence]).map_err(sql)?;
            tx.execute("DELETE FROM receipts WHERE space=?1 AND client=?2 AND seq<=?3",params![space,client,sequence]).map_err(sql)?;
            Value::Null
        }
        Request::Stage{id,name,mime,bytes}=>{
            if bytes.len()>20*1024*1024{return Err("invalid")}
            tx.execute("INSERT OR REPLACE INTO assets VALUES (?1,?2,1,?3,?4,?5)",params![space,id,name,mime,bytes]).map_err(sql)?;
            Value::Null
        }
        Request::ReadAsset{id}=>tx.query_row("SELECT name,mime,bytes FROM assets WHERE space=?1 AND id=?2 AND staged=0",params![space,id],|r|Ok(json!({"name":r.get::<_,String>(0)?,"mime":r.get::<_,String>(1)?,"bytes":r.get::<_,Vec<u8>>(2)?}))).optional().map_err(sql)?.unwrap_or(Value::Null),
        Request::ReleaseAsset{id}=>{
            tx.execute("DELETE FROM assets WHERE space=?1 AND id=?2 AND staged=1",params![space,id]).map_err(sql)?;
            Value::Null
        }
        Request::Delete=>{
            for table in ["spaces","objects","receipts","acknowledgments","assets","recovery"] {
                tx.execute(&format!("DELETE FROM {table} WHERE space=?1"),[&space]).map_err(sql)?;
            }
            Value::Null
        }
    };
    tx.commit().map_err(sql)?;
    Ok(result)
}

pub(crate) fn execute_replica(
    catalog: &std::path::Path,
    endpoint: &str,
    space: String,
    request: Request,
) -> Result<Value, &'static str> {
    use sha2::{Digest, Sha256};
    let directory = catalog.parent().ok_or("unavailable")?.join("replicas");
    std::fs::create_dir_all(&directory).map_err(|_| "unavailable")?;
    let mut db = Connection::open(
        directory.join(format!("{:x}.sqlite3", Sha256::digest(endpoint.as_bytes()))),
    )
    .map_err(|_| "unavailable")?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "unavailable")?;
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);").map_err(|_|"unavailable")?;
    initialize(&db).map_err(|_| "unavailable")?;
    execute_inner(&mut db, space, request, true)
}
