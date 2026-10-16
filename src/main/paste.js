// Remembers which window was in front when PromptDock opened, then refocuses it
// and sends Ctrl+V. Uses one long-lived PowerShell process (no native modules),
// so each call costs milliseconds instead of a PowerShell start-up.
import { spawn } from 'node:child_process';

// One statement per line: `powershell -Command -` reads stdin line by line.
const INIT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class PDWin { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n); [DllImport(\"user32.dll\")] static extern void keybd_event(byte k, byte s, uint f, UIntPtr e); [DllImport(\"user32.dll\")] static extern bool IsIconic(IntPtr h); [DllImport(\"user32.dll\")] static extern bool ShowWindow(IntPtr h, int c); public static bool Focus(IntPtr h) { if (GetForegroundWindow() == h) return true; if (IsIconic(h)) ShowWindow(h, 9); keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); return SetForegroundWindow(h); } public static IntPtr Fg() { IntPtr h = GetForegroundWindow(); var sb = new System.Text.StringBuilder(256); GetClassName(h, sb, 256); string c = sb.ToString(); return (c == \"Shell_TrayWnd\" || c == \"NotifyIconOverflowWindow\" || c == \"TopLevelWindowForOverflowXamlIsland\") ? IntPtr.Zero : h; } }'",
].join('\n');

let ps = null;
const waiters = [];
const debug = (...a) => { if (process.env.PD_DEBUG) console.log('[paste]', ...a); };
let prevHwnd = null;

function ensure() {
  if (ps && ps.exitCode === null) return ps;
  ps = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  ps.stdin.write(INIT + '\n');
  ps.stdout.setEncoding('utf8');
  ps.stderr.setEncoding('utf8');
  ps.stderr.on('data', (d) => debug('ps stderr:', d.trim()));
  let buf = '';
  ps.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('FG ')) waiters.shift()?.(line.slice(3));
      else if (line.startsWith('LOG ')) debug(line.slice(4));
    }
  });
  ps.on('exit', () => { ps = null; waiters.splice(0).forEach((w) => w(null)); });
  return ps;
}

const send = (line) => { if (process.platform === 'win32') ensure().stdin.write(line + '\n'); };

export const warmUp = () => send('');

/**
 * Record the window that is in front right now. Await this BEFORE showing the
 * panel, otherwise the panel itself may already be the foreground window.
 * `ownHandles` are our own windows, which are never remembered.
 */
export async function rememberForeground(ownHandles = []) {
  if (process.platform !== 'win32') return;
  const hwnd = await new Promise((res) => {
    const waiter = (h) => { clearTimeout(t); res(h); };
    // Give up after 400 ms (e.g. PowerShell still starting) rather than delay the panel.
    const t = setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); res(null); }, 400);
    waiters.push(waiter);
    send("[Console]::Out.WriteLine('FG ' + [PDWin]::Fg()); [Console]::Out.Flush()");
  });
  debug('foreground', hwnd, 'own', ownHandles);
  if (hwnd && hwnd !== '0' && !ownHandles.includes(hwnd)) prevHwnd = hwnd;
}

export function sendPaste() {
  debug('paste into', prevHwnd);
  const focus = prevHwnd ? `$ok = [PDWin]::Focus([IntPtr]${prevHwnd}); Start-Sleep -Milliseconds 60; ` : '';
  send(`${focus}[System.Windows.Forms.SendKeys]::SendWait('^v')${process.env.PD_DEBUG ? "; [Console]::Out.WriteLine('LOG focus=' + $ok + ' fg=' + [PDWin]::GetForegroundWindow()); [Console]::Out.Flush()" : ''}`);
}

export function dispose() {
  ps?.kill();
  ps = null;
}
