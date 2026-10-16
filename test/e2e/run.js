// Launches the real app against a throwaway data folder, runs scenario.js inside
// the panel, and prints a pass/fail table. Usage: npm run test:e2e
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptdock-e2e-'));
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const exe = process.argv[2] ? path.resolve(process.argv[2]) : electron; // optionally test a packaged .exe
const args = exe === electron ? [root] : [];

const child = spawn(exe, args, { env: { ...process.env, PD_E2E: path.join(root, 'test', 'e2e', 'scenario.js'), PD_DATA_DIR: dataDir } });
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => { child.kill(); }, 120000);
child.on('exit', (code) => {
  clearTimeout(timer);
  fs.rmSync(dataDir, { recursive: true, force: true });
  const line = out.split(/\r?\n/).find((l) => l.startsWith('E2E_RESULTS '));
  if (!line) { console.error('No results. Output:\n' + out); process.exit(1); }
  const results = JSON.parse(line.slice(12));
  for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.ok ? '' : `  → ${r.info}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  for (const l of out.split(/\r?\n/).filter((l) => l.startsWith('[renderer]'))) console.log(l);
  process.exit(failed || code ? 1 : 0);
});
