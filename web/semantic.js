// Optional "search by meaning" for the web build. Mirrors src/main/semantic.js, but the
// model runs in a Web Worker and embeddings are stored in the same SQLite database.
const MODEL = 'Xenova/all-MiniLM-L6-v2';
const CACHE_NAME = 'transformers-cache';

const textOf = (p) => `${p.title}\n${p.tags.join(' ')}\n${p.body}`;

async function hashOf(p) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(textOf(p)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createSemantic({ getStore, mutate }) {
  let worker = null;
  let ready = false;
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  let state = { status: 'off', progress: 0, error: null };
  let reindexTimer = null;

  const emit = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn(state));
  };

  function call(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, ...payload });
    });
  }

  function startWorker() {
    worker = new Worker(new URL('./semantic-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') return emit({ progress: data.progress });
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.ok ? p.resolve(data) : p.reject(new Error(data.error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Semantic search worker failed'));
      pending.clear();
    };
  }

  function stopWorker() {
    worker?.terminate();
    worker = null;
    ready = false;
    for (const p of pending.values()) p.reject(new Error('stopped'));
    pending.clear();
  }

  async function reindex() {
    if (!ready) return;
    const store = getStore();
    const have = new Map(store.embeddings(MODEL).map((e) => [e.id, e.hash]));
    const todo = [];
    for (const p of store.list()) {
      const h = await hashOf(p);
      if (have.get(p.id) !== h) todo.push({ p, h });
    }
    for (let i = 0; i < todo.length; i += 16) {
      const batch = todo.slice(i, i + 16);
      const { vecs } = await call('embed', { texts: batch.map(({ p }) => textOf(p)) });
      await mutate((st) => {
        batch.forEach(({ p, h }, j) => { if (st.get(p.id)) st.setEmbedding(p.id, MODEL, h, vecs[j]); });
        st.save();
      });
    }
  }

  const api = {
    state: async () => state,
    onState: (fn) => listeners.push(fn),

    async enable() {
      if (ready || worker) return true;
      await mutate((st) => st.setSettings({ semanticEnabled: true }));
      emit({ status: 'downloading', progress: 0, error: null });
      try {
        startWorker();
        await call('load');
        ready = true;
        emit({ status: 'indexing' });
        await reindex();
        emit({ status: 'on' });
      } catch (err) {
        stopWorker();
        await mutate((st) => st.setSettings({ semanticEnabled: false }));
        const offline = !navigator.onLine || /fetch|network|load/i.test(String(err?.message));
        emit({ status: 'error', error: offline
          ? 'Could not download the search model. Check your internet connection and try again (it is only needed once).'
          : `Semantic search could not start: ${err?.message ?? err}` });
      }
      return true;
    },

    async disable({ removeModel = false } = {}) {
      stopWorker();
      await mutate((st) => st.setSettings({ semanticEnabled: false }));
      if (removeModel) {
        await mutate((st) => st.clearEmbeddings());
        try { await caches.delete(CACHE_NAME); } catch { /* Cache API unavailable */ }
      }
      emit({ status: 'off', progress: 0, error: null });
      return true;
    },
  };

  return {
    api,
    /** Map(promptId -> cosine similarity) for a query, or null when semantic search is off. */
    async scores(query) {
      if (!ready || !query.trim()) return null;
      try {
        const { vecs: [q] } = await call('embed', { texts: [query] });
        const map = new Map();
        for (const e of getStore().embeddings(MODEL)) {
          let dot = 0;
          for (let i = 0; i < q.length; i++) dot += q[i] * e.vec[i];
          map.set(e.id, dot);
        }
        return map;
      } catch {
        return null; // keyword search still works
      }
    },
    reindexSoon() {
      clearTimeout(reindexTimer);
      reindexTimer = setTimeout(() => reindex().catch(() => {}), 400);
    },
  };
}
