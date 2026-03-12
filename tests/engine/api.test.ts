import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'http'
import { AgentInstance } from '../../src/engine/agent-instance.js'
import { createRoutes } from '../../src/engine/routes.js'

describe('App Engine API', () => {
  let server: Server
  let baseUrl: string
  let agent: AgentInstance

  beforeAll(async () => {
    agent = new AgentInstance({
      product: 'engine',
      configOverrides: { engine: { port: 0, host: '127.0.0.1', corsOrigins: '*' } },
    })
    await agent.start()

    const app = express()
    app.use(express.json())
    app.use(createRoutes(agent))

    server = createServer(app)
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })

    const addr = server.address() as { port: number }
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    await agent.stop()
    server.close()
  })

  it('GET /api/agent/health should return healthy', async () => {
    const res = await fetch(`${baseUrl}/api/agent/health`)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.status).toBe('healthy')
    expect(data.version).toBe('0.1.0')
  })

  it('POST /api/agent/tasks should create a task', async () => {
    const res = await fetch(`${baseUrl}/api/agent/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'Test task from API' }),
    })
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.success).toBe(true)
    expect(data.task.id).toMatch(/^task_/)
    expect(data.task.instruction).toBe('Test task from API')
  })

  it('POST /api/agent/tasks should reject empty instruction', async () => {
    const res = await fetch(`${baseUrl}/api/agent/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: '' }),
    })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.error.code).toBe('VALIDATION_ERROR')
  })

  it('POST /api/agent/run should create and execute a task', async () => {
    const res = await fetch(`${baseUrl}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'Summarise my notes' }),
    })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.result.stepsCompleted).toBeGreaterThanOrEqual(1)
    expect(data.result.confidence).toBeGreaterThan(0)
  })

  it('POST /api/agent/recommendations should return recommendations', async () => {
    const res = await fetch(`${baseUrl}/api/agent/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'student',
        intent: 'study for physics exam',
        context: { course: 'physics' },
      }),
    })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.recommendations.length).toBeGreaterThan(0)
  })

  it('POST /api/agent/memory should store an entry', async () => {
    const res = await fetch(`${baseUrl}/api/agent/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'test_fact',
        value: 'Exam is March 25',
        type: 'fact',
        scope: 'user',
      }),
    })
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.success).toBe(true)
    expect(data.id).toBeDefined()
  })

  it('POST /api/agent/memory/search should find entries', async () => {
    // Store first
    await fetch(`${baseUrl}/api/agent/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'physics_date', value: 'March 25', type: 'fact', scope: 'user' }),
    })

    const res = await fetch(`${baseUrl}/api/agent/memory/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'physics' }),
    })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.entries.length).toBeGreaterThan(0)
  })

  it('GET /api/agent/plugins should list plugins', async () => {
    const res = await fetch(`${baseUrl}/api/agent/plugins`)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.plugins.length).toBeGreaterThan(0)
    expect(data.plugins.some((p: { name: string }) => p.name === 'note-summariser')).toBe(true)
  })

  it('GET /api/agent/config should return safe config', async () => {
    const res = await fetch(`${baseUrl}/api/agent/config`)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.config.agent.autonomyLevel).toBeDefined()
    // Should not expose API keys
    expect(data.config.inference).toBeUndefined()
  })
})
