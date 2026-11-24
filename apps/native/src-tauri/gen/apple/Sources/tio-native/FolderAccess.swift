import UIKit
import UniformTypeIdentifiers
import CryptoKit
import Foundation

enum FolderBridgeError: Error { case cancelled, unavailable, invalid }

@MainActor
private final class FolderPicker: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    static var active: FolderPicker?
    private let complete: (Result<URL, Error>) -> Void
    init(_ complete: @escaping (Result<URL, Error>) -> Void) { self.complete = complete }

    static func show(sceneID: String?, _ complete: @escaping (Result<URL, Error>) -> Void) {
        guard active == nil, var controller = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
            .filter({ $0.activationState == .foregroundActive && (sceneID == nil || $0.session.persistentIdentifier == sceneID) }).flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController
        else { complete(.failure(FolderBridgeError.unavailable)); return }
        while let presented = controller.presentedViewController { controller = presented }
        let delegate = FolderPicker(complete)
        active = delegate
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
        picker.delegate = delegate
        picker.presentationController?.delegate = delegate
        controller.present(picker, animated: true)
    }
    private func finish(_ result: Result<URL, Error>) {
        guard Self.active === self else { return }
        Self.active = nil
        complete(result)
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if let url = urls.first { finish(.success(url)) } else { finish(.failure(FolderBridgeError.cancelled)) }
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(.failure(FolderBridgeError.cancelled)) }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { finish(.failure(FolderBridgeError.cancelled)) }
}

enum FolderAccess {
    static var privateDirectory: URL {
        get throws {
            let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let directory = root.appendingPathComponent("TioFolderGrants", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            return directory
        }
    }

    static func call(_ request: [String: Any]) throws -> Any {
        let action = request["action"] as? String
        if action == "forgetAll" {
            BackgroundSync.cancel()
            let directory = try privateDirectory
            try FileManager.default.removeItem(at: directory)
            return true
        }
        if action == "pick" {
            // The Tauri handler dispatches this blocking call off the main thread.
            guard !Thread.isMainThread else { throw FolderBridgeError.unavailable }
            let done = DispatchSemaphore(value: 0)
            var picked: Result<URL, Error>?
            let sceneID = request["scene"] as? String
            DispatchQueue.main.async { FolderPicker.show(sceneID: sceneID) { picked = $0; done.signal() } }
            done.wait()
            let selection = try picked!.get()
            let grant = try AuthorizedFolder(selection: selection)
            let id = SHA256.hash(data: Data(selection.standardizedFileURL.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
            try grant.bookmark.write(to: try privateDirectory.appendingPathComponent(id), options: .atomic)
            return ["kind": "native-folder", "id": id, "name": selection.lastPathComponent]
        }
        guard let id = request["grant"] as? String, id.count == 64,
              id.allSatisfy({ $0.isHexDigit }) else { throw FolderBridgeError.invalid }
        if let action, ["lock","unlock","stateRead","stateEntries","stateWrite","stateDelete"].contains(action) {
            return try FolderJournal.call(action, request, grant: id)
        }
        let grant = AuthorizedFolder(bookmark: try Data(contentsOf: privateDirectory.appendingPathComponent(id)))
        if action == "access" { try grant.checkAccess(); return true }
        if action == "workspaces" { return try grant.workspaceIDs() }
        guard let path = request["path"] as? String, path.hasPrefix("workspaces/") else { throw FolderBridgeError.invalid }
        switch action {
        case "list": return try grant.list(path)
        case "read": return try grant.read(path)?.base64EncodedString() as Any? ?? NSNull()
        case "write":
            guard let encoded = request["data"] as? String, let data = Data(base64Encoded: encoded) else { throw FolderBridgeError.invalid }
            try grant.write(data, to: path)
        case "remove": try grant.remove(path)
        default: throw FolderBridgeError.invalid
        }
        return NSNull()
    }

    static func reply(_ input: String) -> String {
        let output: [String: Any]
        do {
            guard let request = try JSONSerialization.jsonObject(with: Data(input.utf8)) as? [String: Any] else { throw FolderBridgeError.invalid }
            output = ["value": try call(request)]
        } catch {
            let code: String
            switch error {
            case FolderAccessError.permission, FolderAccessError.staleBookmark: code = "permission"
            case FolderAccessError.downloadPending: code = "pending"
            case FolderAccessError.conflict: code = "conflict"
            case FolderBridgeError.cancelled: code = "cancelled"
            case FolderAccessError.invalidPath, FolderBridgeError.invalid: code = "invalid"
            case let error as CocoaError where [.fileReadNoPermission,.fileWriteNoPermission].contains(error.code): code = "permission"
            default: code = "unavailable"
            }
            output = ["error": code]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: output) else { return "{\"error\":\"invalid\"}" }
        return String(decoding: data, as: UTF8.self)
    }
}

@_cdecl("tio_apple_folder")
func tioAppleFolder(_ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    strdup(FolderAccess.reply(String(cString: json)))
}

@_cdecl("tio_free_apple_string")
func tioFreeAppleString(_ pointer: UnsafeMutablePointer<CChar>) { free(pointer) }
