import { describe, it, expect, beforeEach } from 'vitest'
import { AgentLoop } from '../../src/core/agent-loop.js'
import { Scheduler } from '../../src/core/scheduler.js'
import { MemoryStore } from '../../src/core/memory.js'
import { PolicyEngine } from '../../src/core/policy.js'
import { Telemetry } from '../../src/core/telemetry.js'
import { InferenceLayer } from '../../src/inference/index.js'
import { EventBus } from '../../src/shared/events.js'

describe('AgentLoop', () => {
  let loop: AgentLoop
  let scheduler: Scheduler
  let memory: MemoryStore

  beforeEach(async () => {
    const bus = new EventBus()
    const telemetry = new Telemetry({ product: 'engine', enabled: false, bus })
    memory = new MemoryStore()
    const policy = new PolicyEngine({ telemetry })
    scheduler = new Scheduler({ maxConcurrent: 2, bus, telemetry })

    const inference = new InferenceLayer({
      preferLocal: true,
      localModelPath: './models',
      localProvider: 'rule-based',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'llama3.2',
      cloudApiKey: '',
      cloudEndpoint: '',
      cloudProvider: 'anthropic',
      cloudModel: 'claude-sonnet-4-20250514',
      timeoutMs: 5000,
      telemetry,
    })
    await inference.initialize()

    loop = new AgentLoop({
      scheduler,
      memory,
      policy,
      inference,
      telemetry,
      config: {
        autonomyLevel: 'L2',
        maxStepsPerTask: 20,
        confirmIrreversible: true,
      },
    })
  })

  it('should execute a summarisation task and return a result', async () => {
    const task = scheduler.createTask({
      instruction: 'Summarise my physics notes',
      context: { topic: 'physics' },
    })

    const result = await scheduler.executeTask(task.id)

    expect(result.success).toBe(true)
    expect(result.stepsCompleted).toBeGreaterThanOrEqual(1)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.summary).toBeDefined()
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('should execute a quiz generation task', async () => {
    const task = scheduler.createTask({
      instruction: 'Generate a practice quiz for chemistry',
      context: { topic: 'chemistry' },
    })

    const result = await scheduler.executeTask(task.id)

    expect(result.success).toBe(true)
    expect(result.stepsCompleted).toBeGreaterThanOrEqual(1)
  })

  it('should store results in memory after successful execution', async () => {
    const task = scheduler.createTask({
      instruction: 'Summarise lecture notes',
    })

    await scheduler.executeTask(task.id)

    // Give background post-processing a moment to complete
    await new Promise((r) => setTimeout(r, 50))

    const entries = await memory.export()
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some((e) => e.key.includes('task_result'))).toBe(true)
  })

  it('should generate recommendations', async () => {
    const recs = await loop.generateRecommendations({
      role: 'student',
      intent: 'prepare for physics exam',
      context: { course: 'physics' },
    })

    expect(recs.length).toBeGreaterThan(0)
    expect(recs[0].type).toBe('study_plan')
    expect(recs[0].confidence).toBeGreaterThan(0)
    expect(recs[0].role).toBe('student')
  })

  it('should complete tasks with valid result structure', async () => {
    const task = scheduler.createTask({ instruction: 'Explain gravity' })
    const result = await scheduler.executeTask(task.id)

    expect(result.success).toBe(true)
    expect(result.summary).toBeDefined()
    expect(result.summary.length).toBeGreaterThan(0)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})
