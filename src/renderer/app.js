import { parseSlots } from '../core/slots.js';
import { render, slotsFor } from '../core/compose.js';
import { compile, ROLES } from '../core/compile.js';

const $ = (s) => document.querySelector(s);
const pd = window.pd;

const state = {
  view: 'search',
  results: [],
  sel: 0,
  tray: [],          // prompts queued for composing, in order
  fill: null,        // { prompts, slots }
  editing: null,     // prompt being edited, or null for new
  settings: null,
  library: [],       // every prompt, for the compiler
  byId: new Map(),
  recipes: [],       // all saved recipes
  recipeHits: [],    // recipes shown under the search results
  c: { items: [], format: 'plain', ordering: 'role', recipeId: null, values: {}, sugg: [], suggSel: 0, result: null },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), ms);
}

function show(view) {
  state.view = view;
  for (const v of ['search', 'fill', 'edit', 'settings', 'compile']) $(`#view-${v}`).hidden = v !== view;
}

// ---------------- search ----------------
let searchSeq = 0;
let searchTimer = null;
let searchDone = Promise.resolve();

/** Run any search still waiting on the typing debounce, and wait for the latest one to finish. */
function flushSearch() {
  if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; searchDone = runSearch(); }
  return searchDone;
}

async function runSearch() {
  const seq = ++searchSeq;
  const [res] = await Promise.all([pd.search($('#q').value), loadLibrary()]);
  if (seq !== searchSeq) return; // a newer query already ran
  state.results = res.map((r) => r.prompt);
  state.recipeHits = matchRecipes($('#q').value);
  state.sel = Math.min(state.sel, Math.max(0, rowCount() - 1));
  drawResults();
}

/** Recipes whose name has every typed word; none when filtering by #tag. */
function matchRecipes(q) {
  if (/(^|\s)#/.test(q)) return [];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return state.recipes.filter((r) => words.every((w) => r.name.toLowerCase().includes(w)));
}

const rowCount = () => state.results.length + state.recipeHits.length;

function drawResults() {
  const ul = $('#results');
  if (!rowCount()) {
    ul.innerHTML = `<li class="empty">${$('#q').value ? `No matches. <b>${newKey()}</b> to save a new prompt.` : `No prompts yet. <b>${newKey()}</b> to add one.`}</li>`;
    return;
  }
  const inTray = new Set(state.tray.map((p) => p.id));
  ul.innerHTML = state.results.map((p, i) => `
    <li data-i="${i}" class="${i === state.sel ? 'sel' : ''}">
      <span class="mark">${inTray.has(p.id) ? '✓' : p.pinned ? '★' : ''}</span>
      <span class="t">${esc(p.title)}</span>
      <span class="tags">${p.tags.map((t) => '#' + esc(t)).join(' ')}</span>
      <span class="b">${esc(p.body.replace(/\s+/g, ' '))}</span>
      <button class="edit icon" data-edit="${i}" title="Edit" aria-label="Edit ${esc(p.title)}">✎</button>
    </li>`).join('') + state.recipeHits.map((r, j) => {
    const i = state.results.length + j;
    const parts = r.items.map((it) => state.byId.get(it.id)?.title).filter(Boolean).join(' + ');
    return `<li data-r="${j}" class="recipe ${i === state.sel ? 'sel' : ''}">
      <span class="mark">≡</span><span class="t">${esc(r.name)}</span><span class="tags">recipe · ${r.items.length} blocks</span>
      <span class="b">${esc(parts)}</span></li>`;
  }).join('');
  ul.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

function drawTray() {
  const tray = $('#tray');
  tray.hidden = !state.tray.length;
  tray.innerHTML = `<span class="lbl">Stack (${state.tray.length})</span>` + state.tray.map((p, i) =>
    `<span class="chip">${esc(p.title)}<button data-rm="${i}" title="Remove">×</button></span>`).join('') +
    `<span class="lbl">Enter joins them · <a href="#" data-compile>${combo('K')} to compile</a></span>`;
  $('#compile-count').textContent = state.tray.length ? ` ${state.tray.length}` : '';
}

function toggleTray(p) {
  const i = state.tray.findIndex((x) => x.id === p.id);
  if (i >= 0) state.tray.splice(i, 1); else state.tray.push(p);
  drawTray();
  drawResults();
}

// ---------------- use / fill ----------------
async function startUse(prompts, mode = 'paste') {
  if (!prompts.length) return;
  const slots = slotsFor(prompts, state.settings.separator);
  if (!slots.length) return finishUse(prompts, {}, mode);
  const saved = await pd.slotValues();
  state.fill = { prompts, slots, mode };
  $('#fill-form').innerHTML = slots.map((s, i) => `
    <label>${esc(s.name)}
      <input data-slot="${esc(s.name)}" data-i="${i}" value="${esc(saved[s.name] ?? s.default ?? '')}" placeholder="${esc(s.default || s.name)}">
    </label>`).join('');
  show('fill');
  updatePreview();
  const first = $('#fill-form input');
  first.focus();
  first.select();
}

function fillValues() {
  return Object.fromEntries([...document.querySelectorAll('#fill-form input')].map((i) => [i.dataset.slot, i.value]));
}

function updatePreview() {
  $('#fill-preview').textContent = render(state.fill.prompts, fillValues(), state.settings.separator);
}

async function finishUse(prompts, values, mode) {
  const res = await pd.use({ ids: prompts.map((p) => p.id), values, mode });
  state.tray = [];
  drawTray();
  if (res.pasted) return;
  if (res.copied === false) { show('search'); showCopyBox(res.text); return; }
  // Copied but not pasted (copy-only, auto-paste off, or macOS/Linux): say so, then get out of the way.
  show('search');
  runSearch();
  toast(`Copied ✓ Press ${combo('V')} to paste`, 1600);
  clearTimeout(finishUse.t);
  finishUse.t = setTimeout(() => pd.hide(), 1300);
}

// The browser refused to copy without a click: show the text with a Copy button instead.
function showCopyBox(text) {
  let box = $('#copybox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'copybox';
    box.className = 'tour';
    box.innerHTML = `<div class="card"><h2>Ready to copy</h2>
      <textarea readonly rows="7" style="width:100%;min-height:0"></textarea>
      <div class="row tour-nav"><button id="copybox-close">Close</button><span class="grow"></span><button id="copybox-copy" class="primary">Copy</button></div></div>`;
    $('#panel').append(box);
    $('#copybox-close').addEventListener('click', () => { box.hidden = true; $('#q').focus(); });
    $('#copybox-copy').addEventListener('click', async () => {
      const ta = box.querySelector('textarea');
      ta.select();
      let ok = false;
      try { await navigator.clipboard.writeText(ta.value); ok = true; } catch { ok = document.execCommand('copy'); }
      box.hidden = true;
      toast(ok ? `Copied ✓ Press ${combo('V')} to paste` : `Select the text and press ${combo('C')}`, 2500);
      $('#q').focus();
    });
  }
  box.querySelector('textarea').value = text;
  box.hidden = false;
  $('#copybox-copy').focus();
}

// ---------------- editor ----------------
function openEditor(p = null, prefill = '') {
  state.editing = p;
  $('#edit-title').textContent = p ? 'Edit prompt' : 'New prompt';
  $('#e-title').value = p?.title ?? '';
  $('#e-tags').value = p?.tags.join(', ') ?? '';
  $('#e-body').value = p?.body ?? prefill;
  $('#e-pinned').checked = !!p?.pinned;
  $('#e-role').value = p?.role ?? 'task';
  $('#e-delete').hidden = !p;
  drawEditorSlots();
  show('edit');
  (p ? $('#e-body') : $('#e-title')).focus();
}

function drawEditorSlots() {
  const s = parseSlots($('#e-body').value);
  $('#e-slots').innerHTML = s.length ? 'Slots: ' + s.map((x) => `<span class="s">${esc(x.name)}${x.default ? ':' + esc(x.default) : ''}</span>`).join('') : '<span class="muted">No slots yet</span>';
}

async function saveEditor() {
  const data = { title: $('#e-title').value, tags: $('#e-tags').value, body: $('#e-body').value, pinned: $('#e-pinned').checked, role: $('#e-role').value };
  try {
    if (state.editing) await pd.update(state.editing.id, data); else await pd.create(data);
    toast('Saved');
    backToSearch();
  } catch (e) { toast(e.message.replace(/^Error: /, '')); }
}

function makeSlot() {
  const ta = $('#e-body');
  const { selectionStart: a, selectionEnd: b, value } = ta;
  const sel = value.slice(a, b).trim();
  const name = (sel || 'name').toLowerCase().replace(/[^a-z0-9_\- ]/g, '').trim().replace(/\s+/g, '_').slice(0, 30) || 'name';
  const slot = sel ? `{{${name}:${sel.replace(/[{}]/g, '')}}}` : `{{${name}}}`;
  ta.setRangeText(slot, a, b, 'end');
  ta.focus();
  if (!sel) ta.setSelectionRange(a + 2, a + 2 + name.length); // let the user type the name
  drawEditorSlots();
}

// ---------------- compile ----------------
async function loadLibrary() {
  const [list, recipes] = await Promise.all([pd.list(), pd.recipes()]);
  state.library = list;
  state.byId = new Map(list.map((p) => [p.id, p]));
  state.recipes = recipes;
}

/** Open the compiler with a recipe, the stacked prompts, or whatever was there last time. */
async function openCompile({ recipe = null } = {}) {
  await loadLibrary();
  const c = state.c;
  if (recipe) {
    Object.assign(c, { recipeId: recipe.id, format: recipe.format, ordering: recipe.ordering,
      items: recipe.items.map((it) => ({ prompt: state.byId.get(it.id), on: it.on })).filter((it) => it.prompt) });
    $('#c-name').value = recipe.name;
  } else if (state.tray.length) {
    const have = new Set(c.items.map((it) => it.prompt.id));
    for (const p of state.tray) if (!have.has(p.id)) c.items.push({ prompt: p, on: true });
    state.tray = [];
    drawTray();
  }
  // Pick up edits made since (titles, bodies, roles) and drop deleted prompts.
  c.items = c.items.map((it) => ({ ...it, prompt: state.byId.get(it.prompt.id) })).filter((it) => it.prompt);
  c.values = { ...(await pd.slotValues()), ...c.values };
  show('compile');
  drawCompile();
  $('#c-add').focus();
}

function drawCompile() {
  const c = state.c;
  $('#c-recipe').innerHTML = `<option value="">${state.recipes.length ? 'Load recipe…' : 'No recipes yet'}</option>` +
    state.recipes.map((r) => `<option value="${r.id}" ${r.id === c.recipeId ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  const inStack = new Set(c.items.map((it) => it.prompt.id));
  const tags = [...new Set(state.library.flatMap((p) => p.tags))].sort();
  $('#c-tags').innerHTML = tags.map((t) => {
    const all = state.library.filter((p) => p.tags.includes(t)).every((p) => inStack.has(p.id));
    return `<button data-tag="${esc(t)}" class="${all ? 'on' : ''}" title="Add every #${esc(t)} prompt">#${esc(t)}</button>`;
  }).join('');
  $('#c-stack').innerHTML = c.items.length ? c.items.map((it, i) => `
    <li data-i="${i}" class="${it.on ? '' : 'off'}" tabindex="0">
      <span class="n">${String(i + 1).padStart(2, '0')}</span>
      <input type="checkbox" data-on="${i}" ${it.on ? 'checked' : ''} title="Include this block (Space)">
      <span class="t">${esc(it.prompt.title)}</span>
      <select data-role="${i}" title="Role decides where the block goes when ordering by role">${ROLES.map((r) => `<option ${r === it.prompt.role ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <span class="ops"><button data-up="${i}" title="Move up (Alt+↑)" ${i ? '' : 'disabled'}>↑</button><button data-down="${i}" title="Move down (Alt+↓)" ${i < c.items.length - 1 ? '' : 'disabled'}>↓</button><button data-x="${i}" title="Remove (Delete)">×</button></span>
    </li>`).join('')
    : `<li class="empty">Nothing stacked yet. Type above, click a #tag, load a recipe, or press <kbd>Tab</kbd> on prompts in search.</li>`;
  for (const b of document.querySelectorAll('#c-format button')) b.setAttribute('aria-pressed', String(b.dataset.v === c.format));
  for (const b of document.querySelectorAll('#c-order button')) b.setAttribute('aria-pressed', String(b.dataset.v === c.ordering));
  $('#c-del').hidden = !c.recipeId;
  drawSlotsAndOutput(true);
}

/** Merged blanks and the live output. Only redraws the inputs when `rebuild`, so typing keeps focus. */
function drawSlotsAndOutput(rebuild = false) {
  const c = state.c;
  const opts = { format: c.format, ordering: c.ordering, separator: state.settings.separator };
  if (rebuild) {
    const { slots } = compile(c.items, opts);
    $('#c-slots').innerHTML = slots.length ? `<h3>Blanks <span class="muted">filled once, used in every block</span></h3>` + slots.map((s) => `
      <label><code>{{${esc(s.name)}}}</code><input data-cslot="${esc(s.name)}" value="${esc(c.values[s.name] ?? s.default ?? '')}" placeholder="${esc(s.default || s.name)}"></label>`).join('') : '';
  }
  const r = (c.result = compile(c.items, { ...opts, values: c.values }));
  $('#c-out').textContent = r.text || 'The compiled prompt appears here.';
  $('#c-out').classList.toggle('placeholder', !r.text);
  $('#c-stats').textContent = r.text ? `${r.blocks.length} block${r.blocks.length === 1 ? '' : 's'} · ${r.chars} chars · ~${r.tokens} tokens` : '';
  const unfilled = r.slots.filter((s) => !c.values[s.name] && !s.default);
  const notes = [
    ...r.conflicts.map((x) => `<li class="warn">Conflict: ${esc(x)}</li>`),
    ...(unfilled.length ? [`<li class="warn">Still blank: ${unfilled.map((s) => `{{${esc(s.name)}}}`).join(' ')}</li>`] : []),
    ...r.dropped.map((d) => `<li>Dropped a repeat from <b>${esc(d.from)}</b>: "${esc(d.sentence)}"</li>`),
  ];
  $('#c-notes').innerHTML = notes.length ? `<ul>${notes.join('')}</ul>` : '';
}

function addToStack(prompts) {
  const have = new Set(state.c.items.map((it) => it.prompt.id));
  const fresh = prompts.filter((p) => !have.has(p.id));
  state.c.items.push(...fresh.map((p) => ({ prompt: p, on: true })));
  drawCompile();
  return fresh.length;
}

function suggest() {
  const c = state.c;
  const q = $('#c-add').value.trim().toLowerCase();
  if (!q) c.sugg = [];
  else if (q.startsWith('#')) {
    c.sugg = [...new Set(state.library.flatMap((p) => p.tags))].filter((t) => t.startsWith(q.slice(1))).sort().slice(0, 8).map((tag) => ({ tag }));
  } else {
    const words = q.split(/\s+/);
    const inTitle = (p) => +p.title.toLowerCase().includes(words[0]);
    c.sugg = state.library.filter((p) => words.every((w) => `${p.title} ${p.tags.join(' ')} ${p.role} ${p.body}`.toLowerCase().includes(w)))
      .sort((a, b) => inTitle(b) - inTitle(a)).slice(0, 8).map((p) => ({ p }));
  }
  c.suggSel = 0;
  drawSuggest();
}

function drawSuggest() {
  const c = state.c;
  const ul = $('#c-suggest');
  ul.hidden = !c.sugg.length;
  ul.innerHTML = c.sugg.map((s, i) => `<li data-s="${i}" class="${i === c.suggSel ? 'sel' : ''}">${s.tag
    ? `#${esc(s.tag)} <span class="muted">all ${state.library.filter((p) => p.tags.includes(s.tag)).length}</span>`
    : `${esc(s.p.title)} <span class="muted">${esc(s.p.role)}</span>`}</li>`).join('');
}

function pickSuggestion(i) {
  const s = state.c.sugg[i];
  if (!s) return;
  const n = addToStack(s.tag ? state.library.filter((p) => p.tags.includes(s.tag)) : [s.p]);
  if (!n) toast('Already in the stack');
  $('#c-add').value = '';
  suggest();
  $('#c-add').focus();
}

function moveBlock(i, d) {
  const items = state.c.items;
  const j = i + d;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  drawCompile();
  $(`#c-stack li[data-i="${j}"]`)?.focus();
}

function removeBlock(i) {
  state.c.items.splice(i, 1);
  drawCompile();
  $(`#c-stack li[data-i="${Math.min(i, state.c.items.length - 1)}"]`)?.focus();
}

async function copyCompiled() {
  const c = state.c;
  const r = c.result;
  if (!r?.text) return toast('Add a prompt first');
  const values = Object.fromEntries(r.slots.map((s) => [s.name, c.values[s.name] ?? '']));
  const res = await pd.use({ ids: r.blocks.map((b) => b.id), values, mode: 'copy', text: r.text, recipeId: c.recipeId });
  if (res.copied === false) return showCopyBox(res.text);
  toast(`Compiled and copied ✓ Press ${combo('V')} to paste`, 2000);
}

async function saveRecipe() {
  const c = state.c;
  try {
    const r = await pd.saveRecipe({ id: c.recipeId, name: $('#c-name').value, format: c.format, ordering: c.ordering,
      items: c.items.map((it) => ({ id: it.prompt.id, on: it.on })) });
    c.recipeId = r.id;
    $('#c-name').value = r.name;
    await loadLibrary();
    drawCompile();
    toast('Recipe saved');
  } catch (e) { toast(e.message.replace(/^Error: /, '')); }
}

function bindCompile() {
  $('#btn-compile').addEventListener('click', () => openCompile());
  $('#tray').addEventListener('click', (e) => { if (e.target.dataset.compile !== undefined) { e.preventDefault(); openCompile(); } });
  $('#c-add').addEventListener('input', suggest);
  $('#c-add').addEventListener('keydown', (e) => {
    const c = state.c;
    if (e.key === 'ArrowDown' && c.sugg.length) { e.preventDefault(); c.suggSel = (c.suggSel + 1) % c.sugg.length; drawSuggest(); }
    else if (e.key === 'ArrowUp' && c.sugg.length) { e.preventDefault(); c.suggSel = (c.suggSel - 1 + c.sugg.length) % c.sugg.length; drawSuggest(); }
    else if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey) && c.sugg.length) { e.preventDefault(); e.stopPropagation(); pickSuggestion(c.suggSel); }
    else if (e.key === 'Escape' && $('#c-add').value) { e.preventDefault(); e.stopPropagation(); $('#c-add').value = ''; suggest(); }
  });
  $('#c-suggest').addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-s]');
    if (li) { e.preventDefault(); pickSuggestion(+li.dataset.s); }
  });
  $('#c-add').addEventListener('blur', () => setTimeout(() => { $('#c-suggest').hidden = true; }, 120));
  $('#c-add').addEventListener('focus', () => { if (state.c.sugg.length) $('#c-suggest').hidden = false; });
  $('#c-tags').addEventListener('click', (e) => {
    const t = e.target.dataset.tag;
    if (!t) return;
    const n = addToStack(state.library.filter((p) => p.tags.includes(t)));
    toast(n ? `Added ${n} from #${t}` : `#${t} is already stacked`);
  });
  $('#c-stack').addEventListener('click', (e) => {
    const d = e.target.dataset;
    if (d.up !== undefined) moveBlock(+d.up, -1);
    else if (d.down !== undefined) moveBlock(+d.down, 1);
    else if (d.x !== undefined) removeBlock(+d.x);
  });
  $('#c-stack').addEventListener('change', async (e) => {
    const d = e.target.dataset;
    if (d.on !== undefined) { state.c.items[+d.on].on = e.target.checked; drawCompile(); }
    else if (d.role !== undefined) {
      // The role belongs to the prompt, so it applies in every stack and recipe.
      const it = state.c.items[+d.role];
      try { it.prompt = await pd.update(it.prompt.id, { role: e.target.value }); } catch (err) { toast(err.message.replace(/^Error: /, '')); }
      await loadLibrary();
      drawCompile();
    }
  });
  $('#c-stack').addEventListener('keydown', (e) => {
    const li = e.target.closest?.('li[data-i]');
    if (!li || e.target !== li) return;
    const i = +li.dataset.i;
    if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); moveBlock(i, -1); }
    else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); moveBlock(i, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); li.previousElementSibling?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); li.nextElementSibling?.focus(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeBlock(i); }
    else if (e.key === ' ') {
      e.preventDefault();
      state.c.items[i].on = !state.c.items[i].on;
      drawCompile();
      $(`#c-stack li[data-i="${i}"]`)?.focus();
    }
  });
  $('#c-slots').addEventListener('input', (e) => {
    if (e.target.dataset.cslot === undefined) return;
    state.c.values[e.target.dataset.cslot] = e.target.value;
    drawSlotsAndOutput();
  });
  for (const [sel, key] of [['#c-format', 'format'], ['#c-order', 'ordering']]) {
    $(sel).addEventListener('click', (e) => { if (e.target.dataset.v) { state.c[key] = e.target.dataset.v; drawCompile(); } });
  }
  $('#c-recipe').addEventListener('change', (e) => {
    const r = state.recipes.find((x) => x.id === +e.target.value);
    if (r) openCompile({ recipe: r });
  });
  $('#c-copy').addEventListener('click', copyCompiled);
  $('#c-save').addEventListener('click', saveRecipe);
  $('#c-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveRecipe(); } });
  $('#c-del').addEventListener('click', async (e) => {
    if (!armed(e.currentTarget, 'Click again to delete')) return;
    await pd.removeRecipe(state.c.recipeId);
    state.c.recipeId = null;
    $('#c-name').value = '';
    await loadLibrary();
    drawCompile();
    toast('Recipe deleted');
  });
}

// ---------------- settings ----------------
async function openSettings() {
  const s = (state.settings = await pd.settings());
  $('#s-hotkey').value = pretty(s.activeHotkey ?? s.hotkey);
  $('#s-hotkey-msg').textContent = s.hotkeyOk ? 'Click and press a new combination to change it.'
    : s.activeHotkey ? `${pretty(s.hotkey)} is reserved by Windows or another app, so ${pretty(s.activeHotkey)} is used instead. Click to pick another.`
    : '⚠ No shortcut could be registered. Click and pick another.';
  $('#s-autopaste').checked = s.autoPaste;
  $('#s-bubble').checked = s.showBubble;
  $('#s-login').checked = s.launchAtLogin;
  $('#s-opacity').value = s.opacity;
  $('#s-sep').value = s.separator;
  $('#s-datadir').textContent = `Data: ${s.dataDir}${s.portable ? ' (portable)' : ''}`;
  drawSemantic(await pd.semantic.state());
  await drawSlotValues();
  show('settings');
}

// ---------------- platform labels ----------------
const isMac = () => state.settings?.platform === 'darwin' || !!state.settings?.macKeys;
const isWeb = () => state.settings?.platform === 'web';
/** Ctrl+N is reserved by browsers, so the web build uses Alt+N for a new prompt. */
const newKey = () => (isWeb() ? (isMac() ? '⌥N' : 'Alt+N') : combo('N'));
const where = () => (isWeb() ? 'in this browser' : 'on this computer');
const modKey = () => (isMac() ? '⌘' : 'Ctrl');
/** Shortcut with the platform's main modifier: ⌘V on macOS, Ctrl+V elsewhere. */
const combo = (k) => (isMac() ? `⌘${k}` : `Ctrl+${k}`);
const autoPasteOn = () => state.settings?.canAutoPaste && state.settings?.autoPaste;
const osName = () => ({ darwin: 'macOS', win32: 'Windows', web: 'the web' }[state.settings?.platform] ?? 'your desktop');

function pretty(accel) {
  const map = isMac() ? { Super: '⌘ Cmd', Control: '⌃ Ctrl', Alt: '⌥ Option', Shift: '⇧ Shift' }
    : { Super: state.settings?.platform === 'win32' ? 'Win' : 'Super', Control: 'Ctrl' };
  return accel.split('+').map((k) => map[k] ?? k).join(' + ');
}

/** Rewrites shortcut hints and paste wording for this OS and the auto-paste setting. */
function applyPlatform() {
  if (isMac()) {
    document.querySelectorAll('kbd').forEach((k) => { k.textContent = k.textContent.replace('Ctrl+', '⌘'); });
    document.querySelectorAll('[title]').forEach((el) => { el.title = el.title.replace('Ctrl+', '⌘'); });
  }
  document.querySelectorAll('[data-newkey]').forEach((el) => { el.textContent = newKey(); });
  document.querySelectorAll('.lbl-esc').forEach((el) => { el.textContent = isWeb() ? 'clear' : 'close'; });
  if (isWeb()) $('#btn-new').title = `New prompt (${newKey()})`;
  const paste = autoPasteOn();
  document.querySelectorAll('.lbl-use').forEach((el) => { el.textContent = paste ? 'paste' : 'copy'; });
  document.querySelectorAll('.lbl-final').forEach((el) => { el.textContent = paste ? 'paste' : 'copy'; });
  document.querySelectorAll('.only-paste').forEach((el) => { el.hidden = !paste; });
  $('#s-login-label').textContent = state.settings.platform === 'win32' ? 'Start with Windows' : 'Start at login';
  $('#s-autopaste-row').hidden = !state.settings.canAutoPaste;
  const note = $('#s-autopaste-note');
  note.hidden = state.settings.canAutoPaste;
  note.textContent = `Auto-paste is Windows-only for now. On ${osName()}, choosing a prompt copies it; then press ${combo('V')}.`;
}

async function setSetting(patch) {
  try {
    state.settings = { ...state.settings, ...(await pd.setSettings(patch)) };
    applyLook();
    applyPlatform();
  } catch (e) {
    toast(e.message.replace(/^Error: /, ''));
    openSettings();
  }
}

function applyLook() {
  document.documentElement.style.setProperty('--alpha', state.settings.opacity);
}

function captureHotkey(e) {
  e.preventDefault();
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
  if (e.key === 'Escape') return $('#s-hotkey').blur();
  const mods = [];
  if (e.metaKey) mods.push('Super');
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (!mods.length) return toast('Use at least one modifier (Ctrl, Alt, Win, Shift)');
  const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const accel = [...mods, key].join('+');
  $('#s-hotkey').value = pretty(accel);
  $('#s-hotkey').blur();
  setSetting({ hotkey: accel }).then(() => openSettings());
}

function drawSemantic(s) {
  const labels = { off: 'off', on: 'on', downloading: `downloading ${s.progress}%`, loading: 'loading…', indexing: 'indexing…', error: 'error', unavailable: 'not included' };
  $('#s-sem-status').textContent = labels[s.status] ?? s.status;
  $('#sem-badge').hidden = s.status !== 'on';
  const busy = ['downloading', 'loading', 'indexing'].includes(s.status);
  $('#s-sem-toggle').textContent = s.status === 'on' || busy ? 'Turn off' : 'Turn on';
  $('#s-sem-toggle').disabled = busy || s.status === 'unavailable';
  if (s.error) toast(s.error);
}

async function drawSlotValues() {
  const vals = await pd.slotValues();
  const names = Object.keys(vals).sort();
  $('#s-slots').innerHTML = names.length ? names.map((n) => `
    <div class="r"><code>{{${esc(n)}}}</code><input data-sv="${esc(n)}" value="${esc(vals[n])}"><button class="icon" data-svdel="${esc(n)}" title="Forget">×</button></div>`).join('')
    : '<p class="muted">Nothing saved yet — values you type when filling slots appear here.</p>';
}

function backToSearch() {
  show('search');
  $('#q').focus();
  runSearch();
}

// ---------------- first-run tour ----------------
const TOUR = [
  { title: 'Welcome to PromptDock 👋', body: (hk) => isWeb()
    ? `<p>Your prompt library, right here in the browser. No account, nothing uploaded: your prompts stay ${where()}.</p>
       <p>Keep this tab pinned, press <kbd>/</kbd> to jump to search. Want a global hotkey and auto-paste into any app? Grab the desktop version.</p>`
    : `<p>Your prompt library, one shortcut away.</p>
    <p>Press <kbd>${hk}</kbd> anywhere on ${osName()} to open or close this panel. You can also click the small
    <b>P_</b> bubble on the edge of your screen, or the tray icon.</p>` },
  { title: 'Find a prompt and use it', body: () => `<ul>
    <li>Start typing to search. Small typos are fine. Use <code>#tag</code> to filter.</li>
    <li><kbd>↑</kbd> <kbd>↓</kbd> to choose, then <kbd>Enter</kbd>.</li>
    ${autoPasteOn()
      ? `<li>The prompt is <b>pasted straight into the app you were using</b>, e.g. your AI chat box.</li>
         <li><kbd>Ctrl+Enter</kbd> copies it instead of pasting.</li>`
      : `<li>The prompt is <b>copied</b>. Click back into your chat box and press <kbd>${combo('V')}</kbd>.</li>`}</ul>` },
  { title: 'Fill in the blanks', body: () => `<p>Prompts can have slots like <code>{{file}}</code> or <code>{{tone:friendly}}</code> (the part after <b>:</b> is a default).</p>
    <p>When you use one, PromptDock asks for each value. <kbd>Enter</kbd> moves to the next. The last <kbd>Enter</kbd> fills them in and ${autoPasteOn() ? 'pastes' : 'copies'}.
    Your answers are remembered ${where()} for next time.</p>` },
  { title: 'Compile several into one', body: () => `<ul>
    <li><kbd>Tab</kbd> stacks the highlighted prompt. <kbd>Ctrl+K</kbd> opens the compiler: blocks are ordered by role
    (who the AI is, context, task, rules, output format), shared blanks are filled once, and repeated lines are dropped.</li>
    <li>Save a stack as a <b>recipe</b> and it shows up in search.</li>
    <li><kbd>${newKey()}</kbd> new prompt, <kbd>Ctrl+E</kbd> or right-click to edit, <kbd>Esc</kbd> to ${isWeb() ? 'clear the search' : 'close'}.</li></ul>` },
  { title: 'Make it yours', body: () => isWeb()
    ? `<p>Open <b>⚙ Settings</b> (<kbd>Ctrl+,</kbd>) to <b>back up your prompts</b> (Export JSON: do this now and then, since clearing browser data erases them),
    edit remembered answers, or turn on <b>semantic search</b> (finds prompts by meaning, runs in your browser).</p>
    <p>You can replay this tour from Settings at any time.</p>`
    : `<p>Open <b>⚙ Settings</b> (<kbd>Ctrl+,</kbd>) to change the shortcut, opacity and auto-paste,
    hide the bubble, start with Windows, back up your prompts, or turn on <b>semantic search</b> (finds prompts by meaning).</p>
    <p>You can replay this tour from Settings at any time.</p>` },
];
let tourAt = 0;

function showTour(i = 0) {
  tourAt = Math.max(0, Math.min(i, TOUR.length - 1));
  const hk = pretty(state.settings.activeHotkey ?? state.settings.hotkey);
  $('#tour-step').textContent = `${tourAt + 1} / ${TOUR.length}`;
  $('#tour-title').textContent = TOUR[tourAt].title;
  $('#tour-body').innerHTML = TOUR[tourAt].body(esc(hk)).replaceAll('<kbd>Ctrl+', `<kbd>${combo('')}`);
  $('#tour-back').hidden = tourAt === 0;
  $('#tour-next').textContent = tourAt === TOUR.length - 1 ? 'Start using it' : 'Next';
  $('#tour').hidden = false;
  $('#tour-next').focus();
}

async function endTour() {
  $('#tour').hidden = true;
  await setSetting({ tourDone: true });
  backToSearch();
}

// Two-click confirmation (a native dialog would blur and hide the panel).
function armed(btn, label) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; return true; }
  btn.dataset.label = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = label;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 3000);
  return false;
}

// ---------------- wiring ----------------
function bind() {
  $('#q').addEventListener('input', () => {
    clearTimeout(searchTimer);
    state.sel = 0;
    searchTimer = setTimeout(() => { searchTimer = null; searchDone = runSearch(); }, 70);
  });

  document.addEventListener('keydown', (e) => {
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (!$('#tour').hidden) {
      if (k === 'Escape') { e.preventDefault(); endTour(); }
      else if (k === 'ArrowRight') { e.preventDefault(); $('#tour-next').click(); }
      else if (k === 'ArrowLeft' && tourAt > 0) { e.preventDefault(); showTour(tourAt - 1); }
      return;
    }
    if (k === '/' && state.view === 'search' && !e.target.matches('input, textarea, select')) { e.preventDefault(); $('#q').focus(); return; }
    if (state.view === 'search') {
      const cur = state.results[state.sel];
      if (k === 'ArrowDown') { e.preventDefault(); state.sel = Math.min(state.sel + 1, rowCount() - 1); drawResults(); }
      else if (k === 'ArrowUp') { e.preventDefault(); state.sel = Math.max(state.sel - 1, 0); drawResults(); }
      // Enter/Tab act on the results for what is typed now, even if the debounce hasn't fired yet.
      else if (k === 'Tab') { e.preventDefault(); flushSearch().then(() => { const p = state.results[state.sel]; if (p) toggleTray(p); }); }
      else if (k === 'Enter') {
        e.preventDefault();
        flushSearch().then(() => {
          const r = state.recipeHits[state.sel - state.results.length];
          if (r && !state.tray.length) return openCompile({ recipe: r });
          const p = state.results[state.sel]; startUse(state.tray.length ? state.tray : p ? [p] : [], ctrl ? 'copy' : 'paste'); });
      }
      else if (ctrl && k.toLowerCase() === 'e' && cur) { e.preventDefault(); openEditor(cur); }
      else if ((ctrl || e.altKey) && e.code === 'KeyN' || (ctrl && k.toLowerCase() === 'n')) { e.preventDefault(); openEditor(null, ''); }
      else if (ctrl && k === ',') { e.preventDefault(); openSettings(); }
      else if (ctrl && k.toLowerCase() === 'k') { e.preventDefault(); openCompile(); }
      else if (k === 'Escape') { e.preventDefault(); if ($('#q').value) { $('#q').value = ''; runSearch(); } else pd.hide(); }
    } else if (state.view === 'fill') {
      if (k === 'Escape') { e.preventDefault(); backToSearch(); }
      else if (k === 'Enter' && e.target.matches('#fill-form input')) {
        e.preventDefault();
        const inputs = [...document.querySelectorAll('#fill-form input')];
        const i = inputs.indexOf(e.target);
        if (ctrl || i === inputs.length - 1) finishUse(state.fill.prompts, fillValues(), ctrl ? 'copy' : state.fill.mode);
        else { inputs[i + 1].focus(); inputs[i + 1].select(); }
      }
    } else if (state.view === 'edit') {
      if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); saveEditor(); }
      else if (k === 'Escape') { e.preventDefault(); backToSearch(); }
    } else if (state.view === 'compile') {
      if (ctrl && k === 'Enter') { e.preventDefault(); copyCompiled(); }
      else if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); saveRecipe(); }
      else if (k === 'Escape' && !e.target.matches('select')) { e.preventDefault(); backToSearch(); }
    } else if (state.view === 'settings') {
      if (k === 'Escape' && e.target.id !== 's-hotkey') { e.preventDefault(); backToSearch(); }
    }
  });

  $('#results').addEventListener('click', (e) => {
    if (e.target.dataset.edit !== undefined) return openEditor(state.results[+e.target.dataset.edit]);
    const rli = e.target.closest('li[data-r]');
    if (rli) return openCompile({ recipe: state.recipeHits[+rli.dataset.r] });
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    const p = state.results[+li.dataset.i];
    if (e.ctrlKey) toggleTray(p); else startUse([p]);
  });
  $('#results').addEventListener('contextmenu', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); openEditor(state.results[+li.dataset.i]); }
  });
  $('#tray').addEventListener('click', (e) => {
    if (e.target.dataset.rm === undefined) return;
    state.tray.splice(+e.target.dataset.rm, 1);
    drawTray(); drawResults(); $('#q').focus();
  });
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', backToSearch));
  $('#btn-new').addEventListener('click', () => openEditor());
  $('#btn-settings').addEventListener('click', openSettings);

  $('#fill-form').addEventListener('input', updatePreview);
  bindCompile();

  $('#e-body').addEventListener('input', drawEditorSlots);
  $('#e-slot').addEventListener('click', makeSlot);
  $('#e-save').addEventListener('click', saveEditor);
  $('#e-delete').addEventListener('click', async (e) => {
    if (!armed(e.currentTarget, 'Click again to delete')) return;
    await pd.remove(state.editing.id);
    toast('Deleted');
    backToSearch();
  });

  $('#s-hotkey').addEventListener('keydown', captureHotkey);
  $('#s-autopaste').addEventListener('change', (e) => setSetting({ autoPaste: e.target.checked }));
  $('#s-bubble').addEventListener('change', (e) => setSetting({ showBubble: e.target.checked }));
  $('#s-login').addEventListener('change', (e) => setSetting({ launchAtLogin: e.target.checked }));
  $('#s-opacity').addEventListener('input', (e) => { document.documentElement.style.setProperty('--alpha', e.target.value); });
  $('#s-opacity').addEventListener('change', (e) => setSetting({ opacity: +e.target.value }));
  $('#s-sep').addEventListener('change', (e) => setSetting({ separator: e.target.value }));
  $('#s-sem-toggle').addEventListener('click', async () => {
    const s = await pd.semantic.state();
    if (s.status === 'on') await pd.semantic.disable(); else await pd.semantic.enable();
  });
  $('#s-sem-remove').addEventListener('click', async (e) => {
    if (!armed(e.currentTarget, 'Click again to remove')) return;
    await pd.semantic.disable({ removeModel: true });
    toast('Model removed');
  });
  pd.semantic.onState(drawSemantic);
  $('#tour-next').addEventListener('click', () => (tourAt === TOUR.length - 1 ? endTour() : showTour(tourAt + 1)));
  $('#tour-back').addEventListener('click', () => showTour(tourAt - 1));
  $('#tour-skip').addEventListener('click', endTour);
  $('#s-tour').addEventListener('click', () => showTour(0));
  $('#s-slots').addEventListener('change', (e) => {
    if (e.target.dataset.sv) pd.setSlotValues({ [e.target.dataset.sv]: e.target.value }).then(() => toast('Saved'));
  });
  $('#s-slots').addEventListener('click', async (e) => {
    if (!e.target.dataset.svdel) return;
    await pd.setSlotValues({ [e.target.dataset.svdel]: '' });
    drawSlotValues();
  });
  $('#s-import').addEventListener('click', async () => { const n = await pd.importData(); if (n !== null) toast(`Imported ${n} prompt${n === 1 ? '' : 's'}`); });
  $('#s-export').addEventListener('click', async () => { const f = await pd.exportData(); if (f) toast('Exported'); });

  // Another tab (web) changed the data: refresh what is on screen without leaving the current view.
  pd.onExternalChange?.(() => { if (state.view === 'search') runSearch(); else if (state.view === 'compile') openCompile(); else if (state.view === 'settings') drawSlotValues(); });

  pd.onShown(() => {
    if (state.view !== 'edit') { show('search'); $('#q').select(); }
    $('#q').focus();
    runSearch();
  });
}

(async function init() {
  state.settings = await pd.settings();
  applyLook();
  applyPlatform();
  drawSemantic(await pd.semantic.state());
  bind();
  runSearch();
  if (!state.settings.tourDone) showTour(0);
  window.__pdReady = true;
})();
