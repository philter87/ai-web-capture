/* ============================================================
   Page Capture — bookmarklet source
   Self-contained. No external requests, no libraries.
   Chromium (Chrome/Edge) for folder writing.
   ============================================================ */
(() => {
  'use strict';

  const KEY = '__pageCapture_v1';
  const DONE = 'submitted';   // subfolder captures move to once they are filed
  const MAX_HTML = 20000;     // cap captured markup so a huge element doesn't burn tokens for nothing
  if (window[KEY]) { window[KEY].wake(); return; }

  /* ---------- session state ---------- */
  const S = {
    dir: null,          // FileSystemDirectoryHandle
    count: 0,
    shots: [],          // {n, name}
    mode: 'idle',
    pending: null,      // {blob, url, html, selector, rect}
    onGitHub: /(^|\.)github\.com$/.test(location.hostname)
  };
  window[KEY] = { wake, state: S, snap: shootDOM };

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
  /* body.append() would stringify a null into the panel; el() drops it,
     so screens use this to keep conditional rows optional. */
  const put = (...kids) => kids.flat().forEach(k => k && body.append(k));
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const slug = s => (s || '').toLowerCase().normalize('NFKD')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'capture';
  const q = s => JSON.stringify(String(s ?? ''));           // safe YAML scalar
  const fence = s => { const m = String(s).match(/`{3,}/g); return '`'.repeat(m ? Math.max(...m.map(x => x.length)) + 1 : 3); };
  const capHTML = html => html.length <= MAX_HTML ? html
    : html.slice(0, MAX_HTML) + `\n<!-- truncated: ${(html.length / 1024).toFixed(1)} kB total, kept first ${MAX_HTML / 1000}k chars -->`;

  /* platform.docwise.dk -> docwise ; example.co.uk -> example ; localhost -> localhost */
  const SLD = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'sch', 'gob', 'nom', 'firm']);
  function siteName(host = location.hostname) {
    const h = host.replace(/^www\./, '');
    if (!h.includes('.') || /^[\d.]+$/.test(h)) return slug(h.replace(/\./g, '-'));
    const p = h.split('.');
    let i = p.length - 2;
    if (p.length >= 3 && SLD.has(p[i])) i = p.length - 3;
    return slug(p[i]);
  }

  const siteOf = url => { try { return siteName(new URL(url).hostname); } catch (_) { return ''; } };

  const rememberRepo = (site, repo) => { if (site && repo) IDB.set('repo:' + site, repo); };
  const recallRepo = site => site ? IDB.get('repo:' + site) : Promise.resolve(null);

  const claudePrompt = folder => `Read capture files located in ${folder}. Each describes an issue — fix it and delete the capture (.md and .png) when done.`;

  /* next free number for this site: 1, 2, 3 … reads the folder so it survives reloads */
  async function nextIndex(base) {
    const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)\\.');
    if (S.dir) {
      let max = 0;
      const scan = async dir => {
        for await (const name of dir.keys()) {
          const m = name.match(re);
          if (m) max = Math.max(max, +m[1]);
        }
      };
      await scan(S.dir);
      try { await scan(await S.dir.getDirectoryHandle(DONE)); } catch (_) { }   // submitted ones still count
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
    .help{font-size:10px;color:#7c8792;margin-top:6px;letter-spacing:.02em}
    .divider{margin-top:16px;padding-top:12px;border-top:1px solid #262c33;font-size:10px;
      color:#7c8792;letter-spacing:.02em}
    .link{background:none;border:0;padding:4px 1px 0;color:#7c8792;font-size:10px;cursor:pointer;
      letter-spacing:.02em;text-decoration:underline}
    .link:hover{color:#cdd4da}
    .done{font-size:14px;color:#e6e9ec;font-weight:600;letter-spacing:.01em}
    .done i{color:#ffb020;font-style:normal;margin-right:6px}
    .next{display:block;width:100%;text-align:left;margin-top:8px;padding:10px 11px;cursor:pointer;
      border:1px solid #333b43;border-radius:6px;background:#1d232a;color:#cdd4da;font-size:11px}
    .next:hover{background:#252c34;border-color:#3a434c}
    .next.go{background:#ffb020;border-color:#ffb020}
    .next.go:hover{background:#ffc247;border-color:#ffc247}
    .next.go b{color:#14181d}
    .next.go span{color:rgba(20,24,29,.7)}
    .next b{display:block;color:#e6e9ec;font-weight:600;font-size:11.5px;margin-bottom:3px;
      letter-spacing:.02em;word-break:break-word}
    .next span{display:block;color:#7c8792;font-size:10px;line-height:1.4}
    .meta{font-size:10px;color:#7c8792;margin-top:7px;word-break:break-all}
    .warn{font-size:10px;color:#ffb020;margin-top:7px}
    .err{font-size:11px;color:#ff8a70;margin-top:8px}
    .list{max-height:210px;overflow:auto;border:1px solid #2a3138;border-radius:6px}
    .item{display:flex;align-items:center;gap:7px;padding:6px 8px;background:#0f1216;
      border-bottom:1px solid #1e242a}
    .item:hover{background:#1a2027}
    .item input{width:auto;height:13px;flex:0 0 auto;accent-color:#ffb020;margin:0;cursor:pointer}
    .lbl{flex:1;min-width:0;padding:2px 0;text-align:left;background:none;border:0;
      color:#cdd4da;font-size:11px;cursor:pointer;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .lbl span{display:block;color:#6f7a85;font-size:10px;margin-top:2px;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .del{flex:0 0 auto;background:none;border:0;color:#5f6a75;cursor:pointer;font-size:11px;padding:0 3px}
    .del:hover,.del.arm{color:#ff8a70}
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
    put(
      el('button', { class: 'big', onclick: startPick, text: 'Click here to capture' }),
      el('p', { class: 'help', text: 'Pick an element, then write a description. ↑↓ widens or narrows the selection, Esc cancels.' })
    );
    drawReel();
  }

  /* Straight after a save: what landed where, and the three things worth
     doing next. Claude cannot be talked to from here, so that option
     hands over a prompt to paste; GitHub needs the bookmarklet clicked
     again on the issue form, so that one just opens the tab. */
  async function screenSaved() {
    S.mode = 'saved';
    body.textContent = '';
    const n = S.count;
    const many = n === 1 ? 'capture' : 'captures';

    const another = el('button', { class: 'next go', onclick: startPick },
      el('b', { text: 'Capture another element' }),
      el('span', { text: 'Pick another element on this page.' }));

    const claudeOption = () => {
      const note = el('span', { text: 'Click to copy a prompt.' });
      return el('button', { class: 'next', onclick: async () => {
        try {
          await navigator.clipboard.writeText(claudePrompt(S.dir.name));
          note.textContent = 'Copied — paste it into your Claude session.';
        } catch (_) {
          note.textContent = `Could not copy — point Claude at the ${S.dir.name} folder yourself.`;
        }
      } },
        el('b', { text: 'Tell Claude to fix it' }), note);
    };

    put(
      el('p', { class: 'done' }, el('i', { text: '✓' }), 'Capture saved'),
      el('p', { class: 'help', text: S.dir
        ? `${n} ${many} saved to folder ${S.dir.name}`
        : `${n} ${many} downloaded — no folder mounted, so they went to your Downloads.` }),
      another,
      el('p', { class: 'divider', text: 'Done capturing? Wrap up with one of these:' }),
      S.dir ? claudeOption() : null,
      githubOption(await recallRepo(siteName()).catch(() => null))
    );
    drawReel();
  }

  /* The repo to file against is asked for once and remembered per site,
     so the second time it is a single click. */
  function githubOption(repo) {
    const site = siteName();
    const wrap = el('div');
    const open = r => window.open(`https://github.com/${r}/issues/new`, '_blank', 'noopener');

    const ask = current => {
      wrap.textContent = '';
      const input = el('input', { type: 'text', placeholder: 'owner/repo', value: current || '' });
      const err = el('p', { class: 'err' });
      const go = el('button', { class: 's go', text: 'Open issue form' });
      go.onclick = () => {
        const r = input.value.trim();
        if (!/^[\w.-]+\/[\w.-]+$/.test(r)) { err.textContent = 'Enter it as owner/repo.'; return; }
        rememberRepo(site, r);
        open(r);                                   // synchronous, so the gesture still counts
        card(r);
      };
      input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } };
      wrap.append(
        el('label', { text: 'Repository' }), input, err,
        el('div', { class: 'row' },
          el('button', { class: 's', onclick: () => card(current), text: 'Back' }), go));
      input.focus();
    };

    const card = r => {
      wrap.textContent = '';
      wrap.append(el('button', { class: 'next', onclick: () => r ? open(r) : ask('') },
        el('b', { text: r ? `Go to ${r} and click the bookmarklet again` : 'Go to GitHub and click the bookmarklet again' }),
        el('span', { text: r
          ? 'Opens its new-issue form — the panel fills it in from these captures, images and all.'
          : 'Asks which repository, then opens its new-issue form.' })));
      if (r) wrap.append(el('button', { class: 'link', onclick: () => ask(r), text: 'File against a different repository' }));
    };

    card(repo || '');
    return wrap;
  }

  function screenPreview() {
    S.mode = 'preview';
    body.textContent = '';
    const img = el('img', { class: 'shot', alt: 'Captured region' });
    if (S.pending.blob) img.src = URL.createObjectURL(S.pending.blob);
    put(
      S.pending.blob ? img
        : el('p', { class: 'warn', text: 'No image — this page blocks in-page rendering. The HTML will still be saved.' }),
      el('p', { class: 'meta', text: `${S.pending.selector}  ·  ${Math.round(S.pending.rect.width)}×${Math.round(S.pending.rect.height)}  ·  ${(S.pending.html.length / 1024).toFixed(1)} kB html` }),
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
        await screenSaved();
      } catch (e) {
        err.textContent = e.message || String(e);
        save.disabled = false; save.textContent = 'Save';
      }
    };

    put(
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
     4. Screenshots
        DOM snapshot: clone the picked subtree with its computed styles
        and rasterise it through <svg><foreignObject>. No permission
        prompt, and parts scrolled out of view still land in the image.
        Cannot see into iframes, and cross-origin images without CORS
        headers come out blank.
     ============================================================ */

  /* ---------- 4a. the clone ---------- */

  /* Properties a child inherits: those must be re-stated whenever they
     differ from the parent, even if they match the UA default. */
  const INHERITED = new Set(`border-collapse border-spacing caption-side color direction empty-cells font
    font-family font-feature-settings font-kerning font-optical-sizing font-size font-stretch font-style
    font-variant font-variant-caps font-variant-east-asian font-variant-ligatures font-variant-numeric
    font-variation-settings font-weight hyphens letter-spacing line-height list-style list-style-image
    list-style-position list-style-type orphans overflow-wrap paint-order quotes tab-size text-align
    text-align-last text-decoration-color text-indent text-rendering text-shadow text-transform
    text-underline-offset text-underline-position visibility white-space widows word-break word-spacing
    writing-mode -webkit-font-smoothing -webkit-text-size-adjust -webkit-text-stroke-color
    -webkit-text-stroke-width`.split(/\s+/));

  /* Interaction-only or time-based properties: never affect a still frame. */
  const SKIP = new Set(`contain content-visibility cursor pointer-events resize touch-action user-select
    will-change view-transition-name -webkit-locale -webkit-tap-highlight-color -webkit-user-drag
    -webkit-user-select`.split(/\s+/));
  const SKIP_RE = /^(-webkit-)?(animation|transition)|^(scroll|overscroll|view-transition)-/;

  /* Displays where an explicit width/height would be ignored or harmful.
     Note inline-block / inline-flex are pinnable — only bare `inline` is not. */
  const NO_PIN = /^(inline|contents|none|ruby)$|^table-(row|column|caption|header|footer)/;
  const DEAD = new Set(['SCRIPT', 'NOSCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE']);
  const SVG_PROPS = ('fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin ' +
    'stroke-dasharray stroke-dashoffset stroke-opacity opacity color display visibility font-family ' +
    'font-size font-weight text-anchor').split(' ');

  /* UA defaults per tag, read from a blank same-origin iframe. Anything a
     node shares with its bare default does not need to be written out —
     that is what keeps the serialised clone small enough to rasterise. */
  const baseCache = new Map();
  let probeDoc;
  function baseStyle(tag) {
    if (baseCache.has(tag)) return baseCache.get(tag);
    let map = null;
    try {
      if (probeDoc === undefined) {
        const f = document.createElement('iframe');
        f.setAttribute('aria-hidden', 'true');
        f.setAttribute('style', 'position:fixed;left:-9999px;top:0;width:800px;height:600px;border:0;opacity:0');
        document.body.appendChild(f);
        probeDoc = f.contentDocument || null;
      }
      if (probeDoc) {
        const n = probeDoc.createElement(tag);
        probeDoc.body.appendChild(n);
        const cs = probeDoc.defaultView.getComputedStyle(n);
        map = new Map();
        for (const p of cs) map.set(p, cs.getPropertyValue(p));
        n.remove();
      }
    } catch (_) { map = null; }
    baseCache.set(tag, map);
    return map;
  }

  /* Fetch-and-inline, memoised. Anything the SVG references by URL is
     dropped by the rasteriser, so every asset has to travel as data. */
  const resCache = new Map();
  function dataURL(url) {
    if (!url) return Promise.resolve(null);
    if (/^data:/.test(url)) return Promise.resolve(url);
    if (resCache.has(url)) return resCache.get(url);
    const p = (async () => {
      const r = await fetch(url, { cache: 'force-cache' });
      if (!r.ok) return null;
      const b = await r.blob();
      if (b.size > 4e6) return null;
      return new Promise(res => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res(null);
        fr.readAsDataURL(b);
      });
    })().catch(() => null);
    resCache.set(url, p);
    return p;
  }

  async function inlineURLs(value) {
    const urls = [...value.matchAll(/url\((["']?)([^"')]+)\1\)/g)];
    if (!urls.length) return null;
    const map = new Map();
    await Promise.all(urls.map(async m => map.set(m[2], await dataURL(m[2]))));
    let out = value, any = false;
    for (const [raw, data] of map) {
      if (!data) continue;
      any = true;
      out = out.split(raw).join(data);
    }
    return any ? out : null;
  }

  function applyProps(dest, cs, parentCS, tag, ctx) {
    const base = baseStyle(tag);
    const st = dest.style;
    for (const prop of cs) {
      if (SKIP.has(prop) || SKIP_RE.test(prop)) continue;
      const v = cs.getPropertyValue(prop);
      if (v === '') continue;
      if (base && base.get(prop) === v &&
        !(parentCS && INHERITED.has(prop) && parentCS.getPropertyValue(prop) !== v)) continue;
      try { st.setProperty(prop, v); } catch (_) { }
    }
    st.setProperty('animation', 'none');
    st.setProperty('transition', 'none');
    if (cs.position === 'fixed') st.setProperty('position', 'absolute');
    /* The rasteriser draws classic scrollbars where the page had overlay
       ones; we place scrolled content by hand, so clip instead. */
    if (/auto|scroll/.test(cs.overflowX)) st.setProperty('overflow-x', 'hidden');
    if (/auto|scroll/.test(cs.overflowY)) st.setProperty('overflow-y', 'hidden');
    /* Pin the box so layout stays put even if a font falls back. Computed
       width/height are expressed in the element's own box-sizing basis
       (border-box for a UA-styled <button>), so carry that over with it. */
    if (!NO_PIN.test(cs.display) && cs.width.endsWith('px') && cs.height.endsWith('px')) {
      st.setProperty('width', cs.width);
      st.setProperty('height', cs.height);
      st.setProperty('box-sizing', cs.boxSizing);
    }
    for (const f of (cs.fontFamily || '').split(','))
      ctx.fams.add(f.trim().replace(/^["']|["']$/g, '').toLowerCase());
  }

  /* ::marker only takes styling from a rule, so hand one to the SVG. */
  function marker(src, out, cs, ctx) {
    if (!cs.display.includes('list-item')) return;
    let ms;
    try { ms = getComputedStyle(src, '::marker'); } catch (_) { return; }
    if (!ms || (ms.color === cs.color && ms.fontSize === cs.fontSize)) return;
    const cls = '__m' + (ctx.rules.length);
    out.classList.add(cls);
    ctx.rules.push(`.${cls}::marker{color:${ms.color};font-size:${ms.fontSize};` +
      `font-weight:${ms.fontWeight};font-family:${ms.fontFamily}}`);
  }

  /* ::before / ::after do not survive cloneNode — re-create them as spans. */
  function pseudo(src, out, cs, ctx) {
    for (const which of ['::before', '::after']) {
      let ps;
      try { ps = getComputedStyle(src, which); } catch (_) { continue; }
      const c = ps.content;
      if (!c || c === 'none' || c === 'normal' || ps.display === 'none') continue;
      const span = document.createElement('span');
      applyProps(span, ps, cs, 'span', ctx);
      span.style.setProperty('content', 'normal');
      const u = c.match(/url\((["']?)([^"')]+)\1\)/);
      if (u) {
        const img = document.createElement('img');
        ctx.tasks.push(dataURL(u[2]).then(d => d && img.setAttribute('src', d)));
        span.appendChild(img);
      } else {
        const m = c.match(/^"([\s\S]*)"$/) || c.match(/^'([\s\S]*)'$/);
        span.textContent = (m ? m[1] : '')
          .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
      }
      which === '::before' ? out.insertBefore(span, out.firstChild) : out.appendChild(span);
    }
  }

  /* Inline SVG: keep the markup verbatim, carry over only what paints. */
  function cloneSVG(src) {
    const out = src.cloneNode(true);
    const from = [src, ...src.querySelectorAll('*')];
    const to = [out, ...out.querySelectorAll('*')];
    for (let i = 0; i < from.length && i < to.length; i++) {
      const cs = getComputedStyle(from[i]);
      for (const p of SVG_PROPS) {
        const v = cs.getPropertyValue(p);
        if (v) to[i].style.setProperty(p, v);
      }
    }
    return out;
  }

  function frameOf(video) {
    const c = el('canvas');
    c.width = video.videoWidth || video.clientWidth;
    c.height = video.videoHeight || video.clientHeight;
    if (!c.width || !c.height) return null;
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL();
  }

  /* A scrolled container renders from the top in the clone; nudge its
     static children back by the scroll offset so the same slice shows. */
  function shiftScroll(out, x, y) {
    if (!out.style.position || out.style.position === 'static') out.style.setProperty('position', 'relative');
    for (const c of out.children) {
      if (c.style.position && c.style.position !== 'static') continue;
      c.style.setProperty('position', 'relative');
      c.style.setProperty('left', -x + 'px');
      c.style.setProperty('top', -y + 'px');
    }
  }

  function cloneTree(src, parentCS, isRoot, ctx) {
    if (src.nodeType === 3) return document.createTextNode(src.nodeValue);
    if (src.nodeType !== 1 || DEAD.has(src.tagName) || src === host) return null;

    const cs = getComputedStyle(src);
    if (!isRoot && cs.display === 'none') return null;
    const tag = src.tagName.toLowerCase();

    if (src instanceof SVGSVGElement) {
      const out = cloneSVG(src);
      for (const p of ['width', 'height', 'display', 'vertical-align', 'overflow', 'opacity',
        'margin-top', 'margin-right', 'margin-bottom', 'margin-left'])
        out.style.setProperty(p, cs.getPropertyValue(p));
      return out;
    }
    if (src instanceof SVGElement) return null;

    if (tag === 'slot') {                        // render what the slot projects
      const holder = document.createElement('span');
      holder.style.setProperty('display', 'contents');
      for (const n of (src.assignedNodes ? src.assignedNodes({ flatten: true }) : [])) {
        const c = cloneTree(n, parentCS, false, ctx);
        if (c) holder.appendChild(c);
      }
      return holder;
    }

    let out, leaf = false;
    if (tag === 'iframe' || tag === 'object' || tag === 'embed' || tag === 'frame') {
      out = document.createElement('div');       // keep the box, drop the content
      leaf = true;
    } else if (tag === 'canvas' || tag === 'video') {
      out = document.createElement('img');
      leaf = true;
      let u = null;
      try { u = tag === 'canvas' ? src.toDataURL() : frameOf(src); } catch (_) { u = null; }
      if (u) out.setAttribute('src', u);
      out.style.setProperty('object-fit', cs.objectFit || 'contain');
    } else {
      out = src.cloneNode(false);
      leaf = tag === 'img' || tag === 'br' || tag === 'hr' || tag === 'input';
    }

    applyProps(out, cs, parentCS, out.tagName.toLowerCase(), ctx);

    if (tag === 'img') {
      const url = src.currentSrc || src.src;
      out.removeAttribute('srcset');
      out.removeAttribute('sizes');
      out.removeAttribute('loading');
      out.removeAttribute('src');
      ctx.tasks.push(dataURL(url).then(d => d && out.setAttribute('src', d)));
    } else if (tag === 'input') {
      out.setAttribute('value', src.value);
      src.checked ? out.setAttribute('checked', '') : out.removeAttribute('checked');
    } else if (tag === 'textarea') {
      out.textContent = src.value;
      leaf = true;
    } else if (tag === 'option' && src.selected) {
      out.setAttribute('selected', '');
    }

    const bg = cs.backgroundImage;
    if (bg && bg !== 'none' && bg.includes('url('))
      ctx.tasks.push(inlineURLs(bg).then(v => v && out.style.setProperty('background-image', v)));

    if (!leaf) {
      for (const kid of (src.shadowRoot || src).childNodes) {
        const c = cloneTree(kid, cs, false, ctx);
        if (c) out.appendChild(c);
      }
      pseudo(src, out, cs, ctx);
      marker(src, out, cs, ctx);
      if (src.scrollTop || src.scrollLeft) shiftScroll(out, src.scrollLeft, src.scrollTop);
    }
    return out;
  }

  /* Only the @font-face rules the subtree actually uses, with the file
     inlined — SVG-as-image will not fetch a font over the network. */
  async function faceCSS(fams) {
    const jobs = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (_) { continue; }   // cross-origin sheet
      for (const r of rules) {
        if (r.type !== 5) continue;
        const fam = (r.style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim().toLowerCase();
        if (fams.has(fam)) jobs.push(face(r, sheet.href));
      }
    }
    if (!jobs.length) return '';
    const out = (await Promise.all(jobs)).filter(Boolean).join('\n');
    return out.length > 8e6 ? '' : out;
  }

  async function face(rule, href) {
    const src = rule.style.getPropertyValue('src') || '';
    const urls = [...src.matchAll(/url\((["']?)([^"')]+)\1\)/g)].map(m => m[2]);
    if (!urls.length) return null;
    const pick = urls.find(u => /\.woff2($|[?#])/i.test(u)) || urls.find(u => /\.woff($|[?#])/i.test(u)) || urls[0];
    let abs;
    try { abs = new URL(pick, href || location.href).href; } catch (_) { return null; }
    const d = await dataURL(abs);
    return d ? rule.cssText.replace(/src\s*:[^;}]*/i, 'src:url(' + d + ')') : null;
  }

  function bgOf(node) {
    for (let n = node.parentElement; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const parts = m[1].split(',').map(Number);
      if (parts.length < 4 || parts[3] > 0.05) return c;
    }
    return '#fff';
  }

  function rasterize(node, w, h, css) {
    const scale = Math.min(2, window.devicePixelRatio || 1);
    let xml;
    try { xml = new XMLSerializer().serializeToString(node); } catch (_) { return Promise.resolve(null); }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" ` +
      `height="${Math.round(h * scale)}" viewBox="0 0 ${w} ${h}">` +
      (css ? `<style><![CDATA[${css}]]></style>` : '') +
      `<foreignObject x="0" y="0" width="${w}" height="${h}">${xml}</foreignObject></svg>`;

    return new Promise(res => {
      const img = new Image();
      let retried = false, timer;
      const done = v => { clearTimeout(timer); res(v || null); };
      img.onload = () => {
        try {
          const c = el('canvas');
          c.width = Math.round(w * scale);
          c.height = Math.round(h * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(done, 'image/png');
        } catch (_) { done(null); }
      };
      /* A data: URL is the CSP-friendliest carrier; fall back to blob: if
         the page forbids it or the payload is too big for one URL. */
      img.onerror = () => {
        if (retried) return done(null);
        retried = true;
        try { img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); }
        catch (_) { done(null); }
      };
      timer = setTimeout(() => done(null), 12000);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  async function shootDOM(node, rect) {
    const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    if (w * h > 4e7) return null;
    const ctx = { tasks: [], fams: new Set(), rules: [] };
    const cs = getComputedStyle(node);
    const parentCS = node.parentElement ? getComputedStyle(node.parentElement) : null;
    const clone = cloneTree(node, parentCS, true, ctx);
    if (!clone) return null;

    const st = clone.style;
    st.setProperty('margin', '0');
    st.setProperty('position', 'static');
    st.setProperty('float', 'none');
    st.setProperty('transform', 'none');
    st.setProperty('max-width', 'none');
    st.setProperty('max-height', 'none');
    st.setProperty('min-width', '0');
    st.setProperty('min-height', '0');
    st.setProperty('width', w + 'px');
    st.setProperty('height', h + 'px');
    st.setProperty('box-sizing', 'border-box');
    if (cs.display === 'inline') st.setProperty('display', 'inline-block');

    const wrap = document.createElement('div');
    wrap.setAttribute('style',
      `width:${w}px;height:${h}px;overflow:hidden;background:${bgOf(node)};box-sizing:border-box`);
    wrap.appendChild(clone);

    let css = ctx.rules.join('');
    try {
      await Promise.all(ctx.tasks);
      css = await faceCSS(ctx.fams) + css;
    } catch (_) { }
    return rasterize(wrap, w, h, css);
  }

  /* ---------- 4b. entry point ---------- */
  async function capture(node) {
    node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    await new Promise(r => setTimeout(r, 120));
    const rect = node.getBoundingClientRect();
    let blob = null;
    try { blob = await shootDOM(node, rect); } catch (_) { blob = null; }

    S.pending = {
      blob, rect,
      url: location.href,
      html: capHTML(node.outerHTML),
      selector: selectorOf(node)
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

  /* ============================================================
     5. Storage
     ============================================================ */
  const IDB = {
    open: () => new Promise((res, rej) => {
      const r = indexedDB.open('__pageCapture', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }),
    /* Remembering things is a convenience — never let it break a capture. */
    async set(k, v) {
      try { (await this.open()).transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch (_) { }
    },
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

  /* Only what a reader — human or agent — actually needs: the image name
     comes from the .md name, so it never has to be written down. */
  function buildMarkdown(id, title, desc, p) {
    const f = fence(p.html);
    return `---
title: ${q(title || '')}
url: ${q(p.url)}
selector: ${q(p.selector)}
viewport: ${q(window.innerWidth + 'x' + window.innerHeight)}
---

${p.blob ? `![capture](./${id}.png)\n` : '_No screenshot._\n'}
## Description

${desc}

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

  /* Move a capture and its image into the submitted/ subfolder so the
     folder only ever shows what still needs filing. */
  async function archive(md, png) {
    if (!S.dir) return false;
    try {
      const done = await S.dir.getDirectoryHandle(DONE, { create: true });
      for (const name of [md, png].filter(Boolean)) {
        let fh;
        try { fh = await S.dir.getFileHandle(name); } catch (_) { continue; }
        if (fh.move) { await fh.move(done, name); continue; }   // Chrome 111+
        await writeFile(done, name, await fh.getFile());
        await S.dir.removeEntry(name);
      }
      return true;
    } catch (_) { return false; }
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
      put(
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
    put(
      el('button', { class: 'big', onclick: useLatest, text: 'Fill from newest capture' }),
      el('div', { class: 'row' }, el('button', { class: 's', onclick: listCaptures, text: 'Choose from list…' })),
      el('p', { class: 'help', text: `Select folder with claude session. Once the issue is created the capture moves to ${DONE}/, so the list only shows what is still unfiled.` })
    );
    drawReel();
  }

  /* Shared folder reads for both the list and the one-click path. */
  async function mdFiles() {
    const files = [];
    for await (const [name, h] of S.dir.entries())
      if (h.kind === 'file' && name.endsWith('.md')) files.push(name);
    return files.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }

  /* What to call a capture: its title, else its first line of description. */
  function headingOf(cap, name) {
    return cap.fm.title ||
      (cap.description || '').split('\n').find(l => l.trim())?.trim().slice(0, 90) ||
      name.replace(/\.md$/, '');
  }

  /* A capture's image always sits beside it under the same name. */
  const pngOf = name => name.replace(/\.md$/, '.png');

  async function readCapture(name) {
    return parseCapture(await (await (await S.dir.getFileHandle(name)).getFile()).text());
  }

  function failed(e) {
    body.textContent = '';
    put(el('p', { class: 'err', text: e.message || String(e) }),
      el('div', { class: 'row' }, el('button', { class: 's', onclick: screenGitHub, text: 'Back' })));
    drawReel();
  }

  async function useLatest() {
    body.textContent = '';
    try {
      await pickDir('readwrite');
      const files = await mdFiles();
      if (!files.length) throw new Error(`No unfiled captures in that folder — check ${DONE}/.`);
      await fillIssue([{ cap: await readCapture(files[0]), name: files[0] }]);
    } catch (e) { failed(e); }
  }

  async function listCaptures() {
    body.textContent = '';
    try {
      await pickDir('readwrite');
      const files = await mdFiles();
      if (!files.length) throw new Error(`No unfiled captures in that folder — check ${DONE}/.`);

      const picked = new Map();                 // name -> cap, in the order ticked
      const count = el('p', { class: 'help' });
      const list = el('div', { class: 'list' });
      const fileBtn = el('button', { class: 's go' });
      let left = files.length;

      const sync = () => {
        count.textContent = `${left} unfiled in ${S.dir.name}` +
          (picked.size ? ` · ${picked.size} selected` : '');
        fileBtn.disabled = !picked.size;
        fileBtn.textContent = picked.size > 1 ? `File ${picked.size} as one issue` : 'File selected';
      };
      fileBtn.onclick = () => fillIssue([...picked].map(([name, cap]) => ({ cap, name })));

      for (const name of files) {
        const cap = await readCapture(name);
        const num = (name.match(/-(\d+)\.md$/) || [, ''])[1];
        const label = num ? `#${num} · ${headingOf(cap, name)}` : headingOf(cap, name);

        const box = el('input', { type: 'checkbox', title: 'Select for a combined issue' });
        box.onchange = () => { box.checked ? picked.set(name, cap) : picked.delete(name); sync(); };

        const row = el('div', { class: 'item' }, box,
          el('button', { class: 'lbl', onclick: () => fillIssue([{ cap, name }]) }, label,
            el('span', { text: (cap.description || '').slice(0, 90) })));

        /* Delete needs a second click to arm — no undo once the file is gone. */
        const rm = el('button', { class: 'del', title: 'Delete this capture', text: '✕' });
        let armed = false;
        rm.onclick = async () => {
          if (!armed) { armed = true; rm.classList.add('arm'); rm.textContent = 'delete?'; return; }
          rm.disabled = true;
          try {
            await S.dir.removeEntry(name);
            try { await S.dir.removeEntry(pngOf(name)); } catch (_) { }
            picked.delete(name); row.remove(); left--; sync();
          } catch (_) { rm.disabled = false; rm.textContent = 'failed'; }
        };
        row.append(rm);
        list.append(row);
      }

      sync();
      put(count, list, el('div', { class: 'row' },
        el('button', { class: 's', onclick: screenGitHub, text: 'Back' }), fileBtn));
    } catch (e) {
      failed(e);
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

  /* ---------- issue text ---------- */
  const PH = '<!-- image goes here -->';                                   // attachImage replaces this

  function issueTitle(items) {
    return items.length > 1
      ? `${items.length} captures from ${siteOf(items[0].cap.fm.url) || 'the app'}`
      : headingOf(items[0].cap, items[0].name);
  }

  function section(cap, name, n, total) {
    const html = cap.html || '';
    let block = '';
    if (html) {
      const f = fence(html);
      block = `\n<details><summary>Captured HTML</summary>\n\n${f}html\n${html}\n${f}\n\n</details>\n`;
    }
    return `${total > 1 ? `## ${n}. ${headingOf(cap, name)}\n\n` : ''}${cap.description}

${PH}

---

**Source:** ${cap.fm.url || '—'}
**Element:** \`${cap.fm.selector || '—'}\`
${block}`;
  }

  function issueBody(items) {
    return items.map((it, i) => section(it.cap, it.name, i + 1, items.length)).join('\n\n');
  }

  async function archiveAll(items) {
    let ok = !!items.length;
    for (const it of items) ok = await archive(it.name, it.png) && ok;
    return ok;
  }

  async function fillIssue(items) {
    const t = GH.title(), b = GH.body();
    if (!t || !b) { body.prepend(el('p', { class: 'err', text: 'Could not find the title/body fields on this page.' })); return; }
    setValue(t, issueTitle(items));
    setValue(b, issueBody(items) + '\n');

    /* Learn owner/repo for the site the capture came from, so the panel
       there can offer it next time. */
    rememberRepo(siteOf(items[0].cap.fm.url),
      (location.pathname.match(/^\/([^/]+\/[^/]+)/) || [, ''])[1]);

    for (const it of items) {
      it.png = pngOf(it.name);
      it.file = null;
      try { it.file = await (await S.dir.getFileHandle(it.png)).getFile(); } catch (_) { }
    }

    body.textContent = '';
    put(el('p', { class: 'help', text: items.length > 1
      ? `Filled from ${items.length} captures.`
      : `Filled from ${items[0].name}.` }));

    /* Each attach consumes the first remaining placeholder, so ordering
       holds as long as we go one at a time — which takes a couple of
       seconds per image, so say so rather than sitting silent. */
    const stuck = [];
    const shots = items.filter(it => it.file);
    let sent = 0;
    const busy = el('p', { class: 'help' });
    if (shots.length) put(busy);
    for (const it of shots) {
      busy.textContent = shots.length > 1
        ? `Attaching image ${sent + stuck.length + 1} of ${shots.length}…`
        : 'Attaching the image…';
      let ok = false;
      try { ok = await attachImage(it.file, b); } catch (_) { }
      ok ? sent++ : stuck.push(it.file);
    }
    busy.remove();
    if (sent) put(el('p', { class: 'help', text: sent > 1
      ? `${sent} images uploading — GitHub swaps in each placeholder as it finishes.`
      : 'Image uploading — GitHub replaces the placeholder when it finishes.' }));
    if (stuck.length) {
      let i = 0;
      const copy = el('button', { class: 's go', text: stuck.length > 1 ? `Copy image 1/${stuck.length}` : 'Copy image' });
      copy.onclick = async () => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': stuck[i] })]);
          copy.textContent = stuck.length > 1 ? `Copied ${i + 1}/${stuck.length} — paste, then click again` : 'Copied — paste in body';
          i = (i + 1) % stuck.length;
        } catch (_) { copy.textContent = 'Copy blocked'; }
      };
      put(
        el('p', { class: 'warn', text: `GitHub did not take ${stuck.length > 1 ? 'every image' : 'the image'}. Copy and paste into the body.` }),
        el('div', { class: 'row' }, copy));
    }

    const mark = el('button', { class: 's go', text: `Move to ${DONE}/` });
    mark.onclick = async () => {
      mark.disabled = true;
      mark.textContent = await archiveAll(items) ? 'Moved ✓' : 'Could not move';
    };
    put(el('div', { class: 'row' },
      el('button', { class: 's', onclick: listCaptures, text: 'Pick another' }), mark));
    watchSubmit(items);
    drawReel();
  }

  /* GitHub creates the issue without a full page load, so the panel is
     still alive to see it — file the capture the moment it lands. */
  let watcher = null;
  function watchSubmit(items) {
    clearInterval(watcher);
    const from = location.pathname;
    let ticks = 0;
    watcher = setInterval(async () => {
      if (++ticks > 600) return clearInterval(watcher);           // give up after 10 min
      const m = location.pathname.match(/\/issues\/(\d+)$/);
      if (!m || location.pathname === from) return;
      clearInterval(watcher);
      if (await archiveAll(items))
        body.prepend(el('p', { class: 'help', text: items.length > 1
          ? `Issue #${m[1]} created — ${items.length} captures moved to ${DONE}/.`
          : `Issue #${m[1]} created — ${items[0].name} moved to ${DONE}/.` }));
    }, 1000);
  }

  /* ---------- boot ---------- */
  render();
})();
