// One-time GitHub session capture for the Preview-diff (/changes) tests.
//
//   npm run test:auth
//
// Opens a real Chrome window at github.com/login. Sign in (complete any 2FA);
// the script detects your session cookie and saves the storage state to
// .auth/github.json (gitignored). The Preview tests then load these cookies into
// their extension-bearing Chromium so GitHub serves them the logged-in diff.
//
// GitHub sessions are long-lived; re-run this only if the Preview tests start
// failing because the session expired or was revoked.
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const { AUTH_FILE } = require('./auth');

const LOGIN_URL = 'https://github.com/login';
const TIMEOUT_MS = 5 * 60_000;

(async () => {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  // Real Chrome (not the bundled Chromium) for the login: it's the least likely
  // to trip GitHub's automated-browser checks during an interactive sign-in.
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(LOGIN_URL);

  console.log('\n→ Sign in to GitHub in the window that opened (finish any 2FA).');
  console.log('  Waiting for your session… (5 min timeout)\n');

  const deadline = Date.now() + TIMEOUT_MS;
  let signedIn = false;
  while (Date.now() < deadline) {
    // user_session is GitHub's authenticated web-session cookie (httpOnly, so we
    // read it via the context, not document.cookie).
    const cookies = await context.cookies('https://github.com');
    if (cookies.some((c) => c.name === 'user_session')) {
      signedIn = true;
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (!signedIn) {
    console.error('✗ Timed out before sign-in completed — nothing saved.');
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: AUTH_FILE });
  console.log(`✓ Session saved to ${path.relative(process.cwd(), AUTH_FILE)} (gitignored).`);
  console.log('  Run the Preview tests with:  npx playwright test preview');
  await browser.close();
})();
