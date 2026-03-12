import { createLogger } from '../shared/logger.js'
import type { Tool, ToolResult, ToolPermission, ToolCategory } from './types.js'
import type { ToolDefinition } from '../shared/types.js'

const log = createLogger('tool-registry')

export class ToolRegistry {
  private tools = new Map<string, Tool>()
  private schemaCache: ToolDefinition[] | null = null

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      log.warn(`Tool "${tool.name}" already registered — overwriting`)
    }
    this.tools.set(tool.name, tool)
    this.schemaCache = null // invalidate on registration
    log.info(`Tool registered: ${tool.name} [${tool.category}]`)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  list(category?: ToolCategory): Tool[] {
    const all = Array.from(this.tools.values())
    if (!category) return all
    return all.filter((t) => t.category === category)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  get count(): number {
    return this.tools.size
  }

  checkPermissions(tool: Tool, granted: ToolPermission[]): boolean {
    return tool.permissions.every((p) => granted.includes(p))
  }

  async execute(
    name: string,
    params: Record<string, unknown>,
    granted?: ToolPermission[],
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return {
        success: false,
        output: null,
        durationMs: 0,
        error: `Tool "${name}" not found`,
      }
    }

    // Permission check
    if (granted && !this.checkPermissions(tool, granted)) {
      const missing = tool.permissions.filter((p) => !granted.includes(p))
      return {
        success: false,
        output: null,
        durationMs: 0,
        error: `Missing permissions: ${missing.join(', ')}`,
      }
    }

    // Validate required parameters
    for (const param of tool.parameters) {
      if (param.required && !(param.name in params)) {
        return {
          success: false,
          output: null,
          durationMs: 0,
          error: `Missing required parameter: ${param.name}`,
        }
      }
    }

    const startTime = Date.now()
    try {
      const result = await tool.execute(params)
      log.info(`Tool executed: ${name}`, { durationMs: result.durationMs, success: result.success })
      return result
    } catch (err) {
      const durationMs = Date.now() - startTime
      const message = err instanceof Error ? err.message : 'Unknown error'
      log.error(`Tool execution failed: ${name}`, { error: message, durationMs })
      return {
        success: false,
        output: null,
        durationMs,
        error: message,
      }
    }
  }

  toAnthropicSchema(): ToolDefinition[] {
    if (this.schemaCache) return this.schemaCache
    this.schemaCache = this.list().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: Object.fromEntries(
          t.parameters.map((p) => [
            p.name,
            {
              type: p.type,
              description: p.description,
            },
          ]),
        ),
        required: t.parameters.filter((p) => p.required).map((p) => p.name),
      },
    }))
    return this.schemaCache
  }

  toJSON(): Array<{
    name: string
    description: string
    category: ToolCategory
    permissions: ToolPermission[]
    parameters: Array<{ name: string; type: string; description: string; required: boolean }>
  }> {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      permissions: t.permissions,
      parameters: t.parameters.map((p) => ({
        name: p.name,
        type: p.type,
        description: p.description,
        required: p.required,
      })),
    }))
  }
}
