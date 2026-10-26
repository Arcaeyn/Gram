import SwiftUI
import WebKit

struct ContentView: View {
    let settings: FilterSettings
    @State private var browser: BrowserModel
    @State private var timer = SessionTimer()
    @AppStorage("didShowWelcome") private var didShowWelcome = false
    @State private var showWelcome = false
    @Environment(\.scenePhase) private var scenePhase
    private let quickActions = QuickActions.shared

    init(settings: FilterSettings) {
        self.settings = settings
        _browser = State(initialValue: BrowserModel(settings: settings))
    }

    private var pageColor: Color { Color(uiColor: browser.pageColor ?? .systemBackground) }

    /// How far tab-bar pages reach into the home-indicator area, so the tab bar sits lower.
    private static let bottomOverlap: CGFloat = 18

    var body: some View {
        GeometryReader { proxy in
            let overlap = browser.lowersTabBar ? Self.bottomOverlap : 0
            main(bottomInset: max(0, proxy.safeAreaInsets.bottom - overlap))
        }
        // The web view moves its own content above the keyboard, like Safari. Resizing it as well
        // would push the message bar out of place.
        .ignoresSafeArea(.keyboard)
    }

    private func main(bottomInset: CGFloat) -> some View {
        @Bindable var browser = browser
        return ZStack(alignment: .top) {
            VStack(spacing: 0) {
                if timer.showTimer {
                    SessionStrip(timer: timer) { browser.showSettings = true }
                }
                ZStack(alignment: .top) {
                    WebContainer(webView: browser.webView)
                    if browser.isLoading && browser.progress < 1 {
                        ProgressView(value: browser.progress)
                            .progressViewStyle(.linear)
                            .tint(Color(red: 0.0, green: 0.58, blue: 0.96))
                            .frame(height: 2)
                            .transition(.opacity)
                    }
                }
                .padding(.bottom, bottomInset)
                .ignoresSafeArea(.container, edges: .bottom)
            }

            if let error = browser.loadError {
                OfflineView(message: error, onRetry: browser.retry)
            }

            if let toast = browser.toast {
                Text(toast)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.black.opacity(0.8), in: Capsule())
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, 90)
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
                    .allowsHitTesting(false)
            }

            if timer.isLocked {
                TimesUpView(timer: timer)
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        .background(pageColor.ignoresSafeArea())
        .animation(.easeOut(duration: 0.2), value: browser.toast)
        .animation(.easeOut(duration: 0.2), value: browser.isLoading)
        .animation(.easeInOut(duration: 0.3), value: timer.isLocked)
        .sheet(isPresented: $browser.showSettings) {
            SettingsView(settings: settings, browser: browser, timer: timer)
        }
        .sheet(isPresented: $showWelcome) {
            WelcomeView { showWelcome = false }
                .interactiveDismissDisabled()
        }
        .onAppear {
            timer.onLock = { browser.suspendForLock() }
            timer.onUnlock = { browser.resumeAfterLock() }
            timer.becameActive()
            if timer.isLocked { browser.suspendForLock() }
            if !didShowWelcome {
                didShowWelcome = true
                showWelcome = true
            }
            consumeQuickAction()
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: timer.becameActive()
            case .background: timer.resignedActive()
            default: break
            }
        }
        .onChange(of: quickActions.pending) { _, _ in consumeQuickAction() }
        .onChange(of: browser.showSettings) { _, showing in
            // No changing the rules while locked out.
            if showing && timer.isLocked { browser.showSettings = false }
        }
    }

    private func consumeQuickAction() {
        guard quickActions.pending == QuickActions.settingsType else { return }
        quickActions.pending = nil
        if !timer.isLocked { browser.showSettings = true }
    }
}

/// Today's screen time above the page. Tap it for settings.
private struct SessionStrip: View {
    let timer: SessionTimer
    let onTap: () -> Void

    var body: some View {
        let warning = (timer.remaining ?? .infinity) <= 60
        Button(action: onTap) {
            HStack(spacing: 5) {
                Image(systemName: "timer")
                    .font(.system(size: 11, weight: .semibold))
                Text("\(Clock.short(timer.todayTotal)) today")
                    .font(.system(size: 12, weight: .semibold))
                    .monospacedDigit()
                if let remaining = timer.remaining {
                    Text("\u{00B7} \(Clock.short(remaining)) left")
                        .font(.system(size: 12, weight: .medium))
                        .monospacedDigit()
                        .opacity(0.75)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 24)
            .overlay(alignment: .trailing) {
                Image(systemName: "gearshape")
                    .font(.system(size: 13, weight: .medium))
                    .padding(.trailing, 14)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(warning ? Color.red : Color.primary.opacity(0.5))
        .accessibilityLabel("Screen time today \(Clock.short(timer.todayTotal)). Opens settings.")
    }
}

private struct TimesUpView: View {
    let timer: SessionTimer

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "hourglass")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(.secondary)
                .padding(.bottom, 6)
            Text("Time\u{2019}s up")
                .font(.system(size: 30, weight: .bold))
            Text(timer.limitMinutes == 0 ? "Session over."
                 : timer.limitScope == .day ? "You reached your \(Clock.long(Double(timer.limitMinutes * 60))) for today."
                 : "You reached your \(timer.limitMinutes)-minute session.")
                .font(.system(size: 16))
                .foregroundStyle(.secondary)
            if let until = timer.lockedUntil, until > timer.now {
                Text("Back in \(Clock.short(until.timeIntervalSince(timer.now)))")
                    .font(.system(size: 17, weight: .semibold))
                    .monospacedDigit()
                    .padding(.top, 10)
            }
        }
        .multilineTextAlignment(.center)
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
    }
}

struct WebContainer: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

private struct OfflineView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(.secondary)
            Text(message)
                .font(.system(size: 15))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Try again", action: onRetry)
                .buttonStyle(.borderedProminent)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
    }
}

private struct WelcomeView: View {
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Text("Just your people.")
                .font(.system(size: 32, weight: .bold))
            Text("Instagram without the endless scroll.")
                .font(.system(size: 17))
                .foregroundStyle(.secondary)
                .padding(.top, 6)

            VStack(alignment: .leading, spacing: 22) {
                row("person.2.fill", "Your people only", "Posts from people you follow. No suggested posts or ads.")
                row("circle.dashed", "Stories & messages", "Everything you actually open the app for.")
                row("play.slash.fill", "No Reels tab", "Reels a friend sends you still open, one at a time, with no swiping to the next.")
                row("timer", "Screen time", "Today's time shows at the top. After a 10-minute session, Gram closes. You can change this.")
                row("gearshape.fill", "Settings", "Tap the timer at the top.")
            }
            .padding(.top, 36)

            Spacer()

            Button(action: onDone) {
                Text("Log in to Instagram")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 12))

            Text("You sign in on Instagram's own page. Your password never touches this app.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
                .padding(.top, 12)
        }
        .padding(28)
    }

    private func row(_ icon: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundStyle(.tint)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 16, weight: .semibold))
                Text(detail).font(.system(size: 15)).foregroundStyle(.secondary)
            }
        }
    }
}
