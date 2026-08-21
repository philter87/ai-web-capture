import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { W, H, CHROME_H, stageHTML, fakeFSSource } from './lib.mjs';
import { cursorTo, click, centreOf, beat } from './drive.mjs';
import { serve, setStage } from './serve.mjs';
import { terminalHTML, PROMPT, STEPS } from './terminal.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CAPTURE_JS = fs.readFileSync(new URL('../../capture.js', import.meta.url), 'utf8');
const OUT = fileURLToPath(new URL('./clips', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

/** Centre of an element in the stage document (the chrome), in stage coordinates. */
async function stageCentre(page, selector) {
  const b = await page.locator(selector).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}

const DEEPDRAW = { tab: { title: 'Drawings that go deeper — DeepDraw', color: '#4338ca' }, url: 'deepdraw.ai' };
const INSTALL = { tab: { title: 'AI Web Capture', color: '#ffb020' }, url: 'philter87.github.io/ai-web-capture/' };

async function openStage(browser, { tab, url, src, bookmark }) {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: OUT, size: { width: W, height: H } },
    deviceScaleFactor: 1,
  });
  const born = Date.now();
  await ctx.route('**/*', async route => {
    try {
      const r = await route.fetch();
      const h = { ...r.headers() };
      delete h['x-frame-options'];
      delete h['content-security-policy'];
      delete h['content-security-policy-report-only'];
      await route.fulfill({ response: r, headers: h });
    } catch { await route.continue().catch(() => {}); }
  });
  const page = await ctx.newPage();
  setStage(stageHTML({ tab, url, src, bookmark }));
  await page.goto('http://localhost:8787/__stage');
  await page.waitForTimeout(2500);
  const frame = page.frames().find(f => f !== page.mainFrame());
  return { ctx, page, frame, born };
}

/** Run the bookmarklet inside the framed page, exactly as clicking the bookmark would. */
async function runBookmarklet(frame, folder) {
  if (folder) await frame.evaluate(s => (0, eval)(s), fakeFSSource(folder));
  await frame.evaluate(s => (0, eval)('(function(){' + s + '})()'), CAPTURE_JS);
}

async function finish(ctx, page, born, markedAt, name) {
  const video = page.video();
  await ctx.close();
  const src = await video.path();
  const lead = (markedAt - born) / 1000;
  fs.renameSync(src, `${OUT}/${name}.webm`);
  fs.writeFileSync(`${OUT}/${name}.lead`, String(lead.toFixed(2)));
  console.log(`  ${name}.webm  (trim ${lead.toFixed(2)}s of lead-in)`);
}

/* ============================================================
   Segment: drag the button onto the bookmarks bar
   ============================================================ */
async function segDrag(browser) {
  console.log('seg-drag');
  const { ctx, page, frame, born } = await openStage(browser, {
    ...INSTALL, src: 'http://localhost:8787/index.html', bookmark: false,
  });
  await frame.waitForSelector('#drag-btn');
  // the install page embeds this very gif — hide it so the clip doesn't show itself
  await frame.addStyleTag({ content: '#video-guide{display:none}' });
  await page.waitForTimeout(400);
  const mark = Date.now();

  const btn = await centreOf(frame, '#drag-btn');
  await cursorTo(page, btn.x, btn.y, 800);
  await beat(page, 260);

  // press: the amber chip lifts off the button and follows the pointer
  await page.evaluate(([x, y]) => {
    const g = document.getElementById('bz-ghost');
    g.style.transition = 'none';
    g.style.transform = `translate(${x - 60}px,${y - 16}px)`;
    g.style.opacity = '.92';
  }, [btn.x, btn.y]);
  await beat(page, 240);

  // drag up to the bookmarks bar
  const marks = await stageCentre(page, '.bz-marks');
  const target = { x: 74, y: marks.y };
  await page.evaluate(([x, y]) => {
    document.getElementById('bz-ghost').style.transition = 'transform 1150ms cubic-bezier(.35,.05,.2,1)';
    document.getElementById('bz-ghost').style.transform = `translate(${x - 60}px,${y - 16}px)`;
  }, [target.x, target.y]);
  await cursorTo(page, target.x, target.y, 1150);
  await beat(page, 320);

  // drop
  await page.evaluate(() => {
    const g = document.getElementById('bz-ghost');
    g.style.transition = 'opacity 180ms ease';
    g.style.opacity = '0';
    const b = document.getElementById('bz-bookmark');
    b.style.display = '';
    b.classList.add('bz-new');
  });
  await beat(page, 260);
  await cursorTo(page, W * 0.42, H * 0.45, 500);
  await beat(page, 900);

  await finish(ctx, page, born, mark, 'seg-drag');
}

/* ============================================================
   Segment: click the bookmark, capture the title, describe it
   ============================================================ */
/* ============================================================
   One continuous deepdraw.ai session: capture the headline,
   capture the buttons, then hand the prompt to Claude.
   Marks record where the text cards get spliced in later.
   ============================================================ */
async function segSession(browser) {
  console.log('seg-session');
  const FOLDER = 'feedback-captures';
  const { ctx, page, frame, born } = await openStage(browser, {
    ...DEEPDRAW, src: 'https://deepdraw.ai', bookmark: true,
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://deepdraw.ai' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8787' });
  await page.waitForTimeout(300);

  const marks = {};
  const mark = k => { marks[k] = (Date.now() - born) / 1000; };
  mark('start');

  // --- click the bookmark ---
  await cursorTo(page, W * 0.42, H * 0.42, 450);
  const bm = await stageCentre(page, '#bz-bookmark');
  await click(page, bm.x, bm.y, { ms: 850 });
  await runBookmarklet(frame, FOLDER);
  await beat(page, 900);

  const capture = async ({ pick, widen = 0, title, desc, chooseFolder, entry }) => {
    const go = await centreOf(frame, entry);
    await click(page, go.x, go.y, { ms: 750 });
    await beat(page, 550);

    const el = await centreOf(frame, pick);
    await cursorTo(page, el.x, el.y, 800);
    await beat(page, 700);
    for (let i = 0; i < widen; i++) { await page.keyboard.press('ArrowUp'); await beat(page, 600); }
    await beat(page, 300);
    await click(page, el.x, el.y, { move: false });
    await beat(page, 1500);

    const ok = await centreOf(frame, 'button.go');
    await click(page, ok.x, ok.y, { ms: 650 });
    await beat(page, 500);

    const t = await centreOf(frame, 'input[type=text]');
    await click(page, t.x, t.y, { ms: 550 });
    await page.keyboard.type(title, { delay: 58 });
    await beat(page, 250);

    const d = await centreOf(frame, 'textarea');
    await click(page, d.x, d.y, { ms: 450 });
    await page.keyboard.type(desc, { delay: 55 });
    await beat(page, 550);

    if (chooseFolder) {
      const pb = await centreOf(frame, 'button:has-text("Choose folder")');
      await click(page, pb.x, pb.y, { ms: 550 });
      await beat(page, 900);
    }

    const save = await centreOf(frame, 'button.go');
    await click(page, save.x, save.y, { ms: 550 });
    await beat(page, 2000);
  };

  await capture({
    entry: 'text=CLICK HERE TO CAPTURE', pick: 'h1',
    title: 'Landing headline', desc: 'Add ! to title', chooseFolder: true,
  });
  mark('cap1End');
  await beat(page, 400);

  await capture({
    entry: 'text=Capture another element', pick: 'button:has-text("Create drawing")', widen: 2,
    title: 'Call to action', desc: 'Make buttons bigger',
  });
  mark('cap2End');
  await beat(page, 600);

  // --- hand it to Claude ---
  const claude = await centreOf(frame, 'text=Tell Claude to fix it');
  await click(page, claude.x, claude.y, { ms: 800 });
  await beat(page, 2200);                      // "Copied — paste it into your Claude session."
  mark('end');

  fs.writeFileSync(`${OUT}/seg-session.marks.json`, JSON.stringify(marks, null, 2));
  console.log('  marks', marks);
  await finish(ctx, page, born, born, 'seg-session');   // marks are absolute, so no lead trim
}


/* ============================================================
   Segment: the prompt lands in a Claude Code session
   ============================================================ */
async function segTerminal(browser) {
  console.log('seg-terminal');
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  });
  const born = Date.now();
  const page = await ctx.newPage();
  setStage(terminalHTML());
  await page.goto('http://localhost:8787/__stage');
  await page.waitForTimeout(500);
  const mark = Date.now();

  await page.waitForTimeout(900);
  await page.evaluate(t => window.paste(t), PROMPT);   // the clipboard lands
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.submit());
  await page.waitForTimeout(700);

  for (const st of STEPS) {
    await page.evaluate(h => window.push(h), st.html);
    await page.waitForTimeout(st.wait);
  }
  await page.waitForTimeout(1600);

  await finish(ctx, page, born, mark, 'seg-terminal');
}

/* ============================================================ */
const main = async () => {
  const server = await serve(8787);
  const browser = await chromium.launch();
  const want = process.argv.slice(2);
  const has = n => !want.length || want.includes(n);

  if (has('drag')) await segDrag(browser);
  if (has('session')) await segSession(browser);
  if (has('terminal')) await segTerminal(browser);

  await browser.close();
  server.close();
};
main();
