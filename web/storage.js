// Durable browser storage for the SQLite bytes.
//
// - IndexedDB holds { bytes, version } under one key, written in a single transaction,
//   so a save is all-or-nothing.
// - Every write goes through a cross-tab Web Lock and first checks the stored version:
//   if another tab saved in the meantime, the caller reloads before applying its change,
//   so two tabs never overwrite each other's edits.
// - After a write, other tabs are told via BroadcastChannel (and re-check on focus).
// - If IndexedDB is unavailable (some private modes), it falls back to memory and says so.

const DB_NAME = 'promptdock';
const STORE = 'kv';
const KEY = 'main';
const LOCK = 'promptdock-db';

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openIdb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB is not available'));
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

export async function openStorage() {
  let idb = null;
  try { idb = await openIdb(); } catch { idb = null; }
  const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel(DB_NAME) : null;
  let memory = null; // { bytes, version } when IndexedDB is unavailable

  const storage = {
    mode: idb ? 'indexeddb' : 'memory',

    /** @returns {Promise<{bytes: Uint8Array|null, version: number}>} */
    async read() {
      if (!idb) return memory ?? { bytes: null, version: 0 };
      const rec = await req(idb.transaction(STORE).objectStore(STORE).get(KEY));
      if (!rec) return { bytes: null, version: 0 };
      return { bytes: rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes), version: rec.version ?? 0 };
    },

    /**
     * Compare-and-swap: saves only if the stored version is still `version - 1`, checked in the
     * same transaction. So even without Web Locks a stale tab can never overwrite newer data;
     * it gets a ConflictError and reloads instead.
     */
    async write(bytes, version) {
      if (!idb) { memory = { bytes, version }; return; }
      const tx = idb.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      let conflict = false;
      os.get(KEY).onsuccess = (e) => {
        const cur = e.target.result?.version ?? 0;
        if (cur !== version - 1) { conflict = true; tx.abort(); return; }
        os.put({ bytes, version, savedAt: Date.now() }, KEY);
      };
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = (e) => e.preventDefault?.();
        tx.onabort = () => reject(conflict
          ? Object.assign(new Error('Changed in another tab'), { name: 'ConflictError' })
          : (tx.error ?? new Error('Save was aborted (storage may be full)')));
      });
      channel?.postMessage({ type: 'changed', version });
    },

    /** Keep a copy of unreadable bytes so nothing is silently thrown away. Resolves to whether it was stored. */
    async quarantine(bytes) {
      if (!idb || !bytes) return false;
      try {
        const tx = idb.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ bytes, savedAt: Date.now() }, `corrupt-${Date.now()}`);
        return await new Promise((resolve) => {
          tx.oncomplete = () => resolve(true);
          tx.onerror = tx.onabort = () => resolve(false);
        });
      } catch { return false; }
    },

    /** Run fn while holding the cross-tab write lock (where supported). */
    withLock(fn) {
      return navigator.locks?.request ? navigator.locks.request(LOCK, fn) : fn();
    },

    onRemoteChange(fn) {
      channel?.addEventListener('message', (e) => { if (e.data?.type === 'changed') fn(e.data.version); });
    },

    /** Ask the browser not to evict our data under storage pressure. */
    async persist() {
      try {
        if (!navigator.storage?.persist) return null;
        return (await navigator.storage.persisted()) || (await navigator.storage.persist());
      } catch { return null; }
    },
  };
  return storage;
}
