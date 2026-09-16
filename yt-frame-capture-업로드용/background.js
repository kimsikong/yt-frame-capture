/* YouTube Frame Capture — service worker */

const MAX_RECENT = 12;

async function pushRecent(record, downloadId) {
  if (!record) return;
  const { recent = [] } = await chrome.storage.local.get({ recent: [] });
  recent.unshift({ ...record, downloadId });
  await chrome.storage.local.set({ recent: recent.slice(0, MAX_RECENT) });
}

async function startDownload(opts) {
  try {
    return await chrome.downloads.download(opts);
  } catch (err) {
    // Chrome rejects some filenames outright; fall back to a plain one.
    const ext = (opts.filename.match(/\.[a-z0-9]+$/i) || ['.png'])[0];
    return await chrome.downloads.download({
      ...opts,
      filename: 'YouTube Captures/capture-' + Date.now() + ext
    });
  }
}

// A content script only reaches tabs loaded after the install, so YouTube tabs
// that were already open would silently do nothing until reloaded by hand.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
    for (const tab of tabs) chrome.tabs.reload(tab.id);
  } catch (err) {
    // Not fatal: the user can still reload the tab themselves.
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'ytfc-download') return;

  (async () => {
    try {
      const downloadId = await startDownload({
        url: msg.dataUrl,
        filename: msg.filename,
        saveAs: !!msg.saveAs,
        conflictAction: 'uniquify'
      });
      await pushRecent(msg.record, downloadId);
      sendResponse({ ok: true, downloadId });
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();

  return true; // keep the message channel open for the async response
});
