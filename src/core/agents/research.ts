// ─── Research Agent ─────────────────────────────────────────────
// Gathers information from the internet via search and page reading.
// See IMARA-AGENT-SPEC.md §4.3

import { createLogger } from '../../shared/logger.js'
import { requiresWebResearch } from '../../shared/intent.js'
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

const log = createLogger('agent:research')

export class ResearchAgent implements SpecialistAgent {
  readonly role: AgentRole = 'research'
  readonly description = 'Gathers information from the internet through search queries and page extraction'
  readonly toolNames = ['web_search', 'browser_read', 'browser_navigate']

  private inference: InferenceLayer
  private tools: ToolRegistry

  constructor(options: { inference: InferenceLayer; tools: ToolRegistry }) {
    this.inference = options.inference
    this.tools = options.tools
  }

  async execute(node: TaskNode, state: SharedState, emit: AgentEmitFn): Promise<AgentResult> {
    const start = Date.now()
    const toolsUsed: string[] = []

    log.info('Research agent executing', { instruction: node.instruction.slice(0, 80) })
    emit('agent.research.started', { nodeId: node.id })

    try {
      const needsWeb = requiresWebResearch(node.instruction)

      // Step 1: Formulate a search query from the instruction (only if web is needed)
      let query = node.instruction
      if (needsWeb) {
        const queryResult = await this.inference.run({
          type: 'generate',
          input: `Extract a concise web search query from this instruction. Return ONLY the search query, nothing else.\n\nInstruction: "${node.instruction}"`,
          context: state.userContext,
        })
        query = queryResult.output.replace(/^["']|["']$/g, '').trim() || node.instruction
      }

      // Step 2: Execute web search
      let searchOutput = ''
      if (needsWeb && this.tools.has('web_search')) {
        const searchResult = await this.tools.execute('web_search', { query, maxResults: 5 })
        toolsUsed.push('web_search')
        if (searchResult.success) {
          searchOutput = typeof searchResult.output === 'string'
            ? searchResult.output
            : JSON.stringify(searchResult.output)
        } else {
          log.warn('Web search failed', { error: searchResult.error })
        }
      }

      // Step 3: Synthesise findings into a clear answer
      const synthesisPrompt = needsWeb
        ? `You are the Imara Research Agent helping a person with disabilities accomplish a task.

User's goal: "${node.instruction}"
${state.memoryContext ? `User context: ${state.memoryContext}` : ''}

Search results:
${searchOutput || '(No search results available)'}

Provide a clear, helpful summary of what you found. Focus on actionable information.
If the results include URLs, include the most relevant ones.
Use plain language suitable for someone who may have cognitive accessibility needs.`
        : `You are the Imara Assistant helping a person with disabilities accomplish a task.

User's goal: "${node.instruction}"
${state.memoryContext ? `User context: ${state.memoryContext}` : ''}

Provide a clear, helpful answer using your existing knowledge.
Use plain language suitable for someone who may have cognitive accessibility needs.`

      const synthesis = await this.inference.run({
        type: 'generate',
        input: synthesisPrompt,
        context: state.userContext,
      })

      const durationMs = Date.now() - start
      emit('agent.research.completed', { nodeId: node.id, durationMs })

      return {
        success: true,
        output: synthesis.output,
        data: { query, searchOutput },
        confidence: synthesis.confidence,
        toolsUsed,
        durationMs,
      }
    } catch (err) {
      const durationMs = Date.now() - start
      const error = err instanceof Error ? err.message : 'Research agent failed'
      log.error('Research agent error', { error })
      emit('agent.research.failed', { nodeId: node.id, error })

      return {
        success: false,
        output: error,
        confidence: 0,
        toolsUsed,
        durationMs,
      }
    }
  }
}
