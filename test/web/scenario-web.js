// Runs inside the web build (see electron-runner.cjs). Drives the real UI with
// keyboard events and checks DOM + stored state. Evaluates to a results array.
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
  const step = async (name, fn) => { console.log('[step] ' + name); try { await fn(); } catch (e) { R.push({ name, ok: false, info: 'threw: ' + e.message }); } };
  const search = async (q) => { await type('#q', q); await wait(150); };
  const home = async () => { $('.view:not([hidden]) [data-back]')?.click(); await wait(250); };
  const newPrompt = () => key('n', { code: 'KeyN', altKey: true });
  const toast = () => (!$('#toast').hidden ? $('#toast').textContent : '');

  await wait(300);
  await step('tour', async () => {
    check('first run shows tour', $('#tour') && !$('#tour').hidden, 'tour hidden');
    $('#tour-next').click(); await wait();
    check('tour advances', $('#tour-step').textContent.startsWith('2'), $('#tour-step').textContent);
    $('#tour-skip').click(); await wait(250);
    check('tour dismissed', $('#tour').hidden);
    check('tour flag saved', (await pd.settings()).tourDone === true);
  });

  await step('web platform', async () => {
    const s = await pd.settings();
    check('settings report web platform', s.platform === 'web' && s.canAutoPaste === false, JSON.stringify({ platform: s.platform, canAutoPaste: s.canAutoPaste }));
    check('storage mode reported', s.storage && ['indexeddb', 'memory'].includes(s.storage.mode), JSON.stringify(s.storage));
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
    check('no-match empty state', $('#results .empty')?.textContent.includes('No matches'), $('#results').textContent);
    await search('');
    $('#q').focus(); await key('ArrowDown'); await key('ArrowDown');
    check('arrow moves selection', $('#results li.sel .t').textContent === titles()[2]);
    await key('ArrowUp');
    check('arrow up', $('#results li.sel .t').textContent === titles()[1]);
  });

  await step('slash focuses search', async () => {
    $('#q').blur(); await wait();
    await key('/', { code: 'Slash' });
    check('/ focuses search box', document.activeElement === $('#q'), document.activeElement?.id || document.activeElement?.tagName);
  });

  await step('create prompt via editor', async () => {
    $('#q').focus(); await newPrompt();
    check('Alt+N opens editor', visible('edit'));
    await home();
    $('#btn-new').click(); await wait();
    check('+ button opens editor', visible('edit'));
    await type('#e-title', 'Translate text');
    await type('#e-tags', 'Lang, #Writing');
    await type('#e-body', 'Translate {{text}} into {{language:Hindi}} keeping a {{tone:neutral}} tone.');
    check('editor detects 3 slots', $$('#e-slots .s').length === 3, $('#e-slots').textContent);
    $('#e-body').focus(); await key('s', { code: 'KeyS', ctrlKey: true }); await wait(300);
    check('saved returns to search', visible('search'));
    await search('translate');
    check('new prompt searchable', titles()[0] === 'Translate text', titles());
    const p = (await pd.list()).find((x) => x.title === 'Translate text');
    check('tags normalised', JSON.stringify(p?.tags) === '["lang","writing"]', JSON.stringify(p?.tags));
  });

  await step('empty body rejected', async () => {
    await home();
    $('#q').focus(); await newPrompt();
    await type('#e-body', '   ');
    $('#e-save').click(); await wait(300);
    check('empty body keeps editor open', visible('edit'));
    check('empty body shows message', /empty/i.test(toast()), toast());
    await home();
  });

  await step('fill flow', async () => {
    await home();
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
    const last = await pd.testLast();
    check('Ctrl+Enter copies final text', last === 'Translate Good morning into Hindi keeping a neutral tone.', last);
    check('values remembered', (await pd.slotValues()).text === 'Good morning');
    await home();
  });

  await step('enter right after typing', async () => {
    document.querySelector('.view:not([hidden]) [data-back]')?.click(); await wait(250);
    const q = $('#q'); q.focus(); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); await wait(200);
    q.value = 'respnsive'; q.dispatchEvent(new Event('input', { bubbles: true }));
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); // no wait: beat the debounce
    await wait(500);
    const used = (await pd.testLast()) ?? '';
    check('Enter right after typing uses the new top result', used.startsWith('Make this layout'), used.slice(0, 40));
    document.querySelector('#copybox-close')?.click();
  });

  await step('copy instead of paste', async () => {
    await home();
    await search('#css'); $('#q').focus(); await key('Enter'); await wait(300);
    // Hidden test windows may not get clipboard access; then the "Ready to copy" box must appear instead.
    const box = $('#copybox');
    const viaBox = box && !box.hidden;
    check('Enter on slot-free prompt copies (toast) or offers the copy box', toast().includes('to paste') || viaBox, toast());
    if (viaBox) {
      check('copy box holds the prompt text', box.querySelector('textarea').value.startsWith('Make this layout'), box.querySelector('textarea').value.slice(0, 40));
      $('#copybox-close').click(); await wait();
      check('copy box closes', box.hidden);
    }
    check('Enter hint says copy', $('.lbl-use').textContent === 'copy', $('.lbl-use').textContent);
  });

  await step('compose', async () => {
    await home();
    await search('#git'); $('#q').focus(); await key('Tab');
    await search('#ui'); $('#q').focus(); await key('Tab');
    check('tray shows 2', !$('#tray').hidden && $$('#tray .chip').length === 2);
    await key('Enter', { ctrlKey: true }); await wait(300);
    const t = (await pd.testLast()) ?? '';
    check('composed in order with blank line', t.startsWith('Write a concise') && t.includes('\n\nMake this layout'), t);
    check('tray cleared after use', $('#tray').hidden);
  });

  await step('edit existing', async () => {
    await home();
    await search('commit'); $('#q').focus(); await key('e', { code: 'KeyE', ctrlKey: true });
    check('Ctrl+E opens editor with prompt', visible('edit') && $('#e-title').value === 'Commit message', $('#e-title').value);
    await type('#e-body', $('#e-body').value + ' Scope: {{scope}}.');
    $('#e-pinned').checked = true;
    await key('s', { code: 'KeyS', ctrlKey: true }); await wait(300);
    const p = (await pd.list()).find((x) => x.title === 'Commit message');
    check('edit saved and pinned', p?.body.endsWith('Scope: {{scope}}.') && p.pinned);
  });

  await step('html is escaped', async () => {
    await home();
    await pd.create({ title: '<img src=x onerror="window.__xss=1">', body: '<b>bold</b> {{x}}' });
    await search('img'); await wait(300);
    check('no html injection', window.__xss === undefined && !$('#results img') && $('#results .t')?.textContent.includes('<img'), $('#results').innerHTML.slice(0, 200));
  });

  await step('delete two-click', async () => {
    await search('img'); $('#q').focus(); await key('e', { code: 'KeyE', ctrlKey: true });
    $('#e-delete').click(); await wait();
    check('first click arms', $('#e-delete').textContent.includes('again'), $('#e-delete').textContent);
    $('#e-delete').click(); await wait(300);
    check('second click deletes', !(await pd.list()).some((p) => p.title.includes('<img')));
  });

  await step('settings', async () => {
    await home();
    $('#q').focus(); await key(',', { code: 'Comma', ctrlKey: true }); await wait(300);
    check('Ctrl+, opens settings', visible('settings'));
    const shown = ['#s-hotkey', '#s-bubble', '#s-login', '#s-opacity'].filter((s) => $(s) && $(s).offsetParent !== null);
    check('desktop-only settings hidden', !shown.length, shown);
    $('#s-sep').value = '\n\n---\n\n'; $('#s-sep').dispatchEvent(new Event('change')); await wait(200);
    check('separator persisted', (await pd.settings()).separator === '\n\n---\n\n', JSON.stringify((await pd.settings()).separator));
    $('#s-sep').value = '\n\n'; $('#s-sep').dispatchEvent(new Event('change')); await wait(200);
    const rows = $$('#s-slots .r');
    check('saved slot values listed', rows.some((r) => r.textContent.includes('{{text}}')), $('#s-slots').textContent);
    const inp = $('#s-slots input[data-sv="text"]');
    inp.value = 'Hello'; inp.dispatchEvent(new Event('change', { bubbles: true })); await wait(250);
    check('slot value edited', (await pd.slotValues()).text === 'Hello');
    $('#s-slots [data-svdel="text"]').click(); await wait(250);
    check('slot value forgotten', !('text' in (await pd.slotValues())));
    await home();
  });

  await step('import/export', async () => {
    const json = await pd.exportData('return');
    check('export returns JSON', typeof json === 'string' && JSON.parse(json), typeof json);
    const before = (await pd.list()).length;
    check('re-import skips duplicates', (await pd.importData(json)) === 0);
    check('count unchanged', (await pd.list()).length === before);
    let err = null;
    try { await pd.importData('not json'); } catch (e) { err = e; }
    check('invalid import rejected', err instanceof Error, String(err));
    check('invalid import changes nothing', (await pd.list()).length === before);
  });

  await step('performance with 300 prompts', async () => {
    for (let i = 0; i < 300; i++) await pd.create({ title: `Bulk prompt ${i}`, body: `Lorem ipsum ${i} dolor sit amet {{v${i % 7}}}`, tags: ['bulk'] });
    const t0 = performance.now(); await pd.search('dolor 42'); const ms = performance.now() - t0;
    check('search 300 prompts < 150ms', ms < 150, `${Math.round(ms)}ms`);
    await home();
    await search('bulk prompt 42');
    check('whole-word ranking', titles()[0] === 'Bulk prompt 42', titles().slice(0, 3));
  });

  await step('esc behaviour', async () => {
    await home();
    await search('abc'); $('#q').focus(); await key('Escape');
    check('Esc clears query first', $('#q').value === '');
  });

  return R;
})();
