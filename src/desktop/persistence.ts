import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createLogger } from '../shared/logger.js'
import type { MemoryEntry, AgentTask } from '../shared/types.js'
import type { AgentConfig } from '../shared/config.js'

const log = createLogger('persistence')

const NEURA_DIR = join(homedir(), '.neura')
const MEMORY_FILE = join(NEURA_DIR, 'memory.json')
const HISTORY_FILE = join(NEURA_DIR, 'history.json')
const CONFIG_FILE = join(NEURA_DIR, 'config.json')

function ensureDir(): void {
  if (!existsSync(NEURA_DIR)) {
    mkdirSync(NEURA_DIR, { recursive: true })
    log.info(`Created data directory: ${NEURA_DIR}`)
  }
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    log.warn(`Failed to read ${path}, using defaults`)
    return fallback
  }
}

function writeJson(path: string, data: unknown): void {
  try {
    ensureDir()
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
  } catch (err) {
    log.error(`Failed to write ${path}`, { error: err instanceof Error ? err.message : 'Unknown' })
  }
}

// ── Memory Persistence ──────────────────────────────────────

export function loadMemory(): MemoryEntry[] {
  const entries = readJson<MemoryEntry[]>(MEMORY_FILE, [])
  log.info(`Loaded ${entries.length} memory entries from disk`)
  return entries
}

export function saveMemory(entries: MemoryEntry[]): void {
  writeJson(MEMORY_FILE, entries)
  log.debug(`Saved ${entries.length} memory entries to disk`)
}

// ── Task History Persistence ────────────────────────────────

interface TaskHistoryEntry {
  id: string
  instruction: string
  status: string
  success: boolean
  confidence: number
  summary: string
  stepsCompleted: number
  durationMs: number
  createdAt: string
  completedAt?: string
}

export function loadHistory(): TaskHistoryEntry[] {
  return readJson<TaskHistoryEntry[]>(HISTORY_FILE, [])
}

export function saveTaskToHistory(task: AgentTask): void {
  const history = loadHistory()

  history.unshift({
    id: task.id,
    instruction: task.instruction,
    status: task.status,
    success: task.result?.success ?? false,
    confidence: task.result?.confidence ?? 0,
    summary: task.result?.summary ?? '',
    stepsCompleted: task.result?.stepsCompleted ?? 0,
    durationMs: task.result?.durationMs ?? 0,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
  })

  // Keep last 200 entries
  if (history.length > 200) {
    history.length = 200
  }

  writeJson(HISTORY_FILE, history)
}

export { type TaskHistoryEntry }

// ── Config Persistence ──────────────────────────────────────

export function loadPersistedConfig(): Partial<AgentConfig> {
  return readJson<Partial<AgentConfig>>(CONFIG_FILE, {})
}

export function savePersistedConfig(config: Partial<AgentConfig>): void {
  const existing = loadPersistedConfig()
  const merged = { ...existing, ...config }
  writeJson(CONFIG_FILE, merged)
  log.info('Config saved to disk')
}

export function getConfigValue(key: string): unknown {
  const config = loadPersistedConfig()
  return getNestedValue(config, key)
}

export function setConfigValue(key: string, value: unknown): void {
  const config = loadPersistedConfig() as Record<string, unknown>
  setNestedValue(config, key, value)
  writeJson(CONFIG_FILE, config)
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

// ── Utility ─────────────────────────────────────────────────

export function getNeuraDir(): string {
  ensureDir()
  return NEURA_DIR
}
