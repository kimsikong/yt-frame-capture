// Shared default settings. Loaded as a classic script by popup/options,
// and duplicated inline in content.js (content scripts can't import).
const YTFC_DEFAULTS = {
  captureKey: 's',
  captureModifiers: [],
  clipboardKey: 's',
  clipboardModifiers: ['shift'],
  format: 'png',
  quality: 0.95,
  subfolder: 'YouTube Captures',
  groupByVideo: false,
  filenameTemplate: '{title} [{id}] {timeStr}',
  pauseOnCapture: true,
  showToast: true,
  saveAs: false,
  showPlayerButton: true,
  keepRecent: true
};
