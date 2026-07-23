window.RMX = window.RMX || {};

// The content script runs in the github.com page context, so it can't make the
// cross-origin request to the *.github.io feed itself under MV3. The service
// worker holds that host permission, so we ask it to fetch and hand back JSON.
window.RMX.messaging = (function () {
  function fetchFeed(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'RMX_FETCH_FEED', url }, (res) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!res || !res.ok) {
          return reject(new Error(res ? res.error : 'no response from service worker'));
        }
        resolve(res.feed);
      });
    });
  }

  return { fetchFeed };
})();
