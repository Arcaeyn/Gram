// CPU cost of filter.js on a large feed that keeps changing (like Instagram while it loads).
// Needs jsdom. Usage: node Tests/filter.bench.js [path/to/filter.js]
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const res = (n) => fs.readFileSync(path.join(__dirname, '../Gram/Resources', n), 'utf8');
const filterSource = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : res('filter.js');
const config = { followingFeed: false, hideSuggested: true, hideAds: true, hideFeedReels: true, allowDMReels: true, blockExplore: true, hideAppBanners: true };

function article(i) {
  let words = '';
  for (let j = 0; j < 40; j++) words += `<span>comment ${i}-${j}</span>`;
  return `<article><header><a href="/user${i}/">user${i}</a></header><a href="/p/${i}/"><img alt=""></a>${words}</article>`;
}

function run(withFilter) {
  const feed = Array.from({ length: 150 }, (_, i) => article(i)).join('');
  const dom = new JSDOM(`<!doctype html><html><head></head><body><main role="main"><div id="feed">${feed}</div></main></body></html>`,
    { url: 'https://www.instagram.com/', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const { window } = dom;
  window.webkit = { messageHandlers: { gram: { postMessage() {} } } };
  if (withFilter) {
    window.eval(res('rules.js'));
    window.eval(filterSource.replace('__GRAM_CONFIG__', JSON.stringify(config)));
  }
  return new Promise((resolve) => {
    const start = process.cpuUsage();
    let n = 0;
    const churn = setInterval(() => {
      // Small, frequent DOM updates: like counts, timestamps, lazy images.
      const span = window.document.createElement('span');
      span.textContent = 'tick ' + n++;
      window.document.getElementById('feed').children[n % 150].appendChild(span);
    }, 16);
    setTimeout(() => {
      clearInterval(churn);
      const cpu = process.cpuUsage(start);
      window.close();
      resolve((cpu.user + cpu.system) / 1000);
    }, 3000);
  });
}

(async () => {
  const base = await run(false);
  const filtered = await run(true);
  console.log(`baseline ${base.toFixed(0)} ms CPU, with filter ${filtered.toFixed(0)} ms CPU over 3 s → filter overhead ${(filtered - base).toFixed(0)} ms`);
  process.exit(0);
})();
