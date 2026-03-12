import { v4 as uuid } from 'uuid'
import { createLogger } from '../shared/logger.js'
import type { MemoryEntry, MemoryType, MemoryScope } from '../shared/types.js'

const log = createLogger('memory')

export interface SearchOptions {
  type?: MemoryType
  scope?: MemoryScope
  limit?: number
}

export interface StoreParams {
  key: string
  value: string
  type: MemoryType
  scope: MemoryScope
  expiresAt?: string
}

export class MemoryStore {
  private entries = new Map<string, MemoryEntry>()
  private maxEntries: number
  private onChangeCallback?: () => void

  constructor(options?: { maxEntries?: number }) {
    this.maxEntries = options?.maxEntries ?? 50000
  }

  onChanged(callback: () => void): void {
    this.onChangeCallback = callback
  }

  private notifyChange(): void {
    if (this.onChangeCallback) this.onChangeCallback()
  }

  loadEntries(entries: MemoryEntry[]): void {
    for (const entry of entries) {
      if (!this.isExpired(entry)) {
        this.entries.set(entry.id, entry)
      }
    }
    log.info(`Loaded ${this.entries.size} memory entries`)
  }

  async store(params: StoreParams): Promise<string> {
    if (this.entries.size >= this.maxEntries) {
      this.evictOldest()
    }

    const id = uuid()
    const now = new Date().toISOString()

    const entry: MemoryEntry = {
      id,
      type: params.type,
      key: params.key,
      value: params.value,
      scope: params.scope,
      createdAt: now,
      updatedAt: now,
      expiresAt: params.expiresAt,
    }

    this.entries.set(id, entry)
    log.debug(`Stored memory: ${params.key}`, { id, type: params.type })
    this.notifyChange()
    return id
  }

  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
    const limit = options?.limit ?? 10
    const queryLower = query.toLowerCase()

    const results: MemoryEntry[] = []

    for (const entry of this.entries.values()) {
      if (this.isExpired(entry)) continue
      if (options?.type && entry.type !== options.type) continue
      if (options?.scope && entry.scope !== options.scope) continue

      const keyMatch = entry.key.toLowerCase().includes(queryLower)
      const valueMatch = entry.value.toLowerCase().includes(queryLower)

      if (keyMatch || valueMatch) {
        results.push(entry)
      }

      if (results.length >= limit) break
    }

    return results
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id)
    if (!entry || this.isExpired(entry)) return null
    return entry
  }

  async update(id: string, patch: Partial<Pick<MemoryEntry, 'key' | 'value' | 'expiresAt'>>): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`Memory entry not found: ${id}`)

    if (patch.key !== undefined) entry.key = patch.key
    if (patch.value !== undefined) entry.value = patch.value
    if (patch.expiresAt !== undefined) entry.expiresAt = patch.expiresAt
    entry.updatedAt = new Date().toISOString()

    log.debug(`Updated memory: ${entry.key}`, { id })
    this.notifyChange()
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id)
    this.notifyChange()
  }

  async export(): Promise<MemoryEntry[]> {
    return Array.from(this.entries.values()).filter((e) => !this.isExpired(e))
  }

  async clear(): Promise<void> {
    const count = this.entries.size
    this.entries.clear()
    log.info(`Cleared ${count} memory entries`)
    this.notifyChange()
  }

  get size(): number {
    return this.entries.size
  }

  private isExpired(entry: MemoryEntry): boolean {
    if (!entry.expiresAt) return false
    return new Date(entry.expiresAt) < new Date()
  }

  private evictOldest(): void {
    let oldest: MemoryEntry | null = null
    for (const entry of this.entries.values()) {
      if (!oldest || entry.createdAt < oldest.createdAt) {
        oldest = entry
      }
    }
    if (oldest) {
      this.entries.delete(oldest.id)
      log.debug(`Evicted oldest memory entry: ${oldest.key}`)
    }
  }
}
