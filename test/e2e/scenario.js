// Runs inside the PromptDock panel (see runE2E in main.js). Drives the real UI
// with keyboard events and checks DOM + stored state. Evaluates to a results array.
(async () => {
  const R = [];
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
  const key = async (k, o = {}) => { (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o })); await wait(); };
  const type = async (sel, v) => { const el = $(sel); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await wait(200); };
  const visible = (id) => !$(`#view-${id}`).hidden;
  const titles = () => $$('#results li[data-i] .t').map((e) => e.textContent);
  const check = (name, ok, info = '') => R.push({ name, ok: !!ok, info: ok ? '' : String(info) });
  const step = async (name, fn) => { try { await fn(); } catch (e) { R.push({ name, ok: false, info: 'threw: ' + e.message }); } };
  const search = async (q) => { await type('#q', q); await wait(150); };

  await wait(300);
  await step('tour', async () => {
    check('first run shows tour', $('#tour') && !$('#tour').hidden, 'tour hidden');
    $('#tour-next').click(); await wait();
    check('tour advances', $('#tour-step').textContent.startsWith('2'), $('#tour-step').textContent);
    $('#tour-skip').click(); await wait(250);
    check('tour dismissed', $('#tour').hidden);
    check('tour flag saved', (await pd.settings()).tourDone === true);
  });

  await step('seed list', async () => {
    await search('');
    check('6 seed prompts listed', titles().length === 6, titles());
    check('pinned first', titles()[0] === 'Code review', titles()[0]);
  });

  await step('search', async () => {
    await search('respnsive');
    check('fuzzy typo finds prompt', titles()[0] === 'Make UI responsive', titles());
    await search('#git');
    check('tag filter', titles().length === 1 && titles()[0] === 'Commit message', titles());
    await search('zzzqqq');
    check('no-match empty state', $('#results .empty')?.textContent.includes('No matches'));
    await search('');
    $('#q').focus(); await key('ArrowDown'); await key('ArrowDown');
    check('arrow moves selection', $('#results li.sel .t').textContent === titles()[2]);
    await key('ArrowUp');
    check('arrow up', $('#results li.sel .t').textContent === titles()[1]);
  });

  await step('create prompt via editor', async () => {
    $('#q').focus(); await key('n', { ctrlKey: true });
    check('Ctrl+N opens editor', visible('edit'));
    await type('#e-title', 'Translate text');
    await type('#e-tags', 'Lang, #Writing');
    await type('#e-body', 'Translate {{text}} into {{language:Hindi}} keeping a {{tone:neutral}} tone.');
    check('editor detects 3 slots', $$('#e-slots .s').length === 3, $('#e-slots').textContent);
    $('#e-body').focus(); await key('s', { ctrlKey: true }); await wait(300);
    check('saved returns to search', visible('search'));
    await search('translate');
    check('new prompt searchable', titles()[0] === 'Translate text', titles());
    const p = (await pd.list()).find((x) => x.title === 'Translate text');
    check('tags normalised', JSON.stringify(p.tags) === '["lang","writing"]', JSON.stringify(p.tags));
  });

  await step('empty body rejected', async () => {
    $('#q').focus(); await key('n', { ctrlKey: true });
    await type('#e-body', '   ');
    $('#e-save').click(); await wait(300);
    check('empty body keeps editor open', visible('edit'));
    check('empty body shows message', !$('#toast').hidden && /empty/i.test($('#toast').textContent), $('#toast').textContent);
    $('#e-body').focus(); await key('Escape');
    check('Esc leaves editor', visible('search'));
  });

  await step('make-slot button', async () => {
    $('#q').focus(); await key('n', { ctrlKey: true });
    await type('#e-body', 'Summarise this article');
    const ta = $('#e-body'); ta.setSelectionRange(10, 22); // "this article"
    $('#e-slot').click(); await wait();
    check('selection becomes slot with default', ta.value === 'Summarise {{this_article:this article}}', ta.value);
    ta.focus(); await key('Escape');
  });

  await step('unicode slot', async () => {
    const id = (await pd.create({ title: 'Hindi slot', body: 'नमस्ते {{नाम}}' })).id;
    await search('hindi slot'); $('#q').focus(); await key('Enter'); await wait(300);
    check('unicode slot name becomes a field', $$('#fill-form input')[0]?.dataset.slot === 'नाम', $('#fill-form').textContent);
    $$('#fill-form input')[0]?.focus(); await key('Escape');
    await pd.remove(id);
  });

  await step('fill flow', async () => {
    await search('translate');
    $('#q').focus(); await key('Enter'); await wait(300);
    check('Enter opens fill view', visible('fill'));
    const inputs = $$('#fill-form input');
    check('3 slot inputs', inputs.length === 3, inputs.length);
    check('default prefilled', inputs[1]?.value === 'Hindi', inputs[1]?.value);
    check('first input focused', document.activeElement === inputs[0]);
    inputs[0].value = 'Good morning'; inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    await wait();
    check('live preview', $('#fill-preview').textContent.includes('Good morning'), $('#fill-preview').textContent);
    await key('Enter');
    check('Enter moves to next slot', document.activeElement === inputs[1]);
    await key('Enter', { ctrlKey: true }); await wait(300);
    check('Ctrl+Enter copies final text', (await pd.testLast()) === 'Translate Good morning into Hindi keeping a neutral tone.', await pd.testLast());
    check('values remembered', (await pd.slotValues()).text === 'Good morning');
    await search('translate'); $('#q').focus(); await key('Enter'); await wait(300);
    check('remembered value prefilled next time', $$('#fill-form input')[0].value === 'Good morning');
    await key('Escape');
  });

  await step('compose', async () => {
    await search('#git'); $('#q').focus(); await key('Tab');
    await search('#ui'); $('#q').focus(); await key('Tab');
    check('tray shows 2', !$('#tray').hidden && $$('#tray .chip').length === 2);
    check('tray marks result', $('#results li.sel .mark').textContent === '✓');
    await key('Enter', { ctrlKey: true }); await wait(300);
    const t = (await pd.testLast()) ?? '';
    check('composed in order with separator', t.startsWith('Write a concise') && t.includes('\n\nMake this layout'), t);
    check('tray cleared after use', $('#tray').hidden);
  });

  await step('edit existing', async () => {
    await search('commit'); $('#q').focus(); await key('e', { ctrlKey: true });
    check('Ctrl+E opens editor with prompt', visible('edit') && $('#e-title').value === 'Commit message');
    await type('#e-body', $('#e-body').value + ' Scope: {{scope}}.');
    $('#e-pinned').checked = true;
    await key('s', { ctrlKey: true }); await wait(300);
    const p = (await pd.list()).find((x) => x.title === 'Commit message');
    check('edit saved with new slot', p.body.endsWith('Scope: {{scope}}.') && p.pinned);
  });

  await step('html is escaped', async () => {
    await pd.create({ title: '<img src=x onerror="window.__xss=1">', body: '<b>bold</b> {{x}}' });
    await search('img'); await wait();
    check('no html injection', !window.__xss && !$('#results img') && $('#results .t').textContent.includes('<img'));
  });

  await step('delete two-click', async () => {
    await search('img'); $('#q').focus(); await key('e', { ctrlKey: true });
    $('#e-delete').click(); await wait();
    check('first click arms', $('#e-delete').textContent.includes('again'), $('#e-delete').textContent);
    $('#e-delete').click(); await wait(300);
    check('second click deletes', !(await pd.list()).some((p) => p.title.includes('<img')));
  });

  await step('settings', async () => {
    $('#q').focus(); await key(',', { ctrlKey: true }); await wait(300);
    check('Ctrl+, opens settings', visible('settings'));
    $('#s-autopaste').click(); await wait(200);
    check('autoPaste persisted', (await pd.settings()).autoPaste === false);
    $('#s-autopaste').click(); await wait(200);
    $('#s-sep').value = '\n\n---\n\n'; $('#s-sep').dispatchEvent(new Event('change')); await wait(200);
    check('separator persisted', (await pd.settings()).separator === '\n\n---\n\n', JSON.stringify((await pd.settings()).separator));
    $('#s-sep').value = '\n\n'; $('#s-sep').dispatchEvent(new Event('change')); await wait(200);
    $('#s-opacity').value = '0.7'; $('#s-opacity').dispatchEvent(new Event('change')); await wait(200);
    check('opacity persisted + applied', (await pd.settings()).opacity === 0.7 && document.documentElement.style.getPropertyValue('--alpha') === '0.7');
    $('#s-bubble').click(); await wait(200);
    check('bubble toggle persisted', (await pd.settings()).showBubble === false);
    $('#s-bubble').click(); await wait(200);
    await key(',', { ctrlKey: true }); // no-op in settings
    const rows = $$('#s-slots .r');
    check('saved slot values listed', rows.some((r) => r.textContent.includes('{{text}}')), $('#s-slots').textContent);
    const inp = $('#s-slots input[data-sv="text"]');
    inp.value = 'Hello'; inp.dispatchEvent(new Event('change', { bubbles: true })); await wait(250);
    check('slot value edited', (await pd.slotValues()).text === 'Hello');
    $('#s-slots [data-svdel="text"]').click(); await wait(250);
    check('slot value forgotten', !('text' in (await pd.slotValues())));
  });

  await step('hotkey change', async () => {
    const hk = $('#s-hotkey'); hk.focus();
    await key('o', { code: 'KeyO', ctrlKey: true, altKey: true }); await wait(400);
    check('valid hotkey applied', (await pd.settings()).activeHotkey === 'Control+Alt+O', (await pd.settings()).activeHotkey);
    let err = null;
    try { await pd.setSettings({ hotkey: 'Alt+Space' }); } catch (e) { err = e.message; }
    check('taken hotkey rejected + reverted', err && (await pd.settings()).activeHotkey === 'Control+Alt+O', err + ' / ' + (await pd.settings()).activeHotkey);
    $('#s-hotkey').focus(); await key('p', { code: 'KeyP', metaKey: true, altKey: true }); await wait(400);
    check('hotkey back to Win+Alt+P', (await pd.settings()).activeHotkey === 'Super+Alt+P', (await pd.settings()).activeHotkey);
  });

  await step('import/export', async () => {
    const f = (await pd.settings()).dataDir + '\\export-test.json';
    await pd.exportData(f);
    const before = (await pd.list()).length;
    check('re-import skips duplicates', (await pd.importData(f)) === 0);
    check('count unchanged', (await pd.list()).length === before);
  });

  await step('performance with 500 prompts', async () => {
    for (let i = 0; i < 500; i++) await pd.create({ title: `Bulk prompt ${i}`, body: `Lorem ipsum ${i} dolor sit amet {{v${i % 7}}}`, tags: ['bulk'] });
    const t0 = performance.now(); await pd.search('dolor 42'); const ms = performance.now() - t0;
    check('search 500 prompts < 150ms', ms < 150, `${Math.round(ms)}ms`);
    await search('bulk prompt 42');
    check('finds right one', titles()[0] === 'Bulk prompt 42', titles().slice(0, 3));
  });

  const home = async () => { document.querySelector('.view:not([hidden]) [data-back]')?.click(); await wait(250); };

  await step('copy-only feedback', async () => {
    await home();
    await search('#css'); $('#q').focus(); await key('Enter', { ctrlKey: true }); await wait(250); // no slots
    check('copy shows paste hint', !$('#toast').hidden && $('#toast').textContent.includes('Press Ctrl+V to paste'), $('#toast').textContent);
  });

  await step('auto-paste off relabels hints', async () => {
    await home();
    $('#q').focus(); await key(',', { ctrlKey: true }); await wait(300);
    $('#s-autopaste').click(); await wait(300);
    check('auto-paste off: Enter hint says copy', (await pd.settings()).autoPaste === false && $('.lbl-use').textContent === 'copy', $('.lbl-use').textContent);
    check('auto-paste off: copy-only hint hidden', $('.only-paste').hidden);
    $('#s-autopaste').click(); await wait(300);
    check('auto-paste on: Enter hint says paste', $('.lbl-use').textContent === 'paste', $('.lbl-use').textContent);
    await home();
  });

  await step('esc behaviour', async () => {
    await home();
    await search('abc'); $('#q').focus(); await key('Escape');
    check('Esc clears query first', $('#q').value === '');
  });

  return R;
})();
