// Options page for standalone mode. Persists the RefactoringMiner service
// settings to chrome.storage.sync, where src/rm.js reads them. This page runs in
// its own extension context (not the content script), so it can't see RMX.rm —
// the defaults are mirrored here (keep in sync with src/rm.js DEFAULTS).
//
// The highlight colours and the blink speed (blinkSpeed) are read by
// src/overlay.js; keep these defaults in sync with overlay.js HL_DEFAULTS /
// HL_LEGACY / BLINK_PERIODS.
const DEFAULTS = {
  baseurl: 'https://rminer.encs.concordia.ca:8000/RefactoringMiner',
  token: '',
  timeout: 60,
  autoTrigger: false,
  blinkSpeed: 1,
  theme: 'light',
};

// Defaults only: one pair per GitHub theme, picked automatically by whichever
// theme GitHub is in. The user overrides them with the single left/right pair
// below, which then applies whatever theme GitHub is in. The fill sits behind
// GitHub's own syntax colours, so each pair is tuned to the code it has to stay
// readable under: pale tints for dark-on-white, deep shades for
// light-on-near-black. Left is amber and right is azure — near-complementary, so
// the pair separates by hue rather than brightness, and clear of the red/green
// GitHub already uses for removed/added lines. `leftA`/`rightA` are the
// hand-picked outline accents. Mirror of HL_DEFAULTS in src/overlay.js.
const HL_DEFAULTS = {
  light: { left: '#ffe1a8', leftA: '#9a6700', right: '#d1e7fd', rightA: '#0969da' },
  dark: { left: '#4b3a0f', leftA: '#d4a72c', right: '#143d69', rightA: '#58a6ff' },
};

// The pair that used to be the default for both themes, written out verbatim on
// every save by the old options page — so a stored value equal to it means
// "never actually chosen". Mirror of HL_LEGACY in src/overlay.js.
const HL_LEGACY = { left: '#ec4899', right: '#7c3aed' };

const HL_SIDES = ['left', 'right'];

// Which theme GitHub is in, so the page shows the defaults that actually apply.
// src/overlay.js records it after measuring a real diff; until it has (nothing
// opened yet), fall back to the OS preference, which is what GitHub's own
// default "sync with system" setting follows.
let ghMode = 'light';

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

// Mirrors of src/overlay.js shift()/accentFor() so the on-page preview shows the
// same fill + derived outline the diff will use. Defaults keep their hand-picked
// accent; a custom colour is pushed away from the canvas it sits on — darker in
// GitHub light mode, lighter in dark. Keep in sync with overlay.js.
function shift(hex, amt) {
  const h = normHex(hex);
  if (!h) return hex;
  const n = parseInt(h.slice(1), 16);
  const mix = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function accentFor(fill, mode, side) {
  const d = HL_DEFAULTS[mode];
  if (String(fill).toLowerCase() === d[side]) return side === 'left' ? d.leftA : d.rightA;
  return shift(fill, mode === 'dark' ? 0.5 : -0.4);
}

// The user's own colour if they picked one, else the default for the theme
// GitHub is in. Mirror of fillFor() in src/overlay.js.
function resolveFill(stored, side) {
  const chosen = normHex(stored[side === 'left' ? 'hlLeft' : 'hlRight']);
  if (chosen && chosen !== HL_LEGACY[side]) return chosen;
  return HL_DEFAULTS[ghMode][side];
}

// Clamp an arbitrary stored value to a valid slider index.
function normSpeed(v) {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n < 0 || n >= BLINK_PERIODS.length) return DEFAULTS.blinkSpeed;
  return n;
}

// Paint the preview with the two chosen fills and their derived accents. It is
// rendered in GitHub's canvas/text colours for the detected theme, so it shows
// the contrast the fill will actually have to survive.
function updatePreview() {
  const preview = document.querySelector('.preview');
  preview.classList.toggle('pv-gh-dark', ghMode === 'dark');
  preview.classList.toggle('pv-gh-light', ghMode !== 'dark');
  $('pvCap').textContent = 'Live preview · GitHub ' + ghMode;
  HL_SIDES.forEach((side) => {
    const fill = $(side === 'left' ? 'hlLeft' : 'hlRight').value;
    const v = side === 'left' ? '--pv-left' : '--pv-right';
    preview.style.setProperty(v, fill);
    preview.style.setProperty(v + '-d', accentFor(fill, ghMode, side));
  });
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

  document.querySelectorAll('.preview').forEach((preview) => {
    preview.classList.toggle('pv-constant', period === 0);
    preview.style.setProperty('--pv-period', (period || 5000) + 'ms');
  });
}

// Keep a colour picker and its hex text field mirrored. `picker` is the source of
// truth for what gets saved; the text field just offers a typeable alternative.
function bindColor(side, initial) {
  const id = side === 'left' ? 'hlLeft' : 'hlRight';
  const picker = $(id);
  const hex = $(id + 'Hex');
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
}

const GH_NOTE = {
  light: 'Your GitHub is in light mode, so the defaults are pale tints that keep '
    + 'its dark code readable. Pick your own and it replaces them in both of '
    + "GitHub's themes.",
  dark: 'Your GitHub is in dark mode, so the defaults are deep shades that keep '
    + 'its light code readable. Pick your own and it replaces them in both of '
    + "GitHub's themes.",
};

// The recorded GitHub theme lives in storage.local (it describes this browser,
// not a synced preference), so it is read separately from everything else.
function load() {
  chrome.storage.local.get('ghMode', (l) => {
    const recorded = l && l.ghMode;
    const osDark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
    ghMode = recorded === 'dark' || recorded === 'light' ? recorded : osDark ? 'dark' : 'light';
    $('ghModeNote').textContent = GH_NOTE[ghMode];
    loadSync();
  });
}

function loadSync() {
  chrome.storage.sync.get(
    ['baseurl', 'token', 'timeout', 'autoTrigger', 'blinkSpeed', 'theme', 'hlLeft', 'hlRight'],
    (r) => {
      r = r || {};
      $('baseurl').value = r.baseurl || DEFAULTS.baseurl;
      $('token').value = r.token || DEFAULTS.token;
      $('timeout').value = r.timeout || DEFAULTS.timeout;
      $('triggerAuto').checked = r.autoTrigger === true;
      HL_SIDES.forEach((s) => bindColor(s, resolveFill(r, s)));
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
  const blinkSpeed = normSpeed($('blinkSpeed').value);
  const write = { baseurl, token, timeout, autoTrigger, blinkSpeed };

  // A colour still sitting on the current default isn't a choice, so it is
  // cleared rather than written. Storing it would pin the colour to whichever
  // theme GitHub happened to be in at save time — someone who opened this page
  // only to change the timeout would silently lose the theme-following default.
  const clear = [];
  HL_SIDES.forEach((side) => {
    const id = side === 'left' ? 'hlLeft' : 'hlRight';
    const value = $(id).value;
    if (value.toLowerCase() === HL_DEFAULTS[ghMode][side]) clear.push(id);
    else write[id] = value;
  });

  chrome.storage.sync.set(write, () => {
    if (clear.length) chrome.storage.sync.remove(clear);
    $('timeout').value = timeout;
    const status = $('status');
    status.textContent = 'Saved.';
    setTimeout(() => (status.textContent = ''), 1500);
  });
}

// Back to the defaults for the theme GitHub is in. Clearing the stored pair (as
// well as resetting the pickers) is what puts the colours back under GitHub's
// control, so they follow along again if the user later switches its theme.
function resetColors() {
  chrome.storage.sync.remove(['hlLeft', 'hlRight']);
  HL_SIDES.forEach((side) => {
    const id = side === 'left' ? 'hlLeft' : 'hlRight';
    $(id).value = HL_DEFAULTS[ghMode][side];
    $(id + 'Hex').value = HL_DEFAULTS[ghMode][side];
  });
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
