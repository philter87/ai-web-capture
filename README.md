# AI Web Capture

A bookmarklet for grabbing feedback straight off a web page — pick an element, write a note, and it's saved as Markdown (with a screenshot) or dropped straight into a GitHub issue. No browser extension, no install beyond dragging a button to your bookmarks bar.

**Install:** https://philter87.github.io/ai-web-capture/

Free forever. Works in Chrome, Edge, and Brave on desktop. It relies on the File System Access API to write captures to a folder, so it does **not** work on mobile devices or in Safari — the install page shows a video walkthrough for those cases.

## How it works

https://github.com/philter87/ai-web-capture/raw/main/AiWebCapture.mp4

1. Drag the **AI Web Capture** button to your bookmarks bar.
2. Click it on any page — a small panel appears bottom right.
3. Pick an element, write a description, and save.
4. Captures are written as `.md` files (with a screenshot) to a folder you choose — handy as feedback for an AI coding agent — or filed as a GitHub issue.

## Filing to GitHub

Two routes, whichever suits the moment:

- **From the page you captured** — hit **File newest on GitHub →** and it opens a new-issue form with the title and body already filled, screenshot on your clipboard ready to paste. The repository is remembered per site, so it is one click the second time. Captured HTML rides along in the URL and is trimmed to fit, with a pointer to the `.md` file when it does not.
- **From the issue form itself** — **Fill from newest capture**, or pick from the list. Images upload straight into the body. Tick several captures to file them as one issue with a section each.

The list also has a two-click delete for captures you decide not to file. Once an issue is created, its capture moves to a `submitted/` subfolder — automatically when the panel sees the issue land, or via the button — so the list only ever shows what is still unfiled.

## Screenshots

By default the screenshot is rendered from the page itself: the picked element is cloned with its computed styles and rasterised through `<svg><foreignObject>`. That needs **no permission prompt**, and it captures the whole element even where it runs past the bottom of the window.

What it cannot see: content inside `<iframe>`s, cross-origin images served without CORS headers, and pages whose Content-Security-Policy forbids `data:` images. Tick **Improved snapshot quality** for those — it uses tab capture instead, which is exactly what the screen shows, at the cost of Chrome's one-per-page "share this tab" prompt and only covering the visible part of the element.
