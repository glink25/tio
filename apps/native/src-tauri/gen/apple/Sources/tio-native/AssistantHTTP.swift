import Foundation

typealias AssistantHTTPReply = @convention(c) (
    UnsafeMutableRawPointer?, Int32, UnsafePointer<CChar>?, UnsafePointer<UInt8>?, Int, Bool
) -> Void

private final class AssistantHTTPTasks: @unchecked Sendable {
    private let lock = NSLock()
    private var tasks: [String: URLSessionDataTask] = [:]

    func insert(_ task: URLSessionDataTask, id: String) {
        lock.lock()
        tasks[id] = task
        lock.unlock()
    }

    func remove(_ id: String) -> URLSessionDataTask? {
        lock.lock()
        defer { lock.unlock() }
        return tasks.removeValue(forKey: id)
    }
}

private let assistantHTTPTasks = AssistantHTTPTasks()

private final class AssistantDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let id: String
    private let limit: Int
    private let context: UnsafeMutableRawPointer?
    private let reply: AssistantHTTPReply
    private var status: Int32 = -1
    private var headers: [String: String] = [:]
    private var body = Data()
    private var truncated = false

    init(id: String, limit: Int, context: UnsafeMutableRawPointer?, reply: @escaping AssistantHTTPReply) {
        self.id = id
        self.limit = limit
        self.context = context
        self.reply = reply
    }

    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }

    func urlSession(
        _ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
            completionHandler(.performDefaultHandling, nil)
        } else {
            completionHandler(.rejectProtectionSpace, nil)
        }
    }

    func urlSession(
        _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let response = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        status = Int32(response.statusCode)
        for name in ["cache-control", "content-length", "content-type", "date", "etag",
                     "last-modified", "location", "retry-after"] {
            headers[name] = response.value(forHTTPHeaderField: name)
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !truncated else { return }
        let remaining = limit - body.count
        body.append(contentsOf: data.prefix(remaining))
        if data.count > remaining {
            truncated = true
            dataTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        _ = assistantHTTPTasks.remove(id)
        session.finishTasksAndInvalidate()
        if let error, !truncated {
            let code: Int32 = (error as? URLError)?.code == .timedOut ? -2 : -1
            reply(context, code, nil, nil, 0, false)
            return
        }
        let encoded = (try? JSONEncoder().encode(headers)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        body.withUnsafeBytes { bytes in
            encoded.withCString { headerBytes in
                reply(context, status, headerBytes, bytes.bindMemory(to: UInt8.self).baseAddress, body.count, truncated)
            }
        }
    }
}

private struct AssistantHTTPRequest: Decodable {
    let url: URL
    let method: String
    let headers: [String: String]
    let body: String?
}

@_cdecl("tio_ios_assistant_fetch")
func tioIOSAssistantFetch(
    _ identifier: UnsafePointer<CChar>, _ input: UnsafePointer<CChar>, _ limit: Int,
    _ context: UnsafeMutableRawPointer?, _ reply: @escaping AssistantHTTPReply
) {
    let data = Data(String(cString: input).utf8)
    guard let input = try? JSONDecoder().decode(AssistantHTTPRequest.self, from: data),
          let scheme = input.url.scheme, ["http", "https"].contains(scheme),
          input.url.host != nil, input.url.user == nil, input.url.password == nil else {
        reply(context, -1, nil, nil, 0, false)
        return
    }

    let id = String(cString: identifier)
    var request = URLRequest(url: input.url)
    request.httpMethod = input.method
    request.allHTTPHeaderFields = input.headers
    request.httpBody = input.body.map { Data($0.utf8) }
    request.httpShouldHandleCookies = false

    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.urlCredentialStorage = nil
    config.urlCache = nil
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 15
    let download = AssistantDownload(id: id, limit: limit, context: context, reply: reply)
    let session = URLSession(configuration: config, delegate: download, delegateQueue: nil)
    let task = session.dataTask(with: request)
    assistantHTTPTasks.insert(task, id: id)
    task.resume()
}

@_cdecl("tio_ios_cancel_assistant_fetch")
func tioIOSCancelAssistantFetch(_ identifier: UnsafePointer<CChar>) {
    assistantHTTPTasks.remove(String(cString: identifier))?.cancel()
}
