// Options page for standalone mode. Persists the RefactoringMiner service
// settings to chrome.storage.sync, where src/rm.js reads them. This page runs in
// its own extension context (not the content script), so it can't see RMX.rm —
// the defaults are mirrored here (keep in sync with src/rm.js DEFAULTS).
//
// The highlight colours (hlLeft/hlRight) are read by src/overlay.js and apply in
// every mode; keep these defaults in sync with overlay.js HL_DEFAULTS.
const DEFAULTS = {
  baseurl: 'https://rminer.encs.concordia.ca:8000/RefactoringMiner',
  token: '',
  timeout: 60,
  autoTrigger: false,
  hlLeft: '#ec4899',
  hlRight: '#7c3aed',
};

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
    ['baseurl', 'token', 'timeout', 'autoTrigger', 'hlLeft', 'hlRight'],
    (r) => {
      r = r || {};
      $('baseurl').value = r.baseurl || DEFAULTS.baseurl;
      $('token').value = r.token || DEFAULTS.token;
      $('timeout').value = r.timeout || DEFAULTS.timeout;
      $('triggerAuto').checked = r.autoTrigger === true;
      getLeft = bindColor('hlLeft', 'hlLeftHex', normHex(r.hlLeft) || DEFAULTS.hlLeft);
      getRight = bindColor('hlRight', 'hlRightHex', normHex(r.hlRight) || DEFAULTS.hlRight);
      updatePreview();
    }
  );
}

function save() {
  const baseurl = $('baseurl').value.trim() || DEFAULTS.baseurl;
  const token = $('token').value.trim();
  const timeout = Math.min(1000, Math.max(10, parseInt($('timeout').value, 10) || DEFAULTS.timeout));
  const autoTrigger = $('triggerAuto').checked;
  const hlLeft = getLeft();
  const hlRight = getRight();
  chrome.storage.sync.set({ baseurl, token, timeout, autoTrigger, hlLeft, hlRight }, () => {
    $('timeout').value = timeout;
    const status = $('status');
    status.textContent = 'Saved.';
    setTimeout(() => (status.textContent = ''), 1500);
  });
}

function resetColors() {
  $('hlLeft').value = DEFAULTS.hlLeft;
  $('hlLeftHex').value = DEFAULTS.hlLeft;
  $('hlRight').value = DEFAULTS.hlRight;
  $('hlRightHex').value = DEFAULTS.hlRight;
  updatePreview();
}

document.addEventListener('DOMContentLoaded', load);
$('save').addEventListener('click', save);
$('reset').addEventListener('click', resetColors);
