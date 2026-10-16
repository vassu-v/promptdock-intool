# PromptDock

A translucent, always-on-top prompt library for Windows. Press a hotkey, type a few words,
hit Enter, and the prompt is pasted into whatever app you were in (Antigravity, ChatGPT, an IDE…).

![panel](docs/panel.png)

## Features

- **Instant search**: keyword + typo-tolerant fuzzy matching, `#tag` filters.
- **Optional semantic search**: finds prompts by meaning ("mobile layout" → *Make UI responsive*).
  Off by default; turning it on downloads a ~23 MB model once, then runs offline on the CPU.
- **Slots**: write `{{file}}` or `{{tone:friendly}}` (with a default) in any prompt.
  When you use it, PromptDock asks for each value. **Enter** moves to the next one, and the last
  Enter fills everything in and pastes. Values are remembered **on this computer only**
  and can be edited or cleared in Settings.
- **Compose**: press **Tab** on several prompts to queue them, then Enter joins them in order
  (separator configurable) and pastes them as one.
- **Everything editable later**: prompts, titles, tags, pinned state, slots, saved slot values, settings.
- **Floating bubble**: a small translucent `>_` button you can drag anywhere. Click it to open.
  It can be hidden from Settings or the tray.
- **SQLite storage**, plus JSON import/export for backups or moving between PCs.
- **Two builds**: installer, or a portable `.exe` that keeps its data in a `PromptDock-data` folder next to itself.

## Keys

| Where | Key | Action |
|---|---|---|
| Anywhere | **Win+Alt+P** (default) | Open / close PromptDock |
| Search | `↑` `↓` / `Enter` | Move / use (fill slots → paste) |
| Search | `Tab` (or Ctrl+click) | Add to / remove from compose tray |
| Search | `Ctrl+Enter` | Copy only, no paste |
| Search | `Ctrl+E` / right-click | Edit prompt |
| Search | `Ctrl+N` / `Ctrl+,` | New prompt / Settings |
| Fill | `Enter` | Next slot; on the last slot, paste |
| Editor | `Ctrl+S` | Save |
| Any | `Esc` | Back / clear / close |

**About the hotkey:** the hotkey only toggles the panel and does nothing else. `Ctrl+Win+P` was
requested, but Windows refuses to let apps register it on this PC (it is already reserved).
PromptDock therefore tries your chosen key first, then falls back to `Win+Alt+P` → `Ctrl+Alt+P` →
`Ctrl+Shift+Space`. Settings shows which one is active, and you can rebind it by clicking the field and pressing a combination.

## Install

- `dist/PromptDock-Setup-<version>.exe`: per-user installer (no admin needed), with Start menu
  and desktop shortcuts. Data lives in `%APPDATA%\promptdock`.
- `dist/PromptDock-Portable-<version>.exe`: run from anywhere, e.g. a USB stick.

The builds are unsigned, so Windows SmartScreen may warn on first run: choose *More info → Run anyway*.

## Develop

Requires Node.js 22+ (developed on Node 24). No Rust, Python or system installs are needed.

```bash
npm install
npm start          # run the app
npm test           # unit tests (core logic)
npm run pack       # unpacked build in dist/win-unpacked
npm run dist       # installer + portable exe in dist/
```

Test hooks for scripted UI checks: `PD_SNAP=out.png` captures the panel after launch then quits;
`PD_SNAP_JS` runs code in the panel first; `PD_SNAP_DELAY`/`PD_SNAP_WAIT` add pauses;
`PD_KEEP_OPEN=1` stops the panel hiding on blur.

## How it works

| Concern | Approach |
|---|---|
| Shell | Electron. Frameless, transparent windows; the panel uses `alwaysOnTop: 'screen-saver'` so it shows over other windows |
| Translucency | Transparent window + `rgba` CSS background (opacity slider in Settings); follows Windows light/dark mode |
| Hotkey | `globalShortcut` with an ordered fallback list |
| Paste | A long-lived hidden PowerShell process records the foreground window when the panel opens, then refocuses it and sends `Ctrl+V`. This avoids native modules and a per-paste start-up |
| Storage | SQLite through `sql.js` (WebAssembly). Writes are debounced and atomic (temp file + rename) |
| Semantic search | `@huggingface/transformers` + `all-MiniLM-L6-v2` (q8) on CPU via onnxruntime-node. Embeddings are cached in SQLite and re-embedded only when a prompt changes |
| Packaging | `electron-builder`: NSIS + portable. Unused onnxruntime platforms and web builds are stripped (~130 MB per .exe; most of that is the Electron runtime) |

```
src/core/      pure logic, no Electron: slots, compose, search, store (SQLite)
src/main/      Electron main process: windows, hotkey, tray, IPC, paste, semantic
src/renderer/  panel UI (index.html, app.js, styles.css) and bubble.html
test/          node:test unit tests for src/core
```

### Becoming a web app later

`src/core` has no Electron or Node dependencies, and `sql.js` runs in browsers. A web version
would need:
1. The renderer, plus a small `window.pd` shim that calls `src/core` directly instead of over IPC.
2. `PromptStore` persisting its bytes to IndexedDB instead of a file.
3. Removing the desktop-only parts: global hotkey, auto-paste and bubble. Copy to clipboard still works.

A browser extension would be the same shim plus a popup.

## Changelog

- **0.1.0**: first release. Search, slots with fill-and-paste, compose, editor, settings,
  bubble, tray, optional semantic search, import/export, installer and portable builds.
