/* YouTube Frame Capture — options */

const $ = (id) => document.getElementById(id);

const CHECKBOXES = ['showPlayerButton', 'groupByVideo', 'saveAs',
                    'pauseOnCapture', 'showToast', 'keepRecent'];
const TEXTS = ['subfolder', 'filenameTemplate'];

const MOD_LABEL = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Cmd' };

let state = { ...YTFC_DEFAULTS };

function comboLabel(key, mods) {
  if (!key) return '(없음)';
  return [...(mods || []).map(m => MOD_LABEL[m] || m), key.toUpperCase()].join(' + ');
}

function flashSaved() {
  const el = $('saved');
  el.classList.add('on');
  clearTimeout(flashSaved.t);
  flashSaved.t = setTimeout(() => el.classList.remove('on'), 1200);
}

function save() {
  chrome.storage.sync.set(state, flashSaved);
}

/* ------------------------------------------------------------- preview */

function sanitizeSegment(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120) || 'untitled';
}

function renderPreview() {
  const sample = {
    '{title}': '고양이가 키보드를 밟는 4분',
    '{id}': 'dQw4w9WgXcQ',
    '{timeStr}': '00-03-27.480',
    '{time}': '207.480',
    '{date}': new Date().toISOString().slice(0, 10),
    '{res}': '1920x1080'
  };
  let base = state.filenameTemplate || YTFC_DEFAULTS.filenameTemplate;
  for (const [k, v] of Object.entries(sample)) base = base.split(k).join(v);
  base = base.replace(/[[({]\s*[\])}]/g, '').replace(/\s{2,}/g, ' ').trim();

  const ext = state.format === 'jpeg' ? 'jpg' : state.format === 'webp' ? 'webp' : 'png';
  const parts = ['다운로드'];
  if (state.subfolder) state.subfolder.split('/').filter(Boolean)
    .forEach(p => parts.push(sanitizeSegment(p)));
  if (state.groupByVideo) parts.push(sanitizeSegment(sample['{title}']));
  parts.push(sanitizeSegment(base) + '.' + ext);

  $('preview').textContent = '예시: ' + parts.join(' / ');
}

function syncQualityVisibility() {
  $('quality-field').style.display = state.format === 'png' ? 'none' : '';
}

/* ----------------------------------------------------- hotkey recorder */

let recording = null; // 'capture' | 'clipboard' | null

function renderKeys() {
  $('key-capture').textContent = comboLabel(state.captureKey, state.captureModifiers);
  $('key-clipboard').textContent = comboLabel(state.clipboardKey, state.clipboardModifiers);
}

function stopRecording() {
  recording = null;
  document.querySelectorAll('.keybtn').forEach(b => b.classList.remove('recording'));
  renderKeys();
}

function startRecording(target, btn) {
  stopRecording();
  recording = target;
  btn.classList.add('recording');
  btn.textContent = '키를 누르세요…';
}

document.addEventListener('keydown', (e) => {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();

  if (e.key === 'Escape') { stopRecording(); return; }
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

  const mods = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.shiftKey) mods.push('shift');
  if (e.altKey) mods.push('alt');
  if (e.metaKey) mods.push('meta');

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (recording === 'capture') { state.captureKey = key; state.captureModifiers = mods; }
  else { state.clipboardKey = key; state.clipboardModifiers = mods; }

  stopRecording();
  save();
}, true);

/* --------------------------------------------------------------- wiring */

function applyToForm() {
  for (const id of CHECKBOXES) $(id).checked = !!state[id];
  for (const id of TEXTS) $(id).value = state[id] ?? '';
  $('format').value = state.format;
  $('quality').value = state.quality;
  renderKeys();
  syncQualityVisibility();
  renderPreview();
}

async function init() {
  state = { ...YTFC_DEFAULTS, ...(await chrome.storage.sync.get(YTFC_DEFAULTS)) };
  applyToForm();

  for (const id of CHECKBOXES) {
    $(id).addEventListener('change', () => {
      state[id] = $(id).checked;
      renderPreview();
      save();
    });
  }
  for (const id of TEXTS) {
    $(id).addEventListener('input', () => {
      state[id] = $(id).value;
      renderPreview();
      save();
    });
  }
  $('format').addEventListener('change', () => {
    state.format = $('format').value;
    syncQualityVisibility();
    renderPreview();
    save();
  });
  $('quality').addEventListener('change', () => {
    const v = Math.min(1, Math.max(0.3, Number($('quality').value) || YTFC_DEFAULTS.quality));
    state.quality = v;
    $('quality').value = v;
    save();
  });

  document.querySelectorAll('.keybtn').forEach(btn => {
    btn.addEventListener('click', () => startRecording(btn.dataset.target, btn));
  });

  $('reset').addEventListener('click', async () => {
    state = { ...YTFC_DEFAULTS };
    await chrome.storage.sync.set(state);
    applyToForm();
    flashSaved();
  });
}

init();
