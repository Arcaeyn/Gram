import SwiftUI

struct SettingsView: View {
    @Bindable var settings: FilterSettings
    let browser: BrowserModel
    @Bindable var timer: SessionTimer
    @Environment(\.dismiss) private var dismiss
    @State private var original = ""
    @State private var confirmLogout = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Today", value: Clock.long(timer.todayTotal))
                    Toggle("Show timer at the top", isOn: $timer.showTimer)
                    Picker("Time limit", selection: $timer.limitMinutes) {
                        Text("Off").tag(0)
                        ForEach(SessionTimer.limitOptions, id: \.self) { minutes in
                            Text(minutes >= 60 && minutes % 60 == 0 ? "\(minutes / 60) hr" : "\(minutes) min").tag(minutes)
                        }
                    }
                    if timer.limitMinutes > 0 {
                        Picker("Limit counts", selection: $timer.limitScope) {
                            ForEach(SessionTimer.LimitScope.allCases) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        if timer.limitScope == .session {
                            Picker("Locked out for", selection: $timer.cooldownMinutes) {
                                Text("Don\u{2019}t lock").tag(0)
                                ForEach(SessionTimer.cooldownOptions, id: \.self) { minutes in
                                    Text(minutes >= 60 ? "\(minutes / 60) hr" : "\(minutes) min").tag(minutes)
                                }
                            }
                            LabeledContent("This session", value: Clock.short(timer.elapsed))
                        }
                    }
                } header: {
                    Text("Screen time")
                } footer: {
                    Text(timer.limitScope == .day && timer.limitMinutes > 0
                         ? "Today's total resets at midnight. Once it passes the limit, Gram closes and stays locked until midnight."
                         : "Today's total resets at midnight. When one session passes the limit, Gram closes and stays locked for the lockout time. Being away for 5 minutes starts a new session.")
                }

                Section {
                    Toggle("Open the Following view instead of Home", isOn: $settings.followingFeed)
                    Toggle("Hide suggested posts & accounts", isOn: $settings.hideSuggested)
                    Toggle("Hide ads in feed & stories", isOn: $settings.hideAds)
                    Toggle("Hide reels in feed & profiles", isOn: $settings.hideFeedReels)
                } header: {
                    Text("Feed")
                } footer: {
                    Text("Home keeps your stories and posts from people you follow, with suggestions, ads and reels removed. The Following view is Instagram's separate newest-first list.")
                }

                Section {
                    LabeledContent("Reels tab") {
                        Label("Always hidden", systemImage: "lock.fill")
                            .labelStyle(.titleAndIcon)
                            .foregroundStyle(.secondary)
                    }
                    Toggle("Open reels sent in messages", isOn: $settings.allowDMReels)
                } header: {
                    Text("Reels")
                } footer: {
                    Text("A reel a friend sends you opens on its own. Swiping to the next reel is blocked.")
                }

                Section {
                    Toggle("Hide Explore grid", isOn: $settings.blockExplore)
                    Toggle("Hide \u{201C}Open app\u{201D} prompts", isOn: $settings.hideAppBanners)
                } footer: {
                    Text("Search still works with the Explore grid hidden.")
                }

                Section {
                    Button("Reload Instagram") {
                        original = settings.json
                        browser.reload(with: settings)
                        dismiss()
                    }
                    Button("Log out", role: .destructive) { confirmLogout = true }
                } footer: {
                    Text("Open this screen anytime by tapping the timer at the top. You can also tap with two fingers twice, or long-press the app icon and choose Settings.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
            .confirmationDialog("Log out of Instagram?", isPresented: $confirmLogout, titleVisibility: .visible) {
                Button("Log out", role: .destructive) {
                    Task {
                        await browser.logOut()
                        dismiss()
                    }
                }
            } message: {
                Text("This clears your session and cookies on this device.")
            }
        }
        .onAppear { original = settings.json }
        .onDisappear {
            // Filters are injected at page load, so apply changes with a reload.
            if settings.json != original { browser.reload(with: settings) }
        }
    }
}
