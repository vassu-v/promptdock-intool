// Renders build/icon.svg to build/icon.png (256) and build/icon.ico (16-256) using
// Electron's own renderer, so no image libraries are needed. Run: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  // Render once at 512 px from a temp file, then downscale for each icon size.
  const tmp = path.join(app.getPath('temp'), 'promptdock-icon.html');
  fs.writeFileSync(tmp, `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', '<svg width="512" height="512" ')}</body></html>`);
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 300));
  const big = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  win.destroy();
  fs.rmSync(tmp);
  const pngs = SIZES.map((s) => ({ s, buf: big.resize({ width: s, height: s, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), pngs.at(-1).buf);
  fs.writeFileSync(path.join(root, 'build', 'tray.png'), pngs.find((p) => p.s === 32).buf);
  // ICO container with PNG-compressed entries (supported since Windows Vista).
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ s, buf }, i) => {
    const e = 6 + i * 16;
    head[e] = s >= 256 ? 0 : s; head[e + 1] = s >= 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += buf.length;
  });
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([head, ...pngs.map((p) => p.buf)]));
  console.log('wrote icon.png, tray.png, icon.ico');
  app.quit();
});
