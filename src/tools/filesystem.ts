import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve, basename, extname, relative, isAbsolute } from 'path'
import { homedir } from 'os'
import { createLogger } from '../shared/logger.js'
import type { Tool, ToolResult, ToolParameter, ToolPermission } from './types.js'

const log = createLogger('tool:filesystem')

// Allowed root directories — prevent path traversal
const ALLOWED_ROOTS = [
  homedir(),
  resolve('./data'),
]

function isPathAllowed(targetPath: string): boolean {
  const resolved = resolve(targetPath)
  return ALLOWED_ROOTS.some((root) => resolved.startsWith(resolve(root)))
}

function safePath(inputPath: string): string {
  // Expand ~ to home directory
  const expanded = inputPath.startsWith('~')
    ? join(homedir(), inputPath.slice(1))
    : inputPath

  // Make absolute
  const abs = isAbsolute(expanded) ? expanded : resolve(expanded)

  // Block path traversal
  if (!isPathAllowed(abs)) {
    throw new Error(`Access denied: path "${inputPath}" is outside allowed directories`)
  }

  return abs
}

// ── read_file ────────────────────────────────────────────────

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a text file',
  category: 'filesystem',
  permissions: ['filesystem.read'],
  parameters: [
    { name: 'path', type: 'string', description: 'File path to read', required: true },
    { name: 'maxLines', type: 'number', description: 'Maximum lines to read (default: all)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const filePath = safePath(params.path as string)
      let content = await readFile(filePath, 'utf-8')

      const maxLines = params.maxLines as number | undefined
      if (maxLines && maxLines > 0) {
        const lines = content.split('\n')
        content = lines.slice(0, maxLines).join('\n')
        if (lines.length > maxLines) {
          content += `\n... (${lines.length - maxLines} more lines)`
        }
      }

      return {
        success: true,
        output: content,
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Failed to read file',
      }
    }
  },
}

// ── write_file ───────────────────────────────────────────────

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write content to a text file (creates or overwrites)',
  category: 'filesystem',
  permissions: ['filesystem.write'],
  parameters: [
    { name: 'path', type: 'string', description: 'File path to write', required: true },
    { name: 'content', type: 'string', description: 'Content to write', required: true },
    { name: 'append', type: 'boolean', description: 'Append instead of overwrite (default: false)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const filePath = safePath(params.path as string)
      const content = params.content as string
      const append = params.append as boolean | undefined

      // Ensure parent directory exists
      const dir = join(filePath, '..')
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }

      if (append) {
        const existing = existsSync(filePath) ? await readFile(filePath, 'utf-8') : ''
        await writeFile(filePath, existing + content, 'utf-8')
      } else {
        await writeFile(filePath, content, 'utf-8')
      }

      return {
        success: true,
        output: `File written: ${filePath} (${content.length} chars)`,
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Failed to write file',
      }
    }
  },
}

// ── list_directory ───────────────────────────────────────────

export const listDirectoryTool: Tool = {
  name: 'list_directory',
  description: 'List files and folders in a directory',
  category: 'filesystem',
  permissions: ['filesystem.read'],
  parameters: [
    { name: 'path', type: 'string', description: 'Directory path (default: home)', required: false },
    { name: 'showHidden', type: 'boolean', description: 'Include hidden files (default: false)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const dirPath = safePath((params.path as string) || '~')
      const showHidden = params.showHidden as boolean | undefined

      const entries = await readdir(dirPath, { withFileTypes: true })
      const items = []

      for (const entry of entries) {
        if (!showHidden && entry.name.startsWith('.')) continue

        const fullPath = join(dirPath, entry.name)
        try {
          const info = await stat(fullPath)
          items.push({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: info.size,
            modified: info.mtime.toISOString(),
          })
        } catch {
          items.push({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: 0,
            modified: '',
          })
        }
      }

      // Sort: directories first, then alphabetical
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return {
        success: true,
        output: items,
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Failed to list directory',
      }
    }
  },
}

// ── search_files ─────────────────────────────────────────────

export const searchFilesTool: Tool = {
  name: 'search_files',
  description: 'Search for files by name pattern in a directory',
  category: 'filesystem',
  permissions: ['filesystem.read'],
  parameters: [
    { name: 'path', type: 'string', description: 'Directory to search in', required: true },
    { name: 'pattern', type: 'string', description: 'Filename pattern to match (case-insensitive substring)', required: true },
    { name: 'maxResults', type: 'number', description: 'Maximum results (default: 20)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const dirPath = safePath(params.path as string)
      const pattern = (params.pattern as string).toLowerCase()
      const maxResults = (params.maxResults as number) || 20
      const matches: Array<{ name: string; path: string; type: string }> = []

      async function walk(dir: string, depth: number): Promise<void> {
        if (depth > 5 || matches.length >= maxResults) return
        try {
          const entries = await readdir(dir, { withFileTypes: true })
          for (const entry of entries) {
            if (matches.length >= maxResults) return
            if (entry.name.startsWith('.')) continue

            const fullPath = join(dir, entry.name)
            if (entry.name.toLowerCase().includes(pattern)) {
              matches.push({
                name: entry.name,
                path: relative(dirPath, fullPath),
                type: entry.isDirectory() ? 'directory' : 'file',
              })
            }
            if (entry.isDirectory()) {
              await walk(fullPath, depth + 1)
            }
          }
        } catch {
          // Skip directories we can't read
        }
      }

      await walk(dirPath, 0)

      return {
        success: true,
        output: matches,
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Failed to search files',
      }
    }
  },
}

// ── file_info ────────────────────────────────────────────────

export const fileInfoTool: Tool = {
  name: 'file_info',
  description: 'Get detailed information about a file or directory',
  category: 'filesystem',
  permissions: ['filesystem.read'],
  parameters: [
    { name: 'path', type: 'string', description: 'File or directory path', required: true },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const filePath = safePath(params.path as string)
      const info = await stat(filePath)

      return {
        success: true,
        output: {
          name: basename(filePath),
          path: filePath,
          type: info.isDirectory() ? 'directory' : 'file',
          extension: info.isFile() ? extname(filePath) : null,
          size: info.size,
          sizeHuman: formatBytes(info.size),
          created: info.birthtime.toISOString(),
          modified: info.mtime.toISOString(),
          accessed: info.atime.toISOString(),
          isReadonly: !(info.mode & 0o200),
        },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Failed to get file info',
      }
    }
  },
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

// ── Export all filesystem tools ──────────────────────────────

export const filesystemTools: Tool[] = [
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  searchFilesTool,
  fileInfoTool,
]
