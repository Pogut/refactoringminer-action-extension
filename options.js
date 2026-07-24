// Options page for standalone mode. Persists the RefactoringMiner service
// settings to chrome.storage.sync, where src/rm.js reads them. This page runs in
// its own extension context (not the content script), so it can't see RMX.rm —
// the defaults are mirrored here (keep in sync with src/rm.js DEFAULTS).
//
// The highlight colours (hlLeft/hlRight) and the blink speed (blinkSpeed) are
// read by src/overlay.js and apply in every mode; keep these defaults in sync
// with overlay.js HL_DEFAULTS / BLINK_PERIODS.
const DEFAULTS = {
  baseurl: 'https://rminer.encs.concordia.ca:8000/RefactoringMiner',
  token: '',
  timeout: 60,
  autoTrigger: false,
  hlLeft: '#ec4899',
  hlRight: '#7c3aed',
  blinkSpeed: 1,
  theme: 'light',
};

// Blink speed steps: slider index → full pulse period in ms. Step 0 is
// "constant" — the highlight stays lit and never blinks. Step 1 is the original
// 5 s pulse, so a fresh install behaves exactly as before. Keep in sync with
// BLINK_PERIODS in src/overlay.js.
const BLINK_PERIODS = [0, 5000, 3000, 1800, 1000, 600, 320];
const BLINK_NAMES = [
  'Constant · no blinking',
  'Very slow',
  'Slow',
  'Medium',
  'Fast',
  'Very fast',
  'Fastest',
];

// Mirror of the stored theme, kept in localStorage as well as chrome.storage.
// storage.sync is async, so a reload would flash the light palette before the
// dark one resolves; this synchronous copy is read before the body paints (the
// page loads this script from <head>) and storage.sync reconciles it after.
const THEME_KEY = 'rmxOptionsTheme';

function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.setAttribute('aria-pressed', String(t === 'dark'));
    btn.title = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }
  return t;
}

// Runs before <body> exists — applyTheme only touches documentElement here.
try {
  applyTheme(localStorage.getItem(THEME_KEY));
} catch {
  applyTheme(DEFAULTS.theme);
}

const $ = (id) => document.getElementById(id);

// Normalise user-typed hex to #rrggbb (expanding #rgb), or null if it isn't a
// valid hex colour — <input type="color"> only accepts the 6-digit form.
function normHex(v) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((v || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return '#' + h.toLowerCase();
}

// Mirror of src/overlay.js darken()/applyColors() so the on-page preview shows
// the same fill + derived outline shade the diff will use (defaults keep their
// hand-picked shade, custom colours derive theirs). Keep in sync with overlay.js.
function darken(hex, amt) {
  const h = normHex(hex);
  if (!h) return hex;
  const n = parseInt(h.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amt));
  const g = Math.round(((n >> 8) & 255) * (1 - amt));
  const b = Math.round((n & 255) * (1 - amt));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Clamp an arbitrary stored value to a valid slider index.
function normSpeed(v) {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n < 0 || n >= BLINK_PERIODS.length) return DEFAULTS.blinkSpeed;
  return n;
}

function updatePreview() {
  const left = $('hlLeft').value;
  const right = $('hlRight').value;
  const leftD = left.toLowerCase() === DEFAULTS.hlLeft ? '#be185d' : darken(left, 0.22);
  const rightD = right.toLowerCase() === DEFAULTS.hlRight ? '#6d28d9' : darken(right, 0.22);
  const pv = document.querySelector('.preview').style;
  pv.setProperty('--pv-left', left);
  pv.setProperty('--pv-left-d', leftD);
  pv.setProperty('--pv-right', right);
  pv.setProperty('--pv-right-d', rightD);
}

// Paint everything driven by the speed slider: the gradient fill on the track,
// the tick highlighting, the readout, and the preview's pulse period.
function updateSpeed() {
  const slider = $('blinkSpeed');
  const idx = normSpeed(slider.value);
  const period = BLINK_PERIODS[idx];
  const max = BLINK_PERIODS.length - 1;

  slider.style.setProperty('--fill', (idx / max) * 100 + '%');
  document.querySelectorAll('.speed-ticks i').forEach((tick, i) => {
    tick.classList.toggle('on', i <= idx);
  });
  $('speedName').textContent = BLINK_NAMES[idx];
  $('speedDetail').textContent = period ? (period / 1000).toFixed(2) + ' s per pulse' : 'always lit';

  const preview = document.querySelector('.preview');
  preview.classList.toggle('pv-constant', period === 0);
  preview.style.setProperty('--pv-period', (period || 5000) + 'ms');
}

// Keep a colour picker and its hex text field mirrored. `picker` is the source of
// truth for what gets saved; the text field just offers a typeable alternative.
function bindColor(pickerId, hexId, initial) {
  const picker = $(pickerId);
  const hex = $(hexId);
  const set = (value) => {
    picker.value = value;
    hex.value = value;
  };
  set(initial);
  picker.addEventListener('input', () => {
    hex.value = picker.value;
    updatePreview();
  });
  hex.addEventListener('change', () => {
    const norm = normHex(hex.value);
    set(norm || picker.value); // revert to the last good colour on bad input
    updatePreview();
  });
  return () => picker.value;
}

let getLeft, getRight;

function load() {
  chrome.storage.sync.get(
    ['baseurl', 'token', 'timeout', 'autoTrigger', 'hlLeft', 'hlRight', 'blinkSpeed', 'theme'],
    (r) => {
      r = r || {};
      $('baseurl').value = r.baseurl || DEFAULTS.baseurl;
      $('token').value = r.token || DEFAULTS.token;
      $('timeout').value = r.timeout || DEFAULTS.timeout;
      $('triggerAuto').checked = r.autoTrigger === true;
      getLeft = bindColor('hlLeft', 'hlLeftHex', normHex(r.hlLeft) || DEFAULTS.hlLeft);
      getRight = bindColor('hlRight', 'hlRightHex', normHex(r.hlRight) || DEFAULTS.hlRight);
      $('blinkSpeed').value = normSpeed(r.blinkSpeed);
      setTheme(r.theme, false);
      updatePreview();
      updateSpeed();
    }
  );
}

// The theme is applied (and mirrored to localStorage) immediately; `persist`
// only controls whether it is also pushed to chrome.storage.sync, so loading a
// stored value doesn't write it straight back.
function setTheme(theme, persist) {
  const t = applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode / storage disabled — the sync copy still carries it */
  }
  if (persist) chrome.storage.sync.set({ theme: t });
}

function save() {
  const baseurl = $('baseurl').value.trim() || DEFAULTS.baseurl;
  const token = $('token').value.trim();
  const timeout = Math.min(1000, Math.max(10, parseInt($('timeout').value, 10) || DEFAULTS.timeout));
  const autoTrigger = $('triggerAuto').checked;
  const hlLeft = getLeft();
  const hlRight = getRight();
  const blinkSpeed = normSpeed($('blinkSpeed').value);
  chrome.storage.sync.set(
    { baseurl, token, timeout, autoTrigger, hlLeft, hlRight, blinkSpeed },
    () => {
      $('timeout').value = timeout;
      const status = $('status');
      status.textContent = 'Saved.';
      setTimeout(() => (status.textContent = ''), 1500);
    }
  );
}

function resetColors() {
  $('hlLeft').value = DEFAULTS.hlLeft;
  $('hlLeftHex').value = DEFAULTS.hlLeft;
  $('hlRight').value = DEFAULTS.hlRight;
  $('hlRightHex').value = DEFAULTS.hlRight;
  updatePreview();
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(document.documentElement.dataset.theme); // sync the button's label/state
  load();
  $('save').addEventListener('click', save);
  $('reset').addEventListener('click', resetColors);
  $('blinkSpeed').addEventListener('input', updateSpeed);
  $('themeToggle').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
});
