import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry } from '../../src/tools/registry.js'
import type { Tool, ToolResult, ToolPermission } from '../../src/tools/types.js'

function createMockTool(overrides?: Partial<Tool>): Tool {
  return {
    name: 'mock_tool',
    description: 'A mock tool for testing',
    category: 'filesystem',
    permissions: ['filesystem.read'] as ToolPermission[],
    parameters: [
      { name: 'input', type: 'string', description: 'Input value', required: true },
    ],
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      return {
        success: true,
        output: `Processed: ${params.input}`,
        durationMs: 1,
      }
    },
    ...overrides,
  }
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  it('should start empty', () => {
    expect(registry.count).toBe(0)
    expect(registry.list()).toEqual([])
  })

  it('should register a tool', () => {
    const tool = createMockTool()
    registry.register(tool)
    expect(registry.count).toBe(1)
    expect(registry.has('mock_tool')).toBe(true)
  })

  it('should get a tool by name', () => {
    const tool = createMockTool()
    registry.register(tool)
    expect(registry.get('mock_tool')).toBe(tool)
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('should list tools by category', () => {
    registry.register(createMockTool({ name: 'fs_tool', category: 'filesystem' }))
    registry.register(createMockTool({ name: 'browser_tool', category: 'browser' }))
    registry.register(createMockTool({ name: 'fs_tool_2', category: 'filesystem' }))

    expect(registry.list('filesystem').length).toBe(2)
    expect(registry.list('browser').length).toBe(1)
    expect(registry.list('desktop').length).toBe(0)
    expect(registry.list().length).toBe(3)
  })

  it('should execute a tool', async () => {
    registry.register(createMockTool())
    const result = await registry.execute('mock_tool', { input: 'hello' })
    expect(result.success).toBe(true)
    expect(result.output).toBe('Processed: hello')
  })

  it('should return error for unknown tool', async () => {
    const result = await registry.execute('nonexistent', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('should check permissions', () => {
    const tool = createMockTool({ permissions: ['filesystem.read', 'filesystem.write'] })
    registry.register(tool)

    expect(registry.checkPermissions(tool, ['filesystem.read', 'filesystem.write'])).toBe(true)
    expect(registry.checkPermissions(tool, ['filesystem.read'])).toBe(false)
    expect(registry.checkPermissions(tool, [])).toBe(false)
  })

  it('should reject execution when permissions are missing', async () => {
    const tool = createMockTool({ permissions: ['filesystem.write'] })
    registry.register(tool)

    const result = await registry.execute('mock_tool', { input: 'test' }, ['filesystem.read'])
    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing permissions')
  })

  it('should validate required parameters', async () => {
    registry.register(createMockTool())
    const result = await registry.execute('mock_tool', {}) // missing 'input'
    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing required parameter')
  })

  it('should handle tool execution errors gracefully', async () => {
    registry.register(createMockTool({
      name: 'error_tool',
      async execute(): Promise<ToolResult> {
        throw new Error('Boom!')
      },
    }))

    const result = await registry.execute('error_tool', { input: 'test' })
    expect(result.success).toBe(false)
    expect(result.error).toBe('Boom!')
  })

  it('should serialize to JSON', () => {
    registry.register(createMockTool())
    const json = registry.toJSON()
    expect(json.length).toBe(1)
    expect(json[0].name).toBe('mock_tool')
    expect(json[0].category).toBe('filesystem')
    expect(json[0].parameters[0].name).toBe('input')
  })

  it('should convert to Anthropic tool schema', () => {
    registry.register(createMockTool({
      name: 'read_file',
      description: 'Read a file',
      parameters: [
        { name: 'path', type: 'string', description: 'File path', required: true },
        { name: 'maxLines', type: 'number', description: 'Max lines', required: false },
      ],
    }))

    const schema = registry.toAnthropicSchema()
    expect(schema.length).toBe(1)
    expect(schema[0].name).toBe('read_file')
    expect(schema[0].description).toBe('Read a file')
    expect(schema[0].input_schema).toEqual({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        maxLines: { type: 'number', description: 'Max lines' },
      },
      required: ['path'],
    })
  })
})
