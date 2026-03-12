// ─── Browser Agent ──────────────────────────────────────────────
// Interacts with websites through Playwright automation.
// Navigate, click, fill forms, extract content, download files.
// See IMARA-AGENT-SPEC.md §4.4

import { createLogger } from '../../shared/logger.js'
import type { InferenceLayer } from '../../inference/index.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type {
  AgentRole,
  TaskNode,
  SharedState,
  AgentResult,
  AgentEmitFn,
  SpecialistAgent,
} from './types.js'

const log = createLogger('agent:browser')

const MAX_BROWSER_ROUNDS = 5

export class BrowserAgent implements SpecialistAgent {
  readonly role: AgentRole = 'browser'
  readonly description = 'Interacts with websites: navigate, click, fill forms, extract content'
  readonly toolNames = [
    'browser_navigate', 'browser_read', 'browser_screenshot',
    'browser_click', 'browser_fill', 'browser_type',
    'browser_submit', 'browser_scroll', 'browser_hover',
  ]

  private inference: InferenceLayer
  private tools: ToolRegistry

  constructor(options: { inference: InferenceLayer; tools: ToolRegistry }) {
    this.inference = options.inference
    this.tools = options.tools
  }

  async execute(node: TaskNode, state: SharedState, emit: AgentEmitFn): Promise<AgentResult> {
    const start = Date.now()
    const toolsUsed: string[] = []
    const observations: string[] = []

    log.info('Browser agent executing', { instruction: node.instruction.slice(0, 80) })
    emit('agent.browser.started', { nodeId: node.id })

    try {
      // Gather prior context from dependency results
      const priorContext = this.gatherPriorContext(node, state)

      // ReAct loop: reason about what to do, act, observe, repeat
      let round = 0
      let lastAction = ''

      while (round < MAX_BROWSER_ROUNDS) {
        round++

        // Reason: ask the model what browser action to take next
        const reasonPrompt = this.buildReasonPrompt(
          node.instruction, priorContext, observations, lastAction, round,
        )

        const decision = await this.inference.run({
          type: 'generate',
          input: reasonPrompt,
          context: state.userContext,
        })

        const action = this.parseAction(decision.output)

        if (action.type === 'done') {
          // Model says task is complete
          const durationMs = Date.now() - start
          emit('agent.browser.completed', { nodeId: node.id, durationMs, rounds: round })

          return {
            success: true,
            output: action.summary || observations.join('\n'),
            data: { observations, rounds: round },
            confidence: decision.confidence,
            toolsUsed: [...new Set(toolsUsed)],
            durationMs,
          }
        }

        if (action.type === 'tool' && action.toolName) {
          // Execute the browser tool
          if (!this.tools.has(action.toolName)) {
            observations.push(`Tool "${action.toolName}" not available.`)
            continue
          }

          const result = await this.tools.execute(action.toolName, action.toolInput ?? {})
          toolsUsed.push(action.toolName)
          lastAction = action.toolName

          const output = result.success
            ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output))
            : `Error: ${result.error}`

          // Truncate large outputs to keep context manageable
          observations.push(`[${action.toolName}] ${output.slice(0, 2000)}`)

          emit('agent.browser.action', {
            nodeId: node.id,
            tool: action.toolName,
            success: result.success,
            round,
          })
        }
      }

      // Hit max rounds — return what we have
      const durationMs = Date.now() - start
      emit('agent.browser.completed', { nodeId: node.id, durationMs, rounds: round })

      return {
        success: observations.length > 0,
        output: observations.join('\n') || 'Browser agent reached max rounds without completion.',
        data: { observations, rounds: round },
        confidence: 0.5,
        toolsUsed: [...new Set(toolsUsed)],
        durationMs,
      }
    } catch (err) {
      const durationMs = Date.now() - start
      const error = err instanceof Error ? err.message : 'Browser agent failed'
      log.error('Browser agent error', { error })
      emit('agent.browser.failed', { nodeId: node.id, error })

      return {
        success: false,
        output: error,
        confidence: 0,
        toolsUsed: [...new Set(toolsUsed)],
        durationMs,
      }
    }
  }

  private gatherPriorContext(node: TaskNode, state: SharedState): string {
    const parts: string[] = []
    for (const depId of node.dependsOn) {
      const depNode = state.taskGraph?.nodes.find(n => n.id === depId)
      if (depNode?.result) {
        const output = (depNode.result.payload as Record<string, unknown>)?.output
        if (typeof output === 'string') {
          parts.push(`From ${depNode.assignedAgent}: ${output.slice(0, 500)}`)
        }
      }
    }
    return parts.join('\n')
  }

  private buildReasonPrompt(
    instruction: string,
    priorContext: string,
    observations: string[],
    lastAction: string,
    round: number,
  ): string {
    return `You are the Imara Browser Agent. You interact with websites to help users complete tasks.

Task: ${instruction}
${priorContext ? `Prior context:\n${priorContext}` : ''}
${observations.length ? `\nObservations so far:\n${observations.map((o, i) => `${i + 1}. ${o.slice(0, 500)}`).join('\n')}` : ''}
${lastAction ? `Last action: ${lastAction}` : ''}
Round: ${round}/${MAX_BROWSER_ROUNDS}

Available browser tools:
- browser_navigate: {"url": "..."} — open a URL
- browser_read: {"url": "..."} or {} — read current page content
- browser_click: {"selector": "..."} — click an element
- browser_fill: {"selector": "...", "value": "..."} — fill a form field
- browser_type: {"selector": "...", "text": "..."} — type text
- browser_submit: {"selector": "..."} — submit a form
- browser_scroll: {"direction": "down"/"up"} — scroll the page
- browser_screenshot: {} — take a screenshot

Respond with ONE of:
TOOL: tool_name {"param": "value"}
DONE: summary of what was accomplished

Think step by step about what to do next.`
  }

  private parseAction(output: string): {
    type: 'tool' | 'done'
    toolName?: string
    toolInput?: Record<string, unknown>
    summary?: string
  } {
    const trimmed = output.trim()

    // Check for DONE
    const doneMatch = trimmed.match(/^DONE:\s*(.*)/is)
    if (doneMatch) {
      return { type: 'done', summary: doneMatch[1].trim() }
    }

    // Check for TOOL
    const toolMatch = trimmed.match(/^TOOL:\s*(\w+)\s*(.*)/is)
    if (toolMatch) {
      const toolName = toolMatch[1]
      let toolInput: Record<string, unknown> = {}
      try {
        const jsonStr = toolMatch[2].trim()
        if (jsonStr.startsWith('{')) {
          toolInput = JSON.parse(jsonStr)
        }
      } catch {
        // If JSON parse fails, try to extract key-value pairs
        log.warn('Failed to parse tool input JSON', { raw: toolMatch[2] })
      }
      return { type: 'tool', toolName, toolInput }
    }

    // Default: if output contains a URL, try navigating
    const urlMatch = trimmed.match(/https?:\/\/[^\s]+/)
    if (urlMatch) {
      return { type: 'tool', toolName: 'browser_navigate', toolInput: { url: urlMatch[0] } }
    }

    // Fallback: treat as done
    return { type: 'done', summary: trimmed }
  }
}
