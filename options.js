/* YouTube Frame Capture — options */

const $ = (id) => document.getElementById(id);

const CHECKBOXES = ['showPlayerButton', 'groupByVideo', 'saveAs',
                    'pauseOnCapture', 'showToast', 'keepRecent'];
const TEXTS = ['subfolder', 'filenameTemplate'];

let state = { ...YTFC_DEFAULTS };

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

/* --------------------------------------------------------------- wiring */

function applyToForm() {
  for (const id of CHECKBOXES) $(id).checked = !!state[id];
  for (const id of TEXTS) $(id).value = state[id] ?? '';
  $('format').value = state.format;
  $('quality').value = state.quality;
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

  $('reset').addEventListener('click', async () => {
    state = { ...YTFC_DEFAULTS };
    await chrome.storage.sync.set(state);
    applyToForm();
    flashSaved();
  });
}

init();
