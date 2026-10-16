import { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Tray, Menu, screen, dialog, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { PromptStore } from '../core/store.js';
import { search } from '../core/search.js';
import { render } from '../core/compose.js';
import { SEED_PROMPTS } from './seed.js';
import * as semantic from './semantic.js';
import * as paste from './paste.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const require = createRequire(import.meta.url);

if (!app.requestSingleInstanceLock()) app.exit(0);

// Portable build keeps its data beside the .exe; the installed build uses %APPDATA%.
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
const dataDir = portableDir ? path.join(portableDir, 'PromptDock-data') : app.getPath('userData');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'promptdock.sqlite');
const modelDir = path.join(dataDir, 'models');

let store, panel, bubble, tray;
let settings;
let modalOpen = false;
let saveTimer = null;
let pendingBytes = null;
let hotkeyOk = false;
let activeHotkey = null;
// Tried in order when the chosen hotkey is unavailable (e.g. Ctrl+Win+P is reserved on many PCs).
const HOTKEY_FALLBACKS = ['Super+Alt+P', 'Control+Alt+P', 'Control+Shift+Space'];

function persist(bytes) {
  pendingBytes = bytes;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

function flush() {
  if (!pendingBytes) return;
  const tmp = `${dbPath}.tmp`;
  fs.writeFileSync(tmp, pendingBytes);
  fs.renameSync(tmp, dbPath);
  pendingBytes = null;
}

async function openStore() {
  const SQL = await initSqlJs({ locateFile: (f) => require.resolve(`sql.js/dist/${f}`) });
  const exists = fs.existsSync(dbPath);
  store = new PromptStore(SQL, exists ? fs.readFileSync(dbPath) : null, persist);
  if (!exists) for (const p of SEED_PROMPTS) store.create(p);
  settings = store.settings();
}

// ---------- windows ----------
const PANEL_W = 620, PANEL_H = 480;

function createPanel() {
  panel = new BrowserWindow({
    width: PANEL_W, height: PANEL_H, show: false, frame: false, transparent: true,
    resizable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false,
    maximizable: false, minimizable: false, hasShadow: false,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  panel.setAlwaysOnTop(true, 'screen-saver');
  panel.loadFile(path.join(root, 'src', 'renderer', 'index.html'));
  panel.on('blur', () => { if (!modalOpen && !process.env.PD_KEEP_OPEN) hidePanel(); });
}

function positionPanel() {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  panel.setBounds({
    x: Math.round(workArea.x + (workArea.width - PANEL_W) / 2),
    y: Math.round(workArea.y + workArea.height * 0.18),
    width: PANEL_W, height: PANEL_H,
  });
}

function showPanel() {
  positionPanel();
  panel.show();
  panel.focus();
  panel.webContents.send('panel:shown');
}

function hidePanel() {
  if (panel?.isVisible()) panel.hide();
}

function togglePanel() {
  if (panel.isVisible() && panel.isFocused()) hidePanel();
  else showPanel();
}

function createBubble() {
  const { workArea } = screen.getPrimaryDisplay();
  const pos = settings.bubblePos ?? { x: workArea.x + workArea.width - 76, y: workArea.y + Math.round(workArea.height * 0.45) };
  bubble = new BrowserWindow({
    width: 56, height: 56, x: pos.x, y: pos.y, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  bubble.setAlwaysOnTop(true, 'screen-saver');
  bubble.loadFile(path.join(root, 'src', 'renderer', 'bubble.html'));
  bubble.once('ready-to-show', () => { if (settings.showBubble) bubble.showInactive(); });
}

function applyBubble() {
  if (settings.showBubble) bubble.showInactive();
  else bubble.hide();
}

// ---------- hotkey / tray ----------
function tryRegister(accel) {
  try { return globalShortcut.register(accel, togglePanel); } catch { return false; }
}

function registerHotkey(accel) {
  globalShortcut.unregisterAll();
  hotkeyOk = tryRegister(accel);
  activeHotkey = hotkeyOk ? accel : null;
  return hotkeyOk;
}

function registerWithFallback(accel) {
  if (registerHotkey(accel)) return;
  activeHotkey = HOTKEY_FALLBACKS.find(tryRegister) ?? null;
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(root, 'build', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip(`PromptDock${activeHotkey ? ` (${activeHotkey.replace('Super', 'Win').replace('Control', 'Ctrl')})` : ''}`);
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open PromptDock', click: showPanel },
    { label: 'Show bubble', type: 'checkbox', checked: settings.showBubble, click: (i) => updateSettings({ showBubble: i.checked }) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', showPanel);
  tray.rebuild = () => tray.setContextMenu(menu());
}

function updateSettings(patch) {
  const prev = settings;
  settings = store.setSettings(patch);
  if (patch.hotkey && patch.hotkey !== prev.hotkey && !registerHotkey(settings.hotkey)) {
    registerWithFallback(prev.hotkey);
    settings = store.setSettings({ hotkey: prev.hotkey });
    throw new Error(`"${patch.hotkey}" could not be registered (in use or invalid). Kept ${prev.hotkey}.`);
  }
  if ('showBubble' in patch) { applyBubble(); tray?.rebuild(); }
  if ('launchAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin });
  return settings;
}

// ---------- semantic ----------
let semState = { status: 'off', progress: 0, error: null };

function semBroadcast(patch) {
  semState = { ...semState, ...patch };
  panel?.webContents.send('semantic:state', semState);
}

async function enableSemantic() {
  if (!(await semantic.isAvailable())) {
    semBroadcast({ status: 'unavailable', error: 'This build was made without the semantic search library.' });
    return;
  }
  semBroadcast({ status: semantic.isModelDownloaded(modelDir) ? 'loading' : 'downloading', progress: 0, error: null });
  try {
    await semantic.load(modelDir, (progress) => semBroadcast({ progress }));
    semBroadcast({ status: 'indexing' });
    await semantic.reindex(store);
    semBroadcast({ status: 'on' });
  } catch (e) {
    semantic.unload();
    settings = store.setSettings({ semanticEnabled: false });
    semBroadcast({ status: 'error', error: String(e.message ?? e) });
  }
}

function disableSemantic({ removeModel = false } = {}) {
  semantic.unload();
  if (removeModel) {
    fs.rmSync(modelDir, { recursive: true, force: true });
    store.clearEmbeddings();
  }
  semBroadcast({ status: 'off', progress: 0, error: null });
}

const afterChange = () => { if (semantic.isLoaded()) semantic.reindex(store).catch(() => {}); };

// ---------- IPC ----------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: String(err.message ?? err) }; }
  });
}

function registerIpc() {
  handle('prompts:list', () => store.list());
  handle('prompts:search', async (query) => {
    const sem = semantic.isLoaded() ? await semantic.scores(store, query) : null;
    return search(store.list(), query, { semantic: sem });
  });
  handle('prompts:create', (p) => { const r = store.create(p); afterChange(); return r; });
  handle('prompts:update', (id, patch) => { const r = store.update(id, patch); afterChange(); return r; });
  handle('prompts:remove', (id) => store.remove(id));
  handle('tags:list', () => store.allTags());
  handle('slots:get', () => store.slotValues());
  handle('slots:set', (values) => store.setSlotValues(values));
  handle('settings:get', () => ({ ...settings, hotkeyOk, activeHotkey, dataDir, portable: !!portableDir }));
  handle('settings:set', (patch) => updateSettings(patch));
  handle('semantic:state', () => semState);
  handle('semantic:enable', async () => { settings = store.setSettings({ semanticEnabled: true }); enableSemantic(); return true; });
  handle('semantic:disable', async (opts) => { settings = store.setSettings({ semanticEnabled: false }); disableSemantic(opts); return true; });

  // Render the chosen prompts, copy, and (optionally) paste into the previous window.
  handle('use', async ({ ids, values = {}, mode = 'paste' }) => {
    const prompts = ids.map((id) => store.get(id)).filter(Boolean);
    const text = render(prompts, values, settings.separator);
    clipboard.writeText(text);
    store.markUsed(ids);
    if (Object.keys(values).length) store.setSlotValues(Object.fromEntries(Object.entries(values).filter(([, v]) => v)));
    if (mode === 'copy') return text;
    hidePanel();
    if (settings.autoPaste && mode === 'paste') setTimeout(paste.sendPaste, 120);
    return text;
  });

  handle('panel:hide', () => hidePanel());
  handle('bubble:click', () => togglePanel());
  handle('bubble:move', ({ dx, dy }) => {
    const [x, y] = bubble.getPosition();
    bubble.setPosition(x + dx, y + dy);
  });
  handle('bubble:moved', () => {
    const [x, y] = bubble.getPosition();
    settings = store.setSettings({ bubblePos: { x, y } });
  });
  handle('bubble:pinned', () => store.list().filter((p) => p.pinned).slice(0, 6).map(({ id, title }) => ({ id, title })));

  handle('data:export', async () => {
    modalOpen = true;
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(panel, { defaultPath: 'promptdock-export.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (canceled) return null;
      fs.writeFileSync(filePath, JSON.stringify(store.exportJSON(), null, 2));
      return filePath;
    } finally { modalOpen = false; panel.focus(); }
  });
  handle('data:import', async () => {
    modalOpen = true;
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(panel, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (canceled) return null;
      const n = store.importJSON(JSON.parse(fs.readFileSync(filePaths[0], 'utf8')));
      afterChange();
      return n;
    } finally { modalOpen = false; panel.focus(); }
  });
  handle('modal', (open) => { modalOpen = !!open; });
}

// ---------- lifecycle ----------
app.on('second-instance', () => showPanel());
app.on('window-all-closed', (e) => e.preventDefault?.());
app.on('will-quit', () => { globalShortcut.unregisterAll(); flush(); paste.dispose(); });

app.whenReady().then(async () => {
  app.setAppUserModelId('com.vassu.promptdock');
  await openStore();
  registerIpc();
  createPanel();
  createBubble();
  createTray();
  registerWithFallback(settings.hotkey);
  paste.warmUp();
  if (settings.semanticEnabled) enableSemantic();
  if (process.env.PD_SHOW) panel.once('ready-to-show', showPanel);
  // Dev/test hook: PD_SNAP=out.png [PD_SNAP_JS=code] captures the panel, then quits.
  if (process.env.PD_SNAP) {
    panel.webContents.on('console-message', (e) => console.log('[renderer]', e.level, e.message));
    panel.once('ready-to-show', async () => {
      showPanel();
      await new Promise((r) => setTimeout(r, 700));
      if (process.env.PD_SNAP_JS) console.log('[js]', JSON.stringify(await panel.webContents.executeJavaScript(process.env.PD_SNAP_JS)));
      await new Promise((r) => setTimeout(r, 600));
      fs.writeFileSync(process.env.PD_SNAP, (await panel.webContents.capturePage()).toPNG());
      app.quit();
    });
  }
});
