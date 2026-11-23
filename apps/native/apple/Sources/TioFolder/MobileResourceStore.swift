import Foundation

/// Owned by the foreground host. App Intents do not activate or acknowledge UI updates.
public actor MobileResourceStore {
    private struct State: Codable {
        var highestRevision = 0
        var pending: Data?
        var trial: Data?
        var confirmed: Data?
    }

    private let file: URL
    private let publicKey: Data
    private let channel: String
    private let hostABI: Int
    private let bundledKeys: Set<String>
    private var started = false
    private var selected: MobileResourcePack?

    public init(directory: URL, publicKey: Data, channel: String, hostABI: Int, bundledKeys: Set<String>) {
        self.file = directory.appendingPathComponent("resources-\(channel)-\(hostABI).json")
        self.publicKey = publicKey
        self.channel = channel
        self.hostABI = hostABI
        self.bundledKeys = bundledKeys
    }

    private func load() throws -> State {
        do { return try JSONDecoder().decode(State.self, from: Data(contentsOf: file)) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { return State() }
    }

    private func save(_ state: State) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(state).write(to: file, options: .atomic)
    }

    private func verified(_ data: Data, after revision: Int = 0) throws -> MobileResourcePack {
        try MobileResourcePack.verified(data, publicKey: publicKey, channel: channel,
                                       hostABI: hostABI, activeRevision: revision, bundledKeys: bundledKeys)
    }

    public func stage(_ data: Data) throws {
        var state = try load()
        let pack = try verified(data, after: state.highestRevision)
        state.pending = data
        state.highestRevision = pack.revision
        try save(state)
    }

    /// Call once at cold launch. An unacknowledged trial from the prior process is discarded.
    public func beginLaunch() throws -> MobileResourcePack? {
        if started { return selected }
        var state = try load()
        let needsSave = state.trial != nil || state.pending != nil
        state.trial = state.pending
        state.pending = nil
        let selection = try (state.trial ?? state.confirmed).map { try verified($0) }
        if needsSave { try save(state) }
        selected = selection
        started = true
        return selected
    }

    /// Acknowledge only after the translated application UI has rendered.
    public func confirmLaunch() throws {
        guard started else { return }
        var state = try load()
        guard let trial = state.trial else { return }
        state.confirmed = trial
        state.trial = nil
        try save(state)
    }
}
