export const W = 760, H = 640, CHROME_H = 80, PAGE_H = H - CHROME_H;

/* ---------- Browser chrome, rendered as real DOM in the stage ---------- */
export function chromeHTML({ tab, url, bookmark = false }) {
  return `
<style>
  .bz-chrome,.bz-chrome *{box-sizing:border-box}
  .bz-chrome{position:absolute;top:0;left:0;width:100%;height:${CHROME_H}px;
    background:#dee1e6;font:12px/1 "Segoe UI",system-ui,sans-serif;color:#3c4043;
    user-select:none;overflow:hidden}
  .bz-tabs{height:32px;display:flex;align-items:flex-end;padding:6px 8px 0;gap:6px}
  .bz-dots{display:flex;gap:6px;align-items:center;padding:0 6px 8px 2px}
  .bz-dot{width:10px;height:10px;border-radius:50%}
  .bz-tab{display:flex;align-items:center;gap:7px;background:#fff;border-radius:8px 8px 0 0;
    height:26px;padding:0 10px;max-width:215px;box-shadow:0 -1px 0 rgba(0,0,0,.04)}
  .bz-tab img,.bz-favi{width:13px;height:13px;border-radius:3px;flex:0 0 auto}
  .bz-tab span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11.5px;color:#3c4043}
  .bz-x{color:#5f6368;font-size:13px;line-height:1}
  .bz-plus{color:#5f6368;font-size:15px;padding:0 6px 8px}
  .bz-bar{height:28px;background:#fff;display:flex;align-items:center;gap:10px;padding:0 10px}
  .bz-nav{display:flex;gap:12px;color:#5f6368;font-size:14px;align-items:center}
  .bz-omni{flex:1;height:22px;background:#f1f3f4;border-radius:11px;display:flex;align-items:center;
    gap:7px;padding:0 10px;font-size:11.5px;color:#202124}
  .bz-omni .bz-lock{color:#5f6368;font-size:10px}
  .bz-icons{display:flex;gap:11px;color:#5f6368;font-size:13px}
  .bz-marks{height:20px;background:#fff;border-top:1px solid #e8eaed;display:flex;align-items:center;
    gap:6px;padding:0 10px;font-size:11px;color:#3c4043}
  .bz-mk{display:flex;align-items:center;gap:5px;padding:2px 7px;border-radius:4px}
  .bz-mk.bz-new{animation:bzpop .45s ease-out both}
  @keyframes bzpop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
  .bz-globe{width:12px;height:12px;border-radius:50%;border:1.4px solid #8a9099;
    background:conic-gradient(#cbd2d9 0 25%,#e8eaed 0 50%,#cbd2d9 0 75%,#e8eaed 0)}
  .bz-apps{color:#5f6368;letter-spacing:1px;font-size:11px}
</style>
<div class="bz-chrome">
  <div class="bz-tabs">
    <div class="bz-dots"><i class="bz-dot" style="background:#ff5f57"></i>
      <i class="bz-dot" style="background:#febc2e"></i><i class="bz-dot" style="background:#28c840"></i></div>
    <div class="bz-tab"><i class="bz-favi" style="background:${tab.color}"></i><span>${tab.title}</span><i class="bz-x">&times;</i></div>
    <div class="bz-plus">+</div>
  </div>
  <div class="bz-bar">
    <div class="bz-nav"><span>&#8592;</span><span>&#8594;</span><span>&#10227;</span></div>
    <div class="bz-omni"><span class="bz-lock">&#128274;</span><span>${url}</span></div>
    <div class="bz-icons"><span>&#9734;</span><span>&#9776;</span></div>
  </div>
  <div class="bz-marks">
    <span class="bz-apps">&#9638;</span>
    <span id="bz-bookmark" class="bz-mk" style="${bookmark ? '' : 'display:none'}">
      <i class="bz-globe"></i>AI Web Capture</span>
  </div>
</div>`;
}

/* ---------- Stage: chrome + iframe + synthetic cursor ---------- */
export function stageHTML({ tab, url, src, bookmark }) {
  return `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#dee1e6}
  #bz-frame{position:absolute;top:${CHROME_H}px;left:0;width:${W}px;height:${PAGE_H}px;border:0;display:block;background:#fff}
  #bz-cursor{position:absolute;top:0;left:0;width:22px;height:22px;z-index:2147483647;
    pointer-events:none;transform:translate(-100px,-100px);will-change:transform;
    filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}
  #bz-ring{position:absolute;top:0;left:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;
    border:2px solid #ffb020;opacity:0;z-index:2147483646;pointer-events:none;will-change:transform,opacity}
  #bz-ring.go{animation:bzring .5s ease-out}
  @keyframes bzring{from{opacity:.9;transform:scale(.3)}to{opacity:0;transform:scale(1.5)}}
  #bz-ghost{position:absolute;z-index:2147483645;pointer-events:none;opacity:0;
    background:#ffb020;color:#14181d;font:600 11px/1 ui-monospace,monospace;letter-spacing:.08em;
    padding:8px 12px;border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.35);will-change:transform}
</style>
${chromeHTML({ tab, url, bookmark })}
<iframe id="bz-frame" src="${src}" allow="clipboard-read *; clipboard-write *"></iframe>
<div id="bz-ring"></div>
<div id="bz-ghost">AI WEB CAPTURE</div>
<svg id="bz-cursor" viewBox="0 0 24 24"><path d="M5 2.5 L5 19 L9.2 15 L11.9 21 L14.6 19.8 L12 14 L18 14 Z"
  fill="#fff" stroke="#1a1a1a" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}

/* ---------- Fake File System Access API, injected into the frame ---------- */
export function fakeFSSource(folderName) {
  return `(() => {
    const files = new Map();
    const mkDir = (name) => ({
      kind: 'directory', name,
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      async getFileHandle(n, o) {
        if (!files.has(n)) {
          if (!o || !o.create) throw new DOMException('nf', 'NotFoundError');
          files.set(n, new Blob([]));
        }
        return {
          kind: 'file', name: n,
          getFile: async () => new File([files.get(n)], n, { type: files.get(n).type }),
          createWritable: async () => { const parts = []; return {
            write: async d => { parts.push(d); },
            close: async () => { files.set(n, new Blob(parts)); } }; }
        };
      },
      async getDirectoryHandle(n, o) {
        if (o && o.create) return mkDir(n);
        throw new DOMException('nf', 'NotFoundError');
      },
      removeEntry: async n => { files.delete(n); },
      async *keys() { for (const n of [...files.keys()]) yield n; },
      async *values() { for (const n of [...files.keys()]) yield { kind: 'file', name: n }; },
      async *entries() { for (const n of [...files.keys()]) yield [n, { kind: 'file', name: n }]; },
      [Symbol.asyncIterator]() { return this.entries(); }
    });
    const root = mkDir(${JSON.stringify(folderName)});
    window.showDirectoryPicker = async () => root;
  })();`;
}
