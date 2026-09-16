/* YouTube Frame Capture — popup */

const $ = (id) => document.getElementById(id);

const MOD_LABEL = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Cmd' };

function comboLabel(key, mods) {
  return [...(mods || []).map(m => MOD_LABEL[m] || m), (key || '').toUpperCase()].join(' + ');
}

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text || '';
  el.style.color = isError ? '#e05a5a' : '';
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendCapture(toClipboard) {
  const tab = await activeTab();
  if (!tab) { setStatus('활성 탭을 찾을 수 없습니다.', true); return; }

  // tab.url is only populated when the host permission covers the tab, so an
  // absent url is not evidence that this is the wrong site — only a present,
  // non-YouTube url is. Otherwise just try, and let the send failure speak.
  if (tab.url && !/^https?:\/\/([a-z0-9-]+\.)*youtube\.com\//i.test(tab.url)) {
    setStatus('유튜브 탭에서만 캡쳐할 수 있습니다.', true);
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'ytfc-capture-now', toClipboard });
    setStatus(toClipboard ? '클립보드에 복사했습니다.' : '캡쳐했습니다.');
    setTimeout(renderRecent, 400);
  } catch (err) {
    setStatus('유튜브 영상 페이지를 새로고침한 뒤 다시 시도하세요.', true);
  }
}

async function renderRecent() {
  const { recent = [] } = await chrome.storage.local.get({ recent: [] });
  const grid = $('recent');
  grid.replaceChildren();
  $('recent-empty').hidden = recent.length > 0;

  for (const item of recent) {
    const card = document.createElement('button');
    card.className = 'card';
    card.title = item.filename;

    const img = document.createElement('img');
    img.src = item.thumb;
    img.alt = '';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const b = document.createElement('b');
    b.textContent = item.title || '(제목 없음)';
    const span = document.createElement('span');
    span.textContent = item.timeStr + ' · ' + item.width + '×' + item.height;
    meta.append(b, span);

    card.append(img, meta);
    card.addEventListener('click', () => {
      if (item.downloadId != null) chrome.downloads.show(item.downloadId);
    });
    grid.appendChild(card);
  }
}

async function init() {
  const s = { ...YTFC_DEFAULTS, ...(await chrome.storage.sync.get(YTFC_DEFAULTS)) };
  $('keyhint').textContent =
    comboLabel(s.captureKey, s.captureModifiers) + ' 저장 · ' +
    comboLabel(s.clipboardKey, s.clipboardModifiers) + ' 복사';

  $('shoot').addEventListener('click', () => sendCapture(false));
  $('copy').addEventListener('click', () => sendCapture(true));
  $('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());

  renderRecent();
}

init();
