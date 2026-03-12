import { v4 as uuid } from 'uuid'
import { createLogger } from '../shared/logger.js'
import { EventBus } from '../shared/events.js'
import type { AgentTask, TaskStatus, TaskConstraints, TaskResult, AgentStep } from '../shared/types.js'
import type { Telemetry } from './telemetry.js'

const log = createLogger('scheduler')

export interface CreateTaskParams {
  instruction: string
  context?: Record<string, unknown>
  constraints?: Partial<TaskConstraints>
}

export type TaskExecutor = (task: AgentTask) => Promise<TaskResult>

export class Scheduler {
  private tasks = new Map<string, AgentTask>()
  private queue: string[] = []
  private runningCount = 0
  private maxConcurrent: number
  private defaultConstraints: TaskConstraints
  private executor: TaskExecutor | null = null
  private bus: EventBus
  private telemetry: Telemetry

  constructor(options: {
    maxConcurrent?: number
    defaultConstraints?: Partial<TaskConstraints>
    bus: EventBus
    telemetry: Telemetry
  }) {
    this.maxConcurrent = options.maxConcurrent ?? 3
    this.defaultConstraints = {
      maxSteps: options.defaultConstraints?.maxSteps ?? 20,
      requireConfirmation: options.defaultConstraints?.requireConfirmation ?? false,
      timeout: options.defaultConstraints?.timeout ?? 60000,
      ...options.defaultConstraints,
    }
    this.bus = options.bus
    this.telemetry = options.telemetry
  }

  setExecutor(executor: TaskExecutor): void {
    this.executor = executor
  }

  createTask(params: CreateTaskParams): AgentTask {
    const id = `task_${uuid().slice(0, 12)}`
    const now = new Date().toISOString()

    const task: AgentTask = {
      id,
      instruction: params.instruction,
      context: params.context ?? {},
      constraints: { ...this.defaultConstraints, ...params.constraints },
      status: 'created',
      steps: [],
      createdAt: now,
    }

    this.tasks.set(id, task)
    this.telemetry.emit('task.created', { instruction: params.instruction }, id)
    log.info(`Task created: ${id}`, { instruction: params.instruction })

    return task
  }

  async enqueue(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (task.status !== 'created') throw new Error(`Task ${taskId} is not in "created" state`)

    task.status = 'queued'
    this.queue.push(taskId)
    log.debug(`Task queued: ${taskId}`)

    await this.processQueue()
  }

  async executeTask(taskId: string): Promise<TaskResult> {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (!this.executor) throw new Error('No task executor registered')

    task.status = 'queued'
    this.queue.push(taskId)

    return new Promise<TaskResult>((resolve, reject) => {
      const onComplete = (event: unknown) => {
        const data = event as { taskId: string; result: TaskResult }
        if (data.taskId === taskId) {
          this.bus.off('task.done', onComplete)
          if (task.status === 'failed') {
            reject(new Error(task.result?.summary ?? 'Task failed'))
          } else {
            resolve(data.result)
          }
        }
      }
      this.bus.on('task.done', onComplete)
      this.processQueue().catch(reject)
    })
  }

  async cancelTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)

    if (task.status === 'queued') {
      this.queue = this.queue.filter((id) => id !== taskId)
    }

    task.status = 'cancelled'
    task.completedAt = new Date().toISOString()
    this.telemetry.emit('task.cancelled', {}, taskId)
    log.info(`Task cancelled: ${taskId}`)
  }

  getTask(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId)
  }

  listTasks(filter?: { status?: TaskStatus; limit?: number; offset?: number }): AgentTask[] {
    let results = Array.from(this.tasks.values())

    if (filter?.status) {
      results = results.filter((t) => t.status === filter.status)
    }

    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    const offset = filter?.offset ?? 0
    const limit = filter?.limit ?? 20

    return results.slice(offset, offset + limit)
  }

  addStep(taskId: string, step: AgentStep): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.steps.push(step)
    this.telemetry.emit('step.executed', {
      stepType: step.type,
      description: step.description,
      durationMs: step.durationMs,
    }, taskId)
    this.bus.emit('task.step', { taskId, step })
  }

  get stats(): { total: number; running: number; queued: number; completed: number; failed: number } {
    const all = Array.from(this.tasks.values())
    return {
      total: all.length,
      running: all.filter((t) => t.status === 'running').length,
      queued: all.filter((t) => t.status === 'queued').length,
      completed: all.filter((t) => t.status === 'completed').length,
      failed: all.filter((t) => t.status === 'failed').length,
    }
  }

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.runningCount < this.maxConcurrent) {
      const taskId = this.queue.shift()
      if (!taskId) break

      const task = this.tasks.get(taskId)
      if (!task || task.status !== 'queued') continue

      this.runningCount++
      task.status = 'running'
      this.telemetry.emit('task.started', { instruction: task.instruction }, taskId)

      this.runTask(task).finally(() => {
        this.runningCount--
        this.processQueue()
      })
    }
  }

  private async runTask(task: AgentTask): Promise<void> {
    if (!this.executor) {
      task.status = 'failed'
      task.result = {
        success: false,
        summary: 'No executor registered',
        outputs: {},
        stepsCompleted: 0,
        durationMs: 0,
        confidence: 0,
      }
      return
    }

    const startTime = Date.now()
    const timeoutMs = task.constraints.timeout ?? this.defaultConstraints.timeout ?? 60000

    try {
      // Execute with timeout enforcement
      const result = await Promise.race([
        this.executor(task),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ])
      task.status = 'completed'
      task.result = result
      task.completedAt = new Date().toISOString()
      this.telemetry.emit('task.completed', {
        success: true,
        stepsCompleted: result.stepsCompleted,
        durationMs: result.durationMs,
        confidence: result.confidence,
      }, task.id)
      this.bus.emit('task.done', { taskId: task.id, result })
      log.info(`Task completed: ${task.id}`, { durationMs: result.durationMs })
    } catch (err) {
      const durationMs = Date.now() - startTime
      task.status = 'failed'
      task.completedAt = new Date().toISOString()
      task.result = {
        success: false,
        summary: err instanceof Error ? err.message : 'Unknown error',
        outputs: {},
        stepsCompleted: task.steps.length,
        durationMs,
        confidence: 0,
      }
      this.telemetry.emit('task.failed', {
        error: task.result.summary,
        durationMs,
      }, task.id)
      this.bus.emit('task.done', { taskId: task.id, result: task.result })
      log.error(`Task failed: ${task.id}`, { error: task.result.summary })
    }
  }
}
