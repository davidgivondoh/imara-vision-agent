// ─── Code Execution Agent ───────────────────────────────────────
// Runs scripts and performs computational tasks in a guarded environment.
// See IMARA-AGENT-SPEC.md §4.6

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

const log = createLogger('agent:code')

export class CodeAgent implements SpecialistAgent {
  readonly role: AgentRole = 'code'
  readonly description = 'Runs scripts and performs computational tasks in a guarded sandbox'
  readonly toolNames = ['execute_code', 'execute_bash', 'system_info']

  private inference: InferenceLayer
  private tools: ToolRegistry

  constructor(options: { inference: InferenceLayer; tools: ToolRegistry }) {
    this.inference = options.inference
    this.tools = options.tools
  }

  async execute(node: TaskNode, state: SharedState, emit: AgentEmitFn): Promise<AgentResult> {
    const start = Date.now()
    const toolsUsed: string[] = []

    log.info('Code agent executing', { instruction: node.instruction.slice(0, 80) })
    emit('agent.code.started', { nodeId: node.id })

    try {
      // Gather prior context
      const priorData = this.gatherPriorData(node, state)

      // Ask model to generate the code
      const codePrompt = `You are the Imara Code Agent. Generate code to accomplish this task.

Task: ${node.instruction}
${priorData ? `\nData from previous steps:\n${priorData}` : ''}

Rules:
- Write JavaScript/Node.js code (it runs in a Node.js sandbox)
- Keep it simple and focused on the task
- Use console.log() to output results
- Handle errors gracefully
- Do NOT use require() for external packages — only built-in Node.js modules
- Do NOT access the filesystem or network unless the task explicitly requires it

Return ONLY the code block, no explanation. Wrap in \`\`\`javascript ... \`\`\``

      const codeResult = await this.inference.run({
        type: 'generate',
        input: codePrompt,
        context: state.userContext,
      })

      // Extract code from the model response
      const code = this.extractCode(codeResult.output)
      if (!code) {
        return {
          success: false,
          output: 'Code agent could not generate valid code for this task.',
          confidence: 0,
          toolsUsed,
          durationMs: Date.now() - start,
        }
      }

      // Execute the code
      if (!this.tools.has('execute_code')) {
        return {
          success: false,
          output: 'Code execution tool not available.',
          confidence: 0,
          toolsUsed,
          durationMs: Date.now() - start,
        }
      }

      const execResult = await this.tools.execute('execute_code', {
        language: 'javascript',
        code,
      })
      toolsUsed.push('execute_code')

      const output = execResult.success
        ? (typeof execResult.output === 'string' ? execResult.output : JSON.stringify(execResult.output))
        : `Execution error: ${execResult.error}`

      const durationMs = Date.now() - start
      emit('agent.code.completed', { nodeId: node.id, durationMs, success: execResult.success })

      return {
        success: execResult.success,
        output,
        data: { code, rawOutput: execResult.output },
        confidence: execResult.success ? 0.85 : 0.2,
        toolsUsed,
        durationMs,
      }
    } catch (err) {
      const durationMs = Date.now() - start
      const error = err instanceof Error ? err.message : 'Code agent failed'
      log.error('Code agent error', { error })
      emit('agent.code.failed', { nodeId: node.id, error })

      return {
        success: false,
        output: error,
        confidence: 0,
        toolsUsed,
        durationMs,
      }
    }
  }

  private gatherPriorData(node: TaskNode, state: SharedState): string {
    const parts: string[] = []
    for (const depId of node.dependsOn) {
      const output = state.toolOutputs[depId]
      if (output) {
        parts.push(typeof output === 'string' ? output : JSON.stringify(output))
      }
    }
    return parts.join('\n')
  }

  private extractCode(output: string): string | null {
    // Try to extract from markdown code blocks
    const blockMatch = output.match(/```(?:javascript|js|node)?\s*\n([\s\S]*?)```/)
    if (blockMatch) return blockMatch[1].trim()

    // Try bare code (if it looks like code)
    const trimmed = output.trim()
    if (trimmed.includes('console.log') || trimmed.includes('function') || trimmed.includes('const ')) {
      return trimmed
    }

    return null
  }
}
