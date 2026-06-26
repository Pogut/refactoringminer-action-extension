// Throwaway debug probe — load the extension, open PR #14 files, dump what the
// content script sees. Run: node test/e2e/_debug.js
const path = require('path');
const { chromium } = require('@playwright/test');

const EXT_ROOT = path.resolve(__dirname, '..', '..');

(async () => {
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${EXT_ROOT}`, `--load-extension=${EXT_ROOT}`],
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto('https://github.com/Pogut/rm-action-test/pull/14/files', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  const info = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll('[id^="diff-"]')).slice(0, 5).map((e) => e.id);
    const anchors = Array.from(document.querySelectorAll('[data-line-anchor]')).slice(0, 5).map((e) => e.getAttribute('data-line-anchor'));
    return {
      url: location.href,
      title: document.title,
      hasRMX: typeof window.RMX !== 'undefined',
      rmxKeys: window.RMX ? Object.keys(window.RMX) : null,
      rmxHlCount: document.querySelectorAll('.rmx-hl').length,
      sampleDiffIds: ids,
      sampleLineAnchors: anchors,
      anchorCount: document.querySelectorAll('[data-line-anchor]').length,
      diffIdCount: document.querySelectorAll('[id^="diff-"]').length,
      loginWall: !!document.querySelector('input[name="password"], form[action="/session"]'),
      bodyTextHead: document.body.innerText.slice(0, 200),
    };
  });

  console.log('=== RMX console logs ===');
  logs.filter((l) => l.includes('RMX') || l.includes('pageerror')).forEach((l) => console.log(l));
  console.log('=== page info ===');
  console.log(JSON.stringify(info, null, 2));

  await ctx.close();
})();
