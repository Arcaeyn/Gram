// Applies the routing rules to instagram.com and strips reels, suggestions and ads from the page.
// Runs at document start in the page's own JS world. The config placeholder below is filled in natively.
(function () {
  'use strict';
  if (window.__gramInstalled || !window.__gramRules) return;
  window.__gramInstalled = true;

  var CFG = __GRAM_CONFIG__;
  var R = window.__gramRules;

  var post = function (msg) {
    try { window.webkit.messageHandlers.gram.postMessage(msg); } catch (e) {}
  };
  var store = {
    get: function (k) { try { return sessionStorage.getItem('gram.' + k); } catch (e) { return null; } },
    set: function (k, v) {
      try { v == null ? sessionStorage.removeItem('gram.' + k) : sessionStorage.setItem('gram.' + k, v); } catch (e) {}
    }
  };

  // ---------------------------------------------------------------- styles

  var css = [
    '.gram-hidden { display: none !important; }',
    'html.gram-hold body { visibility: hidden !important; }',
    '#gram-ad-cover { position: fixed; inset: 0; z-index: 2147483647; background: #000; color: rgba(255,255,255,0.55);' +
      ' display: flex; align-items: center; justify-content: center; font: 600 15px -apple-system, system-ui; pointer-events: none; }',
    // Bottom tabs, evenly spaced once the Reels tab is gone.
    '.gram-navrow { display: flex !important; justify-content: space-around !important; }',
    '.gram-navrow > :not(.gram-hidden) { flex: 1 1 0 !important; min-width: 0 !important; display: flex !important;' +
      ' justify-content: center !important; align-items: center !important; }',
    // Explore grid tiles, when the grid can't be hidden as a whole.
    'html.gram-explore main a[href^="/p/"], html.gram-explore main a[href*="/reel/"] { display: none !important; }',
    // The Reels tab, wherever Instagram puts it.
    'a[href="/reels/"], a[href^="/reels/?"] { display: none !important; }'
  ];
  if (CFG.hideFeedReels) {
    // The Reels tab on profiles (/username/reels/).
    css.push('a[href$="/reels/"]:not([href="/reels/"]) { display: none !important; }');
  }
  var style = document.createElement('style');
  style.id = 'gram-style';
  style.textContent = css.join('\n');
  function attachStyle() {
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  }
  attachStyle();

  // ---------------------------------------------------------------- routing

  var allowedReel = store.get('allowedReel');
  var lastPath = store.get('lastPath') || '';
  var lastKey = null;
  var redirecting = false;

  function go(target) {
    if (redirecting) return;
    if (target === location.pathname + location.search) return;
    redirecting = true;
    document.documentElement.classList.add('gram-hold');
    location.replace(target);
    // Never leave the page blank if the redirect is somehow swallowed.
    setTimeout(function () {
      redirecting = false;
      document.documentElement.classList.remove('gram-hold');
    }, 4000);
  }

  function evaluate() {
    if (redirecting) return;
    var path = location.pathname;
    var key = path + location.search;
    if (key === lastKey) return;
    lastKey = key;

    var d = R.decide(lastPath, path, location.search, allowedReel, CFG);
    if (d.allowReel) { allowedReel = d.allowReel; store.set('allowedReel', allowedReel); }
    if (d.clearReel) { allowedReel = null; store.set('allowedReel', null); }

    if (d.action === 'allow') {
      arrived(path);
      return;
    }
    if (d.following) {
      // Only bail out if Instagram strips the parameter right back off (a redirect loop).
      var at = Number(store.get('followingAt') || 0);
      if (Date.now() - at < 3000) {
        arrived(path);
        return;
      }
      store.set('followingAt', String(Date.now()));
    }
    if (d.action === 'block') post({ type: 'blocked', reason: d.reason });
    go(d.target);
  }

  function arrived(path) {
    lastPath = path;
    store.set('lastPath', path);
    document.documentElement.classList.toggle('gram-explore', !!CFG.blockExplore && R.isExploreGrid(path));
    post({ type: 'route', path: path, tabBar: R.hasTabBar(path) });
    requestFullPass();
  }

  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      setTimeout(evaluate, 0);
      return result;
    };
  });
  window.addEventListener('popstate', function () { setTimeout(evaluate, 0); });
  setInterval(evaluate, 400);
  evaluate();

  // Stop taps on blocked links before Instagram's router even sees them.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (url.host !== location.host) return;
    var d = R.decide(location.pathname, url.pathname, url.search, allowedReel, CFG);
    if (d.action === 'block') {
      e.preventDefault();
      e.stopImmediatePropagation();
      post({ type: 'blocked', reason: d.reason });
    }
  }, true);

  // ---------------------------------------------------------------- page cleanup

  var SUGGESTED = ['Suggested for you', 'Suggested for You', 'Suggested posts', 'Suggested Posts', 'Suggestions for you'];
  var ADS = ['Sponsored', 'Ad'];
  // Text that starts an "use the app" prompt (compared lowercase).
  var APP_PHRASES = ['get the app', 'open app', 'open the app', 'use the app', 'switch to the app', 'open instagram',
    'get instagram', 'download the app', 'open in app', 'continue in app', 'see this post in the app',
    'get the full experience', 'instagram app', 'see more in the app', 'watch in the app'];
  var DISMISS = ['not now', 'continue on web', 'continue in browser', 'cancel', 'close', 'dismiss', 'no thanks', 'maybe later'];

  function textNodes(root, limit, visit, maxLength) {
    var max = maxLength || 32;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node, count = 0;
    while ((node = walker.nextNode()) && count++ < limit) {
      var t = node.nodeValue.trim();
      if (t && t.length <= max && visit(t, node.parentElement) === false) return;
    }
  }

  function isAppPrompt(text) {
    var lower = text.toLowerCase();
    for (var i = 0; i < APP_PHRASES.length; i++) {
      if (lower.indexOf(APP_PHRASES[i]) === 0) return true;
    }
    return false;
  }

  function isOnScreen(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
  }

  /** Why a feed post should go, or null if it's from someone you follow. */
  function unwantedReason(article) {
    var reason = null;
    textNodes(article, 500, function (t) {
      // "Follow" only appears in a post header when you don't follow the account.
      if (CFG.hideSuggested && (t === 'Follow' || SUGGESTED.indexOf(t) >= 0)) { reason = 'suggested'; return false; }
      if (CFG.hideAds && ADS.indexOf(t) >= 0) { reason = 'ad'; return false; }
    });
    if (!reason && CFG.hideFeedReels && article.querySelector('a[href*="/reel/"]')) reason = 'reel';
    return reason;
  }

  /** Hide the self-contained block around a heading (e.g. the "Suggested for you" carousel). */
  function hideBlock(leaf, maxHeight) {
    if (!leaf || leaf.closest('.gram-hidden') || leaf.closest('article')) return;
    var el = leaf;
    for (var i = 0; i < 16; i++) {
      var parent = el.parentElement;
      if (!parent || parent === document.body || parent.tagName === 'MAIN' || parent.getAttribute('role') === 'main') break;
      if (parent.querySelector('article')) break; // reached the feed list itself
      if (parent.getBoundingClientRect().height > maxHeight) break;
      el = parent;
    }
    el.classList.add('gram-hidden');
  }

  function hideNavReels(scope) {
    scope.querySelectorAll('a[href="/reels/"]:not(.gram-hidden)').forEach(function (a) {
      a.classList.add('gram-hidden');
      var wrapper = a.parentElement;
      if (wrapper && wrapper.children.length === 1 && wrapper.getBoundingClientRect().width < 120) {
        wrapper.classList.add('gram-hidden');
      }
    });
    centerTabBar();
  }

  var navRow = null, lastNavSearch = 0;

  /**
   * The tab bar is the smallest element holding both the Home and Explore tabs. Drop the slot the
   * Reels tab lived in and let the remaining tabs share the width equally.
   */
  function centerTabBar() {
    if (!navRow || !navRow.isConnected) {
      navRow = null;
      var now = Date.now();
      if (now - lastNavSearch < 1000) return; // measuring is costly; don't search on every pass
      lastNavSearch = now;
      navRow = findTabBar();
      if (!navRow) return;
      navRow.classList.add('gram-navrow');
    }
    Array.prototype.forEach.call(navRow.children, function (slot) {
      if (!slot.classList.contains('gram-hidden') && (slot.matches('a[href="/reels/"]') || slot.querySelector('a[href="/reels/"]'))) {
        slot.classList.add('gram-hidden');
      }
    });
  }

  function findTabBar() {
    var explores = document.querySelectorAll('a[href="/explore/"]');
    for (var i = 0; i < explores.length; i++) {
      var row = explores[i].parentElement;
      for (var depth = 0; row && depth < 8; depth++, row = row.parentElement) {
        if (row === document.body || row.tagName === 'MAIN') { row = null; break; }
        if (row.querySelector('a[href="/"]')) break;
      }
      if (!row || !row.querySelector('a[href="/"]')) continue;
      if (row.querySelector('main, article, [role="main"]') || row.getBoundingClientRect().height >= 160) continue;
      while (row.children.length === 1) row = row.children[0]; // down to the element whose children are the tabs
      return row;
    }
    return null;
  }

  /** Explore: keep the search box, hide the grid of suggested posts. */
  function hideExploreGrid() {
    var links = document.querySelectorAll('main a[href^="/p/"], main a[href*="/reel/"]');
    if (links.length < 3) return;
    var container = links[0].parentElement;
    while (container && !container.contains(links[links.length - 1])) container = container.parentElement;
    if (!container || container.tagName === 'MAIN' || container.getAttribute('role') === 'main') return;
    if (container.querySelector('input, form, [role="search"]')) return; // shares a parent with search: the CSS fallback covers it
    container.classList.add('gram-hidden');
  }

  // ---------------------------------------------------------------- "get the app" prompts

  var DIALOGS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

  /** Popups: press their "Not now", then make sure they and their backdrop are gone. */
  function dismissDialog(dialog) {
    if (dialog.closest('.gram-hidden')) return;
    var buttons = dialog.querySelectorAll('button, [role="button"], a, [aria-label]');
    for (var i = 0; i < buttons.length; i++) {
      var label = ((buttons[i].getAttribute('aria-label') || buttons[i].textContent) || '').trim().toLowerCase();
      if (DISMISS.indexOf(label) >= 0) { buttons[i].click(); break; }
    }
    var layer = dialog;
    while (layer.parentElement && layer.parentElement !== document.body) layer = layer.parentElement;
    var isOverlay = layer.parentElement === document.body &&
      !layer.querySelector('main, [role="main"], nav, [role="navigation"], article');
    (isOverlay ? layer : dialog).classList.add('gram-hidden');
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }

  /** Banners: hide the banner around the text, but never climb into the page header or nav. */
  function hidePromptBanner(leaf) {
    if (!leaf || leaf.closest('.gram-hidden') || leaf.closest('article')) return;
    var el = leaf.closest('a, button, [role="button"]') || leaf;
    for (var i = 0; i < 8; i++) {
      var parent = el.parentElement;
      if (!parent || parent === document.body || parent.tagName === 'MAIN' || parent.getAttribute('role') === 'main') break;
      if (parent.querySelector('a[href="/"], a[href^="/direct/"], nav, [role="navigation"], article, input, textarea')) break;
      if (parent.getBoundingClientRect().height > 260) break;
      el = parent;
    }
    el.classList.add('gram-hidden');
  }

  // ---------------------------------------------------------------- story ads

  var adCover = null, lastSkip = 0, skipTries = 0;

  function setAdCover(on) {
    if (on && !adCover) {
      adCover = document.createElement('div');
      adCover.id = 'gram-ad-cover';
      adCover.textContent = 'Ad hidden · tap to skip';
      document.documentElement.appendChild(adCover);
    } else if (!on && adCover) {
      adCover.remove();
      adCover = null;
    }
  }

  function storyAdOnScreen() {
    var found = false;
    textNodes(document.body, 4000, function (t, el) {
      if (ADS.indexOf(t) >= 0 && el && isOnScreen(el)) { found = true; return false; }
    });
    return found;
  }

  function tap(x, y) {
    var target = document.elementFromPoint(x, y);
    if (!target) return;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
      var Ctor = type.indexOf('pointer') === 0 && window.PointerEvent ? window.PointerEvent : window.MouseEvent;
      target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, view: window }));
    });
  }

  /** Black out sponsored stories and move on to the next one. */
  function skipStoryAds() {
    var ad = CFG.hideAds && /^\/stories\//.test(location.pathname) && storyAdOnScreen();
    setAdCover(ad);
    if (!ad) { skipTries = 0; return; }
    var now = Date.now();
    if (now - lastSkip < 700) return;
    lastSkip = now;
    skipTries += 1;
    if (skipTries === 1) post({ type: 'storyAd' });

    // One method per attempt, so a method that works never double-skips a real story.
    var next = document.querySelector('[aria-label="Next"]');
    if (skipTries === 1 && next) {
      (next.closest('button, [role="button"]') || next).click();
    } else if (skipTries <= 2) {
      ['keydown', 'keyup'].forEach(function (type) {
        document.dispatchEvent(new KeyboardEvent(type, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true }));
      });
    } else {
      tap(Math.round(window.innerWidth * 0.88), Math.round(window.innerHeight * 0.5));
    }
  }

  // ---------------------------------------------------------------- page color

  var lastTheme = null;
  /** Tell the app the page's background so the areas around it match exactly. */
  function reportTheme() {
    var color = null;
    [document.body, document.documentElement].forEach(function (el) {
      if (color || !el) return;
      var c = getComputedStyle(el).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c)) color = c;
    });
    if (!color) {
      var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      color = dark ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    }
    if (color !== lastTheme) {
      lastTheme = color;
      post({ type: 'theme', color: color });
    }
  }

  // ---------------------------------------------------------------- incremental cleanup

  /** Clean one subtree that just appeared. Cost is proportional to what changed, not to the page. */
  function clean(root, path) {
    if (path === '/') {
      var articles = [];
      var own = root.closest ? root.closest('article') : null;
      if (own) articles.push(own);
      if (root.querySelectorAll) Array.prototype.push.apply(articles, root.querySelectorAll('article'));
      articles.forEach(function (a) {
        if (a.classList.contains('gram-hidden') || a.hasAttribute('data-gram-ok')) return;
        if (unwantedReason(a)) a.classList.add('gram-hidden');
        // Once the header and media have rendered, the verdict won't change: skip it from now on.
        else if (a.querySelector('a[href]') && a.querySelector('img, video')) a.setAttribute('data-gram-ok', '');
      });
    }
    var inDirect = R.isDirect(path);
    textNodes(root, 20000, function (t, el) {
      if (!el) return;
      if (CFG.hideSuggested && SUGGESTED.indexOf(t) >= 0) {
        hideBlock(el, 720);
      } else if (CFG.hideAppBanners && isAppPrompt(t)) {
        // Prompts often live in portals outside <main>. Messages are left alone: a friend may type these words.
        var dialog = el.closest(DIALOGS);
        if (dialog) dismissDialog(dialog);
        else if (!inDirect) hidePromptBanner(el);
      }
    }, 60);
  }

  var dirty = [];
  var fullPassDue = true;
  var pending = false;

  function requestFullPass() {
    fullPassDue = true;
    schedule();
  }

  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(pass, 120);
  }

  function pass() {
    pending = false;
    attachStyle();
    evaluate();
    if (redirecting || !document.body) return;
    var path = location.pathname;
    var roots;
    if (fullPassDue) {
      fullPassDue = false;
      dirty = [];
      roots = [document.body];
      reportTheme();
    } else {
      roots = dirty;
      dirty = [];
    }
    var navTouched = roots.length === 1 && roots[0] === document.body;
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      if (!root.isConnected || (root.closest && root.closest('.gram-hidden'))) continue;
      clean(root, path);
      if (!navTouched && root.querySelector && root.querySelector('a[href="/reels/"], a[href="/explore/"]')) navTouched = true;
    }
    // Tabs are only re-checked when tab links were (re)rendered, not on every like-count update.
    if (navTouched) hideNavReels(document);
    if (CFG.blockExplore && R.isExploreGrid(path)) hideExploreGrid();
  }

  function onMutations(records) {
    for (var i = 0; i < records.length; i++) {
      var added = records[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType === 1) dirty.push(node);
        else if (node.nodeType === 3 && node.parentElement) dirty.push(node.parentElement);
      }
    }
    // A huge batch (a whole new page) is cheaper to handle as one full pass.
    if (dirty.length > 300) { dirty = []; fullPassDue = true; }
    if (dirty.length || fullPassDue) schedule();
  }

  // ---------------------------------------------------------------- start

  function start() {
    new MutationObserver(onMutations).observe(document.documentElement, { childList: true, subtree: true });
    if (window.matchMedia) {
      var media = window.matchMedia('(prefers-color-scheme: dark)');
      if (media.addEventListener) media.addEventListener('change', requestFullPass);
    }
    // Stories advance on a timer without always changing the DOM much.
    setInterval(function () { if (/^\/stories\//.test(location.pathname)) skipStoryAds(); }, 500);
    // Safety net for in-place text changes, which the observer doesn't watch.
    setInterval(function () { if (!document.hidden) requestFullPass(); }, 5000);
    pass();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
