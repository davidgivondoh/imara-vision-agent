import { Ollama } from 'ollama'
import { createLogger } from '../shared/logger.js'
import type { InferenceRequest, InferenceResult } from '../shared/types.js'

const log = createLogger('inference:ollama')

export interface OllamaOptions {
  endpoint: string
  model: string
  timeoutMs: number
}

export class OllamaInference {
  private client: Ollama
  private endpoint: string
  private model: string
  private timeoutMs: number
  private ready = false

  constructor(options: OllamaOptions) {
    this.endpoint = options.endpoint
    this.client = new Ollama({ host: options.endpoint })
    this.model = options.model
    this.timeoutMs = options.timeoutMs
  }

  async initialize(): Promise<boolean> {
    try {
      // Verify Ollama is running and model is available
      const models = await this.client.list()
      const modelNames = models.models.map((m) => m.name)

      // Check exact match or partial (e.g. "llama3.1:8b" matches "llama3.1:8b")
      const available = modelNames.some(
        (name) => name === this.model || name.startsWith(this.model.split(':')[0]),
      )

      if (available) {
        this.ready = true
        log.info(`Ollama ready (model: ${this.model}, endpoint: ${this.endpoint})`)
      } else {
        log.warn(
          `Ollama running but model "${this.model}" not found. Available: ${modelNames.join(', ')}`,
        )
        // Still mark ready if ANY model exists — we'll use what's available
        if (modelNames.length > 0) {
          this.model = modelNames[0]
          this.ready = true
          log.info(`Falling back to available model: ${this.model}`)
        }
      }

      return this.ready
    } catch (err) {
      log.info(
        `Ollama not available at ${this.endpoint}: ${err instanceof Error ? err.message : 'connection failed'}`,
      )
      this.ready = false
      return false
    }
  }

  isReady(): boolean {
    return this.ready
  }

  getModel(): string {
    return this.model
  }

  async run(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.ready) {
      throw new Error('Ollama inference not available')
    }

    const startTime = Date.now()
    const systemPrompt = this.buildSystemPrompt(request.type)

    try {
      const response = await this.client.chat({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: request.input },
        ],
        options: {
          num_predict: request.maxTokens ?? 1024,
        },
      })

      const durationMs = Date.now() - startTime
      const output = response.message.content

      return {
        provider: 'ollama',
        output,
        confidence: this.estimateConfidence(request.type, output),
        durationMs,
        tokenCount: (response.eval_count ?? 0) + (response.prompt_eval_count ?? 0),
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      log.error('Ollama inference failed', {
        error: err instanceof Error ? err.message : 'Unknown',
        model: this.model,
        durationMs,
      })
      throw err
    }
  }

  private buildSystemPrompt(type: InferenceRequest['type']): string {
    const base =
      'You are Neura, the Imara Vision Agent — an assistive AI for inclusive learning and independent living for people with disabilities.'

    switch (type) {
      case 'classify':
        return `${base}\n\nClassify the user's task. Return valid JSON with these fields:\n- intent (string): the primary intent category\n- confidence (number 0-1): your confidence in the classification\n- entities (string array): key entities mentioned\n\nCategories: summarisation, assessment, planning, explanation, navigation, communication, reminder, note_taking, daily_living, accessibility, general\n\nReturn ONLY the JSON, no other text.`
      case 'plan':
        return `${base}\n\nCreate a clear, step-by-step action plan for the user's task. Number each step. Be specific, actionable, and concise. Consider accessibility needs and user empowerment.`
      case 'generate':
        return `${base}\n\nComplete the user's requested task. Be clear, helpful, and use plain language. Focus on practical outcomes. If the task involves learning, explain concepts simply. If it involves daily living, give specific actionable guidance.`
      case 'embed':
        return `${base}\n\nGenerate a concise semantic summary of the input in one sentence.`
      default:
        return base
    }
  }

  private estimateConfidence(type: InferenceRequest['type'], output: string): number {
    // Heuristic confidence estimation based on output quality signals
    if (!output || output.trim().length === 0) return 0.1

    const length = output.trim().length

    if (type === 'classify') {
      // Check if output looks like valid JSON
      try {
        const parsed = JSON.parse(output)
        if (parsed.intent && typeof parsed.confidence === 'number') {
          return Math.min(parsed.confidence, 0.95)
        }
      } catch {
        // Not valid JSON — lower confidence
        return 0.5
      }
    }

    // Longer, substantive outputs get higher confidence
    if (length > 500) return 0.88
    if (length > 200) return 0.82
    if (length > 50) return 0.75
    return 0.6
  }
}
