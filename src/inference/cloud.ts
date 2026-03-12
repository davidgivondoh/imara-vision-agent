import Anthropic from '@anthropic-ai/sdk'
import { createLogger } from '../shared/logger.js'
import { buildSystemPrompt } from '../shared/system-prompt.js'
import type { PromptType } from '../shared/system-prompt.js'
import type { InferenceRequest, InferenceResult, ToolUseRequest, TokenCallback } from '../shared/types.js'

const log = createLogger('inference:cloud')

export interface CloudOptions {
  apiKey: string
  endpoint: string
  provider: string
  model: string
  timeoutMs: number
}

export class CloudInference {
  private apiKey: string
  private endpoint: string
  private provider: string
  private model: string
  private timeoutMs: number
  private client: Anthropic | null = null
  private ready = false

  constructor(options: CloudOptions) {
    this.apiKey = options.apiKey
    this.endpoint = options.endpoint
    this.provider = options.provider
    this.model = options.model
    this.timeoutMs = options.timeoutMs
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      log.warn('No cloud API key configured — cloud inference unavailable')
      return
    }

    if (this.provider !== 'anthropic') {
      log.warn(`Unsupported cloud provider: ${this.provider}`)
      return
    }

    this.client = new Anthropic({
      apiKey: this.apiKey,
      timeout: this.timeoutMs,
    })

    this.ready = true
    log.info(`Cloud inference ready (provider: ${this.provider}, model: ${this.model})`)
  }

  isReady(): boolean {
    return this.ready && this.client !== null
  }

  getModel(): string {
    return this.model
  }

  async run(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.isReady() || !this.client) {
      throw new Error('Cloud inference not available — no API key configured')
    }

    const startTime = Date.now()
    const systemPrompt = buildSystemPrompt(request.type as PromptType)

    try {
      // Build messages array — supports multi-turn for tool_use flows
      const messages: Anthropic.MessageParam[] = request.priorMessages
        ? (request.priorMessages as Anthropic.MessageParam[])
        : [{ role: 'user', content: request.input }]

      // If we have tool results, append them as a user message
      if (request.toolResults && request.toolResults.length > 0) {
        messages.push({
          role: 'user',
          content: request.toolResults.map((tr) => ({
            type: 'tool_result' as const,
            tool_use_id: tr.tool_use_id,
            content: tr.content,
            is_error: tr.is_error,
          })),
        })
      }

      // Build create params
      const createParams: Anthropic.MessageCreateParams = {
        model: this.model,
        max_tokens: request.maxTokens ?? 4096,
        system: systemPrompt,
        messages,
      }

      // Attach tools if provided
      if (request.tools && request.tools.length > 0) {
        createParams.tools = request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        }))
      }

      const response = await this.client.messages.create(createParams)

      const durationMs = Date.now() - startTime

      // Extract text blocks
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')

      // Extract tool_use blocks
      const toolCalls: ToolUseRequest[] = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
        .map((block) => ({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        }))

      const tokenCount =
        (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)

      const stopReason = response.stop_reason === 'tool_use' ? 'tool_use' as const
        : response.stop_reason === 'max_tokens' ? 'max_tokens' as const
        : 'end_turn' as const

      return {
        provider: 'cloud',
        output: text,
        confidence: this.estimateConfidence(request.type, text),
        durationMs,
        tokenCount,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        stopReason,
      }
    } catch (err) {
      const durationMs = Date.now() - startTime

      if (err instanceof Anthropic.RateLimitError) {
        log.warn('Cloud API rate limited', { durationMs })
      } else if (err instanceof Anthropic.APIError) {
        log.error('Cloud API error', {
          status: err.status,
          message: err.message,
          durationMs,
        })
      } else {
        log.error('Cloud inference failed', {
          error: err instanceof Error ? err.message : 'Unknown',
          model: this.model,
          durationMs,
        })
      }

      throw err
    }
  }

  /**
   * Streaming inference — emits tokens via callback as they arrive from the API.
   * Returns the same InferenceResult when complete.
   */
  async runStreaming(request: InferenceRequest, onToken: TokenCallback): Promise<InferenceResult> {
    if (!this.isReady() || !this.client) {
      throw new Error('Cloud inference not available — no API key configured')
    }

    const startTime = Date.now()
    const systemPrompt = buildSystemPrompt(request.type as PromptType)

    try {
      const messages: Anthropic.MessageParam[] = request.priorMessages
        ? (request.priorMessages as Anthropic.MessageParam[])
        : [{ role: 'user', content: request.input }]

      if (request.toolResults && request.toolResults.length > 0) {
        messages.push({
          role: 'user',
          content: request.toolResults.map((tr) => ({
            type: 'tool_result' as const,
            tool_use_id: tr.tool_use_id,
            content: tr.content,
            is_error: tr.is_error,
          })),
        })
      }

      const createParams: Anthropic.MessageCreateParams = {
        model: this.model,
        max_tokens: request.maxTokens ?? 4096,
        system: systemPrompt,
        messages,
      }

      if (request.tools && request.tools.length > 0) {
        createParams.tools = request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        }))
      }

      // Use the streaming API
      const stream = this.client.messages.stream(createParams)

      let fullText = ''
      const toolCalls: ToolUseRequest[] = []

      stream.on('text', (text) => {
        fullText += text
        onToken(text)
      })

      // Wait for the stream to finish
      const response = await stream.finalMessage()

      const durationMs = Date.now() - startTime

      // Extract any tool_use blocks (they don't stream as text)
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          })
        }
      }

      const tokenCount =
        (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)

      const stopReason = response.stop_reason === 'tool_use' ? 'tool_use' as const
        : response.stop_reason === 'max_tokens' ? 'max_tokens' as const
        : 'end_turn' as const

      return {
        provider: 'cloud',
        output: fullText,
        confidence: this.estimateConfidence(request.type, fullText),
        durationMs,
        tokenCount,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        stopReason,
      }
    } catch (err) {
      const durationMs = Date.now() - startTime

      if (err instanceof Anthropic.RateLimitError) {
        log.warn('Cloud API rate limited (streaming)', { durationMs })
      } else if (err instanceof Anthropic.APIError) {
        log.error('Cloud API error (streaming)', { status: err.status, message: err.message, durationMs })
      } else {
        log.error('Cloud streaming inference failed', {
          error: err instanceof Error ? err.message : 'Unknown',
          model: this.model,
          durationMs,
        })
      }

      throw err
    }
  }

  private estimateConfidence(type: InferenceRequest['type'], output: string): number {
    if (!output || output.trim().length === 0) return 0.1

    const length = output.trim().length

    if (type === 'classify') {
      try {
        const parsed = JSON.parse(output)
        if (parsed.intent && typeof parsed.confidence === 'number') {
          return Math.min(parsed.confidence, 0.95)
        }
      } catch {
        return 0.6
      }
    }

    if (length > 500) return 0.92
    if (length > 200) return 0.88
    if (length > 50) return 0.82
    return 0.7
  }
}
