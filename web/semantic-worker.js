// Runs the embedding model off the main thread. The library comes from a pinned CDN
// version; the model (~23 MB) downloads once and the browser caches it.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/+esm';
const MODEL = 'Xenova/all-MiniLM-L6-v2';

let extractor = null;

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      const { pipeline, env } = await import(LIB);
      env.allowLocalModels = false;
      extractor = await pipeline('feature-extraction', MODEL, {
        dtype: 'q8',
        progress_callback: (e) => {
          if (e.status === 'progress') self.postMessage({ type: 'progress', progress: Math.round(e.progress ?? 0) });
        },
      });
      self.postMessage({ id, ok: true });
    } else if (type === 'embed') {
      const out = await extractor(data.texts, { pooling: 'mean', normalize: true });
      const dim = out.dims.at(-1);
      const vecs = data.texts.map((_, i) => out.data.slice(i * dim, (i + 1) * dim));
      self.postMessage({ id, ok: true, vecs }, vecs.map((v) => v.buffer));
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
