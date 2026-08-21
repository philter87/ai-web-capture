import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./clips', import.meta.url));

const CARDS = [
  { name: 'card-1-install', kicker: 'step one',
    title: '2 second installation', sub: 'drag the button to your bookmarks bar' },
  { name: 'card-2-howto', kicker: 'how to use',
    title: 'Three clicks', steps: ['Visit any site', 'Click the bookmark', 'Capture an element'] },
  { name: 'card-3-another', kicker: 'and again',
    title: 'Capture another', sub: 'as many elements as you like, one note each' },
  { name: 'card-4-claude', kicker: 'the payoff',
    title: 'Feed it to Claude Code', sub: 'one click copies the prompt' },
  { name: 'card-5-result', kicker: 'and it is done',
    title: 'Both fixes, live', sub: 'back on the page you captured' },
];

const html = c => `<!doctype html><meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0}
  html,body{width:760px;height:640px;background:#0f1216;overflow:hidden}
  body{font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e6e9ec;padding:0 46px;
       display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;
       background:radial-gradient(120% 100% at 50% 0%,#1a1f26 0%,#0f1216 62%)}
  .kicker{font-size:13px;letter-spacing:.3em;text-transform:uppercase;color:#8b96a1}
  .ticks i{display:inline-block;width:19px;height:6px;background:#ffb020;border-radius:1px;margin-right:5px}
  h1{font-size:44px;font-weight:600;letter-spacing:-.015em;color:#fff;text-align:center}
  .sub{font-size:18px;color:#98a2ad;text-align:center;line-height:1.5}
  ol{list-style:none;padding:0;display:flex;flex-direction:column;gap:18px;margin-top:8px}
  li{display:flex;align-items:center;gap:15px;font-size:22px;color:#c4ccd3}
  li b{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;flex:0 0 auto;
       background:#ffb020;color:#14181d;font-size:17px;font-weight:700}
</style>
<div class="ticks"><i></i><i></i><i></i></div>
<div class="kicker">${c.kicker}</div>
<h1>${c.title}</h1>
${c.sub ? `<p class="sub">${c.sub}</p>` : ''}
${c.steps ? `<ol>${c.steps.map((s, i) => `<li><b>${i + 1}</b>${s}</li>`).join('')}</ol>` : ''}`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 760, height: 640 } });
fs.mkdirSync(OUT, { recursive: true });
for (const c of CARDS) {
  await p.setContent(html(c));
  await p.waitForTimeout(120);
  await p.screenshot({ path: `${OUT}/${c.name}.png` });
  console.log('  ' + c.name + '.png');
}
await b.close();
