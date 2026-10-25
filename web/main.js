// Boots the web build: SQLite (WebAssembly) → durable browser storage → shared panel UI.
import { createWebPd } from './pd-web.js';

const banner = document.getElementById('storage-banner');
const notices = [];

function showNotices() {
  if (!notices.length) return;
  banner.textContent = notices.join(' ');
  banner.hidden = false;
}

async function boot() {
  const SQL = await window.initSqlJs({ locateFile: (f) => new URL(`vendor/${f}`, import.meta.url).href });
  window.pd = await createWebPd(SQL, notices);
  showNotices();

  // Reuse the desktop panel markup so both builds stay identical.
  const html = await (await fetch(new URL('../src/renderer/index.html', import.meta.url))).text();
  const panel = new DOMParser().parseFromString(html, 'text/html').getElementById('panel');
  document.getElementById('app').replaceChildren(document.adoptNode(panel));

  await import('../src/renderer/app.js');
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('loading').textContent = 'PromptDock could not start in this browser.';
  notices.push(`Startup failed: ${err?.message ?? err}. Try a recent Chrome, Edge, Firefox or Safari.`);
  showNotices();
});
