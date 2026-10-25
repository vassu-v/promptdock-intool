// Electron main script for the web e2e run. Loads PD_WEB_URL/web/index.html in
// hidden windows sharing one throwaway session and prints WEB_E2E_RESULTS.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.PD_WEB_URL;
const page = base + '/web/index.html';
const R = [];
const errors = [];
let collect = true;
const check = (name, ok, info = '') => R.push({ name, ok: !!ok, info: ok ? '' : String(info) });
const step = async (name, fn) => { try { await fn(); } catch (e) { R.push({ name, ok: false, info: 'threw: ' + e.message }); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ses;
function open() {
  const win = new BrowserWindow({ width: 900, height: 700, show: false, webPreferences: { session: ses, backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => {
    const lvl = e.level; const msg = e.message;
    if (process.env.PD_TRACE && String(msg).startsWith('[step]')) console.log(msg);
    if (collect && (lvl === 'error' || lvl === 3) && !/favicon/i.test(msg)) errors.push(String(msg));
  });
  return win;
}
const js = (win, code) => win.webContents.executeJavaScript(code, true);
async function ready(win) {
  for (let t = Date.now(); Date.now() - t < 15000; await sleep(100)) {
    if (await js(win, 'window.__pdReady === true').catch(() => false)) return true;
  }
  throw new Error('window.__pdReady not set within 15 s');
}
async function load(win) { await win.loadURL(page); await ready(win); }
async function reload(win) {
  const done = new Promise((r) => win.webContents.once('did-finish-load', r));
  win.webContents.reload(); await done; await ready(win);
}
const titles = (win) => js(win, 'pd.list().then((l) => l.map((p) => p.title))');
async function until(fn, ms = 1500) {
  const t = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - t > ms) return false; await sleep(100); }
}

async function run() {
  ses = session.fromPartition('pd-web-test-' + Date.now());
  const A = open();
  let B;

  await step('functional scenario', async () => {
    await load(A);
    const res = await js(A, fs.readFileSync(path.join(__dirname, 'scenario-web.js'), 'utf8'));
    R.push(...res);
  });

  await step('persistence', async () => {
    await reload(A);
    check('data survives reload', (await titles(A)).includes('Translate text'), await titles(A));
    check('tour not shown again', await js(A, "document.querySelector('#tour').hidden"));
  });

  await step('multi-tab live sync', async () => {
    B = open(); await load(B);
    await js(A, "pd.create({ title: 'Synced from A', body: 'Hello from tab A' })");
    const listed = await until(async () => (await titles(B)).includes('Synced from A'));
    check('other tab sees new prompt via pd.list', listed, await titles(B));
    const shown = await until(() => js(B, `(() => {
      const q = document.querySelector('#q'); q.value = 'synced'; q.dispatchEvent(new Event('input', { bubbles: true }));
      return new Promise((r) => setTimeout(() => r([...document.querySelectorAll('#results li[data-i] .t')].some((e) => e.textContent === 'Synced from A')), 150));
    })()`));
    check('other tab renders new prompt in results', shown);
  });

  await step('no lost updates', async () => {
    await Promise.all([
      js(A, "pd.create({ title: 'Concurrent A', body: 'written by tab A' })"),
      js(B, "pd.create({ title: 'Concurrent B', body: 'written by tab B' })"),
    ]);
    await sleep(1500);
    for (const [n, w] of [['A', A], ['B', B]]) {
      const t = await titles(w);
      check(`tab ${n} has both concurrent prompts`, t.includes('Concurrent A') && t.includes('Concurrent B'), t.filter((x) => x.startsWith('Concurrent')));
    }
  });

  await step('no lost updates without Web Locks', async () => {
    // Older Safari/Firefox have no navigator.locks; the compare-and-swap save must still protect edits.
    for (const w of [A, B]) await js(w, "Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }); true");
    await Promise.all([
      js(A, "Promise.all([1,2,3].map((i) => pd.create({ title: 'NoLock A' + i, body: 'a' })))"),
      js(B, "Promise.all([1,2,3].map((i) => pd.create({ title: 'NoLock B' + i, body: 'b' })))"),
    ]);
    await sleep(1500);
    const t = await titles(A);
    const got = t.filter((x) => x.startsWith('NoLock')).length;
    check('all 6 concurrent edits survive without locks', got === 6, t.filter((x) => x.startsWith('NoLock')));
  });

  await step('stale save is refused', async () => {
    const name = await js(A, `(async () => {
      const { openStorage } = await import('/web/storage.js');
      const s = await openStorage();
      const r = await s.read();
      try { await s.write(r.bytes, r.version); return 'saved over newer data'; } catch (e) { return e.name; }
    })()`);
    check('write with an old version raises ConflictError', name === 'ConflictError', name);
  });

  await step('messy import data is cleaned, not half-saved', async () => {
    const before = (await titles(A)).length;
    const res = await js(A, `pd.importData(JSON.stringify({ prompts: [{ title: 'Messy 1', body: 'x', tags: [1, 'a'] }, { title: 'Messy 2', body: 'y', tags: 'b, c' }] })).then((n) => n, (e) => e.message)`);
    const t = await titles(A);
    check('messy import adds both prompts atomically', res === 2 && t.length === before + 2, `${res} | ${t.length - before}`);
  });

  collect = false; // errors are expected while recovering from corrupt data
  await step('corrupt data recovery', async () => {
    if (B) { B.destroy(); B = null; }
    const n = await js(A, `new Promise((resolve, reject) => {
      const rq = indexedDB.open('promptdock');
      rq.onerror = () => reject(rq.error);
      rq.onsuccess = () => {
        const db = rq.result; const names = [...db.objectStoreNames]; let count = 0;
        if (!names.length) { db.close(); return resolve(0); }
        const tx = db.transaction(names, 'readwrite');
        for (const name of names) {
          tx.objectStore(name).openCursor().onsuccess = (e) => {
            const c = e.target.result; if (!c) return;
            const v = c.value;
            const isBytes = (x) => x instanceof Uint8Array || x instanceof ArrayBuffer;
            // getRandomValues is limited to 64 KB per call, so fill in chunks.
            const junk = (x) => { const r = new Uint8Array(x.byteLength); for (let i = 0; i < r.length; i += 65536) crypto.getRandomValues(r.subarray(i, i + 65536)); return x instanceof ArrayBuffer ? r.buffer : r; };
            // Raw bytes, or a record like { bytes, version, savedAt } (key 'main' in 'kv').
            if (isBytes(v)) { c.update(junk(v)); count++; }
            else if (v && typeof v === 'object' && isBytes(v.bytes)) { c.update({ ...v, bytes: junk(v.bytes) }); count++; }
            c.continue();
          };
        }
        tx.oncomplete = () => { db.close(); resolve(count); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('transaction aborted')); };
      };
    })`);
    check('found stored bytes to corrupt', n > 0, `${n} binary values`);
    await reload(A);
    const t = await titles(A);
    check('corrupt data falls back to 6 seeds', t.length === 6, t);
    const banner = await js(A, `(() => { const b = document.querySelector('#storage-banner');
      return b ? { shown: !b.hidden && b.offsetParent !== null && getComputedStyle(b).visibility !== 'hidden', text: b.textContent } : null; })()`);
    check('storage warning banner shown', banner && banner.shown && banner.text.trim(), JSON.stringify(banner));
  });

  check('no console errors', !errors.length, errors.slice(0, 5).join(' | '));
}

app.whenReady().then(async () => {
  try { await run(); } catch (e) { R.push({ name: 'runner', ok: false, info: 'threw: ' + e.message }); }
  console.log('WEB_E2E_RESULTS ' + JSON.stringify(R));
  app.exit(R.every((r) => r.ok) ? 0 : 1);
});
app.on('window-all-closed', () => {});
