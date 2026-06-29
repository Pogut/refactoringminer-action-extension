// Shared accessor for the saved GitHub session the Preview-diff tests need.
// The session is captured once (manually, with your login + 2FA) by
// `npm run test:auth` → capture-auth.js, and stored gitignored under .auth/.
const fs = require('fs');
const path = require('path');

const AUTH_FILE = path.join(__dirname, '.auth', 'github.json');

function hasAuth() {
  return fs.existsSync(AUTH_FILE);
}

// The cookies from the saved storageState — handed to a persistent context via
// context.addCookies(), which is how we log a freshly-launched (extension-
// loaded) Chromium into GitHub without driving the login flow each run.
function authCookies() {
  return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')).cookies || [];
}

module.exports = { AUTH_FILE, hasAuth, authCookies };
