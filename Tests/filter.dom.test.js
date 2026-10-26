// DOM test for filter.js against a mock Instagram page.
// Needs jsdom: npm install jsdom, then: node Tests/filter.dom.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');

const read = (name) => fs.readFileSync(path.join(__dirname, '../Gram/Resources', name), 'utf8');
const config = { followingFeed: true, hideSuggested: true, hideAds: true, hideFeedReels: true, allowDMReels: true, blockExplore: true, hideAppBanners: true };

const html = `<!doctype html><html><head></head><body>
<div role="navigation"><div><div id="tabs">
  <div><a id="nav-home" href="/">Home</a></div>
  <div><a id="nav-explore" href="/explore/">Search</a></div>
  <div id="nav-reels-wrap"><a id="nav-reels" href="/reels/">Reels</a><span>tooltip</span></div>
  <div><a id="nav-dm" href="/direct/inbox/">Messages</a></div>
</div></div></div>
<main role="main">
  <div id="stories"><a href="/stories/friend/1/">friend</a></div>
  <div id="feed">
    <article id="friend"><header><a href="/friend/">friend</a></header><a href="/p/abc/">photo</a><span>beach day</span></article>
    <article id="friend-caption"><header><a href="/friend2/">friend2</a></header><a href="/p/def/">photo</a><span>Follow your dreams and stay Sponsored-free lol</span></article>
    <article id="suggested"><header><a href="/stranger/">stranger</a><div role="button"><div>Follow</div></div></header><a href="/p/x/">p</a></article>
    <article id="suggested-label"><header><a href="/s2/">s2</a><span>Suggested for you</span></header><a href="/p/y/">p</a></article>
    <article id="ad"><header><a href="/brand/">brand</a><span>Sponsored</span></header><a href="/p/z/">p</a></article>
    <article id="reel"><header><a href="/friend/">friend</a></header><a id="reel-link" href="/reel/R1/">reel</a></article>
    <div id="carousel"><div><span>Suggested for you</span></div><div><a href="/u1/">u1</a><a href="/u2/">u2</a></div></div>
  </div>
  <header id="topbar"><a href="/">Instagram</a><a id="openapp" href="#"><span>Open app</span></a><a href="/direct/inbox/">DM</a></header>
</main></body></html>`;

const messages = [];
const virtualConsole = new VirtualConsole(); // swallow jsdom's "navigation not implemented"
const dom = new JSDOM(html, { url: 'https://www.instagram.com/?variant=following', runScripts: 'outside-only', virtualConsole });
const { window } = dom;
window.webkit = { messageHandlers: { gram: { postMessage: (m) => messages.push(m) } } };
window.eval(read('rules.js'));
window.eval(read('filter.js').replace('__GRAM_CONFIG__', JSON.stringify(config)));

const $ = (id) => window.document.getElementById(id);
const hidden = (id) => !!$(id).closest('.gram-hidden');

setTimeout(() => {
  let passed = 0;
  const t = (name, fn) => { fn(); passed++; console.log('✓', name); };

  t('friends\' posts stay', () => {
    assert.equal(hidden('friend'), false);
    assert.equal(hidden('friend-caption'), false, 'caption words must not trigger filters');
  });
  t('suggested posts are hidden', () => {
    assert.equal(hidden('suggested'), true);
    assert.equal(hidden('suggested-label'), true);
  });
  t('ads are hidden', () => assert.equal(hidden('ad'), true));
  t('feed reels are hidden', () => assert.equal(hidden('reel'), true));
  t('suggested accounts carousel is hidden without touching the feed', () => {
    assert.equal(hidden('carousel'), true);
    assert.equal(hidden('feed'), false);
  });
  t('reels tab is hidden, other tabs stay', () => {
    assert.equal(hidden('nav-reels'), true);
    assert.equal(hidden('nav-home') || hidden('nav-explore') || hidden('nav-dm'), false);
  });
  t('tab bar: Reels slot removed, remaining tabs centered', () => {
    assert.ok($('tabs').classList.contains('gram-navrow'));
    assert.equal(hidden('nav-reels-wrap'), true);
    assert.equal(hidden('nav-home') || hidden('nav-explore') || hidden('nav-dm'), false);
  });
  t('"Open app" hides only the button, not the header', () => {
    assert.equal(hidden('openapp'), true);
    assert.equal(hidden('topbar'), false);
  });
  t('stories stay', () => assert.equal(hidden('stories'), false));
  t('style sheet is injected', () => assert.ok(window.document.getElementById('gram-style')));

  t('tapping a reel in the feed is blocked', () => {
    const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    $('reel-link').dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true);
    assert.ok(messages.some((m) => m.type === 'blocked'));
  });

  t('tapping Messages is not blocked', () => {
    const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    $('nav-dm').dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, false);
  });

  t('SPA navigation to the Reels tab triggers a redirect', () => {
    messages.length = 0;
    window.history.pushState({}, '', '/reels/');
  });

  setTimeout(() => {
    t('...and the page is held blank while it redirects', () => {
      assert.ok(window.document.documentElement.classList.contains('gram-hold'));
      assert.ok(messages.some((m) => m.type === 'blocked' && m.reason === 'reels'));
    });
    console.log(`\n${passed} passed`);
    process.exit(0);
  }, 100);
}, 600);
