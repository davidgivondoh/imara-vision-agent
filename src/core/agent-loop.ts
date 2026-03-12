import { v4 as uuid } from 'uuid'
import { createLogger } from '../shared/logger.js'
import type {
  AgentTask,
  AgentStep,
  TaskResult,
  AgentAction,
  AutonomyLevel,
  UserRole,
  Recommendation,
  RecommendationType,
  ToolUseRequest,
  ToolUseResult,
} from '../shared/types.js'
import type { InferenceLayer } from '../inference/index.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { MemoryStore } from './memory.js'
import type { PolicyEngine } from './policy.js'
import type { Scheduler } from './scheduler.js'
import type { Telemetry } from './telemetry.js'
import type { EventBus } from '../shared/events.js'
import { Orchestrator, type SubTask } from './orchestrator.js'
import type { AccessibilityManager } from './accessibility.js'

const log = createLogger('agent-loop')

const MAX_TOOL_ROUNDS = 6
const MAX_REFLECTION_RETRIES = 1
const QUALITY_THRESHOLD = 0.65

// Per-category tool limits to prevent browsing loops
const TOOL_CATEGORY_LIMITS: Record<string, number> = {
  web_search: 3,
  browser_navigate: 3,
  browser_read: 3,
}

export interface AgentLoopConfig {
  autonomyLevel: AutonomyLevel
  maxStepsPerTask: number
  confirmIrreversible: boolean
}

export interface AgentLoopDeps {
  scheduler: Scheduler
  memory: MemoryStore
  policy: PolicyEngine
  inference: InferenceLayer
  tools?: ToolRegistry
  telemetry: Telemetry
  bus?: EventBus
  config: AgentLoopConfig
  userId?: string
  userRole?: UserRole
  onConfirmation?: (action: AgentAction) => Promise<boolean>
  orchestrator?: Orchestrator
  accessibility?: AccessibilityManager
}

export class AgentLoop {
  private deps: AgentLoopDeps
  private orchestrator: Orchestrator

  constructor(deps: AgentLoopDeps) {
    this.deps = deps
    this.orchestrator = deps.orchestrator ?? new Orchestrator({
      telemetry: deps.telemetry,
      inference: deps.inference,
    })

    // Register self as the task executor
    this.deps.scheduler.setExecutor((task) => this.executeTask(task))
  }

  async executeTask(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now()
    const { scheduler, inference, memory, policy, telemetry, config } = this.deps
    const autonomy = task.constraints.autonomyLevel ?? config.autonomyLevel

    try {
      // ── Policy gate (instant, no inference) ───────────────
      const action: AgentAction = {
        id: uuid(),
        type: 'generate',
        label: `Execute: ${task.instruction}`,
        payload: {},
        reversible: true,
        requiresConfirmation: task.constraints.requireConfirmation,
      }

      const policyResult = policy.evaluate({
        action,
        userId: this.deps.userId ?? 'anonymous',
        userRole: this.deps.userRole ?? 'student',
        autonomyLevel: autonomy,
        taskId: task.id,
      })

      if (!policyResult.allowed) {
        if (policyResult.reasonCode === 'autonomy_exceeded' && this.deps.onConfirmation) {
          const approved = await this.deps.onConfirmation(action)
          if (!approved) {
            return {
              success: false,
              summary: 'User denied action',
              outputs: {},
              stepsCompleted: 0,
              durationMs: Date.now() - startTime,
              confidence: 0,
            }
          }
        } else {
          return {
            success: false,
            summary: policyResult.message,
            outputs: {},
            stepsCompleted: 0,
            durationMs: Date.now() - startTime,
            confidence: 0,
          }
        }
      }

      // ── Emit: thinking ──
      this.deps.bus?.emit('task.stage', {
        taskId: task.id,
        stage: 'sense',
        status: 'running',
        timestamp: new Date().toISOString(),
      })

      // ── Fetch memory context (fast, no inference) ─────────
      const memories = await memory.search(task.instruction, { limit: 5 })
      const memoryContext = memories.length > 0
        ? memories.map((m) => `${m.key}: ${m.value}`).join('\n')
        : ''

      // ── Emit: analysing ──
      this.deps.bus?.emit('task.stage', {
        taskId: task.id,
        stage: 'interpret',
        status: 'running',
        timestamp: new Date().toISOString(),
      })

      // Only send tool schemas if a provider capable of tool calling is available
      const canUseTools = inference.getStatus().cloud || inference.getStatus().ollama
      const toolSchemas = (canUseTools && this.deps.tools) ? this.deps.tools.toAnthropicSchema() : []
      const inputWithContext = memoryContext
        ? `${task.instruction}\n\nRelevant context from memory:\n${memoryContext}`
        : task.instruction

      // ── Emit: planning ──
      this.deps.bus?.emit('task.stage', {
        taskId: task.id,
        stage: 'plan',
        status: 'running',
        timestamp: new Date().toISOString(),
      })

      // ── Emit: executing ──
      this.deps.bus?.emit('task.stage', {
        taskId: task.id,
        stage: 'act',
        status: 'running',
        timestamp: new Date().toISOString(),
      })

      const { output, confidence, provider, toolsUsed } = await this.runWithToolLoop(
        inputWithContext,
        'Plan and execute the task directly. Think step-by-step internally.',
        task.context,
        toolSchemas,
        task.id,
      )

      // ── Emit answer event (tokens already streamed, this finalizes) ──
      if (output) {
        this.deps.bus?.emit('task.answer', {
          taskId: task.id,
          answer: output,
          confidence,
          timestamp: new Date().toISOString(),
        })
      }

      // ── Background: memory + accessibility (non-blocking) ──
      this.runPostProcessing(task, output, confidence).catch((err) => {
        log.warn('Post-processing failed (non-critical)', {
          taskId: task.id,
          error: err instanceof Error ? err.message : 'Unknown',
        })
      })

      const durationMs = Date.now() - startTime

      return {
        success: true,
        summary: output || 'Task completed',
        outputs: { result: output },
        stepsCompleted: 1,
        durationMs,
        confidence,
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      log.error(`Agent loop error in task ${task.id}`, {
        error: err instanceof Error ? err.message : 'Unknown error',
      })

      return {
        success: false,
        summary: err instanceof Error ? err.message : 'Agent loop error',
        outputs: {},
        stepsCompleted: 0,
        durationMs,
        confidence: 0,
      }
    }
  }

  /**
   * Non-blocking post-processing: store to memory, run accessibility adaptation.
   * Runs after the answer has already been streamed to the user.
   */
  private async runPostProcessing(
    task: AgentTask,
    output: string | undefined,
    confidence: number,
  ): Promise<void> {
    const { memory } = this.deps

    if (output && confidence >= QUALITY_THRESHOLD) {
      await memory.store({
        key: `task_result:${task.instruction.slice(0, 50)}`,
        value: output.slice(0, 500),
        type: 'context',
        scope: 'session',
      })
    }

    // Accessibility adaptation (if profile exists)
    if (this.deps.accessibility && output && this.deps.userId) {
      const profile = this.deps.accessibility.getProfile(this.deps.userId)
      if (profile) {
        this.deps.accessibility.adaptContent(output, this.deps.userId)
      }
    }
  }

  /**
   * Multi-turn tool calling loop.
   * Sends the task to inference with tool schemas. If the model returns tool_use blocks,
   * executes the tools and sends results back. Repeats until the model returns end_turn.
   */
  private async runWithToolLoop(
    instruction: string,
    plan: string,
    context: Record<string, unknown>,
    toolSchemas: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
    taskId?: string,
  ): Promise<{ output: string; confidence: number; provider: string; toolsUsed: string[] }> {
    const { inference } = this.deps
    const toolsUsed: string[] = []
    const toolCallCounts: Record<string, number> = {}

    const emitToken = (token: string): void => {
      this.deps.bus?.emit('task.token', {
        taskId: taskId ?? 'current',
        token,
        timestamp: new Date().toISOString(),
      })
    }

    const prompt = `${instruction}\n\n${plan}`

    // First call — always streaming so tokens reach the UI immediately
    let result = await inference.runStreaming(
      {
        type: 'generate',
        input: prompt,
        context,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
      },
      emitToken,
    )

    // Multi-turn tool loop — only entered if the model requested tool_use
    let rounds = 0
    const conversationMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
      { role: 'user', content: prompt },
    ]

    while (result.stopReason === 'tool_use' && result.toolCalls && rounds < MAX_TOOL_ROUNDS) {
      rounds++
      log.info(`Tool calling round ${rounds}`, {
        tools: result.toolCalls.map((tc) => tc.name),
      })

      // Build the assistant message with both text and tool_use blocks
      const assistantContent: Array<Record<string, unknown>> = []
      if (result.output) {
        assistantContent.push({ type: 'text', text: result.output })
      }
      for (const tc of result.toolCalls) {
        assistantContent.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })
      }
      conversationMessages.push({ role: 'assistant', content: assistantContent })

      // Execute each tool call
      const toolResults: ToolUseResult[] = []
      for (const toolCall of result.toolCalls) {
        // Enforce per-tool-category limits
        const limit = TOOL_CATEGORY_LIMITS[toolCall.name]
        if (limit !== undefined) {
          toolCallCounts[toolCall.name] = (toolCallCounts[toolCall.name] ?? 0) + 1
          if (toolCallCounts[toolCall.name] > limit) {
            log.warn(`Tool limit reached for ${toolCall.name} (max ${limit})`)
            toolResults.push({
              tool_use_id: toolCall.id,
              content: `Tool limit reached: ${toolCall.name} has been called ${limit} times. Synthesize your answer from the data already collected.`,
              is_error: true,
            })
            continue
          }
        }

        this.deps.bus?.emit('task.tool', {
          taskId: taskId ?? 'current',
          tool: toolCall.name,
          status: 'running',
          params: Object.keys(toolCall.input),
          timestamp: new Date().toISOString(),
        })

        const toolResult = await this.executeSingleTool(toolCall)
        toolResults.push(toolResult)
        toolsUsed.push(toolCall.name)

        this.deps.bus?.emit('task.tool', {
          taskId: taskId ?? 'current',
          tool: toolCall.name,
          status: toolResult.is_error ? 'failed' : 'done',
          durationMs: 0,
          timestamp: new Date().toISOString(),
        })
      }

      // Emit: summarizing results from tools
      this.deps.bus?.emit('task.stage', {
        taskId: taskId ?? 'current',
        stage: 'verify',
        status: 'running',
        timestamp: new Date().toISOString(),
      })

      // Send tool results back — stream the response
      result = await inference.runStreaming(
        {
          type: 'generate',
          input: instruction,
          context,
          tools: toolSchemas.length > 0 ? toolSchemas : undefined,
          priorMessages: conversationMessages,
          toolResults,
        },
        emitToken,
      )
    }

    if (rounds >= MAX_TOOL_ROUNDS) {
      log.warn(`Tool calling hit max rounds (${MAX_TOOL_ROUNDS})`)
    }

    return {
      output: result.output,
      confidence: result.confidence,
      provider: result.provider,
      toolsUsed: [...new Set(toolsUsed)],
    }
  }

  /**
   * Execute a single tool call and return the result in Anthropic tool_result format.
   */
  private async executeSingleTool(toolCall: ToolUseRequest): Promise<ToolUseResult> {
    if (!this.deps.tools) {
      return {
        tool_use_id: toolCall.id,
        content: 'No tools available',
        is_error: true,
      }
    }

    if (!this.deps.tools.has(toolCall.name)) {
      log.warn(`Model requested unknown tool: ${toolCall.name}`)
      return {
        tool_use_id: toolCall.id,
        content: `Tool "${toolCall.name}" not found`,
        is_error: true,
      }
    }

    log.info(`Executing tool: ${toolCall.name}`, { params: toolCall.input })
    const result = await this.deps.tools.execute(toolCall.name, toolCall.input)

    if (result.success) {
      return {
        tool_use_id: toolCall.id,
        content: typeof result.output === 'string' ? result.output : JSON.stringify(result.output),
        is_error: false,
      }
    }

    // Provide actionable context so the model can recover instead of giving up
    const errorMsg = result.error ?? 'Unknown error'
    return {
      tool_use_id: toolCall.id,
      content: `${errorMsg}\n\nPlease try an alternative approach — use a different URL, adjust parameters, or answer from information already gathered.`,
      is_error: true,
    }
  }

  /**
   * Execute a subtask as a lightweight agent run (plan + act, no decomposition).
   */
  private async executeSubtask(subtask: SubTask): Promise<TaskResult> {
    const startTime = Date.now()
    const { inference } = this.deps

    try {
      const toolSchemas = this.deps.tools ? this.deps.tools.toAnthropicSchema() : []

      // Plan the subtask
      const planResult = await inference.run({
        type: 'plan',
        input: subtask.instruction,
        context: subtask.context,
      })

      // Execute the subtask with tool calling
      const { output, confidence } = await this.runWithToolLoop(
        subtask.instruction,
        planResult.output,
        subtask.context,
        toolSchemas,
      )

      return {
        success: true,
        summary: output,
        outputs: { plan: planResult.output, result: output },
        stepsCompleted: 2,
        durationMs: Date.now() - startTime,
        confidence,
      }
    } catch (err) {
      return {
        success: false,
        summary: err instanceof Error ? err.message : 'Subtask execution failed',
        outputs: {},
        stepsCompleted: 0,
        durationMs: Date.now() - startTime,
        confidence: 0,
      }
    }
  }

  async generateRecommendations(params: {
    role: UserRole
    intent: string
    context: Record<string, unknown>
    limit?: number
  }): Promise<Recommendation[]> {
    const { inference, memory, telemetry } = this.deps
    const limit = params.limit ?? 3

    const memories = await memory.search(params.intent, { limit: 5 })

    const prompt = `Generate ${limit} actionable recommendations.\nRole: ${params.role}\nIntent: ${params.intent}\nContext: ${JSON.stringify(params.context)}\nRelevant memory: ${memories.map((m) => `${m.key}: ${m.value}`).join('; ')}`

    const result = await inference.run({
      type: 'generate',
      input: prompt,
      context: params.context,
    })

    const recommendation: Recommendation = {
      id: `rec_${uuid().slice(0, 12)}`,
      role: params.role,
      type: this.inferRecommendationType(params.intent),
      title: `Recommendation for: ${params.intent}`,
      summary: result.output,
      actions: [
        {
          label: `Act on: ${params.intent}`,
          actionType: 'generate',
          payload: { intent: params.intent },
        },
      ],
      confidence: result.confidence,
      rationale: [`Based on intent: ${params.intent}`, `Confidence: ${result.confidence}`],
      inputsUsed: ['intent', 'context', 'memory'],
      createdAt: new Date().toISOString(),
    }

    telemetry.emit('recommendation.generated', {
      type: recommendation.type,
      confidence: recommendation.confidence,
      role: params.role,
    })

    return [recommendation]
  }

  private inferRecommendationType(intent: string): RecommendationType {
    const lower = intent.toLowerCase()
    if (lower.includes('study') || lower.includes('revision') || lower.includes('exam')) return 'study_plan'
    if (lower.includes('quiz') || lower.includes('test') || lower.includes('practice')) return 'quiz_set'
    if (lower.includes('explain') || lower.includes('clarif')) return 'concept_clarification'
    if (lower.includes('navigate') || lower.includes('route') || lower.includes('map')) return 'environment_navigation'
    if (lower.includes('communicate') || lower.includes('message') || lower.includes('call')) return 'communication_assist'
    if (lower.includes('daily') || lower.includes('routine') || lower.includes('task')) return 'daily_living_action'
    return 'concept_clarification'
  }

  private async runStep(
    taskId: string,
    type: AgentStep['type'],
    fn: () => Promise<Record<string, unknown>>,
  ): Promise<AgentStep> {
    const startTime = Date.now()
    log.debug(`[${taskId}] Running stage: ${type}`)

    // Emit stage-start so the UI can show progress immediately
    this.deps.bus?.emit('task.stage', {
      taskId,
      stage: type,
      status: 'running',
      timestamp: new Date().toISOString(),
    })

    const output = await fn()

    const step: AgentStep = {
      id: uuid(),
      type,
      description: `${type.charAt(0).toUpperCase() + type.slice(1)} stage`,
      input: {},
      output,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }

    return step
  }
}
