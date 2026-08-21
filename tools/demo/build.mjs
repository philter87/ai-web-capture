import { execFileSync } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';

const dur = f => parseFloat(execFileSync('ffprobe',
  ['-v','error','-show_entries','format=duration','-of','csv=p=0', f]).toString().trim());

const C = fileURLToPath(new URL('./clips', import.meta.url));
const GIF = fileURLToPath(new URL('../../demo.gif', import.meta.url));
const MP4 = fileURLToPath(new URL('./master.mp4', import.meta.url));
const marks = JSON.parse(fs.readFileSync(`${C}/seg-session.marks.json`, 'utf8'));
const SESSION_END = dur(`${C}/seg-session.webm`);   // marks can run a frame past the file

export const PIECES = [
  { img: 'card-1-install.png', dur: 2.2 },
  { vid: 'seg-drag.webm',      from: parseFloat(fs.readFileSync(`${C}/seg-drag.lead`,'utf8')), to: dur(`${C}/seg-drag.webm`), speed: 1.15 },
  { img: 'card-2-howto.png',   dur: 2.6 },
  { vid: 'seg-session.webm',   from: marks.start,    to: marks.cap1End, speed: 2.0 },
  { img: 'card-3-another.png', dur: 1.9 },
  { vid: 'seg-session.webm',   from: marks.cap1End,  to: marks.cap2End, speed: 2.0 },
  { img: 'card-4-claude.png',  dur: 1.9 },
  { vid: 'seg-session.webm',   from: marks.cap2End,  to: SESSION_END,   speed: 1.35 },
  { vid: 'seg-terminal.webm',  from: parseFloat(fs.readFileSync(`${C}/seg-terminal.lead`,'utf8')), to: dur(`${C}/seg-terminal.webm`), speed: 1.3 },
];

const FPS = 25, W = 760, H = 640;

const args = [], parts = [];
PIECES.forEach((p, i) => {
  if (p.img) args.push('-loop', '1', '-t', String(p.dur), '-i', `${C}/${p.img}`);
  else args.push('-i', `${C}/${p.vid}`);
});
PIECES.forEach((p, i) => {
  parts.push(p.img
    ? `[${i}:v]fps=${FPS},scale=${W}:${H}:flags=lanczos,setsar=1[v${i}]`
    : `[${i}:v]trim=start=${p.from}:end=${p.to},setpts=(PTS-STARTPTS)/${p.speed},fps=${FPS},scale=${W}:${H}:flags=lanczos,setsar=1[v${i}]`);
});
const chain = parts.join(';') + ';' +
  PIECES.map((_, i) => `[v${i}]`).join('') + `concat=n=${PIECES.length}:v=1:a=0[out]`;

const total = PIECES.reduce((a, p) => a + (p.img ? p.dur : (p.to - p.from) / p.speed), 0);
console.log('pieces:', PIECES.length, ' estimated length:', total.toFixed(1) + 's');

execFileSync('ffmpeg', ['-y', '-v', 'error', ...args,
  '-filter_complex', chain, '-map', '[out]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
  MP4], { stdio: 'inherit' });
console.log('master.mp4 written');

/* The gif is what the README and the install page embed. Palette is generated
   from the clip itself; stats_mode=diff biases it toward the moving parts. */
const GIF_W = 760, GIF_FPS = 12, GIF_COLORS = 96;
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', MP4,
  '-filter_complex',
  `[0:v]fps=${GIF_FPS},scale=${GIF_W}:-2:flags=lanczos,split[a][b];` +
  `[a]palettegen=max_colors=${GIF_COLORS}:stats_mode=diff[p];` +
  `[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
  '-loop', '0', GIF], { stdio: 'inherit' });
console.log('demo.gif written ->', GIF, `(${(fs.statSync(GIF).size / 1e6).toFixed(1)} MB)`);
