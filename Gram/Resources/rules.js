// Routing rules for the Instagram filter. Pure functions only, so they can be unit tested
// (see Tests/rules.test.js). Injected before filter.js, which applies them to the live page.
(function (root) {
  'use strict';

  var R = {
    /** Shortcode of a single reel URL: /reel/ID, /reels/ID, /username/reel/ID. */
    reelId: function (path) {
      if (R.isReelsFeed(path)) return null;
      var m = /^\/(?:[\w.]+\/)?reels?\/([\w-]+)\/?/.exec(path || '');
      return m ? m[1] : null;
    },

    /** The endless Reels tab, and audio pages that are just more reels. */
    isReelsFeed: function (path) {
      return /^\/reels\/?$/.test(path) || /^\/reels\/audio\//.test(path);
    },

    /** The Reels tab on someone's profile: /username/reels/ */
    isProfileReels: function (path) {
      return /^\/[\w.]+\/reels\/?$/.test(path) && !/^\/reels\//.test(path);
    },

    isExploreGrid: function (path) { return /^\/explore\/?$/.test(path); },

    isDirect: function (path) { return /^\/direct\//.test(path || ''); },

    /** A profile URL like /some.user/ (not one of Instagram's own sections). */
    isProfile: function (path) {
      var m = /^\/([\w.]+)\/$/.exec(path || '');
      return !!m && ['explore', 'direct', 'reels', 'reel', 'accounts', 'stories', 'p', 'tv', 'about', 'legal', 'emails'].indexOf(m[1]) < 0;
    },

    /** Pages that show Instagram's bottom tab bar (Home, Search, profiles). */
    hasTabBar: function (path) {
      return path === '/' || /^\/explore(\/|$)/.test(path || '') || R.isProfile(path);
    },

    /** Where a single reel may be opened from. Never from another reel, so you can't swipe along. */
    reelAllowedFrom: function (from, cfg) {
      if (!from) return false;
      if (cfg.allowDMReels && R.isDirect(from)) return true;
      if (!cfg.hideFeedReels && !R.reelId(from) && !R.isReelsFeed(from) && !/^\/explore/.test(from)) return true;
      return false;
    },

    /**
     * Decide what to do when the page moves from `from` to `to`.
     * Returns { action: 'allow' | 'redirect' | 'block', target?, reason?, allowReel?, clearReel?, following? }
     */
    decide: function (from, to, search, allowedReel, cfg) {
      var safeBack = function () {
        if (!from || from === to || R.reelId(from) || R.isReelsFeed(from)) return '/';
        return from;
      };

      if (R.isReelsFeed(to)) return { action: 'block', target: safeBack(), reason: 'reels' };

      var id = R.reelId(to);
      if (id) {
        if (id === allowedReel || R.reelAllowedFrom(from, cfg)) {
          // /reels/ID is the swipeable viewer; /reel/ID is the single post page.
          if (/^\/reels\//.test(to)) return { action: 'redirect', target: '/reel/' + id + '/', allowReel: id };
          return { action: 'allow', allowReel: id };
        }
        var back = allowedReel ? '/reel/' + allowedReel + '/' : safeBack();
        return { action: 'block', target: back, reason: 'reel' };
      }

      if (cfg.hideFeedReels && R.isProfileReels(to)) {
        return { action: 'block', target: to.replace(/reels\/?$/, ''), reason: 'reels', clearReel: true };
      }
      if (cfg.followingFeed && to === '/' && !/(^|[?&])variant=following(&|$)/.test((search || '').replace(/^\?/, ''))) {
        return { action: 'redirect', target: '/?variant=following', clearReel: true, following: true };
      }
      return { action: 'allow', clearReel: true };
    }
  };

  root.__gramRules = R;
})(typeof window !== 'undefined' ? window : globalThis);
