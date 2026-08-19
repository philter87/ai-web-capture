#!/usr/bin/env node
// Regenerates the bookmarklet embedded in index.html from capture.js.
// Run this every time capture.js changes: `node build.js`
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = __dirname;
const srcPath = path.join(root, 'capture.js');
const htmlPath = path.join(root, 'index.html');
const tmpPath = path.join(root, '.capture.min.js.tmp');

const src = fs.readFileSync(srcPath, 'utf8');
fs.writeFileSync(tmpPath, src);
try {
  execSync(`npx --yes terser "${tmpPath}" --compress --mangle -o "${tmpPath}"`, { stdio: 'inherit' });
  const min = fs.readFileSync(tmpPath, 'utf8').trim();

  const wrapped = `(function(){${min}})();`;
  const href = 'javascript:' + encodeURIComponent(wrapped);

  let html = fs.readFileSync(htmlPath, 'utf8');
  const hrefRe = /href="javascript:[^"]*"(?=>AI Web Capture<\/a>)/;
  if (!hrefRe.test(html)) throw new Error('drag button href not found in index.html — did the anchor markup change?');
  html = html.replace(hrefRe, `href="${href}"`);

  fs.writeFileSync(htmlPath, html);
  console.log(`Bookmarklet rebuilt from capture.js (${href.length} chars) and written into index.html.`);
  console.log('The fallback textarea mirrors it automatically at page load — no separate copy to update.');
} finally {
  fs.unlinkSync(tmpPath);
}
