import { v4 as uuid } from 'uuid'
import { createLogger } from '../shared/logger.js'
import type { TaskResult } from '../shared/types.js'
import type { Telemetry } from './telemetry.js'
import type { InferenceLayer } from '../inference/index.js'

const log = createLogger('orchestrator')

// ─── Types ──────────────────────────────────────────────────────

export type DelegationStrategy = 'parallel' | 'sequential' | 'fan-out-fan-in'

export type AggregationMethod = 'concatenate' | 'best-of' | 'merge' | 'summarise'

export interface SubTask {
  id: string
  instruction: string
  context: Record<string, unknown>
  parentTaskId: string
  strategy: DelegationStrategy
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: TaskResult
  startedAt?: string
  completedAt?: string
  dependsOn?: string[]
}

export interface DecompositionResult {
  subtasks: SubTask[]
  strategy: DelegationStrategy
  aggregation: AggregationMethod
  reasoning: string
}

export interface AggregatedResult {
  success: boolean
  summary: string
  subtaskResults: Array<{
    subtaskId: string
    instruction: string
    success: boolean
    output: string
  }>
  totalDurationMs: number
  confidence: number
}

export interface OrchestratorConfig {
  maxSubtasks: number
  maxParallel: number
  subtaskTimeoutMs: number
  autoDecompose: boolean
  complexityThreshold: number
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxSubtasks: 5,
  maxParallel: 3,
  subtaskTimeoutMs: 60_000,
  autoDecompose: true,
  complexityThreshold: 0.7,
}

// ─── Orchestrator ───────────────────────────────────────────────

export type SubTaskExecutor = (subtask: SubTask) => Promise<TaskResult>

export class Orchestrator {
  private config: OrchestratorConfig
  private telemetry: Telemetry
  private inference: InferenceLayer
  private subtasks = new Map<string, SubTask>()

  constructor(options: {
    telemetry: Telemetry
    inference: InferenceLayer
    config?: Partial<OrchestratorConfig>
  }) {
    this.telemetry = options.telemetry
    this.inference = options.inference
    this.config = { ...DEFAULT_CONFIG, ...options.config }
  }

  /**
   * Determine whether a task should be decomposed into subtasks.
   * Uses the already-computed classification result to avoid a duplicate inference call.
   */
  shouldDecompose(instruction: string, _context: Record<string, unknown>, classificationResult?: { output: string; confidence: number }): boolean {
    if (!this.config.autoDecompose) return false

    // Check for multi-step indicators in the instruction
    const multiStepSignals = [
      /\band\b.*\band\b/i,               // multiple "and" conjunctions
      /\bthen\b/i,                         // sequential steps
      /\bfirst\b.*\bthen\b/i,             // explicit ordering
      /\b(step|phase|part)\s*\d/i,        // numbered steps
      /\b(also|additionally|moreover)\b/i, // additive tasks
      /\bcompare\b.*\bwith\b/i,           // comparison tasks
      /\bsearch\b.*\bsummar/i,            // search + summarise
      /\bfind\b.*\b(create|write|make)\b/i, // find + create
    ]

    const hasMultiStepSignals = multiStepSignals.some((re) => re.test(instruction))
    const isLongInstruction = instruction.length > 200

    // Use pre-computed classification confidence if available
    let classificationConfidence = classificationResult?.confidence ?? 0.5
    if (classificationResult?.output) {
      try {
        const parsed = JSON.parse(classificationResult.output)
        classificationConfidence = parsed.confidence ?? classificationConfidence
      } catch {
        // Not JSON — use the provided confidence
      }
    }

    // Decompose if: multi-step signals + high complexity, or very long instruction
    const shouldSplit = hasMultiStepSignals || (isLongInstruction && classificationConfidence > this.config.complexityThreshold)

    log.debug('Decomposition assessment', {
      instruction: instruction.slice(0, 80),
      hasMultiStepSignals,
      isLongInstruction,
      classificationConfidence,
      shouldSplit,
    })

    return shouldSplit
  }

  /**
   * Decompose a task into subtasks using inference.
   */
  async decompose(
    taskId: string,
    instruction: string,
    context: Record<string, unknown>,
  ): Promise<DecompositionResult> {
    log.info('Decomposing task', { taskId, instruction: instruction.slice(0, 80) })

    const result = await this.inference.run({
      type: 'plan',
      input: `Break down this complex task into ${this.config.maxSubtasks} or fewer independent subtasks.
Task: "${instruction}"
Context: ${JSON.stringify(context)}

For each subtask, provide:
1. A clear, self-contained instruction
2. Whether it depends on another subtask's output
3. Whether subtasks can run in parallel or must be sequential

Return a numbered list of subtasks. Mark parallel-safe subtasks with [PARALLEL] and sequential ones with [SEQUENTIAL].`,
      context,
    })

    // Parse the plan output into subtasks
    const subtasks = this.parseSubtasks(taskId, result.output, context)
    const strategy = this.determineStrategy(subtasks)
    const aggregation = this.determineAggregation(instruction)

    this.telemetry.emit('orchestrator.decomposed', {
      subtaskCount: subtasks.length,
      strategy,
      aggregation,
    }, taskId)

    log.info('Task decomposed', {
      taskId,
      subtaskCount: subtasks.length,
      strategy,
    })

    // Register subtasks
    for (const st of subtasks) {
      this.subtasks.set(st.id, st)
    }

    return { subtasks, strategy, aggregation, reasoning: result.output }
  }

  /**
   * Execute subtasks according to the delegation strategy.
   */
  async executeSubtasks(
    decomposition: DecompositionResult,
    executor: SubTaskExecutor,
  ): Promise<AggregatedResult> {
    const startTime = Date.now()
    const { subtasks, strategy, aggregation } = decomposition

    switch (strategy) {
      case 'parallel':
        await this.executeParallel(subtasks, executor)
        break
      case 'sequential':
        await this.executeSequential(subtasks, executor)
        break
      case 'fan-out-fan-in':
        await this.executeFanOutFanIn(subtasks, executor)
        break
    }

    const result = this.aggregate(subtasks, aggregation)
    result.totalDurationMs = Date.now() - startTime

    this.telemetry.emit('orchestrator.aggregated', {
      success: result.success,
      subtaskCount: subtasks.length,
      successCount: result.subtaskResults.filter((r) => r.success).length,
      totalDurationMs: result.totalDurationMs,
    }, subtasks[0]?.parentTaskId)

    return result
  }

  /**
   * Get status of all subtasks for a parent task.
   */
  getSubtasks(parentTaskId: string): SubTask[] {
    return Array.from(this.subtasks.values())
      .filter((st) => st.parentTaskId === parentTaskId)
  }

  /**
   * Get orchestrator stats.
   */
  get stats(): { totalSubtasks: number; running: number; completed: number; failed: number } {
    const all = Array.from(this.subtasks.values())
    return {
      totalSubtasks: all.length,
      running: all.filter((st) => st.status === 'running').length,
      completed: all.filter((st) => st.status === 'completed').length,
      failed: all.filter((st) => st.status === 'failed').length,
    }
  }

  // ─── Execution strategies ─────────────────────────────────────

  private async executeParallel(subtasks: SubTask[], executor: SubTaskExecutor): Promise<void> {
    // Execute in batches of maxParallel
    for (let i = 0; i < subtasks.length; i += this.config.maxParallel) {
      const batch = subtasks.slice(i, i + this.config.maxParallel)
      await Promise.all(batch.map((st) => this.runSubtask(st, executor)))
    }
  }

  private async executeSequential(subtasks: SubTask[], executor: SubTaskExecutor): Promise<void> {
    for (const st of subtasks) {
      await this.runSubtask(st, executor)
      // If a sequential subtask fails, stop execution
      if (st.status === 'failed') {
        log.warn('Sequential subtask failed, stopping chain', { subtaskId: st.id })
        break
      }
    }
  }

  private async executeFanOutFanIn(subtasks: SubTask[], executor: SubTaskExecutor): Promise<void> {
    // Fan-out: find subtasks without dependencies (can run in parallel)
    const independent = subtasks.filter((st) => !st.dependsOn || st.dependsOn.length === 0)
    const dependent = subtasks.filter((st) => st.dependsOn && st.dependsOn.length > 0)

    // Execute independent subtasks in parallel
    await Promise.all(independent.map((st) => this.runSubtask(st, executor)))

    // Fan-in: execute dependent subtasks, injecting prior results into context
    for (const st of dependent) {
      // Add results from dependencies into context
      if (st.dependsOn) {
        for (const depId of st.dependsOn) {
          const dep = this.subtasks.get(depId)
          if (dep?.result) {
            st.context = {
              ...st.context,
              [`result_${depId}`]: dep.result.summary,
            }
          }
        }
      }
      await this.runSubtask(st, executor)
    }
  }

  private async runSubtask(subtask: SubTask, executor: SubTaskExecutor): Promise<void> {
    subtask.status = 'running'
    subtask.startedAt = new Date().toISOString()

    this.telemetry.emit('orchestrator.subagent.started', {
      instruction: subtask.instruction.slice(0, 80),
    }, subtask.parentTaskId)

    log.info('Subtask started', {
      subtaskId: subtask.id,
      instruction: subtask.instruction.slice(0, 60),
    })

    try {
      // Execute with timeout
      const result = await Promise.race([
        executor(subtask),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Subtask timed out')), this.config.subtaskTimeoutMs),
        ),
      ])

      subtask.status = 'completed'
      subtask.result = result
      subtask.completedAt = new Date().toISOString()

      this.telemetry.emit('orchestrator.subagent.completed', {
        subtaskId: subtask.id,
        success: result.success,
        durationMs: result.durationMs,
      }, subtask.parentTaskId)

      log.info('Subtask completed', { subtaskId: subtask.id, success: result.success })
    } catch (err) {
      subtask.status = 'failed'
      subtask.completedAt = new Date().toISOString()
      subtask.result = {
        success: false,
        summary: err instanceof Error ? err.message : 'Subtask failed',
        outputs: {},
        stepsCompleted: 0,
        durationMs: 0,
        confidence: 0,
      }

      this.telemetry.emit('orchestrator.subagent.failed', {
        subtaskId: subtask.id,
        error: subtask.result.summary,
      }, subtask.parentTaskId)

      log.error('Subtask failed', {
        subtaskId: subtask.id,
        error: subtask.result.summary,
      })
    }
  }

  // ─── Parsing and aggregation ──────────────────────────────────

  private parseSubtasks(
    parentTaskId: string,
    planOutput: string,
    baseContext: Record<string, unknown>,
  ): SubTask[] {
    const lines = planOutput.split('\n').filter((l) => l.trim())
    const subtasks: SubTask[] = []
    const stepPattern = /^\d+[\.\)]\s*/

    for (const line of lines) {
      const trimmed = line.trim()
      if (!stepPattern.test(trimmed)) continue

      const instruction = trimmed
        .replace(stepPattern, '')
        .replace(/\[(PARALLEL|SEQUENTIAL)\]/gi, '')
        .trim()

      if (instruction.length < 5) continue

      const isParallel = /\[PARALLEL\]/i.test(trimmed)
      const id = `sub_${uuid().slice(0, 12)}`

      subtasks.push({
        id,
        instruction,
        context: { ...baseContext },
        parentTaskId,
        strategy: isParallel ? 'parallel' : 'sequential',
        status: 'pending',
      })

      if (subtasks.length >= this.config.maxSubtasks) break
    }

    // If parsing found nothing, create a single subtask from the whole plan
    if (subtasks.length === 0) {
      subtasks.push({
        id: `sub_${uuid().slice(0, 12)}`,
        instruction: planOutput.slice(0, 500),
        context: { ...baseContext },
        parentTaskId,
        strategy: 'sequential',
        status: 'pending',
      })
    }

    return subtasks
  }

  private determineStrategy(subtasks: SubTask[]): DelegationStrategy {
    const parallelCount = subtasks.filter((st) => st.strategy === 'parallel').length
    const hasDependencies = subtasks.some((st) => st.dependsOn && st.dependsOn.length > 0)

    if (hasDependencies) return 'fan-out-fan-in'
    if (parallelCount > subtasks.length / 2) return 'parallel'
    return 'sequential'
  }

  private determineAggregation(instruction: string): AggregationMethod {
    const lower = instruction.toLowerCase()

    if (lower.includes('compare') || lower.includes('best') || lower.includes('choose')) {
      return 'best-of'
    }
    if (lower.includes('summar') || lower.includes('combine') || lower.includes('overview')) {
      return 'summarise'
    }
    if (lower.includes('merge') || lower.includes('integrate') || lower.includes('unify')) {
      return 'merge'
    }
    return 'concatenate'
  }

  private aggregate(subtasks: SubTask[], method: AggregationMethod): AggregatedResult {
    const subtaskResults = subtasks.map((st) => ({
      subtaskId: st.id,
      instruction: st.instruction,
      success: st.result?.success ?? false,
      output: st.result?.summary ?? 'No output',
    }))

    const successCount = subtaskResults.filter((r) => r.success).length
    const success = successCount > 0
    const confidence = subtasks.length > 0 ? successCount / subtasks.length : 0

    let summary: string

    switch (method) {
      case 'concatenate':
        summary = subtaskResults
          .filter((r) => r.success)
          .map((r, i) => `[${i + 1}] ${r.output}`)
          .join('\n\n')
        break

      case 'best-of':
        // Pick the result with highest confidence
        const bestSubtask = subtasks
          .filter((st) => st.result?.success)
          .sort((a, b) => (b.result?.confidence ?? 0) - (a.result?.confidence ?? 0))[0]
        summary = bestSubtask?.result?.summary ?? 'No successful results'
        break

      case 'merge':
        summary = subtaskResults
          .filter((r) => r.success)
          .map((r) => r.output)
          .join('\n')
        break

      case 'summarise':
        summary = `Completed ${successCount}/${subtasks.length} subtasks:\n` +
          subtaskResults.map((r) => `- ${r.instruction}: ${r.success ? 'Done' : 'Failed'}`).join('\n')
        break
    }

    return {
      success,
      summary: summary || 'No results produced',
      subtaskResults,
      totalDurationMs: 0, // Set by caller
      confidence,
    }
  }
}
