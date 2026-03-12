// ─── Desktop Automation Agent ───────────────────────────────────
// Controls the OS: launch apps, run commands, capture screen, read desktop state.
// See IMARA-AGENT-SPEC.md §4.5

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

const log = createLogger('agent:desktop')

export class DesktopAgent implements SpecialistAgent {
  readonly role: AgentRole = 'desktop'
  readonly description = 'Controls the operating system: launch apps, run commands, capture screen'
  readonly toolNames = ['screen_capture', 'run_command', 'read_desktop', 'list_open_apps']

  private inference: InferenceLayer
  private tools: ToolRegistry

  constructor(options: { inference: InferenceLayer; tools: ToolRegistry }) {
    this.inference = options.inference
    this.tools = options.tools
  }

  async execute(node: TaskNode, state: SharedState, emit: AgentEmitFn): Promise<AgentResult> {
    const start = Date.now()
    const toolsUsed: string[] = []

    log.info('Desktop agent executing', { instruction: node.instruction.slice(0, 80) })
    emit('agent.desktop.started', { nodeId: node.id })

    try {
      // Ask the model to determine the right desktop action
      const decisionPrompt = `You are the Imara Desktop Agent. You help users interact with their computer.

Task: ${node.instruction}

Available tools:
- run_command: {"command": "..."} — run a shell command
- list_open_apps: {} — list currently open applications
- screen_capture: {} — take a screenshot of the desktop
- read_desktop: {} — read desktop state (windows, focus)

Which tool should I use and with what parameters? Respond with:
TOOL: tool_name {"param": "value"}

If the task requires a shell command, be careful:
- Never use destructive commands (rm -rf, format, etc.)
- Prefer read-only operations where possible
- Use the simplest command that achieves the goal`

      const decision = await this.inference.run({
        type: 'generate',
        input: decisionPrompt,
        context: state.userContext,
      })

      // Parse and execute the tool
      const action = this.parseToolAction(decision.output)
      if (!action.toolName || !this.tools.has(action.toolName)) {
        return {
          success: false,
          output: `Desktop agent could not determine appropriate action for: ${node.instruction}`,
          confidence: 0,
          toolsUsed,
          durationMs: Date.now() - start,
        }
      }

      // Safety check: validate commands before execution
      if (action.toolName === 'run_command' && action.toolInput?.command) {
        const cmd = String(action.toolInput.command)
        if (this.isDangerousCommand(cmd)) {
          return {
            success: false,
            output: `Command blocked for safety: "${cmd}". Desktop agent will not execute destructive commands.`,
            confidence: 1,
            toolsUsed,
            durationMs: Date.now() - start,
          }
        }
      }

      const result = await this.tools.execute(action.toolName, action.toolInput ?? {})
      toolsUsed.push(action.toolName)

      const output = result.success
        ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output))
        : `Error: ${result.error}`

      const durationMs = Date.now() - start
      emit('agent.desktop.completed', { nodeId: node.id, durationMs })

      return {
        success: result.success,
        output,
        data: { tool: action.toolName, rawOutput: result.output },
        confidence: result.success ? 0.8 : 0,
        toolsUsed,
        durationMs,
      }
    } catch (err) {
      const durationMs = Date.now() - start
      const error = err instanceof Error ? err.message : 'Desktop agent failed'
      log.error('Desktop agent error', { error })
      emit('agent.desktop.failed', { nodeId: node.id, error })

      return {
        success: false,
        output: error,
        confidence: 0,
        toolsUsed,
        durationMs,
      }
    }
  }

  private parseToolAction(output: string): {
    toolName?: string
    toolInput?: Record<string, unknown>
  } {
    const match = output.match(/TOOL:\s*(\w+)\s*(.*)/is)
    if (!match) return {}

    let toolInput: Record<string, unknown> = {}
    try {
      const jsonStr = match[2].trim()
      if (jsonStr.startsWith('{')) {
        toolInput = JSON.parse(jsonStr)
      }
    } catch {
      // ignore parse errors
    }

    return { toolName: match[1], toolInput }
  }

  private isDangerousCommand(cmd: string): boolean {
    const dangerous = [
      /\brm\s+-rf?\b/i,
      /\bformat\b/i,
      /\bmkfs\b/i,
      /\bdd\s+if=/i,
      /\b(shutdown|reboot|halt)\b/i,
      /\breg\s+delete\b/i,
      /\bdel\s+\/[sf]/i,
      /\brd\s+\/s/i,
    ]
    return dangerous.some(re => re.test(cmd))
  }
}
