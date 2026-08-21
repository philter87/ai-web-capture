import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/* Serves the repo itself, so the install page under test is the real one. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.mp4':'video/mp4' };
let STAGE = '<!doctype html>stage';
export const setStage = html => { STAGE = html; };
export function serve(port = 8787) {
  const s = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/__stage') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(STAGE);
    }
    const p = path.join(ROOT, decodeURIComponent(url));
    fs.readFile(p, (e, b) => {
      if (e) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
      res.end(b);
    });
  });
  return new Promise(r => s.listen(port, () => r(s)));
}
