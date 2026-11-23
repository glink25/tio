import AppIntents

struct ReadDocument: AppIntent {
    static var title: LocalizedStringResource = "Read Tio document"
    @Parameter(title: "Connection ID", default: "device") var connection: String
    @Parameter(title: "Workspace ID") var workspace: String
    @Parameter(title: "Document ID") var document: String
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        .result(value: try await ShortcutKernel.run(["action": "read", "connection": connection, "workspace": workspace, "document": document]))
    }
}
struct AppendDocument: AppIntent {
    static var title: LocalizedStringResource = "Append to Tio document"
    @Parameter(title: "Connection ID", default: "device") var connection: String
    @Parameter(title: "Workspace ID") var workspace: String
    @Parameter(title: "Document ID") var document: String
    @Parameter(title: "Text") var text: String
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        .result(value: try await ShortcutKernel.run(["action": "append", "connection": connection, "workspace": workspace, "document": document, "text": text]))
    }
}
struct CreateDocument: AppIntent {
    static var title: LocalizedStringResource = "Create Tio document"
    @Parameter(title: "Connection ID", default: "device") var connection: String
    @Parameter(title: "Workspace ID") var workspace: String
    @Parameter(title: "Title") var documentTitle: String
    @Parameter(title: "Text") var text: String?
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var input = ["action": "create", "connection": connection, "workspace": workspace, "title": documentTitle]
        input["text"] = text
        return .result(value: try await ShortcutKernel.run(input))
    }
}
