// ─── Tool System Types ──────────────────────────────────────────

export type ToolCategory =
  | 'filesystem'
  | 'browser'
  | 'desktop'
  | 'code'
  | 'vision'
  | 'communication'
  | 'system'

export type ToolPermission =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'filesystem.delete'
  | 'network.http'
  | 'browser.navigate'
  | 'browser.interact'
  | 'desktop.read'
  | 'desktop.control'
  | 'code.execute'
  | 'code.shell'
  | 'notification.send'
  | 'system.info'

export interface ToolParameter {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description: string
  required: boolean
  default?: unknown
}

export interface ToolArtifact {
  type: 'text' | 'image' | 'file' | 'html' | 'screenshot'
  content: string
  mimeType?: string
  filename?: string
}

export interface ToolResult {
  success: boolean
  output: unknown
  artifacts?: ToolArtifact[]
  durationMs: number
  error?: string
}

export interface Tool {
  name: string
  description: string
  category: ToolCategory
  permissions: ToolPermission[]
  parameters: ToolParameter[]
  execute(params: Record<string, unknown>): Promise<ToolResult>
}
