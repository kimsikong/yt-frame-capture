/* YouTube Frame Capture — content script */
(() => {
  'use strict';

  const DEFAULTS = {
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

  const BTN_ID = 'ytfc-player-button';

  let settings = { ...DEFAULTS };
  let busy = false;

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored };
    syncPlayerButton();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, v] of Object.entries(changes)) settings[k] = v.newValue;
    syncPlayerButton();
  });

  /* ---------------------------------------------------------- utilities */

  // Pick the largest video that actually has decoded frames.
  function findVideo() {
    const videos = [...document.querySelectorAll('video')]
      .filter(v => v.videoWidth > 0 && v.videoHeight > 0);
    if (!videos.length) return null;
    return videos.sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return (br.width * br.height) - (ar.width * ar.height);
    })[0];
  }

  function getVideoId() {
    const u = new URL(location.href);
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(/\/(?:shorts|embed|live)\/([^/?#]+)/);
    return m ? m[1] : '';
  }

  function getVideoTitle() {
    const selectors = [
      'ytd-watch-metadata h1 yt-formatted-string',
      'ytd-watch-metadata h1',
      'h1.ytd-watch-metadata',
      'yt-shorts-video-title-view-model h2',
      '#title h1'
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      const t = el && el.textContent && el.textContent.trim();
      if (t) return t;
    }
    return document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() || 'YouTube';
  }

  function pad(n, len = 2) { return String(Math.floor(n)).padStart(len, '0'); }

  function formatTimestamp(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec - Math.floor(sec)) * 1000);
    return pad(h) + '-' + pad(m) + '-' + pad(s) + '.' + pad(ms, 3);
  }

  // Strip characters Chrome's downloads API rejects in a path segment.
  function sanitizeSegment(name) {
    return String(name)
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 120) || 'untitled';
  }

  function buildFilename(ctx, ext) {
    const tokens = {
      '{title}': ctx.title,
      '{id}': ctx.id,
      '{time}': ctx.time.toFixed(3),
      '{timeStr}': formatTimestamp(ctx.time),
      '{date}': ctx.date,
      '{res}': ctx.width + 'x' + ctx.height
    };
    let base = settings.filenameTemplate || DEFAULTS.filenameTemplate;
    for (const [k, v] of Object.entries(tokens)) base = base.split(k).join(v);
    // A token can resolve to nothing (e.g. no video id outside a watch page);
    // drop the brackets left empty around it rather than keeping "title []".
    base = base.replace(/[[({]\s*[\])}]/g, '').replace(/\s{2,}/g, ' ').trim();

    const parts = [];
    if (settings.subfolder) {
      settings.subfolder.split('/').filter(Boolean).forEach(p => parts.push(sanitizeSegment(p)));
    }
    if (settings.groupByVideo) parts.push(sanitizeSegment(ctx.title));
    parts.push(sanitizeSegment(base) + '.' + ext);
    return parts.join('/');
  }

  function mimeFor(format) {
    return format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  }

  function extFor(format) {
    return format === 'jpeg' ? 'jpg' : format === 'webp' ? 'webp' : 'png';
  }

  /* ------------------------------------------------------------- capture */

  // Draws the current frame at the video's native decoded resolution.
  function drawFrame(video) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function makeThumb(canvas, width = 320) {
    const scale = Math.min(1, width / canvas.width);
    const t = document.createElement('canvas');
    t.width = Math.max(1, Math.round(canvas.width * scale));
    t.height = Math.max(1, Math.round(canvas.height * scale));
    t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.7);
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('인코딩에 실패했습니다.')), mime, quality);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('이미지를 읽지 못했습니다.'));
      fr.readAsDataURL(blob);
    });
  }

  async function capture({ toClipboard = false } = {}) {
    if (busy) return;
    const video = findVideo();
    if (!video) { toast({ kind: 'error', text: '재생 중인 영상을 찾지 못했습니다.' }); return; }

    busy = true;
    try {
      if (settings.pauseOnCapture && !video.paused) video.pause();

      let canvas;
      try {
        canvas = drawFrame(video);
      } catch (err) {
        throw new Error('프레임을 읽을 수 없습니다 (DRM 보호 영상일 수 있습니다).');
      }

      const ctx = {
        title: getVideoTitle(),
        id: getVideoId(),
        time: video.currentTime,
        date: new Date().toISOString().slice(0, 10),
        width: canvas.width,
        height: canvas.height
      };

      if (toClipboard) {
        // The clipboard only accepts PNG.
        const blob = await canvasToBlob(canvas, 'image/png');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast({
          kind: 'ok',
          text: '클립보드에 복사됨',
          sub: ctx.width + '×' + ctx.height + ' · ' + formatTimestamp(ctx.time),
          thumb: makeThumb(canvas)
        });
        return;
      }

      const format = settings.format || 'png';
      const blob = await canvasToBlob(canvas, mimeFor(format),
        format === 'png' ? undefined : Number(settings.quality));
      const dataUrl = await blobToDataUrl(blob);
      const filename = buildFilename(ctx, extFor(format));
      const thumb = makeThumb(canvas);

      const res = await chrome.runtime.sendMessage({
        type: 'ytfc-download',
        dataUrl,
        filename,
        saveAs: !!settings.saveAs,
        record: settings.keepRecent ? {
          thumb,
          filename,
          title: ctx.title,
          videoId: ctx.id,
          time: ctx.time,
          timeStr: formatTimestamp(ctx.time),
          width: ctx.width,
          height: ctx.height,
          savedAt: Date.now()
        } : null
      });

      if (!res || !res.ok) throw new Error((res && res.error) || '저장에 실패했습니다.');

      toast({
        kind: 'ok',
        text: '저장됨',
        sub: ctx.width + '×' + ctx.height + ' · ' + filename.split('/').pop(),
        thumb
      });
    } catch (err) {
      toast({ kind: 'error', text: String((err && err.message) || err) });
    } finally {
      busy = false;
    }
  }

  /* --------------------------------------------------------------- toast */

  let toastHost = null, toastRoot = null, toastTimer = null;

  function ensureToastHost() {
    if (toastHost && document.body.contains(toastHost)) return;
    toastHost = document.createElement('div');
    toastHost.id = 'ytfc-toast-host';
    toastHost.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;';
    toastRoot = toastHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = [
      '.box{position:fixed;left:50%;bottom:96px;transform:translate(-50%,12px);',
      'display:flex;gap:12px;align-items:center;min-width:0;',
      'background:rgba(20,20,22,.94);color:#fff;border-radius:12px;',
      'padding:10px 14px 10px 10px;box-shadow:0 8px 28px rgba(0,0,0,.45);',
      'font:500 13px/1.35 "Helvetica Neue",Arial,"Apple SD Gothic Neo",sans-serif;',
      'opacity:0;transition:opacity .16s ease,transform .16s ease;pointer-events:none;',
      'max-width:min(520px,80vw);border:1px solid rgba(255,255,255,.10)}',
      '.box.show{opacity:1;transform:translate(-50%,0)}',
      '.box.error{background:rgba(125,26,26,.95)}',
      'img{width:96px;height:auto;border-radius:7px;display:block;background:#000;flex:none}',
      '.txt{min-width:0}',
      '.t{font-weight:700;font-size:13px}',
      '.s{opacity:.72;font-size:11.5px;margin-top:3px;white-space:nowrap;',
      'overflow:hidden;text-overflow:ellipsis;max-width:340px}',
      '.dot{width:20px;text-align:center;margin:0 2px 0 6px;flex:none;font-size:15px}'
    ].join('');

    const box = document.createElement('div');
    box.className = 'box';
    toastRoot.append(style, box);
    document.body.appendChild(toastHost);
  }

  function toast({ kind = 'ok', text = '', sub = '', thumb = null, ms = 2200 }) {
    if (!settings.showToast && kind !== 'error') return;
    ensureToastHost();
    const box = toastRoot.querySelector('.box');
    box.classList.toggle('error', kind === 'error');
    box.replaceChildren();

    if (thumb) {
      const img = document.createElement('img');
      img.src = thumb;
      box.appendChild(img);
    } else {
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.textContent = kind === 'error' ? '⚠' : '✓';
      box.appendChild(dot);
    }

    const txt = document.createElement('div');
    txt.className = 'txt';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = text;
    txt.appendChild(t);
    if (sub) {
      const s = document.createElement('div');
      s.className = 's';
      s.textContent = sub;
      txt.appendChild(s);
    }
    box.appendChild(txt);

    box.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('show'), kind === 'error' ? 3800 : ms);
  }

  /* ------------------------------------------------------- player button */

  function syncPlayerButton() {
    const existing = document.getElementById(BTN_ID);
    if (!settings.showPlayerButton) { if (existing) existing.remove(); return; }
    if (existing) return;
    const controls = document.querySelector('.ytp-right-controls');
    if (!controls) return;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.className = 'ytp-button';
    btn.title = '이 프레임 캡쳐 (Shift+클릭: 클립보드로 복사)';
    btn.setAttribute('aria-label', '이 프레임 캡쳐');
    btn.style.cssText = 'vertical-align:top;display:inline-flex;align-items:center;justify-content:center';

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('fill', '#fff');
    svg.style.opacity = '.92';
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M14.2 10.5l-1.1 1.8H9.5A1.5 1.5 0 008 13.8v10.4a1.5 1.5 0 001.5 1.5h17a1.5 1.5 0 001.5-1.5V13.8a1.5 1.5 0 00-1.5-1.5h-3.6l-1.1-1.8a1.5 1.5 0 00-1.3-.7h-4a1.5 1.5 0 00-1.3.7zM18 23.3a4.3 4.3 0 110-8.6 4.3 4.3 0 010 8.6z');
    svg.appendChild(path);
    btn.appendChild(svg);

    // Shift+click keeps the clipboard route reachable without a keyboard
    // shortcut, which a non-Latin input mode can swallow before we see it.
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      capture({ toClipboard: e.shiftKey });
    });
    controls.insertBefore(btn, controls.firstChild);
  }

  setInterval(syncPlayerButton, 1500);

  /* -------------------------------------------- messages from the popup */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'ytfc-capture-now') {
      capture({ toClipboard: !!msg.toClipboard })
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
  });
})();
