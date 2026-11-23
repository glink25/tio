import BackgroundTasks
import UIKit

enum BackgroundSync {
    static let identifier = "com.glink25.tio.sync"
    private static var observers: [NSObjectProtocol] = []

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            schedule()
            let execution = Task.detached(priority: .utility) {
                do {
                    guard let bundle = Bundle.main.url(forResource: "headless", withExtension: "js", subdirectory: "assets"),
                          let identifier = Bundle.main.bundleIdentifier else {
                        task.setTaskCompleted(success: false)
                        return
                    }
                    let database = try FileManager.default.url(for: .applicationSupportDirectory,
                        in: .userDomainMask, appropriateFor: nil, create: false)
                        .appendingPathComponent(identifier).appendingPathComponent("catalog.sqlite3")
                    let result = try ShortcutKernel.execute(["action": "background"], bundle: bundle, database: database)
                    let rows = try JSONSerialization.jsonObject(with: Data(result.utf8)) as? [[String: String]]
                    let succeeded = rows?.allSatisfy { ["synced", "manual", "permission"].contains($0["status"] ?? "") } == true
                    task.setTaskCompleted(success: succeeded && !Task.isCancelled)
                } catch {
                    task.setTaskCompleted(success: false)
                }
            }
            task.expirationHandler = { execution.cancel() }
        }
        for name in [UIApplication.didEnterBackgroundNotification, UIScene.didEnterBackgroundNotification] {
            observers.append(NotificationCenter.default.addObserver(
                forName: name, object: nil, queue: .main
            ) { _ in schedule() })
        }
    }

    static func cancel() { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier) }

    static func schedule() {
        let request = BGProcessingTaskRequest(identifier: identifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do { try BGTaskScheduler.shared.submit(request) }
        catch { NSLog("Tio background scheduling unavailable: %@", String(describing: error)) }
    }
}

@_cdecl("tio_register_background")
func tioRegisterBackground() {
    BackgroundSync.register()
}
