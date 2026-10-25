import { app, nativeTheme, BrowserWindow, globalShortcut, ipcMain, clipboard, Tray, Menu, screen, dialog, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { PromptStore } from '../core/store.js';
import { search } from '../core/search.js';
import { render } from '../core/compose.js';
import { seedLibrary } from './seed.js';
import * as semantic from './semantic.js';
import * as paste from './paste.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const require = createRequire(import.meta.url);

if (!app.requestSingleInstanceLock()) app.exit(0);

// Portable build keeps its data beside the .exe; the installed build uses %APPDATA%.
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
// PD_DATA_DIR overrides both (used by the e2e tests to run against a throwaway library).
const dataDir = process.env.PD_DATA_DIR || (portableDir ? path.join(portableDir, 'PromptDock-data') : app.getPath('userData'));
const E2E = !!process.env.PD_E2E;
// Auto-paste is implemented for Windows only; elsewhere the prompt is copied and the user presses Cmd/Ctrl+V.
const CAN_AUTO_PASTE = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'promptdock.sqlite');
const modelDir = path.join(dataDir, 'models');

let store, panel, bubble, tray;
let settings;
let modalOpen = false;
let firstRun = false;
let quitting = false;
let lastText = null;
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
  try {
    fs.writeFileSync(tmp, pendingBytes);
    fs.renameSync(tmp, dbPath);
    pendingBytes = null;
  } catch (err) {
    // Antivirus or a sync tool can briefly lock the file; retry instead of crashing.
    console.error('save failed, retrying', err.message);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 1000);
  }
}

async function openStore() {
  const SQL = await initSqlJs({ locateFile: (f) => require.resolve(`sql.js/dist/${f}`) });
  const exists = fs.existsSync(dbPath);
  store = new PromptStore(SQL, exists ? fs.readFileSync(dbPath) : null, persist);
  if (!exists) { seedLibrary(store); store.save(); }
  settings = store.settings();
  firstRun = !exists;
}

// ---------- windows ----------
const PANEL_W = 620, PANEL_H = 480;

function createPanel() {
  panel = new BrowserWindow({
    width: PANEL_W, height: PANEL_H, show: false, frame: false, transparent: true,
    resizable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false,
    maximizable: false, minimizable: false, hasShadow: false,
    icon: path.join(root, 'build', 'icon.png'),
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  panel.setAlwaysOnTop(true, 'screen-saver');
  if (IS_MAC) panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  quitOnClose(panel);
  panel.loadFile(path.join(root, 'src', 'renderer', 'index.html'));
  panel.on('blur', () => { if (!modalOpen && !process.env.PD_KEEP_OPEN && !E2E) hidePanel(); });
}

// Windows closes our windows on shutdown/sign-out or `taskkill`; treat that as Quit
// instead of leaving an invisible process that still holds the hotkey.
function quitOnClose(win) {
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    // Quitting from inside a prevented close would cancel the quit, so defer it.
    setImmediate(() => app.quit());
  });
}

function positionPanel() {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  panel.setBounds({
    x: Math.round(workArea.x + (workArea.width - PANEL_W) / 2),
    y: Math.round(workArea.y + workArea.height * 0.18),
    width: PANEL_W, height: PANEL_H,
  });
}

const hwndOf = (w) => (w && !w.isDestroyed() ? String(w.getNativeWindowHandle().readBigUInt64LE()) : '');

async function showPanel() {
  if (!panel || panel.isDestroyed()) return;
  if (!panel.isVisible()) await paste.rememberForeground([hwndOf(panel), hwndOf(bubble)]);
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
  let pos = settings.bubblePos ?? { x: workArea.x + workArea.width - 76, y: workArea.y + Math.round(workArea.height * 0.45) };
  // A saved position on a monitor that is no longer attached would leave the bubble unreachable.
  const onScreen = screen.getAllDisplays().some(({ workArea: w }) => pos.x >= w.x && pos.y >= w.y && pos.x + 56 <= w.x + w.width && pos.y + 56 <= w.y + w.height);
  if (!onScreen) pos = { x: workArea.x + workArea.width - 76, y: workArea.y + Math.round(workArea.height * 0.45) };
  bubble = new BrowserWindow({
    width: 56, height: 56, x: pos.x, y: pos.y, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  bubble.setAlwaysOnTop(true, 'screen-saver');
  if (IS_MAC) bubble.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  quitOnClose(bubble);
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

// Human label for an accelerator on this OS, e.g. Super+Alt+P → Win+Alt+P / ⌘⌥P.
function keyLabel(accel) {
  const map = IS_MAC ? { Super: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' } : { Super: process.platform === 'win32' ? 'Win' : 'Super', Control: 'Ctrl' };
  const parts = accel.split('+').map((k) => map[k] ?? k);
  return parts.join(IS_MAC ? '' : '+');
}

function createTray() {
  // macOS menu bar and Linux panels expect a small icon; Windows scales the 32 px one itself.
  const trayImg = nativeImage.createFromPath(path.join(root, 'build', 'tray.png'));
  tray = new Tray(process.platform === 'win32' ? trayImg : trayImg.resize({ width: IS_MAC ? 18 : 22, height: IS_MAC ? 18 : 22, quality: 'best' }));
  tray.setToolTip(`PromptDock${activeHotkey ? ` (${keyLabel(activeHotkey)})` : ''}`);
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
    const offline = /fetch failed|ENOTFOUND|ECONN|network|getaddrinfo/i.test(String(e.message ?? e));
    semBroadcast({ status: 'error', error: offline
      ? 'Could not download the search model. Check your internet connection and try again (it is only needed once).'
      : `Semantic search could not start: ${e.message ?? e}` });
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
  handle('settings:get', () => ({ ...settings, hotkeyOk, activeHotkey, dataDir, portable: !!portableDir, // PD_FAKE_PLATFORM (test hook) previews another OS's labels in the UI only.
    platform: process.env.PD_FAKE_PLATFORM || process.platform,
    canAutoPaste: process.env.PD_FAKE_PLATFORM ? process.env.PD_FAKE_PLATFORM === 'win32' : CAN_AUTO_PASTE }));
  handle('settings:set', (patch) => updateSettings(patch));
  handle('semantic:state', () => semState);
  handle('semantic:enable', async () => { settings = store.setSettings({ semanticEnabled: true }); enableSemantic(); return true; });
  handle('semantic:disable', async (opts) => { settings = store.setSettings({ semanticEnabled: false }); disableSemantic(opts); return true; });

  // Render the chosen prompts, copy, and (optionally) paste into the previous window.
  handle('recipes:list', () => store.recipes());
  handle('recipes:save', (r) => store.saveRecipe(r));
  handle('recipes:remove', (id) => store.removeRecipe(id));

  // `text` is a prompt the renderer already compiled; otherwise the prompts are joined here.
  handle('use', async ({ ids, values = {}, mode = 'paste', text: compiled, recipeId }) => {
    const prompts = ids.map((id) => store.get(id)).filter(Boolean);
    const text = typeof compiled === 'string' ? compiled : render(prompts, values, settings.separator);
    if (recipeId) store.markRecipeUsed(recipeId);
    clipboard.writeText(text);
    lastText = text;
    store.markUsed(ids);
    if (Object.keys(values).length) store.setSlotValues(Object.fromEntries(Object.entries(values).filter(([, v]) => v)));
    // Without auto-paste the renderer shows "Copied, press Ctrl+V" and closes the panel itself.
    if (mode === 'copy' || !CAN_AUTO_PASTE || !settings.autoPaste) return { text, pasted: false };
    hidePanel();
    setTimeout(paste.sendPaste, 80);
    return { text, pasted: true };
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

  handle('data:export', async (testPath) => {
    if (E2E && testPath) { fs.writeFileSync(testPath, JSON.stringify(store.exportJSON(), null, 2)); return testPath; }
    modalOpen = true;
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(panel, { defaultPath: 'promptdock-export.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (canceled) return null;
      fs.writeFileSync(filePath, JSON.stringify(store.exportJSON(), null, 2));
      return filePath;
    } finally { modalOpen = false; panel.focus(); }
  });
  handle('data:import', async (testPath) => {
    if (E2E && testPath) { const n = store.importJSON(JSON.parse(fs.readFileSync(testPath, 'utf8'))); afterChange(); return n; }
    modalOpen = true;
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(panel, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (canceled) return null;
      let data;
      try { data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8')); } catch { throw new Error('That file is not valid JSON.'); }
      if (!Array.isArray(data?.prompts)) throw new Error('That file is not a PromptDock export.');
      const n = store.importJSON(data);
      afterChange();
      return n;
    } finally { modalOpen = false; panel.focus(); }
  });
  handle('modal', (open) => { modalOpen = !!open; });
  handle('app:firstRun', () => firstRun);
  if (E2E) handle('test:last', () => lastText);
}

// ---------- e2e ----------
// PD_E2E=<scenario file>: runs it inside the panel; it must evaluate to a Promise of results.
async function runE2E() {
  panel.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('[renderer]', e.message); });
  await new Promise((r) => panel.once('ready-to-show', r));
  showPanel();
  await new Promise((r) => setTimeout(r, 500));
  let out;
  try { out = await panel.webContents.executeJavaScript(fs.readFileSync(process.env.PD_E2E, 'utf8')); }
  catch (e) { out = [{ name: 'scenario crashed', ok: false, info: String(e) }]; }
  console.log('E2E_RESULTS ' + JSON.stringify(out));
  app.exit(out.every((r) => r.ok) ? 0 : 1);
}

// ---------- lifecycle ----------
app.on('second-instance', () => showPanel());
app.on('window-all-closed', (e) => e.preventDefault?.());
app.on('before-quit', () => { quitting = true; });
app.on('session-end', flush); // Windows shutdown / sign-out
app.on('will-quit', () => { globalShortcut.unregisterAll(); flush(); paste.dispose(); });

app.whenReady().then(async () => {
  app.setAppUserModelId('com.vassu.promptdock');
  if (IS_MAC) app.dock?.hide(); // background utility: menu bar icon + bubble, no Dock icon
  if (process.env.PD_THEME) nativeTheme.themeSource = process.env.PD_THEME; // test hook: light | dark
  await openStore();
  registerIpc();
  createPanel();
  createBubble();
  createTray();
  registerWithFallback(settings.hotkey);
  paste.warmUp();
  if (settings.semanticEnabled) enableSemantic();
  // First launch: open the panel so the user sees the app (the renderer then starts the tour).
  if ((process.env.PD_SHOW || firstRun) && !E2E && !process.env.PD_SNAP) panel.once('ready-to-show', showPanel);
  if (E2E) runE2E();
  // Dev/test hook: PD_SNAP=out.png [PD_SNAP_JS=code] captures the panel, then quits.
  if (process.env.PD_SNAP) {
    panel.webContents.on('console-message', (e) => console.log('[renderer]', e.level, e.message));
    panel.once('ready-to-show', async () => {
      await new Promise((r) => setTimeout(r, +(process.env.PD_SNAP_DELAY ?? 0)));
      showPanel();
      await new Promise((r) => setTimeout(r, 700));
      if (process.env.PD_SNAP_JS) console.log('[js]', JSON.stringify(await panel.webContents.executeJavaScript(process.env.PD_SNAP_JS)));
      await new Promise((r) => setTimeout(r, +(process.env.PD_SNAP_WAIT ?? 600)));
      if (panel.isVisible()) fs.writeFileSync(process.env.PD_SNAP, (await panel.webContents.capturePage()).toPNG());
      if (process.env.PD_SNAP_BUBBLE) fs.writeFileSync(process.env.PD_SNAP_BUBBLE, (await bubble.webContents.capturePage()).toPNG());
      app.quit();
    });
  }
});
