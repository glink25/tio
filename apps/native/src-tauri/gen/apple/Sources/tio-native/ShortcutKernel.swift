import Foundation
import JavaScriptCore
import CryptoKit

enum ShortcutFailure: LocalizedError {
    case execution(String)
    var errorDescription: String? {
        switch self { case .execution(let message): return message }
    }
}

enum ShortcutKernel {
    static func run(_ arguments: [String: String]) async throws -> String {
        guard let bundle = Bundle.main.url(forResource: "headless", withExtension: "js", subdirectory: "assets"),
              let identifier = Bundle.main.bundleIdentifier else { throw ShortcutFailure.execution("unavailable") }
        let database = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                  appropriateFor: nil, create: false)
            .appendingPathComponent(identifier).appendingPathComponent("catalog.sqlite3")
        let result = try await Task.detached { try execute(arguments, bundle: bundle, database: database) }.value
        if ["github-", "gitee-"].contains(where: { arguments["connection"]?.hasPrefix($0) == true }) && arguments["action"] != "read" {
            BackgroundSync.schedule()
        }
        return result
    }

    static func execute(_ arguments: [String: String], bundle: URL, database: URL) throws -> String {
        let lease = try KernelLease.begin(database: database, bundled: bundle)
        defer { lease.end() }
        guard let context = JSContext() else { throw ShortcutFailure.execution("unavailable") }
        let call: @convention(block) (String, String) -> String = { space, args in
            guard let reply = tio_workspace_call(database.path, space, args) else { return "{\"error\":\"unavailable\"}" }
            defer { tio_release_reply(reply) }
            return String(cString: reply)
        }
        let uuid: @convention(block) () -> String = { UUID().uuidString.lowercased() }
        let utf8: @convention(block) (String) -> [UInt8] = { Array($0.utf8) }
        let decode: @convention(block) ([UInt8]) -> String = { String(decoding: $0, as: UTF8.self) }
        var timers = [Int: Timer]()
        var nextTimer = 0
        let schedule: @convention(block) (JSValue, Double) -> Int = { callback, ms in
            nextTimer += 1
            let index = nextTimer
            let timer = Timer(timeInterval: max(0, ms / 1000), repeats: false) { _ in
                timers.removeValue(forKey: index)
                callback.call(withArguments: [])
            }
            timers[index] = timer
            RunLoop.current.add(timer, forMode: .default)
            return index
        }
        let cancel: @convention(block) (Int) -> Void = { timers.removeValue(forKey: $0)?.invalidate() }
        defer { for timer in timers.values { timer.invalidate() } }
        var result: Result<String, Error>?
        let complete: @convention(block) (Bool, String) -> Void = { success, message in
            result = success ? .success(message) : .failure(ShortcutFailure.execution(message))
        }
        context.exceptionHandler = { _, exception in
            result = .failure(ShortcutFailure.execution(exception?.toString() ?? "invalid"))
        }
        func bind(_ name: String, _ value: Any) { context.setObject(value, forKeyedSubscript: name as NSString) }
        let folder: @convention(block) (String) -> String = { FolderAccess.reply($0) }
        let digest: @convention(block) ([UInt8]) -> [UInt8] = { Array(SHA256.hash(data: Data($0))) }
        let fromBase64: @convention(block) (String) -> [UInt8]? = { Data(base64Encoded: $0).map { Array($0) } }
        let toBase64: @convention(block) ([UInt8]) -> String = { Data($0).base64EncodedString() }
        bind("tioFolder", folder); bind("digest", digest); bind("fromBase64", fromBase64); bind("toBase64", toBase64)
        bind("tioWorkspace", call); bind("uuid", uuid); bind("utf8", utf8); bind("decodeUTF8", decode)
        bind("setTimeout", schedule); bind("clearTimeout", cancel); bind("complete", complete)
        bind("shortcutInput", arguments)
        let info: @convention(block) () -> String = { lease.info }
        bind("tioKernelInfo", info)
        let releaseBackgroundIO = BackgroundIO.bind(context, database: database)
        defer { releaseBackgroundIO() }
        context.evaluateScript("""
          globalThis.crypto = {randomUUID: uuid, subtle: {digest: async (name, bytes) => {
            if (name !== 'SHA-256') throw Error('unsupported digest');
            return Uint8Array.from(digest(Array.from(bytes))).buffer;
          }}};
          globalThis.atob = s => Array.from(fromBase64(s), n => String.fromCharCode(n)).join('');
          globalThis.btoa = s => toBase64(Array.from(s, c => c.charCodeAt(0)));
          globalThis.structuredClone = function clone(value, seen = new Map()) {
            if (value === null || typeof value !== 'object') {
              if (typeof value === 'function' || typeof value === 'symbol')
                throw Error('DataCloneError');
              return value;
            }
            if (seen.has(value)) return seen.get(value);
            if (value instanceof ArrayBuffer) {
              const copy = value.slice(0);
              seen.set(value, copy);
              return copy;
            }
            if (ArrayBuffer.isView(value)) {
              const buffer = clone(value.buffer, seen);
              const copy = value instanceof DataView
                ? new DataView(buffer, value.byteOffset, value.byteLength)
                : new value.constructor(buffer, value.byteOffset, value.length);
              seen.set(value, copy);
              return copy;
            }
            if (value instanceof Date) return new Date(value.getTime());
            const copy = value instanceof Map ? new Map()
              : value instanceof Set ? new Set() : Array.isArray(value) ? [] : {};
            seen.set(value, copy);
            if (value instanceof Map) {
              for (const [key, item] of value) copy.set(clone(key, seen), clone(item, seen));
            } else if (value instanceof Set) {
              for (const item of value) copy.add(clone(item, seen));
            } else {
              for (const key of Object.keys(value)) {
                Object.defineProperty(copy, key, {
                  value: clone(value[key], seen), enumerable: true, writable: true, configurable: true
                });
              }
            }
            return copy;
          };
          globalThis.TextEncoder = class { encode(s) { return Uint8Array.from(utf8(s)); } };
          globalThis.TextDecoder = class { decode(b) { return decodeUTF8(Array.from(b || [])); } };
          globalThis.queueMicrotask = callback => Promise.resolve().then(callback);
          """)
        context.evaluateScript(try String(contentsOf: lease.bundle, encoding: .utf8), withSourceURL: lease.bundle)
        if let result { return try result.get() }
        context.evaluateScript("(shortcutInput.action === 'background' ? TioKernel.runBackground() : TioKernel.run(shortcutInput)).then(v => complete(true, JSON.stringify(v)), e => complete(false, e.code || String(e)))")
        while result == nil {
            try Task.checkCancellation()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.01))
        }
        return try result!.get()
    }
}
