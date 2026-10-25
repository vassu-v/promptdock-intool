import { test } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { parseSlots, fillSlots } from '../src/core/slots.js';
import { render, slotsFor } from '../src/core/compose.js';
import { search, parseQuery } from '../src/core/search.js';
import { PromptStore } from '../src/core/store.js';

const SQL = await initSqlJs();

test('parseSlots finds unique slots with defaults, in order', () => {
  const s = parseSlots('Refactor {{file}} using {{ pattern : hooks }} then test {{file}}');
  assert.deepEqual(s, [{ name: 'file', default: '' }, { name: 'pattern', default: 'hooks' }]);
});

test('fillSlots uses value, then default, else leaves slot', () => {
  const t = 'A {{x}} B {{y:def}} C {{z}}';
  assert.equal(fillSlots(t, { x: '1' }), 'A 1 B def C {{z}}');
  assert.equal(fillSlots(t, { x: '1', y: '2', z: '3' }), 'A 1 B 2 C 3');
});

test('compose joins in order and merges slots', () => {
  const ps = [{ body: 'Hi {{name}}' }, { body: '  ' }, { body: 'Bye {{name}} from {{team}}' }];
  assert.deepEqual(slotsFor(ps).map((s) => s.name), ['name', 'team']);
  assert.equal(render(ps, { name: 'Sam', team: 'QA' }, '\n---\n'), 'Hi Sam\n---\nBye Sam from QA');
});

test('search: query parsing, tags, keyword and fuzzy', () => {
  assert.deepEqual(parseQuery('Fix #ui  layout'), { tags: ['ui'], words: ['fix', 'layout'] });
  const ps = [
    { id: 1, title: 'Make UI responsive', body: 'Make the layout work on phones', tags: ['ui', 'css'], pinned: false, useCount: 0 },
    { id: 2, title: 'Write unit tests', body: 'Add tests for edge cases', tags: ['testing'], pinned: true, useCount: 5 },
    { id: 3, title: 'Code review', body: 'Review this diff for bugs', tags: ['review'], pinned: false, useCount: 9 },
  ];
  assert.equal(search(ps, 'responsive')[0].prompt.id, 1);
  assert.equal(search(ps, 'respnsive')[0]?.prompt.id, 1, 'fuzzy typo');
  assert.deepEqual(search(ps, '#test').map((r) => r.prompt.id), [2]);
  assert.equal(search(ps, 'nothing-matches-this').length, 0);
  assert.deepEqual(search(ps, '').map((r) => r.prompt.id), [2, 3, 1], 'pinned, then most used');
  const sem = new Map([[3, 0.8], [1, 0.1]]);
  assert.equal(search(ps, 'check my changes', { semantic: sem })[0].prompt.id, 3, 'semantic-only hit');
});

test('store: CRUD, tags, use counts, slot values, settings', () => {
  let saved = 0;
  const st = new PromptStore(SQL, null, () => saved++);
  const p = st.create({ body: 'Explain {{topic}} simply\nmore', tags: '#Learn, explain, learn' });
  assert.equal(p.title, 'Explain {{topic}} simply');
  assert.deepEqual(p.tags, ['learn', 'explain']);
  const u = st.update(p.id, { body: 'Explain {{topic}} to a {{audience:beginner}}', pinned: true });
  assert.equal(u.pinned, true);
  assert.throws(() => st.update(p.id, { body: '  ' }));
  st.markUsed([p.id]);
  assert.equal(st.get(p.id).useCount, 1);
  st.setSlotValues({ topic: 'closures' });
  assert.deepEqual(st.slotValues(), { topic: 'closures' });
  st.setSlotValues({ topic: '' });
  assert.deepEqual(st.slotValues(), {});
  assert.equal(st.settings().autoPaste, true);
  assert.equal(st.setSettings({ autoPaste: false }).autoPaste, false);
  assert.ok(saved > 0);
  st.remove(p.id);
  assert.equal(st.list().length, 0);
});

test('store: persists through bytes, embeddings round-trip, import/export', () => {
  let bytes = null;
  const a = new PromptStore(SQL, null, (b) => (bytes = b));
  const p = a.create({ title: 'T', body: 'B', tags: ['x'] });
  a.setEmbedding(p.id, 'm', 'h', new Float32Array([0.5, -1, 2]));
  a.save();
  const b = new PromptStore(SQL, bytes);
  assert.equal(b.get(p.id).title, 'T');
  assert.deepEqual([...b.embeddings('m')[0].vec], [0.5, -1, 2]);
  const dump = b.exportJSON();
  const c = new PromptStore(SQL, null);
  assert.equal(c.importJSON(dump), 1);
  assert.equal(c.importJSON(dump), 0, 'duplicates skipped');
  b.remove(p.id);
  assert.equal(b.embeddings('m').length, 0, 'cascade delete');
});

test('search ranks whole-word matches above prefixes', () => {
  const ps = [42, 427, 428, 429].map((n) => ({ id: n, title: `Bulk prompt ${n}`, body: '', tags: [], pinned: false, useCount: 0 }));
  assert.equal(search(ps, 'bulk prompt 42')[0].prompt.id, 42);
});

test('slot names can use non-Latin scripts', () => {
  assert.deepEqual(parseSlots('नमस्ते {{नाम}} {{名前:太郎}}').map((s) => s.name), ['नाम', '名前']);
  assert.equal(fillSlots('Hi {{नाम}}', { 'नाम': 'Asha' }), 'Hi Asha');
});

test('import is all-or-nothing and saves once', () => {
  let saves = 0;
  const st = new PromptStore(SQL, null, () => saves++);
  saves = 0;
  const n = st.importJSON({ prompts: [{ title: 'A', body: 'a', tags: [1, 'x'] }, { title: 'B', body: 'b' }] });
  assert.equal(n, 2);
  assert.deepEqual(st.list().find((p) => p.title === 'A').tags, ['1', 'x']);
  assert.equal(saves, 1, 'one save for the whole import');
  const bad = { title: 'D', body: { toString() { throw new Error('unreadable'); } } };
  assert.throws(() => st.importJSON({ prompts: [{ title: 'C', body: 'c' }, bad] }));
  assert.ok(!st.list().some((p) => p.title === 'C'), 'failed import leaves nothing behind');
});

// ---- compile ----
import { compile } from '../src/core/compile.js';

const blk = (id, role, body, title = `p${id}`) => ({ prompt: { id, role, body, title } });

test('compile orders by role, or keeps stack order', () => {
  const st = [blk(1, 'format', 'Answer as a table.'), blk(2, 'role', 'You are a senior {{lang}} dev.'), blk(3, 'task', 'Review {{file}}.')];
  assert.equal(compile(st).text, 'You are a senior {{lang}} dev.\n\nReview {{file}}.\n\nAnswer as a table.');
  assert.equal(compile(st, { ordering: 'stack' }).text.split('\n\n')[0], 'Answer as a table.');
});

test('compile merges slots across blocks and fills them once', () => {
  const st = [blk(1, 'role', 'You know {{lang:Go}}.'), blk(2, 'task', 'Port this to {{lang}} in {{file}}.')];
  const r = compile(st, { values: { file: 'a.go' } });
  assert.deepEqual(r.slots.map((s) => s.name), ['lang', 'file']);
  assert.equal(r.text, 'You know Go.\n\nPort this to {{lang}} in a.go.'); // default only where written inline
  assert.equal(compile(st, { values: { lang: 'Rust', file: 'x' } }).text, 'You know Rust.\n\nPort this to Rust in x.');
});

test('compile drops repeated sentences and skips disabled blocks', () => {
  const st = [blk(1, 'task', 'Fix the bug. Be concise and direct.'), { ...blk(2, 'task', 'Never shown.'), on: false },
    blk(3, 'constraints', 'be concise and direct!\nKeep the public API.')];
  const r = compile(st);
  assert.equal(r.text, 'Fix the bug. Be concise and direct.\n\nKeep the public API.');
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0].from, 'p3');
});

test('compile flags simple contradictions', () => {
  const r = compile([blk(1, 'task', 'Be concise.'), blk(2, 'constraints', 'Give a detailed answer.')]);
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0], /concise.*detailed/);
  assert.equal(compile([blk(1, 'task', 'Be concise.')]).conflicts.length, 0);
});

test('compile renders markdown sections and xml tags, grouping same roles', () => {
  const st = [blk(1, 'context', 'Repo is a CLI.'), blk(2, 'task', 'Add a flag.'), blk(3, 'task', 'Update the docs.')];
  assert.equal(compile(st, { format: 'markdown' }).text, '## Context\n\nRepo is a CLI.\n\n## Task\n\nAdd a flag.\n\nUpdate the docs.');
  assert.equal(compile(st, { format: 'xml' }).text, '<context>\nRepo is a CLI.\n</context>\n\n<task>\nAdd a flag.\n\nUpdate the docs.\n</task>');
});

test('store: roles, recipes, migration and export/import round trip', () => {
  // An old v1 file without the role column still opens.
  const old = new SQL.Database();
  old.exec("CREATE TABLE prompts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', pinned INTEGER NOT NULL DEFAULT 0, use_count INTEGER NOT NULL DEFAULT 0, last_used TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); INSERT INTO prompts (title, body, created_at, updated_at) VALUES ('Old', 'old body', 'x', 'x');");
  const s = new PromptStore(SQL, old.export());
  assert.equal(s.list()[0].role, 'task');

  const a = s.create({ title: 'Senior', body: 'You are senior.', role: 'role' });
  const b = s.create({ title: 'Bogus', body: 'b', role: 'nonsense' });
  assert.equal(a.role, 'role');
  assert.equal(b.role, 'task');
  assert.equal(s.update(b.id, { role: 'format' }).role, 'format');
  assert.throws(() => s.saveRecipe({ name: '', items: [{ id: a.id }] }), /name/);
  assert.throws(() => s.saveRecipe({ name: 'x', items: [] }), /at least one/);
  const r = s.saveRecipe({ name: 'PR review', items: [{ id: b.id }, { id: a.id, on: false }], format: 'xml' });
  assert.deepEqual(r.items, [{ id: b.id, on: true }, { id: a.id, on: false }]);
  assert.equal(s.saveRecipe({ id: r.id, name: 'PR review 2', items: r.items }).name, 'PR review 2');
  assert.equal(s.recipes().length, 1);

  const fresh = new PromptStore(SQL, null);
  fresh.create({ title: 'Senior', body: 'You are senior.' }); // already there: reused, not duplicated
  assert.equal(fresh.importJSON(JSON.parse(JSON.stringify(s.exportJSON()))), 2);
  const [imp] = fresh.recipes();
  assert.equal(imp.name, 'PR review 2');
  assert.deepEqual(imp.items.map((it) => fresh.get(it.id).title), ['Bogus', 'Senior']);
  assert.equal(imp.items[1].on, false);
  assert.equal(fresh.importJSON(s.exportJSON()), 0);
  assert.equal(fresh.recipes().length, 1); // same-name recipe not duplicated
  s.removeRecipe(r.id);
  assert.equal(s.recipes().length, 0);
});
