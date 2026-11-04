const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const WINDOWS_FOREGROUND_SCRIPT = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class CapriForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
}
'@;
$handle = [CapriForeground]::GetForegroundWindow();
$title = New-Object System.Text.StringBuilder 512;
[void][CapriForeground]::GetWindowText($handle, $title, $title.Capacity);
$targetPid = 0;
[void][CapriForeground]::GetWindowThreadProcessId($handle, [ref]$targetPid);
$process = if ($targetPid -gt 0) { Get-Process -Id $targetPid -ErrorAction SilentlyContinue } else { $null };
[pscustomobject]@{
  appName = if ($process) { $process.ProcessName } else { "未知" };
  title = $title.ToString();
  processId = $targetPid
} | ConvertTo-Json -Compress
`.trim();

const singleLine = (value, maxChars) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);

class RuntimeContext {
  constructor({ includeActiveWindow = true, pollIntervalMs = 15000 }) {
    this.includeActiveWindow = includeActiveWindow;
    this.pollIntervalMs = pollIntervalMs;
    this.activeWindow = null;
    this.timer = null;
  }

  setIncludeActiveWindow(include) {
    this.includeActiveWindow = Boolean(include);
    if (!this.includeActiveWindow) this.activeWindow = null;
  }

  async readActiveWindow() {
    if (!this.includeActiveWindow) return null;
    try {
      const module = await import("active-win");
      const activeWin = module.activeWindow || module.default;
      if (typeof activeWin !== "function") return this.activeWindow;
      const window = await activeWin();
      if (!window || window.owner?.processId === process.pid) {
        return this.activeWindow;
      }
      const ownerName = singleLine(window.owner?.name, 80);
      if (/^(electron|摩羯桌宠|capri)/i.test(ownerName)) {
        return this.activeWindow;
      }
      return {
        appName: ownerName || "未知",
        title: singleLine(window.title, 80) || "无标题"
      };
    } catch {
      // Native bindings can be unavailable after an Electron upgrade.
    }

    if (process.platform === "win32") {
      try {
        const { stdout } = await execFileAsync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            WINDOWS_FOREGROUND_SCRIPT
          ],
          {
            timeout: 3000,
            windowsHide: true,
            maxBuffer: 16 * 1024
          }
        );
        const window = JSON.parse(stdout);
        if (!window?.processId || window.processId === process.pid) {
          return this.activeWindow;
        }
        return {
          appName: singleLine(window.appName, 80) || "未知",
          title: singleLine(window.title, 80) || "无标题"
        };
      } catch {
        // Runtime context is optional; chat must remain usable.
      }
    }
    return this.activeWindow;
  }

  async refresh() {
    const next = await this.readActiveWindow();
    if (next) this.activeWindow = next;
    return this.activeWindow;
  }

  startMonitor() {
    this.refresh();
    if (this.timer || !this.includeActiveWindow) return;
    this.timer = setInterval(() => this.refresh(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  stopMonitor() {
    clearInterval(this.timer);
    this.timer = null;
  }

  snapshot({ petState = "idle", chatPhase = "idle", relationship = "owner" }) {
    const now = new Date();
    return {
      localDateTime: new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "medium",
        hour12: false
      }).format(now),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      activeWindow: this.activeWindow,
      petState,
      chatPhase,
      relationship
    };
  }
}

module.exports = {
  RuntimeContext
};
