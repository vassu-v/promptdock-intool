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
