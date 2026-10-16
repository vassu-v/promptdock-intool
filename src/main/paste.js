// Sends Ctrl+V to whichever window has focus, via one long-lived PowerShell
// process so each paste costs milliseconds instead of a PowerShell start-up.
import { spawn } from 'node:child_process';

let ps = null;

function ensure() {
  if (ps && !ps.killed && ps.exitCode === null) return ps;
  ps = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-Command', '-'], {
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  ps.stdin.write('Add-Type -AssemblyName System.Windows.Forms\n');
  ps.on('exit', () => { ps = null; });
  return ps;
}

export function warmUp() {
  if (process.platform === 'win32') ensure();
}

export function sendPaste() {
  if (process.platform !== 'win32') return;
  ensure().stdin.write("[System.Windows.Forms.SendKeys]::SendWait('^v')\n");
}

export function dispose() {
  ps?.kill();
  ps = null;
}
