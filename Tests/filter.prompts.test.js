// "Get the app" popups, banners and sponsored stories, against mock pages.
// Needs jsdom: npm install jsdom, then: node Tests/filter.prompts.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');

const read = (name) => fs.readFileSync(path.join(__dirname, '../Gram/Resources', name), 'utf8');
const config = { followingFeed: true, hideSuggested: true, hideAds: true, hideFeedReels: true, allowDMReels: true, blockExplore: true, hideAppBanners: true };

function load(url, body, { visible = false } = {}) {
  const messages = [];
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`,
    { url, runScripts: 'outside-only', virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const { window } = dom;
  if (visible) {
    // jsdom has no layout; pretend everything is on screen and small.
    window.Element.prototype.getBoundingClientRect = () => ({ x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 });
  }
  window.webkit = { messageHandlers: { gram: { postMessage: (m) => messages.push(m) } } };
  window.eval(read('rules.js'));
  window.eval(read('filter.js').replace('__GRAM_CONFIG__', JSON.stringify(config)));
  return { window, messages, $: (id) => window.document.getElementById(id), hidden: (id) => !!window.document.getElementById(id).closest('.gram-hidden') };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✓', name); };

(async () => {
  // 1. "Get the app" sheet with a Not now button, rendered in a portal next to the app root.
  {
    const page = load('https://www.instagram.com/?variant=following', `
      <div id="root"><main role="main"><article id="post"><a href="/friend/">friend</a></article></main></div>
      <div id="portal"><div id="backdrop"><div role="dialog" id="sheet">
        <span>Get the app</span><span>Instagram is better in the app.</span>
        <button id="notnow">Not now</button><button>Open Instagram</button>
      </div></div></div>`);
    let clicked = false;
    page.$('notnow').addEventListener('click', () => { clicked = true; });
    await wait(400);
    t('"Get the app" popup: presses Not now', () => assert.equal(clicked, true));
    t('"Get the app" popup: removed with its backdrop', () => assert.equal(page.hidden('portal'), true));
    t('"Get the app" popup: the app itself stays', () => assert.equal(page.hidden('root'), false));
  }

  // 2. Ordinary dialogs are left alone.
  {
    const page = load('https://www.instagram.com/p/abc/', `
      <div id="root"><main role="main"></main></div>
      <div id="portal"><div role="dialog" id="dlg"><span>Unfollow friend?</span><button>Cancel</button></div></div>`);
    await wait(400);
    t('other popups are untouched', () => assert.equal(page.hidden('dlg'), false));
  }

  // 3. Banner at the bottom, and the header's own button.
  {
    const page = load('https://www.instagram.com/friend/', `
      <main role="main">
        <header id="header"><a href="/">Instagram</a><a id="openbtn" href="#">Open app</a><a href="/direct/inbox/">DM</a></header>
        <div id="banner"><div><img alt=""><span>Get the full experience. Download the app.</span></div><button>Get the app</button></div>
      </main>`);
    await wait(400);
    t('app banner is hidden', () => assert.equal(page.hidden('banner'), true));
    t('header button is hidden but the header stays', () => {
      assert.equal(page.hidden('openbtn'), true);
      assert.equal(page.hidden('header'), false);
    });
  }

  // 4. Friends typing these words in DMs are not censored.
  {
    const page = load('https://www.instagram.com/direct/t/123/', `
      <main role="main"><div id="thread"><div id="msg"><span>get the app lol</span></div><input></div></main>`);
    await wait(400);
    t('DM text is left alone', () => assert.equal(page.hidden('msg'), false));
  }

  // 5. Sponsored story: covered, then skipped.
  {
    const page = load('https://www.instagram.com/stories/brand/123/', `
      <section id="viewer"><header><span>brand</span><span id="label">Sponsored</span></header>
      <button aria-label="Next" id="next">›</button></section>`, { visible: true });
    let skips = 0;
    page.$('next').addEventListener('click', () => { skips++; page.$('label').textContent = ''; });
    await wait(700);
    t('sponsored story is skipped', () => assert.equal(skips, 1));
    t('user is told', () => assert.ok(page.messages.some((m) => m.type === 'storyAd')));
    await wait(700);
    t('cover is removed once the ad is gone', () => assert.equal(page.window.document.getElementById('gram-ad-cover'), null));
    t('only one skip, so no real story is skipped', () => assert.equal(skips, 1));
  }

  // 6. A friend's normal story is untouched.
  {
    const page = load('https://www.instagram.com/stories/friend/456/', `
      <section><header><span>friend</span><span>2h</span></header><button aria-label="Next" id="next">›</button></section>`, { visible: true });
    let skips = 0;
    page.$('next').addEventListener('click', () => { skips++; });
    await wait(700);
    t('friend stories are not skipped', () => {
      assert.equal(skips, 0);
      assert.equal(page.window.document.getElementById('gram-ad-cover'), null);
    });
  }

  // 7. Page color is reported.
  {
    const page = load('https://www.instagram.com/?variant=following', `<main role="main"></main>`);
    page.window.document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    page.window.document.body.appendChild(page.window.document.createElement('div'));
    await wait(400);
    t('page background is sent to the app', () => assert.ok(page.messages.some((m) => m.type === 'theme' && m.color === 'rgb(0, 0, 0)')));
  }

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
