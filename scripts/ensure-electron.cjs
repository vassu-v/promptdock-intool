// npm 11+ skips dependency install scripts unless approved, so Electron's own
// postinstall (which downloads the runtime) may not run. Do it here if needed.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = path.join(__dirname, '..', 'node_modules', 'electron');
const exe = path.join(dir, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
if (fs.existsSync(dir) && !fs.existsSync(exe)) {
  console.log('Downloading the Electron runtime...');
  execFileSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit' });
}
