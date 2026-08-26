// Fetches the published feed on behalf of content scripts. Under MV3 the
// cross-origin github.com -> *.github.io request must originate here (the
// worker holds the host permission). Feeds are immutable per PR run, so we keep
// a small in-memory cache keyed by URL.
const cache = new Map();

// --- getting the content script onto the page ------------------------------
// A content script is injected when a DOCUMENT loads, and never again. GitHub
// navigates with pushState, so reaching a diff from the repo page, the pull
// list, or a notification loads no document — and the manifest's patterns cover
// only the diff URLs themselves, so nothing was injected on arrival. That left
// auto-activation with nothing to run, and the toolbar button with no receiver
// ("Receiving end does not exist"), until the page was reloaded.
//
// So watch for navigations into a diff URL and inject on demand. The manifest
// still declares the same two patterns for real document loads; this only fills
// the gap they cannot cover.
const CONTENT_FILES = [
  'src/config.js',
  'src/github.js',
  'src/overlay.js',
  'src/messaging.js',
  'src/rm.js',
  'src/views.js',
  'src/content.js',
];

// Mirrors the manifest's content_scripts.matches. Keep the two in step: this is
// the same set of pages, reached the other way.
const DIFF_URL = /^https:\/\/github\.com\/[^/?#]+\/[^/?#]+\/(pull|commit)\//;

// The injection in flight for a tab, so a burst of navigation events (GitHub
// emits several per route change) can't start two. Holding the PROMISE rather
// than a busy flag matters: a second caller has to be able to wait for the work
// to finish. The toolbar button is one — it injects and then immediately sends
// RMX_ACTIVATE, and returning early from a half-done injection would send that
// message before the content script existed to receive it.
const injecting = new Map();

function ensureInjected(tabId) {
  const inFlight = injecting.get(tabId);
  if (inFlight) return inFlight;
  const work = inject(tabId).catch(() => {
    // The tab navigated away, was closed, or is a page we hold no permission
    // for. Nothing to recover — the next navigation gets its own chance.
  });
  injecting.set(tabId, work);
  work.then(() => injecting.delete(tabId));
  return work;
}

async function inject(tabId) {
  // Runs in the same isolated world the content scripts use, so this sees the
  // flag content.js sets — i.e. it asks the page directly whether a copy is
  // already running, rather than inferring it from navigation events.
  const [probe] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => !!window.__rmxLoaded,
  });
  if (probe && probe.result) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
}

// Chrome reports a pushState navigation exactly like a document load — the same
// `status: 'loading'` then `status: 'complete'` pair — so the event shape cannot
// tell them apart, and the URL only rides along on the first of the two. Acting
// on `complete` is what separates them in practice: by then a real document load
// has already had its declarative injection at document_idle, so the probe in
// ensureInjected finds a copy running and does nothing, while a pushState
// arrival has had none and gets one. `tab.url` rather than `changeInfo.url`,
// which `complete` doesn't carry.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab || !tab.url || !DIFF_URL.test(tab.url)) return;
  ensureInjected(tabId);
});

// In click-to-activate mode the toolbar button starts analysis in the current
// tab. The content script is normally already there; on a diff reached by
// pushState it may not be yet, so make sure before sending — otherwise the
// button silently does nothing on exactly the pages this gap affects. This also
// covers the case where the navigation raised no `complete` event for the
// listener above to act on.
async function activateTab(tab) {
  if (!tab || !tab.id) return;
  if (tab.url && DIFF_URL.test(tab.url)) await ensureInjected(tab.id);
  return chrome.tabs.sendMessage(tab.id, { type: 'RMX_ACTIVATE' }).catch(() => {
    // Unsupported/non-GitHub pages do not have our content script.
  });
}

chrome.action.onClicked.addListener(activateTab);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'RMX_FETCH_FEED') {
    fetchFeed(msg.url).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  return false;
});

async function fetchFeed(url) {
  if (cache.has(url)) {
    return { ok: true, feed: cache.get(url) };
  }
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const feed = await res.json();
    cache.set(url, feed);
    return { ok: true, feed };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
