import Foundation
import SQLite3

/// Projection and publication journal shared by the WebView and the App Intent process.
/// The advisory lock spans the JS repository's read/validate/publish operation.
enum FolderJournal {
    private static let mutex = NSLock()
    private static var held = [String: (fd: Int32, owner: String)]()

    static func resetForegroundLocks(owner: String?) {
        mutex.lock()
        defer { mutex.unlock() }
        for (token, lock) in held where owner.map({ lock.owner == "foreground/" + $0 }) ?? lock.owner.hasPrefix("foreground/") {
            close(lock.fd)
            held.removeValue(forKey: token)
        }
    }

    static func call(_ action: String, _ request: [String: Any], grant: String) throws -> Any {
        guard let space = request["workspace"] as? String, !space.isEmpty, space.utf8.count <= 256,
              space.range(of: "^[a-zA-Z0-9_-]+$", options: .regularExpression) != nil else { throw FolderBridgeError.invalid }
        let directory = try FolderAccess.privateDirectory.appendingPathComponent("journals").appendingPathComponent(grant)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let base = directory.appendingPathComponent(space)
        if action == "lock" {
            let fd = open(base.appendingPathExtension("lock").path, O_CREAT | O_RDWR | O_CLOEXEC, S_IRUSR | S_IWUSR)
            guard fd >= 0 else { throw FolderBridgeError.unavailable }
            guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
                let cause = errno
                close(fd)
                if cause == EWOULDBLOCK { return NSNull() }
                throw FolderBridgeError.unavailable
            }
            let token = UUID().uuidString
            mutex.lock()
            held[token] = (fd, request["owner"] as? String ?? "")
            mutex.unlock()
            return token
        }
        if action == "unlock" {
            guard let token = request["token"] as? String else { throw FolderBridgeError.invalid }
            mutex.lock()
            let owner = request["owner"] as? String ?? ""
            let lock = held[token]?.owner == owner ? held.removeValue(forKey: token) : nil
            mutex.unlock()
            if let lock { close(lock.fd) }
            return NSNull()
        }
        var database: OpaquePointer?
        guard sqlite3_open(base.appendingPathExtension("sqlite3").path, &database) == SQLITE_OK else {
            sqlite3_close(database)
            throw FolderBridgeError.unavailable
        }
        defer { sqlite3_close(database) }
        sqlite3_busy_timeout(database, 5000)
        func exec(_ sql: String) throws {
            guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw FolderBridgeError.unavailable }
        }
        func query(_ sql: String, _ bindings: [String]) throws -> [[String]] {
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(database, sql, -1, &stmt, nil) == SQLITE_OK else { throw FolderBridgeError.unavailable }
            defer { sqlite3_finalize(stmt) }
            for (index, value) in bindings.enumerated() {
                guard sqlite3_bind_text(stmt, Int32(index+1), value, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) == SQLITE_OK else { throw FolderBridgeError.unavailable }
            }
            var rows = [[String]]()
            while true {
                switch sqlite3_step(stmt) {
                case SQLITE_DONE: return rows
                case SQLITE_ROW: rows.append((0..<sqlite3_column_count(stmt)).map { String(cString: sqlite3_column_text(stmt, $0)) })
                default: throw FolderBridgeError.unavailable
                }
            }
        }
        func decode(_ json: String) throws -> Any {
            try JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])
        }
        try exec("CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        switch action {
        case "stateRead":
            guard let keys = request["keys"] as? [String] else { throw FolderBridgeError.invalid }
            try exec("BEGIN")
            let values: [Any] = try keys.map { key in
                guard let row = try query("SELECT value FROM state WHERE key=?", [key]).first else { return NSNull() }
                return try decode(row[0])
            }
            try exec("COMMIT")
            return values
        case "stateEntries":
            guard let prefix = request["prefix"] as? String else { throw FolderBridgeError.invalid }
            let after = request["after"] as? String
            let rows = try query("SELECT key,value FROM state WHERE key>=? AND key<? AND (?='' OR key>?) ORDER BY key LIMIT CAST(? AS INTEGER)",
                                 [prefix, prefix+"\u{FFFF}", after ?? "", after ?? "", String(request["limit"] as? Int ?? -1)])
            return try rows.map { ["key": $0[0], "value": try decode($0[1])] }
        case "stateWrite":
            guard let puts = request["puts"] as? [[String:Any]], let deletes = request["deletes"] as? [String] else { throw FolderBridgeError.invalid }
            try exec("BEGIN IMMEDIATE")
            for key in deletes { _ = try query("DELETE FROM state WHERE key=?", [key]) }
            for put in puts {
                guard let key = put["key"] as? String, let value = put["value"] else { throw FolderBridgeError.invalid }
                let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
                _ = try query("INSERT OR REPLACE INTO state VALUES (?,?)", [key, String(decoding: data, as: UTF8.self)])
            }
            try exec("COMMIT")
        case "stateDelete": try exec("DELETE FROM state")
        default: throw FolderBridgeError.invalid
        }
        return NSNull()
    }
}

@_cdecl("tio_reset_folder_locks")
func tioResetFolderLocks(_ owner: UnsafePointer<CChar>?) {
    FolderJournal.resetForegroundLocks(owner: owner.map { String(cString: $0) })
}
