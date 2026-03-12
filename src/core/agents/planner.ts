// ─── Planner Agent ──────────────────────────────────────────────
// Converts natural-language user intent into a structured TaskGraph.
// Uses ReAct (Reasoning + Acting) pattern: Thought → Action → Observation.
// See IMARA-AGENT-SPEC.md §4.2

import { v4 as uuid } from 'uuid'
import { createLogger } from '../../shared/logger.js'
import type { InferenceLayer } from '../../inference/index.js'
import type {
  AgentRole,
  TaskGraph,
  TaskNode,
  SharedState,
  ExecutionLimits,
  DEFAULT_EXECUTION_LIMITS,
} from './types.js'

const log = createLogger('agent:planner')

// ─── Agent-to-tool routing table ────────────────────────────────
// Maps each agent role to the tools it can use, so the planner
// knows which agent to assign each step to.

const AGENT_CAPABILITIES: Record<AgentRole, string[]> = {
  supervisor: [],
  planner: [],
  research: ['web_search'],
  browser: [
    'browser_navigate', 'browser_read', 'browser_screenshot',
    'browser_click', 'browser_fill', 'browser_type',
    'browser_submit', 'browser_scroll', 'browser_hover',
  ],
  desktop: ['screen_capture', 'run_command', 'read_desktop', 'list_open_apps'],
  code: ['execute_code', 'execute_bash', 'system_info'],
  memory: ['read_file', 'write_file', 'list_files', 'create_dir'],
  verification: ['browser_screenshot', 'browser_read', 'page_audit'],
}

// Intent keywords that hint at which agent is needed
const INTENT_SIGNALS: Record<AgentRole, RegExp[]> = {
  research: [
    /\bsearch\b.*\b(web|online|internet|google)\b/i,
    /\bgoogle\b/i,
    /\blook\s*up\b.*\b(web|online|internet)\b/i,
    /\bfind\b.*\b(online|on the web|on the internet|website|web site|links?)\b/i,
    /\bnews\b|\bheadlines\b/i,
    /\b(latest|today|recent|up[-\s]?to[-\s]?date|this week)\b/i,
    /\bprice\b|\bcost\b|\bavailability\b|\bin stock\b|\brelease date\b|\bschedule\b|\bscore\b|\bweather\b|\bexchange rate\b/i,
    /\bcitation\b|\bcitations\b|\bcite\b/i,
  ],
  browser: [/open/i, /navigate/i, /go\s+to/i, /website/i, /click/i, /fill/i, /book/i, /submit/i, /log\s*in/i, /sign\s*up/i, /pay/i],
  desktop: [/launch/i, /open\s+app/i, /screenshot/i, /screen/i, /desktop/i, /application/i],
  code: [/run/i, /execute/i, /script/i, /code/i, /calculate/i, /compute/i, /generate.*file/i],
  memory: [/remember/i, /recall/i, /save/i, /store/i, /preference/i, /read.*file/i, /write.*file/i],
  supervisor: [],
  planner: [],
  verification: [],
}

export interface PlannerConfig {
  maxNodes: number
  defaultTimeoutMs: number
  defaultMaxRetries: number
}

const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  maxNodes: 8,
  defaultTimeoutMs: 120_000,
  defaultMaxRetries: 2,
}

export class PlannerAgent {
  readonly role: AgentRole = 'planner'
  readonly description = 'Decomposes user requests into structured task graphs using ReAct reasoning'

  private inference: InferenceLayer
  private config: PlannerConfig

  constructor(options: {
    inference: InferenceLayer
    config?: Partial<PlannerConfig>
  }) {
    this.inference = options.inference
    this.config = { ...DEFAULT_PLANNER_CONFIG, ...options.config }
  }

  /**
   * Decompose a user request into a TaskGraph with ordered, agent-assigned nodes.
   */
  async plan(
    goal: string,
    userContext: Record<string, unknown>,
    memoryContext: string,
  ): Promise<TaskGraph> {
    log.info('Planning task graph', { goal: goal.slice(0, 80) })

    const prompt = this.buildPlanningPrompt(goal, userContext, memoryContext)

    const result = await this.inference.run({
      type: 'plan',
      input: prompt,
      context: userContext,
    })

    const nodes = this.parseNodes(result.output, goal)
    const strategy = this.determineStrategy(nodes)

    const graph: TaskGraph = {
      id: `graph_${uuid().slice(0, 12)}`,
      goal,
      nodes,
      strategy,
      createdAt: new Date().toISOString(),
    }

    log.info('Task graph created', {
      graphId: graph.id,
      nodeCount: nodes.length,
      strategy,
      agents: [...new Set(nodes.map(n => n.assignedAgent))],
    })

    return graph
  }

  /**
   * Re-plan a failed node, optionally incorporating feedback from the Verification Agent.
   */
  async replan(
    graph: TaskGraph,
    failedNodeId: string,
    feedback: string,
  ): Promise<TaskGraph> {
    const failedNode = graph.nodes.find(n => n.id === failedNodeId)
    if (!failedNode) return graph

    log.info('Re-planning failed node', {
      nodeId: failedNodeId,
      instruction: failedNode.instruction.slice(0, 60),
      feedback: feedback.slice(0, 100),
    })

    const prompt = `The following step failed and needs a revised approach.

Original goal: ${graph.goal}
Failed step: ${failedNode.instruction}
Assigned agent: ${failedNode.assignedAgent}
Failure feedback: ${feedback}

Provide a revised step (or split into sub-steps) that addresses the failure.
Each line should be: STEP_NUMBER. [AGENT_NAME] instruction
Available agents: research, browser, desktop, code, memory`

    const result = await this.inference.run({
      type: 'plan',
      input: prompt,
      context: {},
    })

    // Replace the failed node with revised nodes
    const revisedNodes = this.parseNodes(result.output, graph.goal)
    const failedIndex = graph.nodes.findIndex(n => n.id === failedNodeId)

    // Wire dependencies: revised nodes depend on whatever the failed node depended on
    for (const rn of revisedNodes) {
      rn.dependsOn = [...failedNode.dependsOn]
    }

    // Nodes that depended on the failed node now depend on the last revised node
    const lastRevised = revisedNodes[revisedNodes.length - 1]
    if (lastRevised) {
      for (const node of graph.nodes) {
        const depIdx = node.dependsOn.indexOf(failedNodeId)
        if (depIdx !== -1) {
          node.dependsOn[depIdx] = lastRevised.id
        }
      }
    }

    // Splice in the revised nodes
    const updatedNodes = [
      ...graph.nodes.slice(0, failedIndex),
      ...revisedNodes,
      ...graph.nodes.slice(failedIndex + 1),
    ]

    return {
      ...graph,
      nodes: updatedNodes,
      strategy: this.determineStrategy(updatedNodes),
    }
  }

  /**
   * Quick classification: does this request need multi-agent orchestration
   * or can a single agent handle it?
   */
  needsMultiAgent(goal: string): boolean {
    const signals = [
      /\band\b.*\bthen\b/i,
      /\bfirst\b.*\bthen\b/i,
      /\bstep\s*\d/i,
      /\b(also|additionally)\b/i,
      /\bcompare\b.*\bwith\b/i,
      /\bsearch\b.*\b(then|and)\b.*\b(open|navigate|click|fill|book|pay)/i,
      /\bfind\b.*\b(then|and)\b.*\b(create|write|send|book|pay)/i,
    ]

    const agentCount = this.detectAgentTypes(goal).length
    const hasMultiStep = signals.some(re => re.test(goal))

    return agentCount > 1 || hasMultiStep
  }

  /**
   * Detect which agent types are likely needed for a goal.
   */
  private detectAgentTypes(goal: string): AgentRole[] {
    const detected: AgentRole[] = []
    for (const [role, patterns] of Object.entries(INTENT_SIGNALS)) {
      if (patterns.some(re => re.test(goal))) {
        detected.push(role as AgentRole)
      }
    }
    return detected
  }

  /**
   * Assign the best agent for a given step instruction.
   */
  private assignAgent(instruction: string): AgentRole {
    const scores: Partial<Record<AgentRole, number>> = {}

    for (const [role, patterns] of Object.entries(INTENT_SIGNALS)) {
      const matchCount = patterns.filter(re => re.test(instruction)).length
      if (matchCount > 0) {
        scores[role as AgentRole] = matchCount
      }
    }

    // Pick highest-scoring agent, default to research
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
    return (sorted[0]?.[0] as AgentRole) ?? 'research'
  }

  private buildPlanningPrompt(
    goal: string,
    context: Record<string, unknown>,
    memoryContext: string,
  ): string {
    const contextStr = Object.keys(context).length > 0
      ? `\nUser context: ${JSON.stringify(context)}`
      : ''
    const memStr = memoryContext
      ? `\nRelevant memory: ${memoryContext}`
      : ''

    return `You are the Imara Planner Agent. Break down this user request into concrete, ordered steps.

User request: "${goal}"${contextStr}${memStr}

Rules:
- Each step must be a single, atomic action (one tool call).
- Assign each step to the most appropriate agent: research, browser, desktop, code, or memory.
- Mark dependencies: if step 3 needs step 1's output, note it.
- Maximum ${this.config.maxNodes} steps.
- Keep steps simple and self-contained.

Format each step as:
STEP_NUMBER. [AGENT_NAME] instruction (depends on: STEP_X, STEP_Y)

If a step has no dependencies, omit the "depends on" part.
Available agents: research, browser, desktop, code, memory`
  }

  private parseNodes(planOutput: string, goal: string): TaskNode[] {
    const nodes: TaskNode[] = []
    const lines = planOutput.split('\n').filter(l => l.trim())
    const stepPattern = /^\d+[\.\)]\s*/

    for (const line of lines) {
      const trimmed = line.trim()
      if (!stepPattern.test(trimmed)) continue

      const cleaned = trimmed.replace(stepPattern, '')

      // Extract agent assignment: [AGENT_NAME]
      const agentMatch = cleaned.match(/\[(\w+)\]/i)
      const assignedAgent = agentMatch
        ? this.normaliseAgentName(agentMatch[1])
        : this.assignAgent(cleaned)

      // Extract dependencies: (depends on: step 1, step 2)
      const depMatch = cleaned.match(/\(?depends?\s+on:?\s*(?:steps?\s*)?([^)]+)\)?/i)
      const dependsOn: string[] = []
      if (depMatch) {
        const depNums = depMatch[1].match(/\d+/g)
        if (depNums) {
          for (const num of depNums) {
            const idx = parseInt(num, 10) - 1
            if (idx >= 0 && idx < nodes.length) {
              dependsOn.push(nodes[idx].id)
            }
          }
        }
      }

      // Clean instruction text
      const instruction = cleaned
        .replace(/\[\w+\]/gi, '')
        .replace(/\(?depends?\s+on:?\s*[^)]*\)?/gi, '')
        .trim()

      if (instruction.length < 3) continue

      nodes.push({
        id: `node_${uuid().slice(0, 8)}`,
        instruction,
        assignedAgent,
        dependsOn,
        status: 'pending',
        retryCount: 0,
        maxRetries: this.config.defaultMaxRetries,
        timeoutMs: this.config.defaultTimeoutMs,
      })

      if (nodes.length >= this.config.maxNodes) break
    }

    // Fallback: if parsing produced nothing, create a single research node
    if (nodes.length === 0) {
      const agent = this.assignAgent(goal)
      nodes.push({
        id: `node_${uuid().slice(0, 8)}`,
        instruction: goal,
        assignedAgent: agent,
        dependsOn: [],
        status: 'pending',
        retryCount: 0,
        maxRetries: this.config.defaultMaxRetries,
        timeoutMs: this.config.defaultTimeoutMs,
      })
    }

    return nodes
  }

  private normaliseAgentName(name: string): AgentRole {
    const lower = name.toLowerCase()
    const mapping: Record<string, AgentRole> = {
      research: 'research',
      browser: 'browser',
      desktop: 'desktop',
      code: 'code',
      memory: 'memory',
      verification: 'verification',
      search: 'research',
      web: 'research',
      file: 'memory',
      filesystem: 'memory',
    }
    return mapping[lower] ?? 'research'
  }

  private determineStrategy(nodes: TaskNode[]): 'sequential' | 'parallel' | 'mixed' {
    const hasDeps = nodes.some(n => n.dependsOn.length > 0)
    const allIndependent = nodes.every(n => n.dependsOn.length === 0)

    if (allIndependent && nodes.length > 1) return 'parallel'
    if (hasDeps && !allIndependent) return 'mixed'
    return 'sequential'
  }
}
