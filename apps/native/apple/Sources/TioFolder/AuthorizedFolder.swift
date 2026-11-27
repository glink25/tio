import Foundation
import OSLog

public enum FolderAccessError: Error {
    case permission, staleBookmark, invalidPath, downloadPending, conflict
}

/// Persist the bookmark in the host's private connection catalog under the connection ID.
public struct AuthorizedFolder: Sendable {
    private static let log = Logger(subsystem: "com.glink25.tio", category: "FolderAccess")
    public let bookmark: Data

    private func measured<T>(_ stage: String, _ work: () throws -> T) throws -> T {
        let start = ProcessInfo.processInfo.systemUptime
        do {
            let value = try work()
            let duration = ProcessInfo.processInfo.systemUptime - start
            if duration >= 1 {
                Self.log.notice("\(stage, privacy: .public) waited \(duration, privacy: .public)s")
            }
            return value
        } catch {
            let errorInfo = error as NSError
            let duration = ProcessInfo.processInfo.systemUptime - start
            Self.log.notice("\(stage, privacy: .public) failed after \(duration, privacy: .public)s (\(errorInfo.domain, privacy: .public) \(errorInfo.code, privacy: .public))")
            throw error
        }
    }

    public init(bookmark: Data) {
        self.bookmark = bookmark
    }

    public init(selection: URL) throws {
        guard selection.startAccessingSecurityScopedResource() else {
            throw FolderAccessError.permission
        }
        defer { selection.stopAccessingSecurityScopedResource() }
        #if os(macOS)
        let options: URL.BookmarkCreationOptions = [.withSecurityScope]
        #else
        let options: URL.BookmarkCreationOptions = [.minimalBookmark]
        #endif
        bookmark = try selection.bookmarkData(options: options)
    }

    private func scoped<T>(_ operation: (URL) throws -> T) throws -> T {
        var stale = false
        #if os(macOS)
        let options: URL.BookmarkResolutionOptions = [.withSecurityScope, .withoutUI]
        #else
        let options: URL.BookmarkResolutionOptions = [.withoutUI]
        #endif
        let root = try measured("bookmark") {
            let root = try URL(resolvingBookmarkData: bookmark, options: options,
                               relativeTo: nil, bookmarkDataIsStale: &stale)
            guard !stale else { throw FolderAccessError.staleBookmark }
            guard root.startAccessingSecurityScopedResource() else {
                throw FolderAccessError.permission
            }
            return root
        }
        defer { root.stopAccessingSecurityScopedResource() }
        return try operation(root)
    }

    /// Coordinate through the selected directory so missing files and new shard directories
    /// can be accessed under the same grant. Each call covers one filesystem operation.
    private func access<T>(writing: Bool, _ operation: (URL) throws -> T) throws -> T {
        try withoutActuallyEscaping(operation) { perform in
            try scoped { root in
                let coordinator = NSFileCoordinator()
                var error: NSError?
                var result: Result<T, Error>?
                let body: (URL) -> Void = { url in
                    result = Result { try self.measured(writing ? "write" : "read") { try perform(url) } }
                }
                try measured(writing ? "coordinate-write" : "coordinate-read") {
                    if writing {
                        coordinator.coordinate(writingItemAt: root, options: [], error: &error, byAccessor: body)
                    } else {
                        coordinator.coordinate(readingItemAt: root, options: [], error: &error, byAccessor: body)
                    }
                    if let error { throw error }
                }
                guard let result else { throw CocoaError(.fileReadUnknown) }
                return try result.get()
            }
        }
    }

    private func target(_ path: String, in root: URL) throws -> URL {
        var url = root
        for part in path.components(separatedBy: "/") {
            guard !part.isEmpty, part != ".", part != "..", !part.contains("\\"),
                  !part.contains("\0") else { throw FolderAccessError.invalidPath }
            url.appendPathComponent(part)
            do {
                if try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
                    throw FolderAccessError.invalidPath
                }
            } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
                continue
            }
        }
        return url
    }

    private func checkCloudState(_ url: URL) throws {
        let values = try url.resourceValues(forKeys: [.ubiquitousItemHasUnresolvedConflictsKey,
                                                     .ubiquitousItemDownloadingStatusKey])
        if values.ubiquitousItemHasUnresolvedConflicts == true { throw FolderAccessError.conflict }
        if values.ubiquitousItemDownloadingStatus == .notDownloaded {
            try FileManager.default.startDownloadingUbiquitousItem(at: url)
            throw FolderAccessError.downloadPending
        }
    }

    public func read(_ path: String) throws -> Data? {
        try access(writing: false) { root in
            let url = try target(path, in: root)
            do {
                try checkCloudState(url)
                return try Data(contentsOf: url)
            } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
                return nil
            }
        }
    }

    public func write(_ data: Data, to path: String) throws {
        try access(writing: true) { root in
            let url = try target(path, in: root)
            do { try checkCloudState(url) }
            catch let error as CocoaError where error.code == .fileReadNoSuchFile {}
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
        }
    }

    public func checkAccess() throws { try scoped { _ in } }

    public func workspaceIDs() throws -> [String] {
        try access(writing: false) { root in
            let url = try target("workspaces", in: root)
            do {
                return try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey])
                    .filter { item in
                        let values = try item.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
                        return values.isDirectory == true && values.isSymbolicLink != true
                            && item.lastPathComponent.range(of: "^[a-zA-Z0-9_-]+$", options: .regularExpression) != nil
                    }.map(\.lastPathComponent).sorted()
            } catch let error as CocoaError where error.code == .fileReadNoSuchFile { return [] }
        }
    }

    public func list(_ prefix: String) throws -> [String] {
        try access(writing: false) { root in
            let path = prefix.hasSuffix("/") ? String(prefix.dropLast()) : prefix
            let directory = try target(path, in: root)
            var paths = [String]()
            func walk(_ url: URL, _ relative: String) throws {
                for item in try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey]) {
                    let values = try item.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
                    if values.isSymbolicLink == true { continue }
                    let child = relative + "/" + item.lastPathComponent
                    if values.isDirectory == true { try walk(item, child) } else { paths.append(child) }
                }
            }
            do { try walk(directory, path) }
            catch let error as CocoaError where error.code == .fileReadNoSuchFile && paths.isEmpty {
                if FileManager.default.fileExists(atPath: directory.path) { throw error }
            }
            return paths.sorted()
        }
    }

    public func remove(_ path: String) throws {
        try access(writing: true) { root in
            let url = try target(path, in: root)
            do {
                try checkCloudState(url)
                try FileManager.default.removeItem(at: url)
            } catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile {}
        }
    }
}
