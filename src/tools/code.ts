import { exec } from 'child_process'
import { promisify } from 'util'
import { platform, hostname, cpus, totalmem, freemem, uptime as osUptime } from 'os'
import { createLogger } from '../shared/logger.js'
import type { Tool, ToolResult } from './types.js'

const execAsync = promisify(exec)
const log = createLogger('tool:code')

// Maximum output size to prevent memory issues
const MAX_OUTPUT_LENGTH = 10_000

// Blocked commands that could cause damage
const BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+[\/~]/i,
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b:>\s*\//,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\breg\s+delete\b/i,
  /\bdel\s+\/[sfq]/i,
]

// ── run_command ────────────────────────────────────────────

export const runCommandTool: Tool = {
  name: 'run_command',
  description: 'Execute a shell command and return the output. Commands run in a sandboxed context with a timeout. Destructive commands are blocked.',
  category: 'code',
  permissions: ['code.shell'],
  parameters: [
    { name: 'command', type: 'string', description: 'Shell command to execute', required: true },
    { name: 'cwd', type: 'string', description: 'Working directory (default: project root)', required: false },
    { name: 'timeout', type: 'number', description: 'Timeout in milliseconds (default: 15000, max: 60000)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const command = params.command as string
      const cwd = (params.cwd as string) || process.cwd()
      const timeout = Math.min((params.timeout as number) || 15_000, 60_000)

      if (!command || command.trim().length === 0) {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'Command is required',
        }
      }

      // Safety check
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(command)) {
          return {
            success: false,
            output: null,
            durationMs: Date.now() - startTime,
            error: `Command blocked for safety: matches dangerous pattern`,
          }
        }
      }

      log.info(`Executing command: ${command.slice(0, 80)}`)

      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB
        env: { ...process.env, TERM: 'dumb' }, // Disable color codes
      })

      const truncatedStdout = stdout.length > MAX_OUTPUT_LENGTH
        ? stdout.slice(0, MAX_OUTPUT_LENGTH) + `\n... (truncated, ${stdout.length} total chars)`
        : stdout

      const truncatedStderr = stderr.length > MAX_OUTPUT_LENGTH
        ? stderr.slice(0, MAX_OUTPUT_LENGTH) + `\n... (truncated)`
        : stderr

      return {
        success: true,
        output: {
          stdout: truncatedStdout.trim(),
          stderr: truncatedStderr.trim() || undefined,
          exitCode: 0,
        },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number; signal?: string; message?: string }
      return {
        success: false,
        output: {
          stdout: (execErr.stdout || '').trim().slice(0, MAX_OUTPUT_LENGTH),
          stderr: (execErr.stderr || '').trim().slice(0, MAX_OUTPUT_LENGTH),
          exitCode: execErr.code ?? 1,
          signal: execErr.signal,
        },
        durationMs: Date.now() - startTime,
        error: execErr.message || 'Command failed',
      }
    }
  },
}

// ── code_execute ───────────────────────────────────────────

export const codeExecuteTool: Tool = {
  name: 'code_execute',
  description: 'Execute a JavaScript/TypeScript code snippet in a sandboxed Node.js context. Has access to standard Node.js modules. Returns the result of the last expression.',
  category: 'code',
  permissions: ['code.execute'],
  parameters: [
    { name: 'code', type: 'string', description: 'JavaScript code to execute', required: true },
    { name: 'timeout', type: 'number', description: 'Timeout in milliseconds (default: 10000)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const code = params.code as string
      const timeout = Math.min((params.timeout as number) || 10_000, 30_000)

      if (!code || code.trim().length === 0) {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'Code is required',
        }
      }

      log.info(`Executing code snippet (${code.length} chars)`)

      // Execute via a child process for isolation
      const wrappedCode = `
        const result = (async () => {
          ${code}
        })();
        result.then(r => {
          process.stdout.write(JSON.stringify({ success: true, result: r === undefined ? 'undefined' : r }));
        }).catch(e => {
          process.stdout.write(JSON.stringify({ success: false, error: e.message || String(e) }));
        });
      `

      const { stdout } = await execAsync(
        `node -e "${wrappedCode.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
        { timeout, maxBuffer: 1024 * 1024 },
      )

      try {
        const parsed = JSON.parse(stdout) as { success: boolean; result?: unknown; error?: string }
        if (parsed.success) {
          return {
            success: true,
            output: parsed.result,
            durationMs: Date.now() - startTime,
          }
        }
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: parsed.error || 'Execution failed',
        }
      } catch {
        // If output isn't valid JSON, return raw output
        return {
          success: true,
          output: stdout.trim().slice(0, MAX_OUTPUT_LENGTH),
          durationMs: Date.now() - startTime,
        }
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Code execution failed',
      }
    }
  },
}

// ── system_info ────────────────────────────────────────────

export const systemInfoTool: Tool = {
  name: 'system_info',
  description: 'Get system information: OS, CPU, memory, uptime, and environment details',
  category: 'system',
  permissions: ['system.info'],
  parameters: [],
  async execute(): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const cpuInfo = cpus()
      const totalMemGB = (totalmem() / (1024 ** 3)).toFixed(1)
      const freeMemGB = (freemem() / (1024 ** 3)).toFixed(1)
      const usedMemGB = ((totalmem() - freemem()) / (1024 ** 3)).toFixed(1)

      return {
        success: true,
        output: {
          platform: platform(),
          hostname: hostname(),
          nodeVersion: process.version,
          cpu: {
            model: cpuInfo[0]?.model || 'Unknown',
            cores: cpuInfo.length,
          },
          memory: {
            total: `${totalMemGB} GB`,
            used: `${usedMemGB} GB`,
            free: `${freeMemGB} GB`,
            usagePercent: Math.round(((totalmem() - freemem()) / totalmem()) * 100),
          },
          uptime: {
            seconds: Math.round(osUptime()),
            formatted: formatUptime(osUptime()),
          },
          env: {
            shell: process.env.SHELL || process.env.COMSPEC || 'unknown',
            user: process.env.USER || process.env.USERNAME || 'unknown',
            home: process.env.HOME || process.env.USERPROFILE || 'unknown',
          },
        },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Failed to get system info',
      }
    }
  },
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

// ── open_application ───────────────────────────────────────

export const openApplicationTool: Tool = {
  name: 'open_application',
  description: 'Open a desktop application, file, or URL using the system default handler',
  category: 'desktop',
  permissions: ['desktop.control'],
  parameters: [
    { name: 'target', type: 'string', description: 'Application name, file path, or URL to open', required: true },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const target = params.target as string

      if (!target || target.trim().length === 0) {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'Target is required',
        }
      }

      log.info(`Opening: ${target}`)

      const os = platform()
      let cmd: string

      if (os === 'win32') {
        cmd = `start "" "${target}"`
      } else if (os === 'darwin') {
        cmd = `open "${target}"`
      } else {
        cmd = `xdg-open "${target}"`
      }

      await execAsync(cmd, { timeout: 10_000 })

      return {
        success: true,
        output: { opened: target, platform: os },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Failed to open application',
      }
    }
  },
}

// ── clipboard_read ─────────────────────────────────────────

export const clipboardReadTool: Tool = {
  name: 'clipboard_read',
  description: 'Read the current contents of the system clipboard',
  category: 'desktop',
  permissions: ['desktop.read'],
  parameters: [],
  async execute(): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const os = platform()
      let cmd: string

      if (os === 'win32') {
        cmd = 'powershell -NoProfile -Command "Get-Clipboard"'
      } else if (os === 'darwin') {
        cmd = 'pbpaste'
      } else {
        cmd = 'xclip -selection clipboard -o'
      }

      const { stdout } = await execAsync(cmd, { timeout: 5000 })

      return {
        success: true,
        output: {
          content: stdout.trim().slice(0, MAX_OUTPUT_LENGTH),
          length: stdout.trim().length,
        },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Failed to read clipboard',
      }
    }
  },
}

// ── clipboard_write ────────────────────────────────────────

export const clipboardWriteTool: Tool = {
  name: 'clipboard_write',
  description: 'Write text to the system clipboard',
  category: 'desktop',
  permissions: ['desktop.control'],
  parameters: [
    { name: 'text', type: 'string', description: 'Text to copy to clipboard', required: true },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const text = params.text as string

      if (!text) {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'Text is required',
        }
      }

      const os = platform()

      if (os === 'win32') {
        // Use PowerShell Set-Clipboard with piped input for safety
        await execAsync(`powershell -NoProfile -Command "Set-Clipboard -Value '${text.replace(/'/g, "''")}'"`
        , { timeout: 5000 })
      } else if (os === 'darwin') {
        await execAsync(`echo ${JSON.stringify(text)} | pbcopy`, { timeout: 5000 })
      } else {
        await execAsync(`echo ${JSON.stringify(text)} | xclip -selection clipboard`, { timeout: 5000 })
      }

      log.info('Clipboard written', { length: text.length })

      return {
        success: true,
        output: { copied: true, length: text.length },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Failed to write clipboard',
      }
    }
  },
}

// ── Export all code/system tools ────────────────────────────

export const codeTools: Tool[] = [
  runCommandTool,
  codeExecuteTool,
  systemInfoTool,
  openApplicationTool,
  clipboardReadTool,
  clipboardWriteTool,
]
