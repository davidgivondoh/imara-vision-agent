import { exec } from 'child_process'
import { mkdir, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { platform } from 'os'
import { promisify } from 'util'
import { createLogger } from '../shared/logger.js'
import type { Tool, ToolResult } from './types.js'

const execAsync = promisify(exec)
const log = createLogger('tool:desktop')

const SCREENSHOT_DIR = './data/screenshots'

function isWindows(): boolean {
  return platform() === 'win32'
}

// ── screen_capture ──────────────────────────────────────────

export const screenCaptureTool: Tool = {
  name: 'screen_capture',
  description: 'Take a screenshot of the current desktop screen',
  category: 'desktop',
  permissions: ['desktop.read'],
  parameters: [
    { name: 'region', type: 'object', description: 'Optional region {x, y, width, height} to capture (default: full screen)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const screenshotDir = resolve(SCREENSHOT_DIR)
      if (!existsSync(screenshotDir)) {
        await mkdir(screenshotDir, { recursive: true })
      }

      const filename = `desktop_${Date.now()}.png`
      const filePath = join(screenshotDir, filename)

      if (isWindows()) {
        // Use PowerShell to capture screen
        const region = params.region as { x?: number; y?: number; width?: number; height?: number } | undefined
        const psScript = region
          ? `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$x=${region.x ?? 0}; $y=${region.y ?? 0}; $w=${region.width ?? 1280}; $h=${region.height ?? 720}
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, [System.Drawing.Size]::new($w, $h))
$g.Dispose()
$bmp.Save('${filePath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "ok"
`
          : `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$g.Dispose()
$bmp.Save('${filePath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "ok"
`

        await execAsync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, { timeout: 10000 })
      } else {
        // macOS/Linux fallback
        try {
          await execAsync(`import -window root "${filePath}"`, { timeout: 10000 })
        } catch {
          await execAsync(`screencapture -x "${filePath}"`, { timeout: 10000 })
        }
      }

      log.info(`Desktop screenshot saved: ${filePath}`)

      return {
        success: true,
        output: {
          path: filePath,
          filename,
        },
        artifacts: [
          {
            type: 'screenshot',
            content: filePath,
            mimeType: 'image/png',
            filename,
          },
        ],
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Screenshot failed',
      }
    }
  },
}

// ── mouse_click ─────────────────────────────────────────────

export const mouseClickTool: Tool = {
  name: 'mouse_click',
  description: 'Move the mouse to a position and click',
  category: 'desktop',
  permissions: ['desktop.control'],
  parameters: [
    { name: 'x', type: 'number', description: 'X coordinate', required: true },
    { name: 'y', type: 'number', description: 'Y coordinate', required: true },
    { name: 'button', type: 'string', description: 'Mouse button: "left", "right", or "middle" (default: "left")', required: false },
    { name: 'doubleClick', type: 'boolean', description: 'Double-click instead of single (default: false)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const x = params.x as number
      const y = params.y as number
      const button = (params.button as string) || 'left'
      const doubleClick = (params.doubleClick as boolean) ?? false

      if (typeof x !== 'number' || typeof y !== 'number') {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'x and y coordinates must be numbers',
        }
      }

      if (isWindows()) {
        const clickFlag = button === 'right' ? '0x0008, 0x0010' : '0x0002, 0x0004'
        const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MouseOps {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
}
"@
[MouseOps]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 50
[MouseOps]::mouse_event(${clickFlag}, 0, 0, 0, 0)
${doubleClick ? `Start-Sleep -Milliseconds 100; [MouseOps]::mouse_event(${clickFlag}, 0, 0, 0, 0)` : ''}
Write-Output "clicked"
`
        await execAsync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, { timeout: 5000 })
      } else {
        // macOS/Linux fallback
        try {
          const clickCmd = doubleClick ? 'click --repeat 2' : 'click'
          await execAsync(`xdotool mousemove ${x} ${y} ${clickCmd}`, { timeout: 5000 })
        } catch {
          await execAsync(`cliclick m:${x},${y} c:${x},${y}`, { timeout: 5000 })
        }
      }

      log.info(`Mouse clicked at (${x}, ${y})`, { button, doubleClick })

      return {
        success: true,
        output: { x, y, button, doubleClick },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Mouse click failed',
      }
    }
  },
}

// ── keyboard_type ───────────────────────────────────────────

export const keyboardTypeTool: Tool = {
  name: 'keyboard_type',
  description: 'Type text or press keyboard keys',
  category: 'desktop',
  permissions: ['desktop.control'],
  parameters: [
    { name: 'text', type: 'string', description: 'Text to type', required: false },
    { name: 'key', type: 'string', description: 'Special key to press: "enter", "tab", "escape", "backspace", "delete", "up", "down", "left", "right", "home", "end", "pageup", "pagedown", "f1"-"f12"', required: false },
    { name: 'modifiers', type: 'string', description: 'Modifier keys: "ctrl", "alt", "shift", "win" — combine with "+" (e.g. "ctrl+shift")', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const text = params.text as string | undefined
      const key = params.key as string | undefined
      const modifiers = params.modifiers as string | undefined

      if (!text && !key) {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'Either "text" or "key" must be provided',
        }
      }

      if (isWindows()) {
        if (text) {
          // Type text using PowerShell SendKeys
          // Escape special SendKeys characters
          const escaped = text.replace(/[+^%~(){}[\]]/g, '{$&}')
          const psScript = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
Write-Output "typed"
`
          await execAsync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, { timeout: 5000 })
        } else if (key) {
          // Press a special key with optional modifiers
          const keyMap: Record<string, string> = {
            enter: '{ENTER}', tab: '{TAB}', escape: '{ESC}',
            backspace: '{BACKSPACE}', delete: '{DELETE}',
            up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
            home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}',
            f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}',
            f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}',
            f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
            space: ' ',
          }

          const sendKey = keyMap[key.toLowerCase()] || key
          let fullKey = sendKey

          if (modifiers) {
            const mods = modifiers.toLowerCase().split('+')
            let prefix = ''
            if (mods.includes('ctrl')) prefix += '^'
            if (mods.includes('alt')) prefix += '%'
            if (mods.includes('shift')) prefix += '+'
            fullKey = prefix + sendKey
          }

          const psScript = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${fullKey.replace(/'/g, "''")}')
Write-Output "pressed"
`
          await execAsync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, { timeout: 5000 })
        }
      } else {
        // macOS/Linux fallback
        if (text) {
          try {
            await execAsync(`xdotool type -- "${text}"`, { timeout: 5000 })
          } catch {
            await execAsync(`osascript -e 'tell application "System Events" to keystroke "${text}"'`, { timeout: 5000 })
          }
        } else if (key) {
          try {
            const xdoKey = modifiers ? `${modifiers}+${key}` : key
            await execAsync(`xdotool key ${xdoKey}`, { timeout: 5000 })
          } catch {
            await execAsync(`osascript -e 'tell application "System Events" to key code ${key}'`, { timeout: 5000 })
          }
        }
      }

      log.info('Keyboard action', { text: text?.slice(0, 20), key, modifiers })

      return {
        success: true,
        output: { text: text ?? null, key: key ?? null, modifiers: modifiers ?? null },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Keyboard action failed',
      }
    }
  },
}

// ── get_active_window ───────────────────────────────────────

export const getActiveWindowTool: Tool = {
  name: 'get_active_window',
  description: 'Get information about the currently active/focused window',
  category: 'desktop',
  permissions: ['desktop.read'],
  parameters: [],
  async execute(): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const activeWin = await import('active-win')
      const result = await activeWin.default()

      if (!result) {
        return {
          success: true,
          output: { title: 'Unknown', owner: 'Unknown', bounds: null },
          durationMs: Date.now() - startTime,
        }
      }

      return {
        success: true,
        output: {
          title: result.title,
          owner: result.owner?.name ?? 'Unknown',
          processId: result.owner?.processId ?? null,
          bounds: result.bounds,
          platform: result.platform,
        },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Failed to get active window',
      }
    }
  },
}

// ── list_windows ────────────────────────────────────────────

export const listWindowsTool: Tool = {
  name: 'list_windows',
  description: 'List all open windows on the desktop',
  category: 'desktop',
  permissions: ['desktop.read'],
  parameters: [],
  async execute(): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      if (isWindows()) {
        const { stdout } = await execAsync(
          `powershell -NoProfile -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json"`,
          { timeout: 5000 },
        )

        const parsed = JSON.parse(stdout)
        const windows = (Array.isArray(parsed) ? parsed : [parsed]).map((w: Record<string, unknown>) => ({
          processId: w.Id,
          name: w.ProcessName,
          title: w.MainWindowTitle,
        }))

        return {
          success: true,
          output: { windows, count: windows.length },
          durationMs: Date.now() - startTime,
        }
      }

      // macOS/Linux fallback
      try {
        const { stdout } = await execAsync('wmctrl -l', { timeout: 5000 })
        const windows = stdout.trim().split('\n').map((line) => {
          const parts = line.split(/\s+/)
          return { id: parts[0], title: parts.slice(3).join(' ') }
        })
        return {
          success: true,
          output: { windows, count: windows.length },
          durationMs: Date.now() - startTime,
        }
      } catch {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'Window listing not available on this platform',
        }
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Failed to list windows',
      }
    }
  },
}

// ── Export all desktop tools ─────────────────────────────────

export const desktopTools: Tool[] = [
  screenCaptureTool,
  mouseClickTool,
  keyboardTypeTool,
  getActiveWindowTool,
  listWindowsTool,
]
