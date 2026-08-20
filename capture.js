/* ============================================================
   Page Capture — bookmarklet source
   Self-contained. No external requests, no libraries.
   Chromium (Chrome/Edge) for folder writing + tab screenshot.
   ============================================================ */
(() => {
  'use strict';

  const KEY = '__pageCapture_v1';
  if (window[KEY]) { window[KEY].wake(); return; }

  /* ---------- session state ---------- */
  const S = {
    dir: null,          // FileSystemDirectoryHandle
    stream: null,       // MediaStream (tab capture)
    video: null,
    count: 0,
    wantShot: true,     // screenshot on/off, remembered for the session
    shots: [],          // {n, name}
    mode: 'idle',
    pending: null,      // {blob, url, html, ancestors, selector, rect, clipped}
    onGitHub: /(^|\.)github\.com$/.test(location.hostname)
  };
  window[KEY] = { wake, state: S };

  /* ---------- tiny helpers ---------- */
  const $ = (sel, root) => root.querySelector(sel);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    kids.flat().forEach(k => k && n.append(k));
    return n;
  };
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const slug = s => (s || '').toLowerCase().normalize('NFKD')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'capture';
  const q = s => JSON.stringify(String(s ?? ''));           // safe YAML scalar
  const fence = s => { const m = String(s).match(/`{3,}/g); return '`'.repeat(m ? Math.max(...m.map(x => x.length)) + 1 : 3); };

  /* platform.docwise.dk -> docwise ; example.co.uk -> example ; localhost -> localhost */
  const SLD = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'sch', 'gob', 'nom', 'firm']);
  function siteName() {
    const h = location.hostname.replace(/^www\./, '');
    if (!h.includes('.') || /^[\d.]+$/.test(h)) return slug(h.replace(/\./g, '-'));
    const p = h.split('.');
    let i = p.length - 2;
    if (p.length >= 3 && SLD.has(p[i])) i = p.length - 3;
    return slug(p[i]);
  }

  /* next free number for this site: 1, 2, 3 … reads the folder so it survives reloads */
  async function nextIndex(base) {
    const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)\\.');
    if (S.dir) {
      let max = 0;
      for await (const name of S.dir.keys()) {
        const m = name.match(re);
        if (m) max = Math.max(max, +m[1]);
      }
      return max + 1;
    }
    const n = (await IDB.get('n:' + base) || 0) + 1;   // download fallback
    await IDB.set('n:' + base, n);
    return n;
  }

  /* ============================================================
     1. UI  — shadow DOM so the host page cannot restyle us
     ============================================================ */
  const host = el('div', { id: '__capture_host' });
  Object.assign(host.style, {
    position: 'fixed', inset: 'auto 0 0 auto', zIndex: '2147483647',
    width: '0', height: '0'
  });
  const root = host.attachShadow({ mode: 'open' });
  root.append(el('style', {
    text: `
    :host{all:initial}
    *{box-sizing:border-box;margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    .panel{
      position:fixed;right:18px;bottom:18px;width:332px;
      background:#171b21;color:#e6e9ec;border:1px solid #2a3138;
      border-radius:10px;box-shadow:0 18px 44px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.03);
      overflow:hidden;font-size:12px;line-height:1.45;
    }
    .panel[hidden]{display:none}
    .bar{display:flex;align-items:center;gap:8px;padding:9px 11px;background:#12161b;border-bottom:1px solid #2a3138}
    .dot{width:7px;height:7px;border-radius:50%;background:#ffb020;box-shadow:0 0 8px #ffb02066}
    .dot.off{background:#3d454d;box-shadow:none}
    .ttl{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8b96a1}
    .grow{flex:1}
    .x{background:none;border:0;color:#5f6a75;cursor:pointer;font-size:14px;padding:0 2px;line-height:1}
    .x:hover{color:#e6e9ec}
    .body{padding:12px}
    /* signature: the film counter strip */
    .reel{display:flex;align-items:center;gap:3px;padding:0 11px 9px;flex-wrap:wrap}
    .tick{width:11px;height:4px;border-radius:1px;background:#ffb020}
    .tick.blank{background:#262c33}
    .reel .n{font-size:10px;color:#8b96a1;letter-spacing:.1em;margin-left:5px}
    .mount{display:flex;gap:6px;align-items:center;padding:7px 11px;border-top:1px solid #22282e;
      font-size:10px;color:#8b96a1;letter-spacing:.04em;word-break:break-all}
    .mount b{color:#ffb020;font-weight:500}
    button.big{width:100%;padding:13px;border:0;border-radius:7px;background:#ffb020;color:#14181d;
      font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
    button.big:hover{background:#ffc247}
    button.big:disabled{background:#2c333a;color:#68727c;cursor:default}
    .row{display:flex;gap:7px;margin-top:10px}
    button.s{flex:1;padding:9px;border-radius:6px;border:1px solid #333b43;background:#1d232a;color:#cdd4da;
      font-size:11px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
    button.s:hover{background:#252c34}
    button.s.go{background:#ffb020;border-color:#ffb020;color:#14181d;font-weight:600}
    button.s.go:hover{background:#ffc247}
    .shot{width:100%;max-height:190px;object-fit:contain;background:
      repeating-conic-gradient(#1b2027 0 25%,#20262e 0 50%) 0 0/14px 14px;
      border:1px solid #2a3138;border-radius:6px;display:block}
    label{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#8b96a1;margin:11px 0 4px}
    label i{color:#ffb020;font-style:normal}
    input,textarea{width:100%;background:#0f1216;border:1px solid #2f373f;border-radius:6px;
      color:#e6e9ec;padding:8px;font-size:12px;resize:vertical}
    textarea{font-family:-apple-system,system-ui,sans-serif;min-height:62px}
    input:focus,textarea:focus{outline:0;border-color:#ffb020}
    .check{display:flex;align-items:center;gap:8px;margin-top:11px;padding:8px 9px;cursor:pointer;
      border:1px solid #2a3138;border-radius:6px;background:#12161b;color:#cdd4da;font-size:11px;letter-spacing:.04em}
    .check:hover{border-color:#3a434c}
    .check input{width:auto;height:13px;flex:0 0 auto;accent-color:#ffb020;margin:0;cursor:pointer}
    .check em{font-style:normal;color:#7c8792;margin-left:auto;font-size:10px}
    .help{font-size:10px;color:#7c8792;margin-top:6px;letter-spacing:.02em}
    .meta{font-size:10px;color:#7c8792;margin-top:7px;word-break:break-all}
    .warn{font-size:10px;color:#ffb020;margin-top:7px}
    .err{font-size:11px;color:#ff8a70;margin-top:8px}
    .list{max-height:210px;overflow:auto;border:1px solid #2a3138;border-radius:6px}
    .item{display:block;width:100%;text-align:left;padding:8px 9px;background:#0f1216;border:0;
      border-bottom:1px solid #1e242a;color:#cdd4da;font-size:11px;cursor:pointer}
    .item:hover{background:#1a2027}
    .item span{display:block;color:#6f7a85;font-size:10px;margin-top:2px}
    /* picker chrome lives in the shadow root too */
    .veil{position:fixed;inset:0;cursor:crosshair;background:transparent}
    .hl{position:fixed;pointer-events:none;border:1.5px solid #ffb020;background:#ffb02014;
      box-shadow:0 0 0 9999px rgba(8,10,13,.34);border-radius:2px}
    .tag{position:fixed;pointer-events:none;background:#ffb020;color:#14181d;font-size:10px;
      padding:2px 5px;border-radius:3px;white-space:nowrap;font-weight:600}
    .tip{position:fixed;left:50%;top:16px;transform:translateX(-50%);pointer-events:none;
      background:#12161b;border:1px solid #2a3138;color:#cdd4da;font-size:11px;padding:7px 12px;border-radius:6px}
    .tip b{color:#ffb020;font-weight:600}
    @media (prefers-reduced-motion:no-preference){
      .panel{animation:in .16s ease-out}
      @keyframes in{from{opacity:0;transform:translateY(6px)}}
    }`
  }));

  const panel = el('div', { class: 'panel' });
  const bar = el('div', { class: 'bar' },
    el('span', { class: 'dot off' }),
    el('span', { class: 'ttl', text: S.onGitHub ? 'capture → issue' : 'page capture' }),
    el('span', { class: 'grow' }),
    el('button', { class: 'x', title: 'Hide', onclick: hide, text: '✕' }));
  const reel = el('div', { class: 'reel' });
  const body = el('div', { class: 'body' });
  const mount = el('div', { class: 'mount' });
  panel.append(bar, body, reel, mount);
  root.append(panel);
  document.documentElement.append(host);

  function wake() { panel.hidden = false; render(); }
  function hide() { panel.hidden = true; }
  function drawReel() {
    reel.textContent = '';
    const n = Math.max(6, S.count);
    for (let i = 0; i < n; i++) reel.append(el('span', { class: 'tick' + (i < S.count ? '' : ' blank') }));
    reel.append(el('span', { class: 'n', text: `${pad(S.count, 3)} saved` }));
    $('.dot', root).className = 'dot' + (S.dir ? '' : ' off');
    mount.textContent = '';
    mount.append(S.dir
      ? el('span', {}, 'folder ', el('b', { text: S.dir.name }))
      : el('span', { text: 'no folder mounted' }));
  }

  /* ============================================================
     2. Screens
     ============================================================ */
  function render() { S.onGitHub ? screenGitHub() : screenIdle(); }

  function screenIdle() {
    S.mode = 'idle';
    body.textContent = '';
    const cb = el('input', { type: 'checkbox' });
    cb.checked = S.wantShot;
    const note = el('p', { class: 'help' });
    const live = () => S.stream?.getVideoTracks()[0]?.readyState === 'live';
    const tell = () => {
      note.textContent = !cb.checked
        ? 'HTML only. No permission prompt, no tab sharing.'
        : live()
          ? 'This tab is already shared — captures happen without a prompt.'
          : 'Chrome will ask permission to see this tab on the first capture. Choose "This tab" and allow. The prompt does not come back until you reload.';
    };
    cb.onchange = () => { S.wantShot = cb.checked; tell(); };
    body.append(
      el('button', { class: 'big', onclick: startPick, text: 'Click here to capture' }),
      el('label', { class: 'check' }, cb, 'Include a screenshot',
        el('em', { text: live() ? 'tab shared' : 'needs permission' })),
      note,
      el('p', { class: 'help', text: 'Pick an element, then write a description. ↑↓ widens or narrows the selection, Esc cancels.' })
    );
    tell();
    drawReel();
  }

  function screenPreview() {
    S.mode = 'preview';
    body.textContent = '';
    const img = el('img', { class: 'shot', alt: 'Captured region' });
    if (S.pending.blob) img.src = URL.createObjectURL(S.pending.blob);
    body.append(
      S.pending.blob ? img
        : el('p', { class: S.pending.shot === 'off' ? 'help' : 'warn', text: S.pending.shot === 'off'
          ? 'HTML only — screenshot turned off.'
          : 'No image — sharing the tab was declined. The HTML will still be saved.' }),
      el('p', { class: 'meta', text: `${S.pending.selector}  ·  ${Math.round(S.pending.rect.width)}×${Math.round(S.pending.rect.height)}  ·  ${(S.pending.html.length / 1024).toFixed(1)} kB html` }),
      S.pending.clipped ? el('p', { class: 'warn', text: 'Taller than the viewport — image shows the visible part only.' }) : null,
      el('div', { class: 'row' },
        el('button', { class: 's', onclick: () => { S.pending = null; screenIdle(); }, text: 'Cancel' }),
        el('button', { class: 's go', onclick: screenForm, text: 'OK' }))
    );
    drawReel();
  }

  function screenForm() {
    S.mode = 'form';
    body.textContent = '';
    const title = el('input', { type: 'text', placeholder: 'Optional' });
    const desc = el('textarea', { placeholder: 'What is this capture about?' });
    const err = el('p', { class: 'err' });
    const save = el('button', { class: 's go', text: 'Save' });

    save.onclick = async () => {
      if (!desc.value.trim()) { err.textContent = 'A description is required.'; desc.focus(); return; }
      err.textContent = ''; save.disabled = true; save.textContent = 'Saving…';
      try {
        const msg = await saveCapture(title.value.trim(), desc.value.trim());
        S.count++; S.pending = null;
        screenIdle();
        body.prepend(el('p', { class: 'help', text: msg }));
      } catch (e) {
        err.textContent = e.message || String(e);
        save.disabled = false; save.textContent = 'Save';
      }
    };

    body.append(
      el('label', { text: 'Title' }), title,
      el('label', {}, 'Description ', el('i', { text: '*' })), desc,
      el('label', { text: 'Destination' }),
      el('button', {
        class: 's', text: S.dir ? `Folder: ${S.dir.name}` : 'Choose folder…',
        onclick: async (e) => {
          try { await pickDir('readwrite', true); e.target.textContent = `Folder: ${S.dir.name}`; drawReel(); }
          catch (_) { }
        }
      }),
      el('p', { class: 'help', text: S.dir ? 'Click to pick a different folder.' : 'Select folder with claude session' }),
      err,
      el('div', { class: 'row' },
        el('button', { class: 's', onclick: () => { S.pending = null; screenIdle(); }, text: 'Cancel' }),
        save)
    );
    desc.focus();
    drawReel();
  }

  /* ============================================================
     3. Element picker
     ============================================================ */
  function startPick() {
    S.mode = 'picking';
    panel.hidden = true;
    let target = null;
    const veil = el('div', { class: 'veil' });
    const hl = el('div', { class: 'hl' });
    const tag = el('div', { class: 'tag' });
    const tip = el('div', { class: 'tip' }, el('b', { text: 'Click' }), ' to capture · ',
      el('b', { text: '↑↓' }), ' resize selection · ', el('b', { text: 'Esc' }), ' cancel');
    root.append(veil, hl, tag, tip);

    const paint = () => {
      if (!target) return;
      const r = target.getBoundingClientRect();
      Object.assign(hl.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      tag.textContent = target.tagName.toLowerCase() +
        (target.id ? '#' + target.id : '') + `  ${Math.round(r.width)}×${Math.round(r.height)}`;
      Object.assign(tag.style, { left: r.left + 'px', top: Math.max(2, r.top - 19) + 'px' });
    };
    const move = e => {
      veil.style.pointerEvents = 'none';
      const t = document.elementFromPoint(e.clientX, e.clientY);
      veil.style.pointerEvents = 'auto';
      if (t && t !== host && !host.contains(t)) { target = t; paint(); }
    };
    const key = e => {
      if (e.key === 'Escape') { stop(); screenIdle(); panel.hidden = false; }
      else if (e.key === 'ArrowUp' && target?.parentElement && target.parentElement !== document.documentElement) { target = target.parentElement; paint(); }
      else if (e.key === 'ArrowDown' && target?.firstElementChild) { target = target.firstElementChild; paint(); }
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    const click = async e => {
      e.preventDefault(); e.stopPropagation();
      const picked = target; stop();
      if (picked) await capture(picked);
      panel.hidden = false;
    };
    function stop() {
      veil.remove(); hl.remove(); tag.remove(); tip.remove();
      window.removeEventListener('keydown', key, true);
      veil.removeEventListener('mousemove', move);
      veil.removeEventListener('click', click);
    }
    veil.addEventListener('mousemove', move);
    veil.addEventListener('click', click);
    window.addEventListener('keydown', key, true);
  }

  /* ============================================================
     4. Screenshot via tab capture
     ============================================================ */
  async function ensureStream() {
    const live = S.stream && S.stream.getVideoTracks()[0]?.readyState === 'live';
    if (live) return true;
    if (!navigator.mediaDevices?.getDisplayMedia) return false;
    S.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 }, audio: false,
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude'
    });
    S.video = el('video', { muted: '', playsinline: '' });
    S.video.srcObject = S.stream;
    await S.video.play();
    await new Promise(r => setTimeout(r, 180));
    return true;
  }

  async function shoot(rect) {
    let ok = false;
    try { ok = await ensureStream(); } catch (_) { ok = false; }
    if (!ok) return null;
    const v = S.video;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const scale = v.videoWidth / window.innerWidth;   // tab capture == viewport
    const top = Math.max(0, rect.top), left = Math.max(0, rect.left);
    const w = Math.min(rect.width, window.innerWidth - left);
    const h = Math.min(rect.height, window.innerHeight - top);
    const c = el('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d').drawImage(v, left * scale, top * scale, w * scale, h * scale, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(res, 'image/png'));
  }

  async function capture(node) {
    node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    await new Promise(r => setTimeout(r, 120));
    const rect = node.getBoundingClientRect();
    const clipped = rect.height > window.innerHeight || rect.top < 0;
    const blob = S.wantShot ? await shoot(rect) : null;
    S.pending = {
      blob, rect, clipped: clipped && !!blob,
      shot: !S.wantShot ? 'off' : blob ? 'ok' : 'declined',
      url: location.href,
      html: node.outerHTML,
      selector: selectorOf(node),
      ancestors: chainOf(node),
      at: new Date()
    };
    screenPreview();
  }

  function selectorOf(node) {
    const parts = []; let n = node;
    while (n && n.nodeType === 1 && parts.length < 8) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(s + '#' + n.id); break; }
      const cls = (n.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      const p = n.parentElement;
      if (p) {
        const sibs = [...p.children].filter(c => c.tagName === n.tagName);
        if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(n) + 1})`;
      }
      parts.unshift(s); n = p;
    }
    return parts.join(' > ');
  }

  function chainOf(node) {
    const out = []; let n = node.parentElement, d = 0;
    while (n && n !== document.documentElement) { out.unshift(n); n = n.parentElement; }
    return out.map(a => {
      const cls = (a.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3);
      return '  '.repeat(d++) + '<' + a.tagName.toLowerCase() +
        (a.id ? ' id="' + a.id + '"' : '') + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>';
    }).join('\n') + '\n' + '  '.repeat(d) + '⤷ ' + node.tagName.toLowerCase() + ' (captured)';
  }

  /* ============================================================
     5. Storage
     ============================================================ */
  const IDB = {
    open: () => new Promise((res, rej) => {
      const r = indexedDB.open('__pageCapture', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }),
    async set(k, v) { const db = await this.open(); const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); },
    async get(k) {
      const db = await this.open();
      return new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
    }
  };

  async function grant(handle, mode) {
    const o = { mode };
    if (await handle.queryPermission(o) === 'granted') return true;
    return await handle.requestPermission(o) === 'granted';
  }

  async function pickDir(mode = 'readwrite', force = false) {
    if (!window.showDirectoryPicker) throw new Error('This browser cannot write to folders — captures will download instead. Use Chrome or Edge for folder mode.');
    if (!force) {
      const saved = await IDB.get('dir');
      if (saved && await grant(saved, mode)) { S.dir = saved; return S.dir; }
    }
    S.dir = await window.showDirectoryPicker({ id: 'claude-capture', mode, startIn: 'documents' });
    await IDB.set('dir', S.dir);
    return S.dir;
  }

  function buildMarkdown(id, title, desc, p) {
    const f = fence(p.html);
    return `---
id: ${q(id)}
title: ${q(title || '')}
url: ${q(p.url)}
selector: ${q(p.selector)}
captured_at: ${q(p.at.toISOString())}
image: ${q(p.blob ? './' + id + '.png' : '')}
viewport: ${q(window.innerWidth + 'x' + window.innerHeight)}
region: ${q(Math.round(p.rect.width) + 'x' + Math.round(p.rect.height))}
page_title: ${q(document.title)}
---

# ${title || 'Capture ' + id}

${p.blob ? `![capture](./${id}.png)\n` : '_No screenshot._\n'}
## Description

${desc}

## Source

- URL: ${p.url}
- Selector: \`${p.selector}\`

## Ancestors

\`\`\`
${p.ancestors}
\`\`\`

## HTML

${f}html
${p.html}
${f}
`;
  }

  async function saveCapture(title, desc) {
    const p = S.pending;
    if (!S.dir && window.showDirectoryPicker) { try { await pickDir(); } catch (_) { } }

    const base = siteName();
    const id = `${base}-${await nextIndex(base)}`;
    const md = buildMarkdown(id, title, desc, p);

    if (S.dir) {
      await writeFile(S.dir, id + '.md', new Blob([md], { type: 'text/markdown' }));
      if (p.blob) await writeFile(S.dir, id + '.png', p.blob);
      S.shots.push({ id });
      return `Saved ${id}.md to ${S.dir.name}`;
    }
    download(id + '.md', new Blob([md], { type: 'text/markdown' }));
    if (p.blob) download(id + '.png', p.blob);
    return `Downloaded ${id}.md`;
  }

  async function writeFile(dir, name, blob) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob); await w.close();
  }

  function download(name, blob) {
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
  }

  /* ============================================================
     6. GitHub mode
     ============================================================ */
  const GH = {
    title: () => document.querySelector('input[name="issue[title]"],#issue-title,input[aria-label*="Title" i],input[placeholder*="Title" i]'),
    body: () => document.querySelector('textarea[name="issue[body]"],#issue-body,textarea[aria-label*="description" i],textarea[placeholder*="description" i],textarea[class*="Markdown" i]'),
    isForm: () => /\/issues\/new/.test(location.pathname) || (!!GH.title() && !!GH.body())
  };

  /* GitHub accepts both drop and paste. Firing both uploads the file twice,
     so try drop, watch the body for the upload placeholder, and only then paste. */
  function bodyChanged(node, before, ms = 1200) {
    return new Promise(res => {
      const t0 = Date.now();
      const tick = () => {
        if (node.value !== before) return res(true);
        if (Date.now() - t0 > ms) return res(false);
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  async function attachImage(file, node) {
    const PH = '<!-- image goes here -->';
    const dt = () => { const d = new DataTransfer(); d.items.add(file); return d; };
    const before = node.value;
    const i = node.value.indexOf(PH);
    node.focus();
    if (i >= 0) node.setSelectionRange(i, i + PH.length);

    const zone = node.closest('file-attachment') || document.querySelector('file-attachment');
    if (zone) {
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt(), bubbles: true, cancelable: true }));
      if (await bodyChanged(node, before)) return true;
    }
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt(), bubbles: true, cancelable: true }));
    return bodyChanged(node, before);
  }

  function setValue(node, v) {
    const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, v);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function screenGitHub() {
    body.textContent = '';
    if (!GH.isForm()) {
      const repo = el('input', { type: 'text', placeholder: 'owner/repo', value: (location.pathname.match(/^\/([^/]+\/[^/]+)/) || [, ''])[1] });
      body.append(
        el('p', { class: 'help', text: 'Open the new-issue form for the repo you want to file against.' }),
        el('label', { text: 'Repository' }), repo,
        el('div', { class: 'row' },
          el('button', {
            class: 's go', text: 'Open issue form',
            onclick: () => { if (/^[\w.-]+\/[\w.-]+$/.test(repo.value.trim())) location.href = `/${repo.value.trim()}/issues/new`; }
          }))
      );
      drawReel(); return;
    }
    body.append(
      el('button', { class: 'big', onclick: () => listCaptures(true), text: S.dir ? `Folder: ${S.dir.name}` : 'Select capture folder' }),
      el('p', { class: 'help', text: S.dir ? 'Click to pick a different folder.' : 'Select folder with claude session — then pick a capture to fill this issue.' })
    );
    drawReel();
  }

  async function listCaptures(force = false) {
    body.textContent = '';
    const err = el('p', { class: 'err' });
    try {
      await pickDir('readwrite', force);
      const files = [];
      for await (const [name, h] of S.dir.entries()) if (name.endsWith('.md') && h.kind === 'file') files.push(name);
      files.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      if (!files.length) throw new Error('No .md captures in that folder.');
      const list = el('div', { class: 'list' });
      for (const name of files) {
        const text = await (await (await S.dir.getFileHandle(name)).getFile()).text();
        const cap = parseCapture(text);
        const num = (name.match(/-(\d+)\.md$/) || [, ''])[1];
        const label = cap.fm.title && num ? `#${num} · ${cap.fm.title}` : cap.fm.title || name.replace(/\.md$/, '');
        list.append(el('button', {
          class: 'item', onclick: () => fillIssue(cap, name)
        }, label,
          el('span', { text: (cap.description || '').slice(0, 90) })));
      }
      body.append(el('p', { class: 'help', text: `${files.length} captures in ${S.dir.name}` }), list,
        el('div', { class: 'row' }, el('button', { class: 's', onclick: screenGitHub, text: 'Back' })));
    } catch (e) {
      err.textContent = e.message || String(e);
      body.append(err, el('div', { class: 'row' }, el('button', { class: 's', onclick: screenGitHub, text: 'Back' })));
    }
    drawReel();
  }

  function parseCapture(text) {
    const fm = {}; const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
    if (m) m[1].split('\n').forEach(line => {
      const i = line.indexOf(':'); if (i < 1) return;
      let v = line.slice(i + 1).trim(); try { v = JSON.parse(v); } catch (_) { }
      fm[line.slice(0, i).trim()] = v;
    });
    const rest = m ? text.slice(m[0].length) : text;
    const grab = re => (rest.match(re) || [, ''])[1].trim();
    return {
      fm,
      description: grab(/## Description\n+([\s\S]*?)(?=\n## |$)/),
      html: grab(/## HTML\n+`{3,}html\n([\s\S]*?)\n`{3,}/)
    };
  }

  async function fillIssue(cap, name) {
    const t = GH.title(), b = GH.body();
    if (!t || !b) { body.prepend(el('p', { class: 'err', text: 'Could not find the title/body fields on this page.' })); return; }
    setValue(t, cap.fm.title || name.replace(/\.md$/, ''));
    const f = fence(cap.html);
    setValue(b, `${cap.description}

<!-- image goes here -->

---

**Source:** ${cap.fm.url || '—'}
**Element:** \`${cap.fm.selector || '—'}\`
**Captured:** ${cap.fm.captured_at || '—'}

<details><summary>Captured HTML</summary>

${f}html
${cap.html}
${f}

</details>
`);

    // image: try synthetic paste/drop, and always offer clipboard as the reliable path
    let file = null;
    const png = (cap.fm.image || '').replace(/^\.\//, '');
    if (png) {
      try { file = await (await S.dir.getFileHandle(png)).getFile(); } catch (_) { }
    }
    body.textContent = '';
    body.append(el('p', { class: 'help', text: `Filled from ${name}.` }));
    if (file) {
      let ok = false;
      try { ok = await attachImage(file, b); } catch (_) { }
      body.append(
        el('p', { class: ok ? 'help' : 'warn', text: ok
          ? 'Image uploading — GitHub replaces the placeholder when it finishes.'
          : 'GitHub did not take the image. Copy it and paste into the body.' }),
        ok ? null : el('div', { class: 'row' },
          el('button', {
            class: 's go', text: 'Copy image',
            onclick: async (e) => {
              try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': file })]);
                e.target.textContent = 'Copied — paste in body';
              } catch (_) { e.target.textContent = 'Copy blocked'; }
            }
          }))
      );
    }
    body.append(el('div', { class: 'row' }, el('button', { class: 's', onclick: listCaptures, text: 'Pick another' })));
    drawReel();
  }

  /* ---------- boot ---------- */
  render();
})();
