import Foundation

struct KernelLease {
    let bundle: URL
    let token: String?
    let revision: Int
    let sha256: String
    let database: URL

    static func call(_ request: [String: Any], database: URL) throws -> [String: Any] {
        let bytes = try JSONSerialization.data(withJSONObject: request)
        let input = String(decoding: bytes, as: UTF8.self)
        guard let pointer = tio_native_call(database.path, input) else {
            throw ShortcutFailure.execution("unavailable")
        }
        defer { tio_release_reply(pointer) }
        let reply = try JSONSerialization.jsonObject(with: Data(String(cString: pointer).utf8)) as? [String: Any]
        if let error = reply?["error"] as? String { throw ShortcutFailure.execution(error) }
        return reply ?? [:]
    }

    static func begin(database: URL, bundled: URL) throws -> KernelLease {
        let reply = try call(["action": "kernelBegin"], database: database)
        guard let value = reply["value"] as? [String: Any],
              let revision = value["revision"] as? Int,
              let sha256 = value["sha256"] as? String else { throw ShortcutFailure.execution("invalid") }
        return KernelLease(bundle: (value["path"] as? String).map { URL(fileURLWithPath: $0) } ?? bundled,
            token: value["token"] as? String, revision: revision, sha256: sha256, database: database)
    }
    static func cancelled(database: URL) -> Bool {
        guard let reply = try? call(["action": "kernelCancelled"], database: database),
              let value = reply["value"] as? Bool else { return true }
        return value
    }
    func end() {
        if let token { _ = try? Self.call(["action": "kernelEnd", "token": token], database: database) }
    }
    var info: String {
        let bytes = try? JSONSerialization.data(withJSONObject: ["revision": revision, "sha256": sha256])
        return bytes.map { String(decoding: $0, as: UTF8.self) } ?? "{}"
    }
}
