// Browser implementation of the `window.pd` API that the shared UI (src/renderer/app.js)
// talks to. On the desktop the same API is served by Electron's main process over IPC.
import { PromptStore } from '../src/core/store.js';
import { search } from '../src/core/search.js';
import { render } from '../src/core/compose.js';
import { SEED_PROMPTS } from '../src/main/seed.js';
import { openStorage } from './storage.js';
import { createSemantic } from './semantic.js';

const macKeys = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || '');

async function copyText(text) {
  try {
    // Some browsers leave this pending while the page is unfocused, so don't wait forever.
    await Promise.race([
      navigator.clipboard.writeText(text),
      new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard timeout')), 1500)),
    ]);
    return true;
  } catch { /* fall back below: no permission, unfocused document or insecure context */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile() {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', () => resolve(input.files[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!Array.isArray(data?.prompts)) throw new Error('That file is not a PromptDock export.');
  return data;
}

/**
 * Builds window.pd. `notices` collects problems the page should show in its banner
 * (memory-only storage, recovered corrupt data, failed saves).
 */
export async function createWebPd(SQL, notices) {
  const storage = await openStorage();
  if (storage.mode === 'memory') {
    notices.push('This browser is blocking storage (private mode?), so prompts are kept only until you close the tab. Use Export JSON to keep them.');
  }

  let store = null;
  let version = 0;
  let pendingBytes = null;
  let lastText = null;
  let persistent = null;
  const externalListeners = [];

  const capture = (bytes) => { pendingBytes = bytes; };

  async function loadFrom(rec) {
    try {
      store = new PromptStore(SQL, rec.bytes, capture);
      store.list(); // touch the data so an unreadable file fails here, not later
      version = rec.version;
    } catch {
      await storage.quarantine(rec.bytes);
      notices.push('Your saved prompts could not be read, so PromptDock started fresh. A copy of the damaged data was kept in browser storage.');
      store = new PromptStore(SQL, null, capture);
      version = rec.version; // the next save replaces the damaged record
    }
  }

  /** Apply a change under the cross-tab lock, on the latest data, and save it atomically. */
  async function mutate(fn) {
    return storage.withLock(async () => {
      const rec = await storage.read();
      if (rec.version !== version) await loadFrom(rec);
      pendingBytes = null;
      const result = fn(store);
      if (pendingBytes) {
        try {
          await storage.write(pendingBytes, version + 1);
          version += 1;
        } catch (err) {
          await loadFrom(await storage.read()); // stay consistent with what is really saved
          throw new Error(`Could not save (${err?.message ?? 'storage error'}). Export a backup from Settings.`);
        } finally {
          pendingBytes = null;
        }
        if (persistent === null) persistent = await storage.persist();
      }
      return result;
    });
  }

  async function refreshFromStorage() {
    const rec = await storage.read();
    if (rec.version === version) return;
    await loadFrom(rec);
    externalListeners.forEach((fn) => fn());
  }

  // ---- initial load (+ first-run seed, done under the lock so two new tabs can't both seed) ----
  await loadFrom(await storage.read());
  await mutate((st) => {
    if (!st.settings().seeded) {
      if (!st.list().length) for (const p of SEED_PROMPTS) st.create(p);
      st.setSettings({ seeded: true });
    }
  });
  persistent = await storage.persist();

  storage.onRemoteChange(() => refreshFromStorage());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshFromStorage(); });

  const semantic = createSemantic({ getStore: () => store, mutate });

  const settings = () => ({
    ...store.settings(),
    platform: 'web',
    canAutoPaste: false,
    macKeys,
    hotkeyOk: true,
    activeHotkey: null,
    portable: false,
    storage: { mode: storage.mode, persistent },
    dataDir: storage.mode === 'memory'
      ? 'this tab only (browser storage is blocked)'
      : `this browser${persistent ? ', protected from automatic cleanup' : ''}. Export a backup now and then`,
  });

  const pd = {
    list: async () => store.list(),
    search: async (q) => search(store.list(), q, { semantic: await semantic.scores(q) }),
    create: (p) => mutate((st) => st.create(p)).then((r) => { semantic.reindexSoon(); return r; }),
    update: (id, patch) => mutate((st) => st.update(id, patch)).then((r) => { semantic.reindexSoon(); return r; }),
    remove: (id) => mutate((st) => st.remove(id)),
    tags: async () => store.allTags(),
    slotValues: async () => store.slotValues(),
    setSlotValues: (v) => mutate((st) => st.setSlotValues(v)),
    settings: async () => settings(),
    setSettings: async (patch) => { await mutate((st) => st.setSettings(patch)); return settings(); },

    async use({ ids, values = {}, mode }) {
      const prompts = ids.map((id) => store.get(id)).filter(Boolean);
      const text = render(prompts, values, store.settings().separator);
      lastText = text;
      const copied = await copyText(text); // starts inside the key/click event, before any other await
      const kept = Object.fromEntries(Object.entries(values).filter(([, v]) => v));
      await mutate((st) => {
        st.markUsed(ids);
        if (Object.keys(kept).length) st.setSlotValues(kept);
      });
      return { text, pasted: false, copied, mode };
    },

    hide: async () => { document.activeElement?.blur?.(); },
    modal: async () => {},
    firstRun: async () => false,
    testLast: async () => lastText,

    async exportData(arg) {
      const json = JSON.stringify(store.exportJSON(), null, 2);
      if (arg === 'return') return json;
      download(`promptdock-backup-${new Date().toISOString().slice(0, 10)}.json`, json);
      return 'downloaded';
    },

    async importData(arg) {
      let text = typeof arg === 'string' ? arg : null;
      if (text === null) {
        const file = await pickFile();
        if (!file) return null;
        text = await file.text();
      }
      const data = parseImport(text);
      const n = await mutate((st) => st.importJSON(data));
      semantic.reindexSoon();
      return n;
    },

    semantic: semantic.api,
    bubble: { click: async () => {}, move: async () => {}, moved: async () => {} },
    onShown: () => {},
    onExternalChange: (fn) => externalListeners.push(fn),
  };

  if (store.settings().semanticEnabled) semantic.api.enable();
  return pd;
}
