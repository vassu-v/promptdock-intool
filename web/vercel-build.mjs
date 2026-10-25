// Vercel build for the web app (Project → Root Directory: web).
// The page reuses ../src and ../build, which sit outside web/, so copy everything the site
// needs into dist/ with the same layout as the repo. No dependencies, no bundler.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(web, '..');
const out = path.join(web, 'dist');

const copy = (from, to) => fs.cpSync(from, to, { recursive: true });

fs.rmSync(out, { recursive: true, force: true });
for (const f of ['index.html', 'main.js', 'pd-web.js', 'storage.js', 'semantic.js', 'semantic-worker.js', 'web.css', 'vendor']) {
  copy(path.join(web, f), path.join(out, 'web', f));
}
copy(path.join(repo, 'src', 'core'), path.join(out, 'src', 'core'));
copy(path.join(repo, 'src', 'renderer'), path.join(out, 'src', 'renderer'));
copy(path.join(repo, 'src', 'main', 'seed.js'), path.join(out, 'src', 'main', 'seed.js'));
copy(path.join(repo, 'build', 'icon.svg'), path.join(out, 'build', 'icon.svg'));
console.log('Built web app into', out);
