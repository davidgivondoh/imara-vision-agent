// ─── Memory Agent ───────────────────────────────────────────────
// Maintains context across sessions: short-term context, long-term knowledge,
// user preferences. Also handles file read/write for persistent data.
// See IMARA-AGENT-SPEC.md §4.7

import { createLogger } from '../../shared/logger.js'
import type { MemoryStore } from '../memory.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type {
  AgentRole,
  TaskNode,
  SharedState,
  AgentResult,
  AgentEmitFn,
  SpecialistAgent,
} from './types.js'

const log = createLogger('agent:memory')

export class MemoryAgent implements SpecialistAgent {
  readonly role: AgentRole = 'memory'
  readonly description = 'Manages context, preferences, and file-based data across sessions'
  readonly toolNames = ['read_file', 'write_file', 'list_files', 'create_dir']

  private memory: MemoryStore
  private tools: ToolRegistry

  constructor(options: { memory: MemoryStore; tools: ToolRegistry }) {
    this.memory = options.memory
    this.tools = options.tools
  }

  async execute(node: TaskNode, state: SharedState, emit: AgentEmitFn): Promise<AgentResult> {
    const start = Date.now()
    const toolsUsed: string[] = []

    log.info('Memory agent executing', { instruction: node.instruction.slice(0, 80) })
    emit('agent.memory.started', { nodeId: node.id })

    try {
      const instruction = node.instruction.toLowerCase()

      // Determine the memory operation type
      if (instruction.includes('remember') || instruction.includes('save') || instruction.includes('store')) {
        return await this.handleStore(node, state, emit, start, toolsUsed)
      }

      if (instruction.includes('recall') || instruction.includes('retrieve') || instruction.includes('what do you know')) {
        return await this.handleRecall(node, state, emit, start, toolsUsed)
      }

      if (instruction.includes('forget') || instruction.includes('delete') || instruction.includes('remove')) {
        return await this.handleForget(node, state, emit, start, toolsUsed)
      }

      if (instruction.includes('read') && instruction.includes('file')) {
        return await this.handleFileRead(node, state, emit, start, toolsUsed)
      }

      if (instruction.includes('write') && instruction.includes('file')) {
        return await this.handleFileWrite(node, state, emit, start, toolsUsed)
      }

      // Default: search memory for relevant context
      return await this.handleRecall(node, state, emit, start, toolsUsed)
    } catch (err) {
      const durationMs = Date.now() - start
      const error = err instanceof Error ? err.message : 'Memory agent failed'
      log.error('Memory agent error', { error })
      emit('agent.memory.failed', { nodeId: node.id, error })

      return {
        success: false,
        output: error,
        confidence: 0,
        toolsUsed,
        durationMs,
      }
    }
  }

  private async handleStore(
    node: TaskNode, state: SharedState, emit: AgentEmitFn, start: number, toolsUsed: string[],
  ): Promise<AgentResult> {
    // Extract key-value from instruction
    const content = node.instruction.replace(/^(remember|save|store)\s*(that\s*)?/i, '').trim()

    await this.memory.store({
      key: `user:${content.slice(0, 50)}`,
      value: content,
      type: 'preference',
      scope: 'user',
    })

    const durationMs = Date.now() - start
    emit('agent.memory.completed', { nodeId: node.id, operation: 'store', durationMs })

    return {
      success: true,
      output: `I'll remember that: "${content}"`,
      data: { operation: 'store', key: content.slice(0, 50) },
      confidence: 1,
      toolsUsed,
      durationMs,
    }
  }

  private async handleRecall(
    node: TaskNode, state: SharedState, emit: AgentEmitFn, start: number, toolsUsed: string[],
  ): Promise<AgentResult> {
    // Extract search terms by stripping recall preamble
    const query = node.instruction
      .replace(/^(recall|retrieve|what do you know about|tell me about)\s*/i, '')
      .replace(/^(my|the|a|an)\s+/i, '')
      .trim() || node.instruction

    // Try the extracted query first, fall back to full instruction
    let results = await this.memory.search(query, { limit: 10 })
    if (results.length === 0 && query !== node.instruction) {
      // Try individual words (3+ chars) from the query
      const words = query.split(/\s+/).filter(w => w.length >= 3)
      for (const word of words) {
        results = await this.memory.search(word, { limit: 10 })
        if (results.length > 0) break
      }
    }

    const durationMs = Date.now() - start
    emit('agent.memory.completed', { nodeId: node.id, operation: 'recall', durationMs })

    if (results.length === 0) {
      return {
        success: true,
        output: 'I don\'t have any stored information matching that query.',
        data: { operation: 'recall', matches: 0 },
        confidence: 0.8,
        toolsUsed,
        durationMs,
      }
    }

    const formatted = results.map(m => `- ${m.key}: ${m.value}`).join('\n')
    return {
      success: true,
      output: `Here's what I know:\n${formatted}`,
      data: { operation: 'recall', matches: results.length, entries: results },
      confidence: 0.9,
      toolsUsed,
      durationMs,
    }
  }

  private async handleForget(
    node: TaskNode, state: SharedState, emit: AgentEmitFn, start: number, toolsUsed: string[],
  ): Promise<AgentResult> {
    const query = node.instruction.replace(/^(forget|delete|remove)\s*(about\s*)?/i, '').trim()
    const matches = await this.memory.search(query, { limit: 5 })

    let removed = 0
    for (const entry of matches) {
      await this.memory.delete(entry.id)
      removed++
    }

    const durationMs = Date.now() - start
    emit('agent.memory.completed', { nodeId: node.id, operation: 'forget', durationMs })

    return {
      success: true,
      output: removed > 0
        ? `Removed ${removed} memory ${removed === 1 ? 'entry' : 'entries'} matching "${query}".`
        : `No memory entries found matching "${query}".`,
      data: { operation: 'forget', removed },
      confidence: 1,
      toolsUsed,
      durationMs,
    }
  }

  private async handleFileRead(
    node: TaskNode, _state: SharedState, emit: AgentEmitFn, start: number, toolsUsed: string[],
  ): Promise<AgentResult> {
    // Extract file path from instruction
    const pathMatch = node.instruction.match(/(?:read|open)\s+(?:the\s+)?(?:file\s+)?["']?([^\s"']+)["']?/i)
    const path = pathMatch?.[1]

    if (!path || !this.tools.has('read_file')) {
      return {
        success: false,
        output: 'Could not determine file path or file reading tool unavailable.',
        confidence: 0,
        toolsUsed,
        durationMs: Date.now() - start,
      }
    }

    const result = await this.tools.execute('read_file', { path })
    toolsUsed.push('read_file')

    const durationMs = Date.now() - start
    emit('agent.memory.completed', { nodeId: node.id, operation: 'file_read', durationMs })

    return {
      success: result.success,
      output: result.success
        ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output))
        : `Error reading file: ${result.error}`,
      data: { operation: 'file_read', path },
      confidence: result.success ? 0.9 : 0,
      toolsUsed,
      durationMs,
    }
  }

  private async handleFileWrite(
    node: TaskNode, state: SharedState, emit: AgentEmitFn, start: number, toolsUsed: string[],
  ): Promise<AgentResult> {
    // Extract path and content from prior context
    const pathMatch = node.instruction.match(/(?:write|save)\s+(?:to\s+)?(?:the\s+)?(?:file\s+)?["']?([^\s"']+)["']?/i)
    const path = pathMatch?.[1]

    if (!path || !this.tools.has('write_file')) {
      return {
        success: false,
        output: 'Could not determine file path or file writing tool unavailable.',
        confidence: 0,
        toolsUsed,
        durationMs: Date.now() - start,
      }
    }

    // Get content from prior step outputs
    let content = ''
    for (const depId of node.dependsOn) {
      const output = state.toolOutputs[depId]
      if (output && typeof output === 'string') {
        content = output
        break
      }
    }

    if (!content) {
      content = node.instruction.replace(/.*(?:write|save)\s+(?:to\s+)?(?:the\s+)?(?:file\s+)?["']?[^\s"']+["']?\s*/i, '').trim()
    }

    const result = await this.tools.execute('write_file', { path, content })
    toolsUsed.push('write_file')

    const durationMs = Date.now() - start
    emit('agent.memory.completed', { nodeId: node.id, operation: 'file_write', durationMs })

    return {
      success: result.success,
      output: result.success ? `File written to ${path}` : `Error writing file: ${result.error}`,
      data: { operation: 'file_write', path },
      confidence: result.success ? 0.9 : 0,
      toolsUsed,
      durationMs,
    }
  }
}
