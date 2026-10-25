// Tiny dependency-free static server for the web build. Serves the repo root.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
};

export function start(port = 0) {
  const server = http.createServer((req, res) => {
    const notFound = () => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); };
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return notFound(); }
    if (rel.endsWith('/')) rel += 'index.html'; // like GitHub Pages
    const file = path.resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + path.sep)) return notFound();
    const type = types[path.extname(file).toLowerCase()];
    if (!type) return notFound();
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return notFound();
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
