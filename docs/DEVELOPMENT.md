# Developing PromptDock

Requires **Node.js 22+** (developed on Node 24). No Rust, Python or system-wide installs are needed.

```bash
npm install        # also downloads the Electron runtime (postinstall)
npm start          # run the app
npm test           # unit tests (core logic)
npm run test:e2e   # drives the real app UI (59 checks) against a throwaway data folder
npm run pack       # unpacked build in dist/win-unpacked
npm run dist       # Windows installer + portable exe in dist/
npm run icon       # re-render build/icon.png, tray.png, icon.ico from build/icon.svg
npm run web        # serve the web build at http://127.0.0.1:5173/web/
npm run test:web   # web build end-to-end (67 checks) in Chromium, incl. multi-tab + corrupt-data recovery
```

## Project layout

```text
src/core/      pure logic, no Electron: slots, compose, search, store (SQLite)
src/main/      Electron main process: windows, hotkey, tray, IPC, paste, semantic search
src/renderer/  panel UI (index.html, app.js, styles.css) and bubble.html
test/          unit tests (core.test.js) and the UI end-to-end suite (e2e/)
build/         icon.svg (source of truth) + generated icon.png / tray.png / icon.ico
scripts/       icon renderer, Electron postinstall helper
docs/          user guide, this file, screenshots
```

## How it works

| Concern | Approach |
|---|---|
| Shell | Electron. Frameless, transparent windows; the panel uses `alwaysOnTop: 'screen-saver'` so it shows over other windows (and over fullscreen apps on macOS) |
| Translucency | Transparent window + `rgba` CSS background (opacity slider); follows the OS light/dark mode |
| Hotkey | `globalShortcut` with an ordered fallback list (`Super+Alt+P` → `Control+Alt+P` → `Control+Shift+Space`). `Super` is ⌘ on macOS |
| Paste (Windows) | A long-lived hidden PowerShell process records the foreground window **before** the panel shows, then refocuses it (using an Alt key event to lift the Windows foreground lock) and sends `Ctrl+V`. No native modules |
| Paste (macOS/Linux) | Not implemented yet: the prompt is copied and the UI says "Press ⌘V / Ctrl+V to paste" |
| Storage | SQLite through `sql.js` (WebAssembly). Writes are debounced and atomic (temp file + rename), with a retry if the file is locked |
| Semantic search | `@huggingface/transformers` + `all-MiniLM-L6-v2` (q8) on CPU via onnxruntime-node. The model downloads on opt-in; embeddings are cached in SQLite and re-embedded only when a prompt changes |
| Packaging | `electron-builder`: NSIS + portable for Windows. Unused onnxruntime platforms and web builds are stripped (~130 MB per .exe, mostly the Electron runtime) |

Data lives in `%APPDATA%\promptdock` (Windows), `~/Library/Application Support/promptdock` (macOS),
`~/.config/promptdock` (Linux), or `PromptDock-data\` next to the portable .exe.

## Testing

| Layer | How | Covers |
|---|---|---|
| Unit | `npm test` | slots (incl. non-Latin names), compose, search ranking/fuzzy/tags/semantic blend, SQLite CRUD, persistence, embeddings, import/export |
| UI end-to-end | `npm run test:e2e` | tour, search + keyboard nav, create/edit/delete, validation, make-slot, fill flow + remembered values, compose, HTML escaping, every setting, hotkey rebinding + rejection, import/export, 500-prompt performance, copy-then-paste messaging, Esc behaviour |
| Packaged build | `node test/e2e/run.js dist/win-unpacked/PromptDock.exe` | the same suite against the built app |
| Manual (Windows) | real keyboard and mouse | hotkey over another app · Enter pastes into Notepad · slot form pastes filled text · bubble click / drag / position persists · click-away hides · Windows close request quits cleanly · light + dark · offline semantic error · installer install/uninstall · portable data folder · fresh `git clone` + `npm install` |

**Not yet verified on real hardware:** macOS and Linux. The UI labels for macOS were checked with `PD_FAKE_PLATFORM=darwin`.

### Test hooks (environment variables)

| Variable | Effect |
|---|---|
| `PD_E2E=<file>` | run a scenario inside the panel and print `E2E_RESULTS` (used by `test:e2e`) |
| `PD_DATA_DIR=<dir>` | use a different data folder |
| `PD_DEBUG=1` | log paste/focus decisions |
| `PD_THEME=light\|dark` | force a theme |
| `PD_FAKE_PLATFORM=darwin\|linux` | preview another OS's labels in the UI only |
| `PD_MODEL_HOST=<url>` | override the model server, e.g. to simulate offline |
| `PD_SNAP=out.png` (+ `PD_SNAP_JS`, `PD_SNAP_DELAY`, `PD_SNAP_WAIT`, `PD_SNAP_BUBBLE`) | screenshot the panel/bubble after launch, then quit |
| `PD_KEEP_OPEN=1` | don't hide the panel on blur |

## Web build (`web/`)

Live at **https://vassu-v.github.io/promptdock-intool/**, served by GitHub Pages straight from `main`
(repo root; `index.html` redirects to `web/`, `.nojekyll` serves files as-is). There's no build step.

| Piece | How |
|---|---|
| UI | `web/main.js` fetches the **same panel markup** from `src/renderer/index.html` and runs the **same** `src/renderer/app.js`; `web/web.css` only frames the page and hides desktop-only settings |
| API | `web/pd-web.js` implements `window.pd` (the API Electron serves over IPC) on top of `src/core` |
| Storage | `web/storage.js`: the SQLite bytes live in IndexedDB as one `{bytes, version}` record. Every change runs under a cross-tab **Web Lock**, re-reads the stored version first (so a stale tab reloads before writing, and no edit is lost), and saves atomically in one transaction. Other tabs are told via `BroadcastChannel` and re-check on focus. It asks for persistent storage, falls back to memory with a warning in private modes, and quarantines unreadable data (`corrupt-<time>` key) before starting fresh |
| Copy | `navigator.clipboard` with a timeout, then `execCommand` fallback, then a "Ready to copy" box with a Copy button |
| Semantic search | `web/semantic-worker.js` runs transformers.js (pinned `@4.3.1` from jsDelivr) in a Web Worker; the model is cached by the browser; embeddings are stored in the same SQLite file |
| Vendored | `web/vendor/sql-wasm.{js,wasm}` (sql.js 1.15.0, MIT) |

Not in the browser: global hotkey, auto-paste into other apps, bubble, tray. Next: PWA install and a browser extension (same `window.pd` shim plus a popup).

## Brand

The mark is a **P** whose bowl holds a `>` prompt chevron, followed by a `_` cursor: "P_", a prompt
waiting for input. Gradient `#4F46E5 → #7C3AED → #C026D3`. Edit `build/icon.svg`, then `npm run icon`.

## Changelog

- **0.4.0**: web version (GitHub Pages): IndexedDB storage with cross-tab locking, live sync and corrupt-data recovery;
  in-browser semantic search; copy fallback box; minimal page. Fix (desktop too): pressing Enter right after typing used
  the previous top result. Edit button on every result row (touch-friendly).

- **0.3.0**: macOS/Linux friendliness: ⌘/Ctrl-aware labels everywhere, a "Copied ✓ press ⌘V/Ctrl+V"
  flow where auto-paste isn't available, menu-bar icon size, no Dock icon, panel over fullscreen apps,
  `PromptDock.command` / `promptdock.sh` launchers. Redesigned README.
- **0.2.1**: new P_ brand mark; `PromptDock.cmd` source launcher; fix: fresh clones got no Electron runtime.
- **0.2.0**: first-run tour, user guide, e2e suite. Fixes: auto-paste failing with the real hotkey, app lingering
  after a Windows close request, Delete button doing nothing, "42" ranking below "429", non-Latin slot names,
  crash on a locked database file, bubble lost after unplugging a monitor, tray click pasting into the taskbar,
  unclear import/offline errors.
- **0.1.0**: first build: search, slots, compose, editor, settings, bubble, tray, semantic search, installer.
