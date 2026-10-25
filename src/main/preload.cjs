const { contextBridge, ipcRenderer } = require('electron');

const call = async (ch, ...a) => {
  const r = await ipcRenderer.invoke(ch, ...a);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('pd', {
  list: () => call('prompts:list'),
  search: (q) => call('prompts:search', q),
  create: (p) => call('prompts:create', p),
  update: (id, patch) => call('prompts:update', id, patch),
  remove: (id) => call('prompts:remove', id),
  tags: () => call('tags:list'),
  slotValues: () => call('slots:get'),
  setSlotValues: (v) => call('slots:set', v),
  settings: () => call('settings:get'),
  setSettings: (p) => call('settings:set', p),
  use: (o) => call('use', o),
  recipes: () => call('recipes:list'),
  saveRecipe: (r) => call('recipes:save', r),
  removeRecipe: (id) => call('recipes:remove', id),
  hide: () => call('panel:hide'),
  modal: (open) => call('modal', open),
  exportData: (testPath) => call('data:export', testPath),
  importData: (testPath) => call('data:import', testPath),
  firstRun: () => call('app:firstRun'),
  testLast: () => call('test:last'),
  semantic: {
    state: () => call('semantic:state'),
    enable: () => call('semantic:enable'),
    disable: (o) => call('semantic:disable', o),
    onState: (fn) => ipcRenderer.on('semantic:state', (_e, s) => fn(s)),
  },
  bubble: {
    click: () => call('bubble:click'),
    move: (d) => call('bubble:move', d),
    moved: () => call('bubble:moved'),
  },
  onShown: (fn) => ipcRenderer.on('panel:shown', fn),
});
