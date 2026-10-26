// End-to-end routing through filter.js: open a reel from DMs, then try to swipe to the next one.
// Needs jsdom: npm install jsdom, then: node Tests/filter.dm.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');

const read = (name) => fs.readFileSync(path.join(__dirname, '../Gram/Resources', name), 'utf8');
const config = { followingFeed: true, hideSuggested: true, hideAds: true, hideFeedReels: true, allowDMReels: true, blockExplore: true, hideAppBanners: true };

const messages = [];
const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', {
  url: 'https://www.instagram.com/direct/t/12345/', runScripts: 'outside-only', virtualConsole: new VirtualConsole()
});
const { window } = dom;
window.webkit = { messageHandlers: { gram: { postMessage: (m) => messages.push(m) } } };
window.eval(read('rules.js'));
window.eval(read('filter.js').replace('__GRAM_CONFIG__', JSON.stringify(config)));

const held = () => window.document.documentElement.classList.contains('gram-hold');
const step = (fn, ms = 50) => new Promise((r) => setTimeout(() => { fn(); r(); }, ms));

(async () => {
  await step(() => {
    window.history.pushState({}, '', '/reel/FRIEND1/');
  });
  await step(() => {
    assert.equal(held(), false);
    assert.equal(window.sessionStorage.getItem('gram.allowedReel'), 'FRIEND1');
    assert.ok(!messages.some((m) => m.type === 'blocked'));
    console.log('✓ reel sent in a DM opens');
    window.history.pushState({}, '', '/reel/STRANGER2/');
  });
  await step(() => {
    assert.equal(held(), true);
    assert.ok(messages.some((m) => m.type === 'blocked' && m.reason === 'reel'));
    console.log('✓ swiping to the next reel is blocked');
    console.log('\n2 passed');
    process.exit(0);
  });
})().catch((e) => { console.error(e); process.exit(1); });
