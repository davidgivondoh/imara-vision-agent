import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from '../../src/core/memory.js'

describe('MemoryStore', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = new MemoryStore({ maxEntries: 100 })
  })

  it('should store and retrieve a memory entry', async () => {
    const id = await store.store({
      key: 'test_key',
      value: 'test_value',
      type: 'fact',
      scope: 'user',
    })

    const entry = await store.get(id)
    expect(entry).not.toBeNull()
    expect(entry!.key).toBe('test_key')
    expect(entry!.value).toBe('test_value')
    expect(entry!.type).toBe('fact')
    expect(entry!.scope).toBe('user')
  })

  it('should search entries by keyword', async () => {
    await store.store({ key: 'physics_exam', value: 'March 25', type: 'fact', scope: 'user' })
    await store.store({ key: 'chemistry_lab', value: 'Lab report due', type: 'context', scope: 'session' })
    await store.store({ key: 'physics_notes', value: 'Chapter 5 complete', type: 'context', scope: 'session' })

    const results = await store.search('physics')
    expect(results.length).toBe(2)
    expect(results.every((r) => r.key.includes('physics') || r.value.includes('physics'))).toBe(true)
  })

  it('should filter search by type', async () => {
    await store.store({ key: 'pref_theme', value: 'dark', type: 'preference', scope: 'user' })
    await store.store({ key: 'fact_exam', value: 'March 25', type: 'fact', scope: 'user' })

    const results = await store.search('', { type: 'preference' })
    expect(results.every((r) => r.type === 'preference')).toBe(true)
  })

  it('should update an entry', async () => {
    const id = await store.store({ key: 'counter', value: '1', type: 'fact', scope: 'user' })
    await store.update(id, { value: '2' })

    const entry = await store.get(id)
    expect(entry!.value).toBe('2')
  })

  it('should delete an entry', async () => {
    const id = await store.store({ key: 'temp', value: 'data', type: 'context', scope: 'session' })
    await store.delete(id)

    const entry = await store.get(id)
    expect(entry).toBeNull()
  })

  it('should export all entries', async () => {
    await store.store({ key: 'a', value: '1', type: 'fact', scope: 'user' })
    await store.store({ key: 'b', value: '2', type: 'fact', scope: 'user' })

    const entries = await store.export()
    expect(entries.length).toBe(2)
  })

  it('should clear all entries', async () => {
    await store.store({ key: 'a', value: '1', type: 'fact', scope: 'user' })
    await store.store({ key: 'b', value: '2', type: 'fact', scope: 'user' })

    await store.clear()
    expect(store.size).toBe(0)
  })

  it('should not return expired entries', async () => {
    const id = await store.store({
      key: 'expired',
      value: 'old',
      type: 'context',
      scope: 'session',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })

    const entry = await store.get(id)
    expect(entry).toBeNull()
  })

  it('should evict oldest entry when at capacity', async () => {
    const smallStore = new MemoryStore({ maxEntries: 2 })
    await smallStore.store({ key: 'first', value: '1', type: 'fact', scope: 'user' })
    await smallStore.store({ key: 'second', value: '2', type: 'fact', scope: 'user' })
    await smallStore.store({ key: 'third', value: '3', type: 'fact', scope: 'user' })

    expect(smallStore.size).toBe(2)
    const entries = await smallStore.export()
    const keys = entries.map((e) => e.key)
    expect(keys).toContain('third')
  })
})
