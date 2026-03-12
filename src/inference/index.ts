import { createLogger } from '../shared/logger.js'
import type { InferenceRequest, InferenceResult, InferenceProvider, ToolDefinition, TokenCallback } from '../shared/types.js'
import type { Telemetry } from '../core/telemetry.js'
import { LocalInference } from './local.js'
import { CloudInference } from './cloud.js'
import { OllamaInference } from './ollama.js'
import { InferenceRouter, type RouterConfig, type RoutingDecision } from './router.js'

const log = createLogger('inference')

export interface InferenceLayerOptions {
  preferLocal: boolean
  localModelPath: string
  localProvider: 'ollama' | 'onnx' | 'rule-based'
  ollamaEndpoint: string
  ollamaModel: string
  cloudApiKey: string
  cloudEndpoint: string
  cloudProvider: string
  cloudModel: string
  timeoutMs: number
  telemetry: Telemetry
  routerConfig?: Partial<RouterConfig>
}

export class InferenceLayer {
  private local: LocalInference
  private cloud: CloudInference
  private ollama: OllamaInference
  private preferLocal: boolean
  private telemetry: Telemetry
  private localProvider: 'ollama' | 'onnx' | 'rule-based'
  private router: InferenceRouter

  constructor(options: InferenceLayerOptions) {
    this.preferLocal = options.preferLocal
    this.telemetry = options.telemetry
    this.localProvider = options.localProvider

    this.local = new LocalInference({ modelPath: options.localModelPath })
    this.cloud = new CloudInference({
      apiKey: options.cloudApiKey,
      endpoint: options.cloudEndpoint,
      provider: options.cloudProvider,
      model: options.cloudModel,
      timeoutMs: options.timeoutMs,
    })
    this.ollama = new OllamaInference({
      endpoint: options.ollamaEndpoint,
      model: options.ollamaModel,
      timeoutMs: options.timeoutMs,
    })

    const localRoutingProvider = options.localProvider === 'onnx' ? 'onnx' : 'rule-based'
    this.router = new InferenceRouter({
      preferLocal: options.preferLocal,
      localProvider: localRoutingProvider,
      ...options.routerConfig,
    })
  }

  async initialize(): Promise<void> {
    // Always init rule-based local (instant, no dependencies)
    await this.local.initialize()

    // Try Ollama if configured
    if (this.localProvider === 'ollama') {
      await this.ollama.initialize()
    }

    // Try cloud
    await this.cloud.initialize()

    // Register provider readiness with the router
    this.router.setProviderReady('local', this.local.isReady())
    this.router.setProviderReady('cloud', this.cloud.isReady())
    this.router.setProviderReady('ollama', this.ollama.isReady())

    log.info('Inference layer ready', {
      ollamaReady: this.ollama.isReady(),
      ollamaModel: this.ollama.isReady() ? this.ollama.getModel() : 'n/a',
      localReady: this.local.isReady(),
      cloudReady: this.cloud.isReady(),
      preferred: this.preferLocal ? 'local' : 'cloud',
    })
  }

  async run(request: InferenceRequest): Promise<InferenceResult> {
    const decision = this.router.route(request)

    this.telemetry.emit('inference.routed', {
      type: request.type,
      provider: decision.provider,
      reason: decision.reason,
      complexity: decision.complexity,
      preferLocal: this.preferLocal,
      ollamaReady: this.ollama.isReady(),
    })

    log.debug('Routing decision', {
      provider: decision.provider,
      reason: decision.reason,
      complexity: decision.complexity,
      fallbacks: decision.fallbacks,
    })

    try {
      const result = await this.executeWithProvider(decision.provider, request)
      this.router.recordSuccess(decision.provider, result.durationMs, result.tokenCount ?? 0)
      return result
    } catch (err) {
      this.router.recordFailure(decision.provider)
      log.warn(`${decision.provider} inference failed, trying fallback`, {
        error: err instanceof Error ? err.message : 'Unknown',
      })

      // Cascade through router-ordered fallbacks
      for (const fallback of decision.fallbacks) {
        try {
          log.info(`Falling back to ${fallback}`)
          const result = await this.executeWithProvider(fallback, request)
          this.router.recordSuccess(fallback, result.durationMs, result.tokenCount ?? 0)
          return result
        } catch (fallbackErr) {
          this.router.recordFailure(fallback)
          log.warn(`Fallback ${fallback} also failed`, {
            error: fallbackErr instanceof Error ? fallbackErr.message : 'Unknown',
          })
        }
      }

      throw err
    }
  }

  /**
   * Streaming inference — tokens are emitted via callback as they arrive.
   * Only works when routed to cloud provider. Falls back to non-streaming otherwise.
   */
  async runStreaming(request: InferenceRequest, onToken: TokenCallback): Promise<InferenceResult> {
    const decision = this.router.route(request)

    this.telemetry.emit('inference.routed', {
      type: request.type,
      provider: decision.provider,
      reason: decision.reason,
      streaming: true,
    })

    // Streaming only supported on cloud — fallback to non-streaming for others
    if (decision.provider === 'cloud' && this.cloud.isReady()) {
      try {
        const result = await this.cloud.runStreaming(request, onToken)
        this.router.recordSuccess('cloud', result.durationMs, result.tokenCount ?? 0)
        return result
      } catch (err) {
        this.router.recordFailure('cloud')
        log.warn('Cloud streaming failed, falling back to non-streaming', {
          error: err instanceof Error ? err.message : 'Unknown',
        })
      }
    }

    // Non-streaming fallback: run normally, then emit full output as one token
    const result = await this.run(request)
    if (result.output) {
      onToken(result.output)
    }
    return result
  }

  /**
   * Get the last routing decision for diagnostic purposes.
   */
  getRouter(): InferenceRouter {
    return this.router
  }

  private async executeWithProvider(
    provider: InferenceProvider,
    request: InferenceRequest,
  ): Promise<InferenceResult> {
    switch (provider) {
      case 'ollama':
        return await this.ollama.run(request)
      case 'cloud':
        return await this.cloud.run(request)
      case 'local':
      default:
        return await this.local.run(request)
    }
  }

  getStatus(): {
    local: boolean
    cloud: boolean
    ollama: boolean
    ollamaModel: string
    cloudModel: string
    preferred: string
    activeProvider: string
  } {
    // Determine which provider would actually be used
    let activeProvider = 'rule-based'
    if (!this.preferLocal && this.cloud.isReady()) activeProvider = 'cloud'
    else if (this.ollama.isReady()) activeProvider = 'ollama'
    else if (this.cloud.isReady()) activeProvider = 'cloud'
    else if (this.local.isReady()) activeProvider = 'rule-based'

    return {
      local: this.local.isReady(),
      cloud: this.cloud.isReady(),
      ollama: this.ollama.isReady(),
      ollamaModel: this.ollama.isReady() ? this.ollama.getModel() : 'none',
      cloudModel: this.cloud.isReady() ? this.cloud.getModel() : 'none',
      preferred: this.preferLocal ? 'local' : 'cloud',
      activeProvider,
    }
  }
}

export { LocalInference } from './local.js'
export { CloudInference } from './cloud.js'
export { OllamaInference } from './ollama.js'
export { InferenceRouter } from './router.js'
export type { RouterConfig, RoutingDecision, TaskComplexity } from './router.js'
