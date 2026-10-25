// Serves the repo, runs the web build inside Electron (electron-runner.cjs) and
// prints a pass/fail table. Usage: node test/web/run.js
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

const server = await start();
const child = spawn(electron, [path.join(here, 'electron-runner.cjs')], { env: { ...process.env, PD_WEB_URL: server.url } });
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => { child.kill(); }, 180000);
child.on('exit', async (code) => {
  clearTimeout(timer);
  await server.close();
  const line = out.split(/\r?\n/).find((l) => l.startsWith('WEB_E2E_RESULTS '));
  if (!line) { console.error('No results. Output:\n' + out); process.exit(1); }
  const results = JSON.parse(line.slice('WEB_E2E_RESULTS '.length));
  for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.ok ? '' : `  → ${r.info}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed || code ? 1 : 0);
});
