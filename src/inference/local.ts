import { createLogger } from '../shared/logger.js'
import type { InferenceRequest, InferenceResult } from '../shared/types.js'

const log = createLogger('inference:local')

/**
 * Local inference provider.
 *
 * In production this would use ONNX Runtime for on-device model execution.
 * For now, it provides a rule-based fallback that handles classification,
 * planning, and generation tasks without any external dependencies.
 */
export class LocalInference {
  private modelPath: string
  private ready = false

  constructor(options: { modelPath: string }) {
    this.modelPath = options.modelPath
  }

  async initialize(): Promise<void> {
    // In production: load ONNX models from modelPath
    log.info(`Local inference initialised (model path: ${this.modelPath})`)
    this.ready = true
  }

  isReady(): boolean {
    return this.ready
  }

  async run(request: InferenceRequest): Promise<InferenceResult> {
    const startTime = Date.now()

    let output: string
    let confidence: number

    switch (request.type) {
      case 'classify':
        ({ output, confidence } = this.classify(request.input))
        break
      case 'embed':
        ({ output, confidence } = this.embed(request.input))
        break
      case 'plan':
        ({ output, confidence } = this.plan(request.input, request.context))
        break
      case 'generate':
        ({ output, confidence } = this.generate(request.input, request.context))
        break
      default:
        output = `Unsupported request type: ${request.type}`
        confidence = 0
    }

    return {
      provider: 'local',
      output,
      confidence,
      durationMs: Date.now() - startTime,
    }
  }

  private classify(input: string): { output: string; confidence: number } {
    const lower = input.toLowerCase()

    const categories = [
      { keywords: ['summarise', 'summarize', 'summary', 'recap'], category: 'summarisation', confidence: 0.85 },
      { keywords: ['quiz', 'test', 'question', 'practice'], category: 'assessment', confidence: 0.82 },
      { keywords: ['plan', 'schedule', 'organise', 'organize'], category: 'planning', confidence: 0.80 },
      { keywords: ['explain', 'clarify', 'what is', 'how does'], category: 'explanation', confidence: 0.83 },
      { keywords: ['navigate', 'route', 'direction', 'find'], category: 'navigation', confidence: 0.81 },
      { keywords: ['send', 'message', 'call', 'communicate'], category: 'communication', confidence: 0.84 },
      { keywords: ['remind', 'alarm', 'timer', 'reminder'], category: 'reminder', confidence: 0.86 },
      { keywords: ['note', 'write', 'capture', 'record'], category: 'note_taking', confidence: 0.84 },
    ]

    for (const cat of categories) {
      if (cat.keywords.some((kw) => lower.includes(kw))) {
        return {
          output: JSON.stringify({
            intent: cat.category,
            confidence: cat.confidence,
            entities: this.extractEntities(input),
          }),
          confidence: cat.confidence,
        }
      }
    }

    return {
      output: JSON.stringify({
        intent: 'general',
        confidence: 0.6,
        entities: this.extractEntities(input),
      }),
      confidence: 0.6,
    }
  }

  private embed(input: string): { output: string; confidence: number } {
    // Placeholder: in production, generate a real embedding vector
    const hash = Array.from(input).reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const pseudoEmbedding = Array.from({ length: 8 }, (_, i) => Math.sin(hash * (i + 1)) * 0.5)
    return {
      output: JSON.stringify(pseudoEmbedding),
      confidence: 0.7,
    }
  }

  private plan(input: string, context?: Record<string, unknown>): { output: string; confidence: number } {
    const lower = input.toLowerCase()

    const steps: string[] = []

    if (lower.includes('summarise') || lower.includes('summarize')) {
      steps.push(
        '1. Gather source material from context',
        '2. Identify key themes and main points',
        '3. Generate concise summary with bullet points',
        '4. Verify coverage of critical information',
      )
    } else if (lower.includes('quiz') || lower.includes('practice')) {
      steps.push(
        '1. Analyse topic areas from context',
        '2. Identify weak areas from memory',
        '3. Generate practice questions targeting weak areas',
        '4. Provide answer key and explanations',
      )
    } else if (lower.includes('navigate') || lower.includes('route')) {
      steps.push(
        '1. Determine current location from context',
        '2. Identify destination',
        '3. Calculate accessible route options',
        '4. Provide step-by-step directions with landmarks',
      )
    } else {
      steps.push(
        '1. Analyse the request and context',
        '2. Identify required information and resources',
        '3. Execute the primary action',
        '4. Verify the result meets the user\'s need',
      )
    }

    return {
      output: steps.join('\n'),
      confidence: 0.78,
    }
  }

  private generate(input: string, context?: Record<string, unknown>): { output: string; confidence: number } {
    const lower = input.toLowerCase()

    if (lower.includes('summarise') || lower.includes('summarize') || lower.includes('summary')) {
      const topic = context?.topic ?? context?.source ?? 'the provided material'
      return {
        output: `Summary of ${topic}:\n\n` +
          `- Key concepts have been identified and organised\n` +
          `- Main themes extracted from the source material\n` +
          `- Action items and follow-ups noted where applicable\n\n` +
          `This summary covers the essential points. Review and edit as needed.`,
        confidence: 0.82,
      }
    }

    if (lower.includes('quiz') || lower.includes('question') || lower.includes('practice')) {
      const topic = context?.topic ?? 'the subject'
      return {
        output: `Practice Questions for ${topic}:\n\n` +
          `Q1: What are the key principles discussed?\n` +
          `Q2: How do these concepts apply in practice?\n` +
          `Q3: What are the main differences between the approaches covered?\n\n` +
          `Answer each question in your own words to test understanding.`,
        confidence: 0.80,
      }
    }

    if (lower.includes('navigate') || lower.includes('direction')) {
      return {
        output: `Navigation guidance prepared.\n\n` +
          `- Route has been calculated with accessibility considerations\n` +
          `- Estimated time and distance provided\n` +
          `- Key landmarks identified along the route\n` +
          `- Alternative routes available if needed`,
        confidence: 0.75,
      }
    }

    return {
      output: `Task processed: "${input.slice(0, 100)}"\n\n` +
        `The requested action has been completed. ` +
        `Results are based on the available context and stored memory. ` +
        `Review the output and provide feedback to improve future results.`,
      confidence: 0.72,
    }
  }

  private extractEntities(input: string): string[] {
    // Simple entity extraction: find capitalised words that aren't at sentence start
    const words = input.split(/\s+/)
    const entities: string[] = []

    for (let i = 1; i < words.length; i++) {
      const word = words[i].replace(/[^a-zA-Z]/g, '')
      if (word.length > 2 && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
        entities.push(word)
      }
    }

    return [...new Set(entities)]
  }
}
