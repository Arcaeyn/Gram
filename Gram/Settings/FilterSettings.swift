import Foundation
import Observation

/// What to strip from Instagram. Persisted in UserDefaults; changes take effect on the next load.
@Observable
final class FilterSettings {
    var followingFeed: Bool { didSet { save(followingFeed, Keys.followingFeed) } }
    var hideSuggested: Bool { didSet { save(hideSuggested, Keys.hideSuggested) } }
    var hideAds: Bool { didSet { save(hideAds, Keys.hideAds) } }
    var hideFeedReels: Bool { didSet { save(hideFeedReels, Keys.hideFeedReels) } }
    var allowDMReels: Bool { didSet { save(allowDMReels, Keys.allowDMReels) } }
    var blockExplore: Bool { didSet { save(blockExplore, Keys.blockExplore) } }
    var hideAppBanners: Bool { didSet { save(hideAppBanners, Keys.hideAppBanners) } }

    private enum Keys {
        // v2: Home now stays Home by default; the Following view is opt-in.
        static let followingFeed = "filter.followingFeed.v2"
        static let hideSuggested = "filter.hideSuggested"
        static let hideAds = "filter.hideAds"
        static let hideFeedReels = "filter.hideFeedReels"
        static let allowDMReels = "filter.allowDMReels"
        static let blockExplore = "filter.blockExplore"
        static let hideAppBanners = "filter.hideAppBanners"
    }

    init(defaults: UserDefaults = .standard) {
        func value(_ key: String) -> Bool { defaults.object(forKey: key) as? Bool ?? true }
        followingFeed = defaults.object(forKey: Keys.followingFeed) as? Bool ?? false
        hideSuggested = value(Keys.hideSuggested)
        hideAds = value(Keys.hideAds)
        hideFeedReels = value(Keys.hideFeedReels)
        allowDMReels = value(Keys.allowDMReels)
        blockExplore = value(Keys.blockExplore)
        hideAppBanners = value(Keys.hideAppBanners)
    }

    /// Snapshot handed to filter.js.
    var json: String {
        let config: [String: Bool] = [
            "followingFeed": followingFeed,
            "hideSuggested": hideSuggested,
            "hideAds": hideAds,
            "hideFeedReels": hideFeedReels,
            "allowDMReels": allowDMReels,
            "blockExplore": blockExplore,
            "hideAppBanners": hideAppBanners,
        ]
        let data = (try? JSONSerialization.data(withJSONObject: config, options: [.sortedKeys])) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    private func save(_ value: Bool, _ key: String) {
        UserDefaults.standard.set(value, forKey: key)
    }
}
