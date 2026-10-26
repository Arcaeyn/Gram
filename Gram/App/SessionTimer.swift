import Observation
import UIKit

/// Tracks today's total time in the app, the current session, and enforces the limit.
/// A session survives quick trips out of the app; 5 minutes away starts a new one.
/// Today's total only resets at midnight.
@Observable
@MainActor
final class SessionTimer {
    enum LimitScope: String, CaseIterable, Identifiable {
        case session, day
        var id: String { rawValue }
        var title: String { self == .session ? "Per session" : "Per day" }
    }

    static let resetAfterAway: TimeInterval = 5 * 60
    static let limitOptions = [5, 10, 15, 20, 30, 45, 60, 90, 120]
    static let cooldownOptions = [5, 15, 30, 60, 120]

    var showTimer: Bool { didSet { defaults.set(showTimer, forKey: Keys.showTimer) } }
    /// 0 = no limit.
    var limitMinutes: Int { didSet { defaults.set(limitMinutes, forKey: Keys.limit) } }
    /// How long the app stays locked after hitting a session limit. 0 = no lockout.
    var cooldownMinutes: Int { didSet { defaults.set(cooldownMinutes, forKey: Keys.cooldown) } }
    /// Whether the limit applies to each session or to the whole day (locked until midnight).
    var limitScope: LimitScope { didSet { defaults.set(limitScope.rawValue, forKey: Keys.scope) } }

    private(set) var elapsed: TimeInterval = 0
    private(set) var todayTotal: TimeInterval = 0
    private(set) var lockedUntil: Date?
    /// True while the "Time's up" screen shows right before the app closes.
    private(set) var timesUp = false
    private(set) var now = Date()

    var isLocked: Bool { timesUp || (lockedUntil.map { $0 > now } ?? false) }

    /// Time counted toward the limit: this session, or all of today.
    var counted: TimeInterval { limitScope == .day ? todayTotal : elapsed }

    var remaining: TimeInterval? {
        limitMinutes > 0 ? max(0, limitSeconds - counted) : nil
    }

    private var limitSeconds: TimeInterval {
        #if DEBUG
        // -limitSeconds 20 shortens the limit for testing.
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-limitSeconds"), i + 1 < args.count, let seconds = Double(args[i + 1]) { return seconds }
        #endif
        return Double(limitMinutes * 60)
    }

    @ObservationIgnored var onLock: (() -> Void)?
    @ObservationIgnored var onUnlock: (() -> Void)?

    @ObservationIgnored private let defaults = UserDefaults.standard
    @ObservationIgnored private var lastTick: Date?
    @ObservationIgnored private var lastSeen: Date?
    @ObservationIgnored private var dayKey: String
    @ObservationIgnored private var ticker: Task<Void, Never>?

    private enum Keys {
        static let showTimer = "session.showTimer"
        static let limit = "session.limitMinutes"
        static let cooldown = "session.cooldownMinutes"
        static let elapsed = "session.elapsed"
        static let lastSeen = "session.lastSeen"
        static let lockedUntil = "session.lockedUntil"
        static let dayKey = "session.dayKey"
        static let todayTotal = "session.todayTotal"
        static let scope = "session.limitScope"
    }

    init() {
        showTimer = defaults.object(forKey: Keys.showTimer) as? Bool ?? true
        limitMinutes = defaults.object(forKey: Keys.limit) as? Int ?? 10
        cooldownMinutes = defaults.object(forKey: Keys.cooldown) as? Int ?? 15
        limitScope = defaults.string(forKey: Keys.scope).flatMap(LimitScope.init(rawValue:)) ?? .session
        elapsed = defaults.double(forKey: Keys.elapsed)
        lastSeen = defaults.object(forKey: Keys.lastSeen) as? Date
        lockedUntil = defaults.object(forKey: Keys.lockedUntil) as? Date
        dayKey = defaults.string(forKey: Keys.dayKey) ?? Self.key(for: Date())
        todayTotal = defaults.double(forKey: Keys.todayTotal)
        rollDayIfNeeded()
    }

    // MARK: Lifecycle

    func becameActive() {
        now = Date()
        if let lockedUntil, lockedUntil <= now { unlock() }
        if let lastSeen, now.timeIntervalSince(lastSeen) > Self.resetAfterAway { elapsed = 0 }
        lastTick = now
        lastSeen = now
        rollDayIfNeeded()
        save()
        guard ticker == nil else { return }
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                self?.tick()
            }
        }
    }

    func resignedActive() {
        tick()
        ticker?.cancel()
        ticker = nil
        lastTick = nil
        save()
    }

    // MARK: Ticking

    private func tick() {
        let current = Date()
        now = current
        guard let previous = lastTick else { return }
        lastTick = current
        lastSeen = current

        if isLocked { return }
        if lockedUntil != nil { unlock() }

        // Cap each step so time spent suspended is never counted.
        let dt = min(2, max(0, current.timeIntervalSince(previous)))
        rollDayIfNeeded()
        elapsed += dt
        todayTotal += dt

        // Saved every second, so even a force-quit loses at most a second.
        save()

        if limitMinutes > 0 && counted >= limitSeconds { lock() }
    }

    private func lock() {
        timesUp = true
        switch limitScope {
        case .session:
            lockedUntil = cooldownMinutes > 0 ? now.addingTimeInterval(Double(cooldownMinutes * 60)) : nil
        case .day:
            lockedUntil = Calendar.current.startOfDay(for: now).addingTimeInterval(24 * 60 * 60)
        }
        elapsed = 0
        save()
        onLock?()
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.5))
            guard let self else { return }
            self.timesUp = false
            if self.lockedUntil == nil { self.onUnlock?() }
            Self.sendToHomeScreen()
        }
    }

    private func unlock() {
        lockedUntil = nil
        elapsed = 0
        save()
        onUnlock?()
    }

    private func rollDayIfNeeded() {
        let today = Self.key(for: Date())
        if today != dayKey {
            dayKey = today
            todayTotal = 0
        }
    }

    private func save() {
        defaults.set(elapsed, forKey: Keys.elapsed)
        defaults.set(lastSeen, forKey: Keys.lastSeen)
        defaults.set(lockedUntil, forKey: Keys.lockedUntil)
        defaults.set(dayKey, forKey: Keys.dayKey)
        defaults.set(todayTotal, forKey: Keys.todayTotal)
    }

    private static func key(for date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return "\(c.year ?? 0)-\(c.month ?? 0)-\(c.day ?? 0)"
    }

    /// Same as pressing the Home button.
    private static func sendToHomeScreen() {
        UIControl().sendAction(#selector(URLSessionTask.suspend), to: UIApplication.shared, for: nil)
    }
}

enum Clock {
    /// 4:07, 1:02:03
    static func short(_ interval: TimeInterval) -> String {
        let total = max(0, Int(interval.rounded(.down)))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    /// 42m, 1h 5m
    static func long(_ interval: TimeInterval) -> String {
        let minutes = max(0, Int(interval / 60))
        return minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes)m"
    }
}
