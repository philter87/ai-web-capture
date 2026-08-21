# Walkthrough recorder

Records `walkthrough.gif` — the walkthrough embedded in the repo README and in
the install page. (`demo.gif` is the previous cut, kept only as a fallback.) Re-run it whenever the panel's UI changes so the gif does not
drift away from `capture.js`.

```sh
cd tools/demo
npm install
npx playwright install chromium   # first time only
npm run all                       # cards -> record -> build, writes ../../walkthrough.gif
```

`ffmpeg` must be on `$PATH`. The whole run takes about four minutes, most of it
the two live page loads.

## How it works

Playwright is headless here, which means two things are out of reach: browser
chrome (the tab strip, address bar and bookmarks bar) and anything that is not a
web page at all. So the rig draws those, and records everything else for real.

A **stage** page (`lib.mjs`) holds a DOM mock of Chrome's chrome across the top
and an `<iframe>` of the site under test below it, plus a synthetic cursor —
Playwright's video has no pointer, so `drive.mjs` animates one and keeps it in
step with the real `page.mouse` calls driving the clicks.

Inside that iframe everything is genuine: `capture.js` is injected exactly as the
bookmarklet would inject it, and the panel, element picker, rendered screenshot,
`.md`/`.png` writes and clipboard copy are all the real code path.

Two shims make that possible headlessly:

- **Framing.** `ctx.route` strips `x-frame-options` and `content-security-policy`
  from every response, otherwise the site refuses to load in the iframe.
- **The folder.** There is no native directory picker, so `fakeFSSource()` in
  `lib.mjs` installs an in-memory `showDirectoryPicker`. It must implement
  `keys()`, `entries()`, `getFileHandle`, `getDirectoryHandle`, `removeEntry`,
  `createWritable` and the permission methods — `capture.js` uses all of them.
  Extend the fake if the real code starts calling something new.

## Files

| File | Role |
|---|---|
| `lib.mjs` | Stage markup, the Chrome mock, the fake File System Access API |
| `drive.mjs` | Synthetic cursor, click ripple, typing helpers |
| `serve.mjs` | Serves the repo (so the install page is the real one) and the stage |
| `record.mjs` | The four recorded segments; writes `clips/*.webm` |
| `cards.mjs` | The five full-screen title cards; writes `clips/*.png` |
| `terminal.mjs`| The Claude Code terminal mock and its scripted output |
| `build.mjs` | Trims, speeds up and concatenates everything, then writes the gif |

`record.mjs` takes segment names, which is handy while iterating:

```sh
node record.mjs drag          # just the bookmarks-bar drag
node record.mjs session       # the two captures on deepdraw.ai
node record.mjs terminal      # just the Claude Code mock
node record.mjs result        # just the fixes landing on deepdraw.ai
```

## Gotchas

- **The two captures are one recording.** `seg-session` is a single unbroken
  session so the counter and the carried-over folder are real continuity, not
  editing. `build.mjs` cuts it into pieces using the timestamps written to
  `clips/seg-session.marks.json`, and splices the cards into the gaps.
- **Never click with a move while the picker is widened.** `page.mouse.click()`
  moves before it presses, and the picker's `mousemove` handler resets the
  selection — which silently undoes an `ArrowUp`. `drive.mjs` presses in place
  via `down()`/`up()` for that reason.
- **The install page embeds this gif**, so `record.mjs` hides `#video-guide`
  during the drag segment. Without it the clip contains a small copy of itself.
- **The closing segment fakes the fixes.** `seg-result` loads deepdraw.ai plain
  and applies the two edits the terminal mock just showed — the `!` on the
  headline, bigger call-to-action buttons — with the descriptions echoed back as
  chips. Keep it in step with `STEPS` in `terminal.mjs`; if one changes and the
  other does not, the gif contradicts itself.
- **Timing.** Each segment records from context creation, so the first seconds
  are page load. Scripts write the lead-in to `clips/<name>.lead` and `build.mjs`
  trims it; the length of the finished gif is otherwise set by the per-piece
  `speed` values in `build.mjs`.
