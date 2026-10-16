import { parseSlots } from '../core/slots.js';
import { render, slotsFor } from '../core/compose.js';

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
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 1800);
}

function show(view) {
  state.view = view;
  for (const v of ['search', 'fill', 'edit', 'settings']) $(`#view-${v}`).hidden = v !== view;
}

// ---------------- search ----------------
let searchSeq = 0;
async function runSearch() {
  const seq = ++searchSeq;
  const res = await pd.search($('#q').value);
  if (seq !== searchSeq) return; // a newer query already ran
  state.results = res.map((r) => r.prompt);
  state.sel = Math.min(state.sel, Math.max(0, state.results.length - 1));
  drawResults();
}

function drawResults() {
  const ul = $('#results');
  if (!state.results.length) {
    ul.innerHTML = `<li class="empty">${$('#q').value ? 'No matches. <b>Ctrl+N</b> to save a new prompt.' : 'No prompts yet. <b>Ctrl+N</b> to add one.'}</li>`;
    return;
  }
  const inTray = new Set(state.tray.map((p) => p.id));
  ul.innerHTML = state.results.map((p, i) => `
    <li data-i="${i}" class="${i === state.sel ? 'sel' : ''}">
      <span class="mark">${inTray.has(p.id) ? '✓' : p.pinned ? '★' : ''}</span>
      <span class="t">${esc(p.title)}</span>
      <span class="tags">${p.tags.map((t) => '#' + esc(t)).join(' ')}</span>
      <span class="b">${esc(p.body.replace(/\s+/g, ' '))}</span>
    </li>`).join('');
  ul.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

function drawTray() {
  const tray = $('#tray');
  tray.hidden = !state.tray.length;
  tray.innerHTML = `<span class="lbl">Compose (${state.tray.length}):</span>` + state.tray.map((p, i) =>
    `<span class="chip">${esc(p.title)}<button data-rm="${i}" title="Remove">×</button></span>`).join('') +
    `<span class="lbl">Enter to use all</span>`;
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
  await pd.use({ ids: prompts.map((p) => p.id), values, mode });
  if (mode === 'copy') toast('Copied to clipboard');
  else if (!state.settings.autoPaste) toast('Copied — paste with Ctrl+V');
  state.tray = [];
  drawTray();
  if (mode === 'copy') { show('search'); runSearch(); }
}

// ---------------- editor ----------------
function openEditor(p = null, prefill = '') {
  state.editing = p;
  $('#edit-title').textContent = p ? 'Edit prompt' : 'New prompt';
  $('#e-title').value = p?.title ?? '';
  $('#e-tags').value = p?.tags.join(', ') ?? '';
  $('#e-body').value = p?.body ?? prefill;
  $('#e-pinned').checked = !!p?.pinned;
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
  const data = { title: $('#e-title').value, tags: $('#e-tags').value, body: $('#e-body').value, pinned: $('#e-pinned').checked };
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

const pretty = (a) => a.replace('Super', 'Win').replace('Control', 'Ctrl').replaceAll('+', ' + ');

async function setSetting(patch) {
  try {
    state.settings = { ...state.settings, ...(await pd.setSettings(patch)) };
    applyLook();
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
  let deb;
  $('#q').addEventListener('input', () => { clearTimeout(deb); state.sel = 0; deb = setTimeout(runSearch, 70); });

  document.addEventListener('keydown', (e) => {
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (state.view === 'search') {
      const cur = state.results[state.sel];
      if (k === 'ArrowDown') { e.preventDefault(); state.sel = Math.min(state.sel + 1, state.results.length - 1); drawResults(); }
      else if (k === 'ArrowUp') { e.preventDefault(); state.sel = Math.max(state.sel - 1, 0); drawResults(); }
      else if (k === 'Tab' && cur) { e.preventDefault(); toggleTray(cur); }
      else if (k === 'Enter') { e.preventDefault(); startUse(state.tray.length ? state.tray : cur ? [cur] : [], ctrl ? 'copy' : 'paste'); }
      else if (ctrl && k.toLowerCase() === 'e' && cur) { e.preventDefault(); openEditor(cur); }
      else if (ctrl && k.toLowerCase() === 'n') { e.preventDefault(); openEditor(null, ''); }
      else if (ctrl && k === ',') { e.preventDefault(); openSettings(); }
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
    } else if (state.view === 'settings') {
      if (k === 'Escape' && e.target.id !== 's-hotkey') { e.preventDefault(); backToSearch(); }
    }
  });

  $('#results').addEventListener('click', (e) => {
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

  $('#e-body').addEventListener('input', drawEditorSlots);
  $('#e-slot').addEventListener('click', makeSlot);
  $('#e-save').addEventListener('click', saveEditor);
  $('#e-delete').addEventListener('click', async () => {
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

  pd.onShown(() => {
    if (state.view !== 'edit') { show('search'); $('#q').select(); }
    $('#q').focus();
    runSearch();
  });
}

(async function init() {
  state.settings = await pd.settings();
  applyLook();
  drawSemantic(await pd.semantic.state());
  bind();
  runSearch();
})();
