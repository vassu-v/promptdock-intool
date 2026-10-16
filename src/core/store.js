// SQLite storage via sql.js (WebAssembly). The same class runs in Node/Electron
// (persisted to a .sqlite file) and in a browser (persist bytes to IndexedDB).
// The caller passes `bytes` to load and a `persist(bytes)` callback to save.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS slot_values (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS embeddings (
  prompt_id INTEGER PRIMARY KEY REFERENCES prompts(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  hash TEXT NOT NULL,
  vec BLOB NOT NULL
);
PRAGMA user_version = 1;
`;

export const DEFAULT_SETTINGS = {
  hotkey: 'Super+Control+P',
  autoPaste: true,
  showBubble: true,
  separator: '\n\n',
  semanticEnabled: false,
  launchAtLogin: false,
  opacity: 0.86,
  tourDone: false,
};

const now = () => new Date().toISOString();

function rowToPrompt(r) {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    tags: JSON.parse(r.tags || '[]'),
    pinned: !!r.pinned,
    useCount: r.use_count,
    lastUsed: r.last_used,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags ?? '').split(',');
  return [...new Set(list.map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))];
}

export class PromptStore {
  /** @param SQL initialised sql.js module, @param bytes Uint8Array|null, @param persist (bytes)=>void */
  constructor(SQL, bytes, persist = () => {}) {
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this._persist = persist;
  }

  _all(sql, params = []) {
    const st = this.db.prepare(sql);
    st.bind(params);
    const rows = [];
    while (st.step()) rows.push(st.getAsObject());
    st.free();
    return rows;
  }

  _run(sql, params = []) {
    this.db.run(sql, params);
  }

  save() {
    this._persist(this.db.export());
  }

  // ---- prompts ----
  list() {
    return this._all('SELECT * FROM prompts ORDER BY updated_at DESC').map(rowToPrompt);
  }

  get(id) {
    const r = this._all('SELECT * FROM prompts WHERE id = ?', [id])[0];
    return r ? rowToPrompt(r) : null;
  }

  create({ title, body, tags = [], pinned = false }) {
    if (!String(body ?? '').trim()) throw new Error('Prompt body is empty');
    const t = now();
    const finalTitle = String(title ?? '').trim() || String(body).trim().split('\n')[0].slice(0, 60);
    this._run(
      'INSERT INTO prompts (title, body, tags, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [finalTitle, body, JSON.stringify(cleanTags(tags)), pinned ? 1 : 0, t, t],
    );
    const id = this._all('SELECT last_insert_rowid() AS id')[0].id;
    this.save();
    return this.get(id);
  }

  update(id, patch) {
    const cur = this.get(id);
    if (!cur) throw new Error(`No prompt ${id}`);
    const next = { ...cur, ...patch };
    if (patch.tags !== undefined) next.tags = cleanTags(patch.tags);
    if (!String(next.body ?? '').trim()) throw new Error('Prompt body is empty');
    this._run(
      'UPDATE prompts SET title = ?, body = ?, tags = ?, pinned = ?, updated_at = ? WHERE id = ?',
      [String(next.title).trim() || cur.title, next.body, JSON.stringify(next.tags), next.pinned ? 1 : 0, now(), id],
    );
    this.save();
    return this.get(id);
  }

  remove(id) {
    this._run('DELETE FROM prompts WHERE id = ?', [id]);
    this.save();
  }

  markUsed(ids) {
    const t = now();
    for (const id of ids) this._run('UPDATE prompts SET use_count = use_count + 1, last_used = ? WHERE id = ?', [t, id]);
    this.save();
  }

  allTags() {
    const counts = new Map();
    for (const p of this.list()) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
  }

  // ---- remembered slot values (local to this machine/user, editable) ----
  slotValues() {
    return Object.fromEntries(this._all('SELECT name, value FROM slot_values').map((r) => [r.name, r.value]));
  }

  setSlotValues(values) {
    const t = now();
    for (const [name, value] of Object.entries(values)) {
      if (value === null || value === '') this._run('DELETE FROM slot_values WHERE name = ?', [name]);
      else this._run('INSERT INTO slot_values (name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [name, String(value), t]);
    }
    this.save();
  }

  // ---- settings ----
  settings() {
    const stored = Object.fromEntries(this._all('SELECT key, value FROM settings').map((r) => [r.key, JSON.parse(r.value)]));
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  setSettings(patch) {
    for (const [k, v] of Object.entries(patch)) {
      this._run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)]);
    }
    this.save();
    return this.settings();
  }

  // ---- embeddings (optional semantic search) ----
  embeddings(model) {
    return this._all('SELECT prompt_id, hash, vec FROM embeddings WHERE model = ?', [model]).map((r) => ({
      id: r.prompt_id,
      hash: r.hash,
      vec: new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength)),
    }));
  }

  setEmbedding(id, model, hash, vec) {
    this._run('INSERT INTO embeddings (prompt_id, model, hash, vec) VALUES (?, ?, ?, ?) ON CONFLICT(prompt_id) DO UPDATE SET model = excluded.model, hash = excluded.hash, vec = excluded.vec', [id, model, hash, new Uint8Array(vec.buffer)]);
  }

  clearEmbeddings() {
    this._run('DELETE FROM embeddings');
    this.save();
  }

  // ---- import / export ----
  exportJSON() {
    return { app: 'PromptDock', version: 1, exportedAt: now(), prompts: this.list().map(({ id, useCount, lastUsed, ...p }) => p), slotValues: this.slotValues() };
  }

  importJSON(data) {
    const existing = new Set(this.list().map((p) => `${p.title}\u0000${p.body}`));
    let added = 0;
    for (const p of data?.prompts ?? []) {
      if (!p?.body || existing.has(`${p.title}\u0000${p.body}`)) continue;
      this.create(p);
      added++;
    }
    if (data?.slotValues) this.setSlotValues(data.slotValues);
    return added;
  }
}
