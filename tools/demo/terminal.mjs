export const PROMPT = 'Read capture files located in feedback-captures. Each describes an issue — fix it and delete the capture (.md and .png) when done.';

export const terminalHTML = () => `<!doctype html><meta charset="utf-8">
<style>
  :root{--bg:#161719;--fg:#d6d9dd;--dim:#7c8288;--orange:#d97757;--green:#7fb37f;--red:#c96a6a}
  *{box-sizing:border-box}
  html,body{margin:0;width:760px;height:640px;background:var(--bg);overflow:hidden}
  body{font:15px/1.62 ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:var(--fg);padding:18px 20px}
  .box{border:1px solid #3a3d42;border-radius:7px;padding:9px 13px;margin-bottom:11px}
  .box .t{color:var(--orange)}
  .cwd{color:var(--dim);font-size:12.5px}
  #log>*{animation:fade .22s ease-out both}
  @keyframes fade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
  .tool{margin:9px 0 0}
  .tool b{color:#fff;font-weight:600}
  .bullet{color:var(--orange)}
  .res{color:var(--dim);padding-left:2px}
  .diff{margin:4px 0 0 20px;display:flex;flex-direction:column;align-items:flex-start;gap:2px}
  .diff div{padding:0 8px;border-radius:3px;white-space:pre;display:inline-block}
  .del{background:#3a2222;color:var(--red)}
  .add{background:#22331f;color:var(--green)}
  .userline{margin:10px 0 0;color:var(--fg)}
  .userline .g{color:var(--dim)}
  #inbox{border:1px solid #4a4d52;border-radius:7px;padding:8px 12px;margin-top:12px;display:flex;gap:9px}
  #inbox.hot{border-color:var(--orange)}
  #inbox .g{color:var(--dim)}
  #typed{white-space:pre-wrap;word-break:break-word}
  .caret{display:inline-block;width:7.5px;height:15px;background:var(--fg);vertical-align:-3px;
    animation:blink 1.05s steps(1,end) infinite}
  @keyframes blink{50%{opacity:0}}
  .hint{color:#5d6268;font-size:12px;margin-top:7px}
  .done{color:var(--green);margin-top:10px}
</style>
<div class="box"><span class="t">&#10039;</span> Welcome back Philip!
  <div class="cwd">&nbsp;&nbsp;cwd: ~/repos/deepdraw</div></div>
<div id="log"></div>
<div id="inbox"><span class="g">&gt;</span><span id="typed"></span><span class="caret" id="caret"></span></div>
<div class="hint" id="hint">? for shortcuts</div>
<script>
  window.paste = t => { document.getElementById('typed').textContent = t;
                        document.getElementById('inbox').classList.add('hot'); };
  window.submit = () => {
    const t = document.getElementById('typed').textContent;
    document.getElementById('typed').textContent = '';
    document.getElementById('inbox').classList.remove('hot');
    window.push('<div class="userline"><span class="g">&gt;</span> ' + t + '</div>');
  };
  window.push = html => {
    const d = document.createElement('div');
    d.innerHTML = html;
    document.getElementById('log').append(...d.childNodes);
  };
</script>`;

export const STEPS = [
  { wait: 900,  html: `<div class="tool"><span class="bullet">&#9679;</span> <b>Read</b>(feedback-captures/deepdraw-1.md)</div>
                       <div class="res">&nbsp;&nbsp;&#8985;&nbsp; "Add ! to title" &#183; h1 &#183; deepdraw-1.png</div>` },
  { wait: 1100, html: `<div class="tool"><span class="bullet">&#9679;</span> <b>Update</b>(src/pages/index.tsx)</div>
                       <div class="diff"><div class="del">- &lt;h1&gt;Drawings that go deeper&lt;/h1&gt;</div>
                       <div class="add">+ &lt;h1&gt;Drawings that go deeper!&lt;/h1&gt;</div></div>` },
  { wait: 900,  html: `<div class="tool"><span class="bullet">&#9679;</span> <b>Read</b>(feedback-captures/deepdraw-2.md)</div>
                       <div class="res">&nbsp;&nbsp;&#8985;&nbsp; "Make buttons bigger" &#183; div.dd-landing-actions &#183; deepdraw-2.png</div>` },
  { wait: 1200, html: `<div class="tool"><span class="bullet">&#9679;</span> <b>Update</b>(src/components/Hero.tsx)</div>
                       <div class="diff"><div class="del">- .cta { padding: 8px 18px; font-size: 15px }</div>
                       <div class="add">+ .cta { padding: 14px 30px; font-size: 18px }</div></div>` },
  { wait: 1200, html: `<div class="done">&#9679; Both captures applied &#183; deepdraw-1 and deepdraw-2 deleted.</div>` },
];
