// Optional semantic search. The library ships with the app, but the model
// (~23 MB) is only downloaded when the user turns the feature on.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MODEL = 'Xenova/all-MiniLM-L6-v2';

let extractor = null;
let loading = null;

const textOf = (p) => `${p.title}\n${p.tags.join(' ')}\n${p.body}`;
const hashOf = (p) => createHash('sha1').update(textOf(p)).digest('hex');

export async function isAvailable() {
  try { await import('@huggingface/transformers'); return true; } catch { return false; }
}

export function isModelDownloaded(cacheDir) {
  return fs.existsSync(path.join(cacheDir, ...MODEL.split('/'), 'onnx'));
}

export async function load(cacheDir, onProgress = () => {}) {
  if (extractor) return extractor;
  loading ??= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = cacheDir;
    env.allowLocalModels = true;
    if (process.env.PD_MODEL_HOST) env.remoteHost = process.env.PD_MODEL_HOST; // test hook (e.g. simulate offline)
    extractor = await pipeline('feature-extraction', MODEL, {
      dtype: 'q8',
      progress_callback: (e) => { if (e.status === 'progress') onProgress(Math.round(e.progress ?? 0)); },
    });
    return extractor;
  })();
  try { return await loading; } finally { loading = null; }
}

export function unload() { extractor = null; }
export const isLoaded = () => !!extractor;

async function embed(text) {
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return new Float32Array(out.data);
}

/** Embed any prompt whose text changed since it was last embedded. */
export async function reindex(store) {
  if (!extractor) return 0;
  const have = new Map(store.embeddings(MODEL).map((e) => [e.id, e.hash]));
  let n = 0;
  for (const p of store.list()) {
    const h = hashOf(p);
    if (have.get(p.id) === h) continue;
    store.setEmbedding(p.id, MODEL, h, await embed(textOf(p)));
    n++;
  }
  if (n) store.save();
  return n;
}

/** Map(promptId -> cosine similarity) for a query. Vectors are normalised, so dot = cosine. */
export async function scores(store, query) {
  if (!extractor || !query.trim()) return null;
  const q = await embed(query);
  const map = new Map();
  for (const e of store.embeddings(MODEL)) {
    let dot = 0;
    for (let i = 0; i < q.length; i++) dot += q[i] * e.vec[i];
    map.set(e.id, dot);
  }
  return map;
}
