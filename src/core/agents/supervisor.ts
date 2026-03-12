// ─── Supervisor Agent ───────────────────────────────────────────
// Central coordinator for the multi-agent system.
// Routes user requests through: Planner → Executors → Verification
// Manages shared state, enforces limits, handles retries and escalation.
// See IMARA-AGENT-SPEC.md §4.1

import { v4 as uuid } from 'uuid'
import { createLogger } from '../../shared/logger.js'
import type { InferenceLayer } from '../../inference/index.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type { MemoryStore } from '../memory.js'
import type { EventBus } from '../../shared/events.js'
import type { Telemetry } from '../telemetry.js'
import type { TokenCallback } from '../../shared/types.js'

import { PlannerAgent } from './planner.js'
import { ResearchAgent } from './research.js'
import { BrowserAgent } from './browser-agent.js'
import { DesktopAgent } from './desktop-agent.js'
import { CodeAgent } from './code-agent.js'
import { MemoryAgent } from './memory-agent.js'
import { VerificationAgent } from './verification.js'
import { requiresWebResearch } from '../../shared/intent.js'

import type {
  AgentRole,
  AgentResult,
  SharedState,
  TaskGraph,
  TaskNode,
  SpecialistAgent,
  SupervisorConfig,
  DEFAULT_SUPERVISOR_CONFIG,
  AgentMessage,
} from './types.js'

const log = createLogger('agent:supervisor')

export interface SupervisorDeps {
  inference: InferenceLayer
  tools: ToolRegistry
  memory: MemoryStore
  telemetry: Telemetry
  bus?: EventBus
  config?: Partial<SupervisorConfig>
  onConfirmation?: (description: string) => Promise<boolean>
}

export interface SupervisorResult {
  success: boolean
  output: string
  confidence: number
  durationMs: number
  graph?: TaskGraph
  agentsUsed: AgentRole[]
  toolsUsed: string[]
}

export class Supervisor {
  private planner: PlannerAgent
  private agents: Map<AgentRole, SpecialistAgent>
  private verifier: VerificationAgent
  private inference: InferenceLayer
  private memory: MemoryStore
  private telemetry: Telemetry
  private bus?: EventBus
  private config: SupervisorConfig
  private onConfirmation?: (description: string) => Promise<boolean>

  constructor(deps: SupervisorDeps) {
    this.inference = deps.inference
    this.memory = deps.memory
    this.telemetry = deps.telemetry
    this.bus = deps.bus
    this.onConfirmation = deps.onConfirmation

    this.config = {
      limits: {
        maxSearchQueriesPerStep: 3,
        maxNavigationsPerStep: 3,
        maxPageReadsPerStep: 3,
        maxTotalActions: 10,
        maxRetriesPerStep: 2,
        stepTimeoutMs: 120_000,
      },
      confirmDestructive: true,
      maxPlanRetries: 2,
      streamTokens: true,
      ...deps.config,
    }

    // Initialize specialist agents
    this.planner = new PlannerAgent({ inference: deps.inference })

    this.verifier = new VerificationAgent({ inference: deps.inference })

    this.agents = new Map<AgentRole, SpecialistAgent>([
      ['research', new ResearchAgent({ inference: deps.inference, tools: deps.tools })],
      ['browser', new BrowserAgent({ inference: deps.inference, tools: deps.tools })],
      ['desktop', new DesktopAgent({ inference: deps.inference, tools: deps.tools })],
      ['code', new CodeAgent({ inference: deps.inference, tools: deps.tools })],
      ['memory', new MemoryAgent({ memory: deps.memory, tools: deps.tools })],
    ])

    log.info('Supervisor initialized', {
      agents: [...this.agents.keys()],
      maxTotalActions: this.config.limits.maxTotalActions,
    })
  }

  /**
   * Process a user request through the full multi-agent pipeline.
   * This is the main entry point for the Supervisor.
   */
  async run(
    instruction: string,
    context: Record<string, unknown> = {},
    onToken?: TokenCallback,
  ): Promise<SupervisorResult> {
    const startTime = Date.now()
    const taskId = `task_${uuid().slice(0, 12)}`
    const agentsUsed: AgentRole[] = []
    const allToolsUsed: string[] = []

    log.info('Supervisor processing request', {
      taskId,
      instruction: instruction.slice(0, 80),
    })

    this.emitEvent('supervisor.started', { taskId, instruction: instruction.slice(0, 100) })

    try {
      // ── 1. Fetch memory context ──────────────────────────────
      const memories = await this.memory.search(instruction, { limit: 5 })
      const memoryContextRaw = memories.length > 0
        ? memories.map(m => `${m.key}: ${m.value}`).join('\n')
        : ''
      const memoryContext = memoryContextRaw.length > 1200
        ? `${memoryContextRaw.slice(0, 1200)}...`
        : memoryContextRaw

      // ── 2. Decide: single-agent or multi-agent? ──────────────
      const needsMulti = this.planner.needsMultiAgent(instruction)

      if (!needsMulti) {
        // Simple request — route directly to the best single agent
        log.info('Single-agent routing', { taskId })
        return await this.runSingleAgent(
          taskId, instruction, context, memoryContext, onToken, startTime, agentsUsed, allToolsUsed,
        )
      }

      // ── 3. Plan: decompose into task graph ────────────────────
      this.emitEvent('supervisor.planning', { taskId })

      const graph = await this.planner.plan(instruction, context, memoryContext)

      // Initialize shared state
      const state: SharedState = {
        taskGraph: graph,
        currentNodeId: null,
        history: [],
        toolOutputs: {},
        errorLog: [],
        userContext: context,
        memoryContext,
      }

      // ── 4. Execute: dispatch nodes to specialist agents ───────
      this.emitEvent('supervisor.executing', {
        taskId,
        nodeCount: graph.nodes.length,
        strategy: graph.strategy,
      })

      await this.executeGraph(graph, state, onToken, agentsUsed, allToolsUsed)

      // ── 5. Verify: check outputs for correctness ──────────────
      this.emitEvent('supervisor.verifying', { taskId })

      const finalOutput = this.assembleOutput(graph, state)
      const verification = this.verifier.quickVerify(finalOutput, instruction)

      // If verification fails and we haven't exhausted retries, re-plan
      if (!verification.passed && verification.shouldRetry) {
        const failedNodes = graph.nodes.filter(n => n.status === 'failed')
        if (failedNodes.length > 0 && failedNodes[0].retryCount < this.config.maxPlanRetries) {
          log.info('Verification failed, re-planning', { taskId, failedNode: failedNodes[0].id })

          const revisedGraph = await this.planner.replan(
            graph, failedNodes[0].id, verification.feedback,
          )
          state.taskGraph = revisedGraph
          await this.executeGraph(revisedGraph, state, onToken, agentsUsed, allToolsUsed)
        }
      }

      // ── 6. Assemble final result ──────────────────────────────
      const output = this.assembleOutput(state.taskGraph ?? graph, state)
      const durationMs = Date.now() - startTime

      // Stream the final answer if we have a token callback
      if (onToken && output) {
        onToken(output)
      }

      this.emitEvent('supervisor.completed', {
        taskId,
        durationMs,
        agentsUsed,
        toolsUsed: [...new Set(allToolsUsed)],
        success: true,
      })

      // Store result in memory for future context
      if (output.length > 20) {
        await this.memory.store({
          key: `task_result:${instruction.slice(0, 40)}`,
          value: output.slice(0, 500),
          type: 'context',
          scope: 'session',
        }).catch(() => { /* non-critical */ })
      }

      return {
        success: true,
        output,
        confidence: verification.passed ? 0.85 : 0.6,
        durationMs,
        graph: state.taskGraph ?? graph,
        agentsUsed: [...new Set(agentsUsed)],
        toolsUsed: [...new Set(allToolsUsed)],
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      const error = err instanceof Error ? err.message : 'Supervisor error'
      log.error('Supervisor failed', { taskId, error })

      this.emitEvent('supervisor.failed', { taskId, error, durationMs })

      return {
        success: false,
        output: error,
        confidence: 0,
        durationMs,
        agentsUsed: [...new Set(agentsUsed)],
        toolsUsed: [...new Set(allToolsUsed)],
      }
    }
  }

  /**
   * Route a simple request to a single specialist agent.
   */
  private async runSingleAgent(
    taskId: string,
    instruction: string,
    context: Record<string, unknown>,
    memoryContext: string,
    onToken: TokenCallback | undefined,
    startTime: number,
    agentsUsed: AgentRole[],
    allToolsUsed: string[],
  ): Promise<SupervisorResult> {
    // Detect the best agent for this task
    const agentRole = this.detectBestAgent(instruction)
    const agent = this.agents.get(agentRole)

    if (!agent || (agentRole === 'research' && !requiresWebResearch(instruction))) {
      // Fallback: use inference directly (like the old single-agent loop)
      return this.runDirectInference(taskId, instruction, context, memoryContext, onToken, startTime)
    }

    agentsUsed.push(agentRole)

    const node: TaskNode = {
      id: `node_${uuid().slice(0, 8)}`,
      instruction,
      assignedAgent: agentRole,
      dependsOn: [],
      status: 'running',
      retryCount: 0,
      maxRetries: 2,
      timeoutMs: this.config.limits.stepTimeoutMs,
    }

    const state: SharedState = {
      taskGraph: null,
      currentNodeId: node.id,
      history: [],
      toolOutputs: {},
      errorLog: [],
      userContext: context,
      memoryContext,
    }

    const emit = (event: string, data: Record<string, unknown>): void => {
      this.emitEvent(event, { taskId, ...data })
    }

    const result = await this.executeWithTimeout(agent, node, state, emit)
    allToolsUsed.push(...result.toolsUsed)

    if (onToken && result.output) {
      onToken(result.output)
    }

    const durationMs = Date.now() - startTime

    this.emitEvent('supervisor.completed', { taskId, durationMs, agentsUsed, success: result.success })

    return {
      success: result.success,
      output: result.output,
      confidence: result.confidence,
      durationMs,
      agentsUsed: [...new Set(agentsUsed)],
      toolsUsed: [...new Set(allToolsUsed)],
    }
  }

  /**
   * Fallback: run inference directly without specialist agents.
   * Used when no specialist agent matches or for simple conversational queries.
   */
  private async runDirectInference(
    taskId: string,
    instruction: string,
    context: Record<string, unknown>,
    memoryContext: string,
    onToken: TokenCallback | undefined,
    startTime: number,
  ): Promise<SupervisorResult> {
    const input = memoryContext
      ? `${instruction}\n\nRelevant context:\n${memoryContext}`
      : instruction

    const result = onToken
      ? await this.inference.runStreaming(
          { type: 'generate', input, context },
          onToken,
        )
      : await this.inference.run({ type: 'generate', input, context })

    return {
      success: true,
      output: result.output,
      confidence: result.confidence,
      durationMs: Date.now() - startTime,
      agentsUsed: [],
      toolsUsed: [],
    }
  }

  /**
   * Execute all nodes in a task graph respecting dependencies and strategy.
   */
  private async executeGraph(
    graph: TaskGraph,
    state: SharedState,
    onToken: TokenCallback | undefined,
    agentsUsed: AgentRole[],
    allToolsUsed: string[],
  ): Promise<void> {
    let totalActions = 0

    const emit = (event: string, data: Record<string, unknown>): void => {
      this.emitEvent(event, data)
    }

    // Process nodes respecting dependencies
    const completed = new Set<string>()
    const remaining = [...graph.nodes]

    while (remaining.length > 0 && totalActions < this.config.limits.maxTotalActions) {
      // Find nodes whose dependencies are all satisfied
      const ready = remaining.filter(n =>
        n.status === 'pending' && n.dependsOn.every(d => completed.has(d)),
      )

      if (ready.length === 0) {
        // No ready nodes — check if we're stuck
        const stuck = remaining.every(n => n.status === 'failed' || n.status === 'skipped')
        if (stuck) break

        // Some nodes are still running or have unsatisfied deps — this shouldn't happen
        // in sequential execution, so break to avoid infinite loop
        log.warn('No ready nodes but not all stuck', {
          remaining: remaining.map(n => ({ id: n.id, status: n.status })),
        })
        break
      }

      // Execute ready nodes (parallel if graph strategy allows)
      if (graph.strategy === 'parallel' || graph.strategy === 'mixed') {
        await Promise.all(ready.map(async (node) => {
          await this.executeNode(node, state, emit, agentsUsed, allToolsUsed)
          totalActions++
          if (node.status === 'completed') completed.add(node.id)
          // Remove from remaining
          const idx = remaining.indexOf(node)
          if (idx !== -1) remaining.splice(idx, 1)
        }))
      } else {
        // Sequential
        for (const node of ready) {
          if (totalActions >= this.config.limits.maxTotalActions) break
          await this.executeNode(node, state, emit, agentsUsed, allToolsUsed)
          totalActions++
          if (node.status === 'completed') completed.add(node.id)
          const idx = remaining.indexOf(node)
          if (idx !== -1) remaining.splice(idx, 1)

          // Stop sequential execution if a node fails
          if (node.status === 'failed') {
            // Skip downstream dependent nodes
            for (const rem of remaining) {
              if (rem.dependsOn.includes(node.id)) {
                rem.status = 'skipped'
              }
            }
            break
          }
        }
      }
    }

    if (totalActions >= this.config.limits.maxTotalActions) {
      log.warn('Hit max total actions limit', { totalActions })
    }
  }

  /**
   * Execute a single task node using its assigned specialist agent.
   */
  private async executeNode(
    node: TaskNode,
    state: SharedState,
    emit: AgentEmitFn,
    agentsUsed: AgentRole[],
    allToolsUsed: string[],
  ): Promise<void> {
    const agent = this.agents.get(node.assignedAgent)
    if (!agent) {
      node.status = 'failed'
      state.errorLog.push({
        nodeId: node.id,
        error: `No agent registered for role: ${node.assignedAgent}`,
        timestamp: new Date().toISOString(),
      })
      return
    }

    agentsUsed.push(node.assignedAgent)
    state.currentNodeId = node.id
    node.status = 'running'

    this.emitEvent('supervisor.node.started', {
      nodeId: node.id,
      agent: node.assignedAgent,
      instruction: node.instruction.slice(0, 80),
    })

    const result = await this.executeWithTimeout(agent, node, state, emit)
    allToolsUsed.push(...result.toolsUsed)

    if (result.success) {
      node.status = 'completed'
      node.result = {
        id: uuid(),
        from: node.assignedAgent,
        to: 'supervisor',
        type: 'task_result',
        taskNodeId: node.id,
        payload: { output: result.output, data: result.data },
        timestamp: new Date().toISOString(),
      }
      state.toolOutputs[node.id] = result.output

      this.emitEvent('supervisor.node.completed', {
        nodeId: node.id,
        agent: node.assignedAgent,
        durationMs: result.durationMs,
      })
    } else {
      node.retryCount++
      if (node.retryCount <= node.maxRetries) {
        // Retry the node
        log.info('Retrying failed node', { nodeId: node.id, attempt: node.retryCount })
        node.status = 'pending'
      } else {
        node.status = 'failed'
        state.errorLog.push({
          nodeId: node.id,
          error: result.output,
          timestamp: new Date().toISOString(),
        })
      }

      this.emitEvent('supervisor.node.failed', {
        nodeId: node.id,
        agent: node.assignedAgent,
        error: result.output,
        retryCount: node.retryCount,
      })
    }
  }

  /**
   * Execute an agent with a timeout guard.
   */
  private async executeWithTimeout(
    agent: SpecialistAgent,
    node: TaskNode,
    state: SharedState,
    emit: AgentEmitFn,
  ): Promise<AgentResult> {
    return Promise.race([
      agent.execute(node, state, emit),
      new Promise<AgentResult>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Agent ${agent.role} timed out after ${node.timeoutMs}ms`)),
          node.timeoutMs,
        ),
      ),
    ])
  }

  /**
   * Assemble final output from completed task graph nodes.
   */
  private assembleOutput(graph: TaskGraph, state: SharedState): string {
    const completedOutputs: string[] = []

    for (const node of graph.nodes) {
      if (node.status === 'completed' && node.result) {
        const output = (node.result.payload as Record<string, unknown>)?.output
        if (typeof output === 'string' && output.trim()) {
          completedOutputs.push(output)
        }
      }
    }

    if (completedOutputs.length === 0) {
      const errors = state.errorLog.map(e => e.error).join('; ')
      return errors || 'No results were produced.'
    }

    // If there's only one output, return it directly
    if (completedOutputs.length === 1) return completedOutputs[0]

    // Multiple outputs — combine them
    return completedOutputs.join('\n\n')
  }

  /**
   * Detect the best single agent for a given instruction.
   */
  private detectBestAgent(instruction: string): AgentRole {
    const lower = instruction.toLowerCase()

    if (/open|navigate|go\s+to|website|click|fill|book|submit|log\s*in|pay|browse/i.test(lower)) return 'browser'
    if (/launch|desktop|screenshot|screen|application|app/i.test(lower)) return 'desktop'
    if (/run|execute|script|code|calculate|compute/i.test(lower)) return 'code'
    if (/remember|recall|save|store|forget|preference|read.*file|write.*file/i.test(lower)) return 'memory'
    if (requiresWebResearch(lower)) return 'research'

    return 'research' // Default fallback
  }

  private emitEvent(event: string, data: Record<string, unknown>): void {
    this.bus?.emit(event, { ...data, timestamp: new Date().toISOString() })
    this.telemetry.emit(event as 'task.created', data)
  }

  /**
   * Get registered specialist agents (for status/health reporting).
   */
  get registeredAgents(): AgentRole[] {
    return [...this.agents.keys()]
  }

  /**
   * Get the planner (for direct access if needed).
   */
  get plannerAgent(): PlannerAgent {
    return this.planner
  }

  /**
   * Get the verifier (for direct access if needed).
   */
  get verificationAgent(): VerificationAgent {
    return this.verifier
  }
}

// Re-export types used in AgentEmitFn
type AgentEmitFn = (event: string, data: Record<string, unknown>) => void
