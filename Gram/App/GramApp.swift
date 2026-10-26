import SwiftUI
import UIKit

@main
struct GramApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var settings = FilterSettings()

    var body: some Scene {
        WindowGroup {
            ContentView(settings: settings)
        }
    }
}

/// Long-press the app icon → "Settings".
@Observable
final class QuickActions {
    static let shared = QuickActions()
    static let settingsType = "com.marshallz.gram.settings"
    var pending: String?
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        if let item = options.shortcutItem { QuickActions.shared.pending = item.type }
        let config = UISceneConfiguration(name: nil, sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        QuickActions.shared.pending = shortcutItem.type
        completionHandler(true)
    }
}
