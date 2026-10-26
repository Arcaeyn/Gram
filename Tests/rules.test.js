// Run with: node Tests/rules.test.js
require('../Gram/Resources/rules.js');
const R = globalThis.__gramRules;
const assert = require('assert');

const cfg = { followingFeed: true, allowDMReels: true, hideFeedReels: true, blockExplore: true };
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✓', name); };

t('reel ids', () => {
  assert.equal(R.reelId('/reel/Cx12_ab/'), 'Cx12_ab');
  assert.equal(R.reelId('/reels/Cx12_ab/'), 'Cx12_ab');
  assert.equal(R.reelId('/some.user/reel/Cx12/'), 'Cx12');
  assert.equal(R.reelId('/reels/'), null);
  assert.equal(R.reelId('/reels/audio/123/'), null);
  assert.equal(R.reelId('/some.user/reels/'), null);
  assert.equal(R.reelId('/p/abc/'), null);
});

t('reels tab is always blocked', () => {
  assert.equal(R.decide('/', '/reels/', '', null, cfg).action, 'block');
  assert.equal(R.decide('/direct/inbox/', '/reels/', '', null, cfg).target, '/direct/inbox/');
  assert.equal(R.decide('/', '/reels/audio/99/', '', null, cfg).action, 'block');
  assert.equal(R.decide('/', '/reels/', '', null, { ...cfg, hideFeedReels: false }).action, 'block');
});

t('reel opened from DMs is allowed', () => {
  const d = R.decide('/direct/t/123/', '/reel/AAA/', '', null, cfg);
  assert.equal(d.action, 'allow');
  assert.equal(d.allowReel, 'AAA');
});

t('swipeable viewer from DMs is converted to the single reel page', () => {
  const d = R.decide('/direct/t/123/', '/reels/AAA/', '', null, cfg);
  assert.deepEqual([d.action, d.target, d.allowReel], ['redirect', '/reel/AAA/', 'AAA']);
});

t('reloading the allowed reel works', () => {
  assert.equal(R.decide('/direct/t/123/', '/reel/AAA/', '', 'AAA', cfg).action, 'allow');
  assert.equal(R.decide('', '/reel/AAA/', '', 'AAA', cfg).action, 'allow');
});

t('swiping to the next reel bounces back to the allowed one', () => {
  const d = R.decide('/reel/AAA/', '/reel/BBB/', '', 'AAA', cfg);
  assert.deepEqual([d.action, d.target], ['block', '/reel/AAA/']);
});

t('reels from feed, explore or a cold link are blocked', () => {
  assert.equal(R.decide('/', '/reel/AAA/', '', null, cfg).action, 'block');
  assert.equal(R.decide('/explore/search/', '/reel/AAA/', '', null, cfg).action, 'block');
  assert.equal(R.decide('', '/reel/AAA/', '', null, cfg).target, '/');
});

t('DM reels can be turned off', () => {
  assert.equal(R.decide('/direct/t/1/', '/reel/AAA/', '', null, { ...cfg, allowDMReels: false }).action, 'block');
});

t('feed reels allowed when the user opts in, but still no swiping', () => {
  const open = { ...cfg, hideFeedReels: false };
  assert.equal(R.decide('/', '/reel/AAA/', '', null, open).action, 'allow');
  assert.equal(R.decide('/friend/', '/reel/AAA/', '', null, open).action, 'allow');
  assert.equal(R.decide('/reel/AAA/', '/reel/BBB/', '', 'AAA', open).action, 'block');
  assert.equal(R.decide('/explore/', '/reel/AAA/', '', null, open).action, 'block');
});

t('profile reels tab', () => {
  const d = R.decide('/friend/', '/friend/reels/', '', null, cfg);
  assert.deepEqual([d.action, d.target], ['block', '/friend/']);
  assert.equal(R.decide('/friend/', '/friend/reels/', '', null, { ...cfg, hideFeedReels: false }).action, 'allow');
});

t('explore opens in place (the grid is hidden on the page, no reload)', () => {
  assert.equal(R.decide('/', '/explore/', '', null, cfg).action, 'allow');
  assert.equal(R.decide('/', '/explore/search/', '', null, cfg).action, 'allow');
  assert.equal(R.decide('/', '/explore/tags/cats/', '', null, cfg).action, 'allow');
});

t('tab bar pages (only these sit lower on screen)', () => {
  for (const p of ['/', '/explore/', '/explore/search/', '/friend/']) assert.equal(R.hasTabBar(p), true, p);
  for (const p of ['/direct/inbox/', '/direct/t/123/', '/stories/friend/1/', '/p/abc/', '/reel/AAA/']) assert.equal(R.hasTabBar(p), false, p);
});

t('profile paths', () => {
  assert.equal(R.isProfile('/some.user_1/'), true);
  assert.equal(R.isProfile('/explore/'), false);
  assert.equal(R.isProfile('/direct/inbox/'), false);
  assert.equal(R.isProfile('/'), false);
});

t('home goes to the following feed', () => {
  assert.equal(R.decide('/direct/inbox/', '/', '', null, cfg).target, '/?variant=following');
  assert.equal(R.decide('/', '/', '?variant=following', null, cfg).action, 'allow');
  assert.equal(R.decide('/', '/', '?a=1&variant=following', null, cfg).action, 'allow');
  assert.equal(R.decide('/', '/', '?variant=home', null, cfg).action, 'redirect');
  assert.equal(R.decide('/', '/', '', null, { ...cfg, followingFeed: false }).action, 'allow');
});

t('Home stays Home when the Following view is off (the default)', () => {
  const off = { ...cfg, followingFeed: false };
  assert.equal(R.decide('/direct/inbox/', '/', '', null, off).action, 'allow');
  assert.equal(R.decide('/friend/', '/', '', null, off).action, 'allow');
});

t('normal pages pass through and clear the allowed reel', () => {
  for (const p of ['/direct/inbox/', '/stories/friend/123/', '/friend/', '/p/abc/', '/accounts/edit/']) {
    const d = R.decide('/', p, '', 'AAA', cfg);
    assert.equal(d.action, 'allow', p);
    assert.equal(d.clearReel, true, p);
  }
});

console.log(`\n${passed} passed`);
