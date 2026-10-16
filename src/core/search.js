// Keyword + fuzzy search with no dependencies. Optional semantic scores can be blended in.
// Query syntax: plain words, plus `#tag` to require a tag.

export function parseQuery(q) {
  const tags = [];
  const words = [];
  for (const part of String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean)) {
    if (part.startsWith('#') && part.length > 1) tags.push(part.slice(1));
    else words.push(part);
  }
  return { tags, words };
}

/** Is `needle` a subsequence of `hay`? Returns a 0..1 tightness score, or 0. */
function subsequence(needle, hay) {
  let i = 0, first = -1, last = -1;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) { if (first < 0) first = j; last = j; i++; }
  }
  if (i < needle.length) return 0;
  return needle.length / (last - first + 1);
}

function fieldScore(word, text) {
  if (!text) return 0;
  const idx = text.indexOf(word);
  if (idx >= 0) {
    // Whole word > start of a word > anywhere inside a word.
    const end = idx + word.length;
    const atWordEnd = end === text.length || /\W/.test(text[end]);
    if ((idx === 0 || /\W/.test(text[idx - 1])) && atWordEnd) return 1;
    if (text.split(/\W+/).includes(word)) return 1;
    const atWordStart = idx === 0 || /\W/.test(text[idx - 1]);
    return atWordStart ? 0.85 : 0.7;
  }
  if (word.length < 3) return 0;
  // Fuzzy: best subsequence match against any single word in the field.
  let best = 0;
  for (const w of text.split(/\W+/)) {
    if (w.length >= word.length - 1) best = Math.max(best, subsequence(word, w));
  }
  return best >= 0.75 ? best * 0.5 : 0;
}

export function keywordScore(prompt, words) {
  if (!words.length) return 0;
  const title = (prompt.title ?? '').toLowerCase();
  const tags = (prompt.tags ?? []).join(' ').toLowerCase();
  const body = (prompt.body ?? '').toLowerCase();
  let total = 0;
  for (const w of words) {
    const s = 3 * fieldScore(w, title) + 2 * fieldScore(w, tags) + fieldScore(w, body);
    if (s === 0) return 0; // every word must match somewhere
    total += s;
  }
  return total / (6 * words.length); // normalise to 0..1
}

/**
 * Rank prompts. `semantic` is an optional Map(id -> cosine similarity 0..1).
 * With no words, results are ordered pinned → most used → most recent.
 */
export function search(prompts, query, { semantic = null, limit = 50 } = {}) {
  const { tags, words } = parseQuery(query);
  const tagged = prompts.filter((p) => {
    const pt = (p.tags ?? []).map((t) => t.toLowerCase());
    return tags.every((t) => pt.some((x) => x.startsWith(t)));
  });

  if (!words.length) {
    return [...tagged]
      .sort((a, b) => (b.pinned - a.pinned) || (b.useCount - a.useCount) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, limit)
      .map((p) => ({ prompt: p, score: 0 }));
  }

  const scored = [];
  for (const p of tagged) {
    const k = keywordScore(p, words);
    const s = semantic?.get(p.id) ?? 0;
    // MiniLM similarities for related short texts sit around 0.2-0.6; below 0.2 is noise.
    const sem = s >= 0.2 ? s : 0;
    const score = semantic ? Math.max(k, 0.5 * k + sem) : k;
    if (score > 0) scored.push({ prompt: p, score: score + (p.pinned ? 0.02 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
