import CryptoKit
import Foundation

private final class ReleaseDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    let done = DispatchSemaphore(value: 0)
    let limit: Int
    var status: Int32 = -1
    var etag: String?
    var body = Data()

    init(limit: Int) {
        self.limit = limit
    }

    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(request.url?.scheme == "https" ? request : nil)
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
        etag = response.value(forHTTPHeaderField: "ETag")
        guard (200..<300).contains(status) else {
            completionHandler(.cancel)
            return
        }
        if response.expectedContentLength > Int64(limit) {
            status = -2
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard status >= 200 else { return }
        guard data.count <= limit - body.count else {
            status = -2
            dataTask.cancel()
            return
        }
        body.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if error != nil && (200..<300).contains(status) {
            status = -1
        }
        done.signal()
    }
}

typealias ReleaseReply = @convention(c) (
    UnsafeMutableRawPointer?, Int32, UnsafePointer<CChar>?, UnsafePointer<UInt8>?, Int
) -> Void

@_cdecl("tio_ios_update_get")
func tioIOSUpdateGet(
    _ address: UnsafePointer<CChar>, _ etag: UnsafePointer<CChar>?, _ limit: Int,
    _ seconds: UInt32, _ context: UnsafeMutableRawPointer?, _ reply: ReleaseReply
) {
    guard let url = URL(string: String(cString: address)), url.scheme == "https" else {
        reply(context, -2, nil, nil, 0)
        return
    }
    var request = URLRequest(url: url)
    if let etag { request.setValue(String(cString: etag), forHTTPHeaderField: "If-None-Match") }
    let config = URLSessionConfiguration.ephemeral
    config.urlCache = nil
    config.timeoutIntervalForRequest = TimeInterval(seconds)
    config.timeoutIntervalForResource = TimeInterval(seconds)
    let download = ReleaseDownload(limit: limit)
    let session = URLSession(configuration: config, delegate: download, delegateQueue: nil)
    session.dataTask(with: request).resume()
    download.done.wait()
    session.finishTasksAndInvalidate()

    download.body.withUnsafeBytes { bytes in
        let base = bytes.bindMemory(to: UInt8.self).baseAddress
        if let tag = download.etag {
            tag.withCString { reply(context, download.status, $0, base, bytes.count) }
        } else {
            reply(context, download.status, nil, base, bytes.count)
        }
    }
}

@_cdecl("tio_ios_verify_update")
func tioIOSVerifyUpdate(
    _ key: UnsafePointer<UInt8>, _ signature: UnsafePointer<UInt8>,
    _ payload: UnsafePointer<UInt8>, _ length: Int
) -> Bool {
    guard let publicKey = try? Curve25519.Signing.PublicKey(rawRepresentation: Data(bytes: key, count: 32))
    else { return false }
    return publicKey.isValidSignature(Data(bytes: signature, count: 64), for: Data(bytes: payload, count: length))
}
