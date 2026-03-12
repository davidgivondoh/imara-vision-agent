import { describe, it, expect, beforeEach } from 'vitest'
import { Scheduler } from '../../src/core/scheduler.js'
import { Telemetry } from '../../src/core/telemetry.js'
import { EventBus } from '../../src/shared/events.js'

describe('Scheduler', () => {
  let scheduler: Scheduler
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
    const telemetry = new Telemetry({ product: 'engine', enabled: false, bus })
    scheduler = new Scheduler({ maxConcurrent: 2, bus, telemetry })
  })

  it('should create a task with default constraints', () => {
    const task = scheduler.createTask({ instruction: 'Test task' })

    expect(task.id).toMatch(/^task_/)
    expect(task.instruction).toBe('Test task')
    expect(task.status).toBe('created')
    expect(task.constraints.maxSteps).toBe(20)
    expect(task.steps).toEqual([])
  })

  it('should create a task with custom constraints', () => {
    const task = scheduler.createTask({
      instruction: 'Custom task',
      constraints: { maxSteps: 5, requireConfirmation: true },
    })

    expect(task.constraints.maxSteps).toBe(5)
    expect(task.constraints.requireConfirmation).toBe(true)
  })

  it('should retrieve a task by ID', () => {
    const task = scheduler.createTask({ instruction: 'Find me' })
    const found = scheduler.getTask(task.id)

    expect(found).toBeDefined()
    expect(found!.id).toBe(task.id)
  })

  it('should list tasks', () => {
    scheduler.createTask({ instruction: 'Task 1' })
    scheduler.createTask({ instruction: 'Task 2' })
    scheduler.createTask({ instruction: 'Task 3' })

    const tasks = scheduler.listTasks()
    expect(tasks.length).toBe(3)
  })

  it('should cancel a created task', async () => {
    const task = scheduler.createTask({ instruction: 'Cancel me' })
    await scheduler.cancelTask(task.id)

    const updated = scheduler.getTask(task.id)
    expect(updated!.status).toBe('cancelled')
  })

  it('should execute a task with a registered executor', async () => {
    scheduler.setExecutor(async (task) => ({
      success: true,
      summary: `Done: ${task.instruction}`,
      outputs: {},
      stepsCompleted: 1,
      durationMs: 10,
      confidence: 0.9,
    }))

    const task = scheduler.createTask({ instruction: 'Run me' })
    const result = await scheduler.executeTask(task.id)

    expect(result.success).toBe(true)
    expect(result.summary).toContain('Run me')
  })

  it('should timeout tasks that exceed their constraint', async () => {
    scheduler.setExecutor(async () => {
      // Simulate a task that takes longer than its timeout
      await new Promise((resolve) => setTimeout(resolve, 2000))
      return {
        success: true,
        summary: 'Should not reach here',
        outputs: {},
        stepsCompleted: 1,
        durationMs: 2000,
        confidence: 0.9,
      }
    })

    const task = scheduler.createTask({
      instruction: 'Slow task',
      constraints: { timeout: 100 }, // 100ms timeout
    })

    await expect(scheduler.executeTask(task.id)).rejects.toThrow('timed out')

    const updated = scheduler.getTask(task.id)
    expect(updated!.status).toBe('failed')
  }, 5000)

  it('should report stats', () => {
    scheduler.createTask({ instruction: 'A' })
    scheduler.createTask({ instruction: 'B' })

    const stats = scheduler.stats
    expect(stats.total).toBe(2)
    expect(stats.running).toBe(0)
  })
})
