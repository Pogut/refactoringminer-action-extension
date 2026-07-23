// Fetches the published feed on behalf of content scripts. Under MV3 the
// cross-origin github.com -> *.github.io request must originate here (the
// worker holds the host permission). Feeds are immutable per PR run, so we keep
// a small in-memory cache keyed by URL.
const cache = new Map();

// In click-to-activate mode the toolbar button starts analysis in the current
// tab. The content script is already present on supported GitHub pages; it just
// stays idle until it receives this message.
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'RMX_ACTIVATE' }).catch(() => {
    // Unsupported/non-GitHub pages do not have our content script.
  });
});

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
