// Options page for standalone mode. Persists the RefactoringMiner service
// settings to chrome.storage.sync, where src/rm.js reads them. This page runs in
// its own extension context (not the content script), so it can't see RMX.rm —
// the defaults are mirrored here (keep in sync with src/rm.js DEFAULTS).
const DEFAULTS = {
  baseurl: 'https://rminer.encs.concordia.ca:8000/RefactoringMiner',
  token: '',
  timeout: 60,
};

const $ = (id) => document.getElementById(id);

function load() {
  chrome.storage.sync.get(['baseurl', 'token', 'timeout'], (r) => {
    r = r || {};
    $('baseurl').value = r.baseurl || DEFAULTS.baseurl;
    $('token').value = r.token || DEFAULTS.token;
    $('timeout').value = r.timeout || DEFAULTS.timeout;
  });
}

function save() {
  const baseurl = $('baseurl').value.trim() || DEFAULTS.baseurl;
  const token = $('token').value.trim();
  const timeout = Math.min(600, Math.max(10, parseInt($('timeout').value, 10) || DEFAULTS.timeout));
  chrome.storage.sync.set({ baseurl, token, timeout }, () => {
    $('timeout').value = timeout;
    const status = $('status');
    status.textContent = 'Saved.';
    setTimeout(() => (status.textContent = ''), 1500);
  });
}

document.addEventListener('DOMContentLoaded', load);
$('save').addEventListener('click', save);
