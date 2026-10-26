import Observation
import SafariServices
import UIKit
import WebKit

/// Owns the web view that hosts instagram.com and everything that keeps it filtered.
@Observable
@MainActor
final class BrowserModel: NSObject {
    static let home = URL(string: "https://www.instagram.com/")!

    private(set) var progress: Double = 0
    private(set) var isLoading = false
    private(set) var loadError: String?
    private(set) var toast: String?
    private(set) var pageColor: UIColor?
    var showSettings = false
    /// True on pages with Instagram's bottom tab bar, which sit a little lower on screen.
    private(set) var lowersTabBar = true

    @ObservationIgnored let webView: WKWebView
    @ObservationIgnored private var observations: [NSKeyValueObservation] = []
    @ObservationIgnored private var toastTask: Task<Void, Never>?
    @ObservationIgnored private let refreshControl = UIRefreshControl()
    @ObservationIgnored private var currentPath = "/"

    init(settings: FilterSettings) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.preferredContentMode = .mobile
        // Present as mobile Safari so Instagram serves its full mobile site instead of "use the app" pages.
        let major = UIDevice.current.systemVersion.split(separator: ".").first ?? "18"
        config.applicationNameForUserAgent = "Version/\(major).0 Mobile/15E148 Safari/604.1"

        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        config.userContentController.add(WeakMessageHandler(self), name: "gram")
        installScripts(settings)

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = false
        // Transparent until the page reports its real background, so nothing grey shows around it.
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        #if DEBUG
        webView.isInspectable = true
        #endif

        refreshControl.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl

        let settingsGesture = UITapGestureRecognizer(target: self, action: #selector(openSettings))
        settingsGesture.numberOfTouchesRequired = 2
        settingsGesture.numberOfTapsRequired = 2
        settingsGesture.cancelsTouchesInView = false
        settingsGesture.delegate = self
        webView.addGestureRecognizer(settingsGesture)

        observations = [
            webView.observe(\.estimatedProgress, options: [.new]) { [weak self] web, _ in
                MainActor.assumeIsolated { self?.progress = web.estimatedProgress }
            },
            webView.observe(\.isLoading, options: [.new]) { [weak self] web, _ in
                MainActor.assumeIsolated { self?.isLoading = web.isLoading }
            },
        ]

        #if DEBUG
        // -mockPage /path/to/page.html renders a local page as instagram.com so the filters run on it.
        // -mockURL https://www.instagram.com/direct/t/1/ sets which instagram.com address it pretends to be.
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-mockPage"), i + 1 < args.count,
           let html = try? String(contentsOfFile: args[i + 1], encoding: .utf8) {
            let base = args.firstIndex(of: "-mockURL").flatMap { $0 + 1 < args.count ? URL(string: args[$0 + 1]) : nil }
            webView.loadHTMLString(html, baseURL: base ?? URL(string: "https://www.instagram.com/?variant=following"))
            return
        }
        #endif
        webView.load(URLRequest(url: Self.home))
    }

    // MARK: Actions

    func reload(with settings: FilterSettings) {
        installScripts(settings)
        loadError = nil
        if webView.url == nil { webView.load(URLRequest(url: Self.home)) } else { webView.reload() }
    }

    func retry() {
        loadError = nil
        webView.load(URLRequest(url: webView.url ?? Self.home))
    }

    /// Session limit hit: stop all playback and park the page.
    func suspendForLock() {
        showSettings = false
        webView.evaluateJavaScript("document.querySelectorAll('video,audio').forEach(function(m){m.pause()})")
        webView.load(URLRequest(url: URL(string: "about:blank")!))
    }

    func resumeAfterLock() {
        loadError = nil
        webView.load(URLRequest(url: Self.home))
    }

    func logOut() async {
        let store = WKWebsiteDataStore.default()
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
        HTTPCookieStorage.shared.removeCookies(since: .distantPast)
        webView.load(URLRequest(url: Self.home))
    }

    @objc private func pullToRefresh() {
        webView.reload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.refreshControl.endRefreshing() }
    }

    @objc private func openSettings() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        showSettings = true
    }

    // MARK: Scripts

    private func installScripts(_ settings: FilterSettings) {
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()
        guard let rules = Self.resource("rules"), let filter = Self.resource("filter") else {
            assertionFailure("Missing filter scripts in bundle")
            return
        }
        let configured = filter.replacingOccurrences(of: "__GRAM_CONFIG__", with: settings.json)
        controller.addUserScript(WKUserScript(source: rules, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.addUserScript(WKUserScript(source: configured, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    private static func resource(_ name: String) -> String? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "js") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    // MARK: Messages from the page

    fileprivate func handle(message body: Any) {
        guard let dict = body as? [String: Any], let type = dict["type"] as? String else { return }
        switch type {
        case "blocked":
            let reason = dict["reason"] as? String
            show(toast: reason == "reel" ? "Only reels sent to you can be opened" : "Reels are hidden")
        case "theme":
            guard let css = dict["color"] as? String, let color = Self.color(fromCSS: css) else { return }
            pageColor = color
            webView.underPageBackgroundColor = color
        case "storyAd":
            show(toast: "Skipped a sponsored story")
        case "route":
            currentPath = dict["path"] as? String ?? "/"
            // DM threads scroll inside the page; pull-to-refresh there would reload mid-conversation.
            webView.scrollView.refreshControl = currentPath.hasPrefix("/direct/") ? nil : refreshControl
            // Chats and stories keep the full bottom margin so their message bar stays clear of the home indicator.
            lowersTabBar = dict["tabBar"] as? Bool ?? false
        default:
            break
        }
    }

    /// Parses getComputedStyle colors: "rgb(255, 255, 255)" / "rgba(0, 0, 0, 0.5)".
    static func color(fromCSS css: String) -> UIColor? {
        let parts = css.components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted).compactMap(Double.init)
        guard css.hasPrefix("rgb"), parts.count >= 3 else { return nil }
        let alpha = parts.count >= 4 ? parts[3] : 1
        guard alpha > 0.05 else { return nil }
        return UIColor(red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: 1)
    }

    private func show(toast message: String) {
        toastTask?.cancel()
        toast = message
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.8))
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }

    // MARK: Link routing

    private static let instagramHosts = ["instagram.com"]
    private static let loginHosts = ["facebook.com", "fb.com", "meta.com", "messenger.com", "fbcdn.net", "cdninstagram.com", "accountscenter.instagram.com"]

    private static func host(_ host: String?, matches domains: [String]) -> Bool {
        guard let host = host?.lowercased() else { return false }
        return domains.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    /// Instagram wraps outbound links as l.instagram.com/?u=<destination>.
    private static func unwrapOutbound(_ url: URL) -> URL? {
        guard url.host?.lowercased() == "l.instagram.com",
              let target = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "u" })?.value
        else { return nil }
        return URL(string: target)
    }

    private func openExternally(_ url: URL) {
        guard let scheme = url.scheme?.lowercased() else { return }
        if scheme == "http" || scheme == "https" {
            let safari = SFSafariViewController(url: url)
            safari.dismissButtonStyle = .close
            Self.topViewController()?.present(safari, animated: true)
        } else if ["mailto", "tel", "sms", "facetime", "maps"].contains(scheme) {
            UIApplication.shared.open(url)
        }
        // instagram:// and other app links are ignored on purpose: they'd bounce you to the real app.
    }

    private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.keyWindow?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

// MARK: - WKNavigationDelegate

extension BrowserModel: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        let scheme = url.scheme?.lowercased() ?? ""

        if scheme == "about" || scheme == "blob" || scheme == "data" { return .allow }
        guard scheme == "http" || scheme == "https" else {
            openExternally(url)
            return .cancel
        }
        // Subframes (captcha, embeds) load freely; only top-level navigation is routed.
        guard action.targetFrame?.isMainFrame ?? true else { return .allow }

        if let outbound = Self.unwrapOutbound(url) {
            openExternally(outbound)
            return .cancel
        }
        if Self.host(url.host, matches: Self.instagramHosts) || Self.host(url.host, matches: Self.loginHosts) {
            return .allow
        }
        openExternally(url)
        return .cancel
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadError = nil
        refreshControl.endRefreshing()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleFailure(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleFailure(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    private func handleFailure(_ error: Error) {
        refreshControl.endRefreshing()
        let ns = error as NSError
        // Cancelled loads and policy interruptions are normal (redirects, SPA navigation).
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        if ns.domain == "WebKitErrorDomain" && (ns.code == 102 || ns.code == 204) { return }
        let offlineCodes = [NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut,
                            NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorDNSLookupFailed]
        if ns.domain == NSURLErrorDomain && offlineCodes.contains(ns.code) {
            loadError = "You're offline. Check your connection and try again."
        }
    }
}

// MARK: - WKUIDelegate

extension BrowserModel: WKUIDelegate {
    /// target=_blank and window.open: keep Instagram/login pages here, send everything else to Safari.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if let outbound = Self.unwrapOutbound(url) {
                openExternally(outbound)
            } else if Self.host(url.host, matches: Self.instagramHosts) || Self.host(url.host, matches: Self.loginHosts) {
                webView.load(action.request)
            } else {
                openExternally(url)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async {
        await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in continuation.resume() })
            guard let top = Self.topViewController() else { continuation.resume(); return }
            top.present(alert, animated: true)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async -> Bool {
        await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in continuation.resume(returning: false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in continuation.resume(returning: true) })
            guard let top = Self.topViewController() else { continuation.resume(returning: false); return }
            top.present(alert, animated: true)
        }
    }

    func webView(_ webView: WKWebView, decideMediaCapturePermissionsFor origin: WKSecurityOrigin,
                 initiatedBy frame: WKFrameInfo, type: WKMediaCaptureType) async -> WKPermissionDecision {
        Self.host(origin.host, matches: Self.instagramHosts) ? .prompt : .deny
    }
}

// MARK: - Gestures

extension BrowserModel: UIGestureRecognizerDelegate {
    nonisolated func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                                       shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }
}

// MARK: - Script message bridge

/// WKUserContentController retains its handlers; this keeps it from retaining the model.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: BrowserModel?
    init(_ target: BrowserModel) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body
        MainActor.assumeIsolated { target?.handle(message: body) }
    }
}
