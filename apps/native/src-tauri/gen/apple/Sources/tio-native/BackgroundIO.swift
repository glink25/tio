import Foundation
import JavaScriptCore
import Security

enum BackgroundIO {
    private final class ResponseBox: @unchecked Sendable {
        let mutex = NSLock()
        var value: [String: Any] = ["error": "unavailable"]
        func put(_ value: [String: Any]) {
            mutex.lock(); defer { mutex.unlock() }
            self.value = value
        }
        func get() -> [String: Any] {
            mutex.lock(); defer { mutex.unlock() }
            return value
        }
    }

    static func bind(_ context: JSContext, database: URL) -> () -> Void {
        let deadline = Date().addingTimeInterval(25)
        let cancelled: @convention(block) () -> Bool = { Task.isCancelled || Date() >= deadline || KernelLease.cancelled(database: database) }
        let native: @convention(block) (String) -> String = { request in
            guard let result = tio_native_call(database.path, request) else { return encode(["error": "unavailable"]) }
            defer { tio_release_reply(result) }
            return String(cString: result)
        }
        let credential: @convention(block) (String, String) -> String = { action, value in
            guard let service = Bundle.main.bundleIdentifier else { return encode(["error": "unavailable"]) }
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: "github"
            ]
            if action == "read" {
                var lookup = query
                lookup[kSecReturnData as String] = true
                lookup[kSecMatchLimit as String] = kSecMatchLimitOne
                var result: CFTypeRef?
                let status = SecItemCopyMatching(lookup as CFDictionary, &result)
                if status == errSecItemNotFound { return encode(["value": NSNull()]) }
                guard status == errSecSuccess, let data = result as? Data else {
                    return encode(["error": status == errSecInteractionNotAllowed ? "permission" : "unavailable"])
                }
                return encode(["value": String(decoding: data, as: UTF8.self)])
            }
            guard action == "write", let data = value.data(using: .utf8) else { return encode(["error": "invalid"]) }
            let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            if status == errSecItemNotFound {
                var insert = query
                insert[kSecValueData as String] = data
                guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { return encode(["error": "unavailable"]) }
            } else if status != errSecSuccess { return encode(["error": "unavailable"]) }
            return encode(["value": NSNull()])
        }
        var locks = Set<String>()
        let lock: @convention(block) (String, String) -> String? = { name, token in
            let reply = native(encode(["action": "lock", "name": name, "token": token]))
            if !token.isEmpty {
                locks.remove(token)
                return nil
            }
            guard let data = reply.data(using: .utf8),
                  let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let acquired = fields["value"] as? String else { return nil }
            locks.insert(acquired)
            return acquired
        }
        let fetch: @convention(block) (String, String) -> String = { address, options in
            let config = native("{\"action\":\"authOrigin\"}")
            let configData = config.data(using: .utf8) ?? Data()
            let configFields = (try? JSONSerialization.jsonObject(with: configData)) as? [String: Any]
            let authOrigin = (configFields?["value"] as? String ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            guard !cancelled(), let url = URL(string: address), url.scheme == "https",
                  (url.host == "api.github.com" || url.absoluteString == authOrigin + "/api/github/refresh"),
                  let data = options.data(using: .utf8),
                  let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return encode(["error": "invalid"])
            }
            var request = URLRequest(url: url)
            request.timeoutInterval = min(20, max(1, deadline.timeIntervalSinceNow))
            request.httpMethod = fields["method"] as? String ?? "GET"
            request.httpBody = (fields["body"] as? String)?.data(using: .utf8)
            for (name, value) in fields["headers"] as? [String: String] ?? [:] {
                request.setValue(value, forHTTPHeaderField: name)
            }
            let box = ResponseBox()
            let done = DispatchSemaphore(value: 0)
            let task = URLSession.shared.dataTask(with: request) { bytes, response, error in
                defer { done.signal() }
                guard error == nil, let response = response as? HTTPURLResponse,
                      let bytes, bytes.count <= 32 * 1024 * 1024 else { return }
                var headers = [String: String]()
                for (name, value) in response.allHeaderFields {
                    headers[String(describing: name).lowercased()] = String(describing: value)
                }
                box.put(["status": response.statusCode, "headers": headers,
                         "body": String(decoding: bytes, as: UTF8.self)])
            }
            task.resume()
            while done.wait(timeout: .now() + 0.1) == .timedOut {
                if cancelled() {
                    task.cancel()
                    return encode(["error": "timeout"])
                }
            }
            return encode(box.get())
        }
        context.setObject(native, forKeyedSubscript: "tioNative" as NSString)
        context.setObject(credential, forKeyedSubscript: "tioCredential" as NSString)
        context.setObject(fetch, forKeyedSubscript: "tioFetch" as NSString)
        context.setObject(lock, forKeyedSubscript: "tioLock" as NSString)
        context.setObject(cancelled, forKeyedSubscript: "tioCancelled" as NSString)
        return {
            for token in locks { _ = native(encode(["action": "lock", "token": token])) }
            locks.removeAll()
        }
    }

    private static func encode(_ value: [String: Any]) -> String {
        guard let bytes = try? JSONSerialization.data(withJSONObject: value) else {
            return "{\"error\":\"invalid\"}"
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}
