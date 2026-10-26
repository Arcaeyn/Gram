# Gram

Instagram with only your people: stories, messages, and posts from accounts you follow. There's no Reels tab, no suggested posts, no ads (in the feed or in stories) and no "get the app" popups. A session timer runs at the top, and the app closes itself when you hit your limit. A reel a friend sends you in a DM still opens, but only that reel. Swiping to the next one is blocked.

## How it works

Instagram has no public API for the feed, stories or DMs, so Gram is a native shell around Instagram's mobile website (`instagram.com`). It works like a content-blocking browser extension. You log in on Instagram's own page, and the session lives in the app's web storage.

Two scripts are injected into every page before Instagram's own code runs:

- **`rules.js`**: pure routing rules, unit-tested.
  - `/reels/` is always blocked.
  - `/reel/<id>` is allowed only when opened from `/direct/…`.
  - Moving from an allowed reel to a different reel bounces back.
  - The swipeable `/reels/<id>` viewer is rewritten to the single-post `/reel/<id>` page.
  - Optionally, Home is sent to Instagram's separate Following view (`/?variant=following`). This is off by default; Home itself is filtered.
  - Explore opens in place with its grid hidden, keeping the search box.
- **`filter.js`**: applies those rules. It only examines content as it appears (new posts, new popups) rather than rescanning the whole page, so it stays out of Instagram's way while pages load.
  - Watches `pushState`, `replaceState` and `popstate`, and cancels taps on blocked links.
  - Hides the page during a redirect.
  - Removes feed posts that show a **Follow** button (you don't follow that account) or are labeled **Sponsored**.
  - Removes the "Suggested for you" blocks, feed reels, and the Reels tab, then spaces the remaining tabs evenly.
  - Presses "Not now" on "get the app" popups and hides app banners. Text inside DMs is never touched.
  - Blacks out sponsored stories and skips to the next story.
  - Reports the page's background color, so the areas around the page match it exactly.

## Run it on your iPhone

1. Open `Gram.xcodeproj` in Xcode.
2. Select the **Gram** target → **Signing & Capabilities** → choose your **Team** (a free Apple ID works). Change the bundle ID if Xcode says it's taken.
3. Select your iPhone and press **Run**. First time only: trust your developer certificate in Settings → General → VPN & Device Management.

## Layout

- The web view handles the keyboard itself, like Safari, so message bars stay put when you type.
- Pages with Instagram's tab bar (Home, Search, profiles) reach slightly into the home-indicator area, so the tab bar sits lower.
- Chats and stories keep the full bottom margin, so their message bar is clear of the home indicator's gesture zone.

## Settings

Open Settings by **tapping the timer at the top** (it has a gear icon). You can also tap anywhere with two fingers twice, or long-press the app icon and choose **Settings**. Settings can't be opened during a lockout.

| Setting | Default |
| --- | --- |
| Show timer at the top (today's total) | On |
| Time limit (Off, 5 min–2 hr) | 10 min |
| Limit counts (per session / per day) | Per session |
| Locked out for, per-session limit only (don't lock, 5 min–2 hr) | 15 min |
| Open the Following view instead of Home | Off |
| Hide suggested posts & accounts | On |
| Hide ads in feed & stories | On |
| Hide reels in feed & profiles | On |
| Open reels sent in messages | On |
| Hide Explore grid (search still works) | On |
| Hide "Open app" prompts | On |
| Reels tab | Always hidden |

## Screen time

- The timer at the top shows your total time in the app today. It keeps counting across closes and reopens, and resets at midnight.
- **Per session** limit: when one session passes the limit, a "Time's up" screen shows, playback stops, and the app closes itself. It stays locked for the lockout time. Short trips out of the app don't reset a session; being away for 5 minutes does.
- **Per day** limit: once today's total passes the limit, the app closes and stays locked until midnight.
- While locked, reopening the app shows a countdown instead of Instagram.

## Limitations

- Everything is limited to what Instagram's mobile website supports. That covers the feed, stories, DMs, profiles, search, likes, comments and posting photos. It does not include push notifications, posting stories, or going live.
- When Instagram changes its website, the routing rules keep working because they depend only on URLs. Some cosmetic hiding, which depends on page text such as "Suggested for you" and "Sponsored", may need updating.

## Tests

```sh
npm install      # once, installs jsdom
npm test         # routing rules, page cleanup, DM reels, popups, story ads
npm run bench    # filter CPU cost on a large, changing feed
```

Debug builds also accept `-mockPage /path/to/page.html`, which renders a local page as instagram.com so the filters run on it (add `-mockURL https://www.instagram.com/direct/t/1/` to choose the address), and `-limitSeconds 20` to shorten the session limit.

The project is generated with [XcodeGen](https://github.com/yonaskolb/XcodeGen) from `project.yml`.
