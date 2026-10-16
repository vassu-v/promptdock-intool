// Remembers which window was in front when PromptDock opened, then refocuses it
// and sends Ctrl+V. Uses one long-lived PowerShell process (no native modules),
// so each call costs milliseconds instead of a PowerShell start-up.
import { spawn } from 'node:child_process';

// One statement per line: `powershell -Command -` reads stdin line by line.
const INIT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class PDWin { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h); }'",
  '$global:pdPrev = [IntPtr]::Zero',
].join('\n');

let ps = null;

function ensure() {
  if (ps && ps.exitCode === null) return ps;
  ps = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  ps.stdin.write(INIT + '\n');
  ps.on('exit', () => { ps = null; });
  return ps;
}

const send = (line) => { if (process.platform === 'win32') ensure().stdin.write(line + '\n'); };

export const warmUp = () => send('');

/** Call just before PromptDock takes focus. */
export const rememberForeground = () => send('$global:pdPrev = [PDWin]::GetForegroundWindow()');

export function sendPaste() {
  send("if ($global:pdPrev -ne [IntPtr]::Zero) { [PDWin]::SetForegroundWindow($global:pdPrev) | Out-Null; Start-Sleep -Milliseconds 60 }; [System.Windows.Forms.SendKeys]::SendWait('^v')");
}

export function dispose() {
  ps?.kill();
  ps = null;
}
