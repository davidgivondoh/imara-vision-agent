import { createLogger } from '../shared/logger.js'
import type { InferenceProvider, InferenceRequest } from '../shared/types.js'

const log = createLogger('inference:router')

// ─── Provider Capabilities ──────────────────────────────────────

export interface ProviderCapabilities {
  toolCalling: boolean
  maxTokens: number
  streaming: boolean
  multiTurn: boolean
  classification: boolean
  embedding: boolean
}

const PROVIDER_CAPABILITIES: Record<InferenceProvider, ProviderCapabilities> = {
  cloud: {
    toolCalling: true,
    maxTokens: 8192,
    streaming: true,
    multiTurn: true,
    classification: true,
    embedding: true,
  },
  ollama: {
    toolCalling: false,
    maxTokens: 4096,
    streaming: true,
    multiTurn: true,
    classification: true,
    embedding: true,
  },
  local: {
    toolCalling: false,
    maxTokens: 2048,
    streaming: false,
    multiTurn: false,
    classification: true,
    embedding: true,
  },
}

// ─── Provider Health Tracking ───────────────────────────────────

interface ProviderStats {
  totalCalls: number
  failures: number
  totalLatencyMs: number
  totalTokens: number
  lastCallAt: number
  lastFailureAt: number
  consecutiveFailures: number
}

function freshStats(): ProviderStats {
  return {
    totalCalls: 0,
    failures: 0,
    totalLatencyMs: 0,
    totalTokens: 0,
    lastCallAt: 0,
    lastFailureAt: 0,
    consecutiveFailures: 0,
  }
}

// ─── Routing Decision ───────────────────────────────────────────

export interface RoutingDecision {
  provider: InferenceProvider
  reason: string
  fallbacks: InferenceProvider[]
  complexity: TaskComplexity
}

export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex'

// ─── Router Config ──────────────────────────────────────────────

export interface RouterConfig {
  preferLocal: boolean
  circuitBreakerThreshold: number   // consecutive failures before circuit-breaking
  circuitBreakerCooldownMs: number  // how long to wait before retrying a circuit-broken provider
  complexityThreshold: number       // complexity score above which we escalate to cloud
  costAware: boolean                // prefer cheaper providers when quality is acceptable
  localProvider: 'ollama' | 'onnx' | 'rule-based'
  avoidRuleBasedGeneration: boolean // avoid rule-based local for text generation if other providers exist
}

const DEFAULT_CONFIG: RouterConfig = {
  preferLocal: true,
  circuitBreakerThreshold: 3,
  circuitBreakerCooldownMs: 60_000,
  complexityThreshold: 0.6,
  costAware: true,
  localProvider: 'rule-based',
  avoidRuleBasedGeneration: true,
}

// ─── Inference Router ───────────────────────────────────────────

export class InferenceRouter {
  private config: RouterConfig
  private stats: Map<InferenceProvider, ProviderStats> = new Map()
  private providerReady: Map<InferenceProvider, boolean> = new Map()

  constructor(config?: Partial<RouterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Initialize stats for all providers
    this.stats.set('local', freshStats())
    this.stats.set('cloud', freshStats())
    this.stats.set('ollama', freshStats())
  }

  /**
   * Update provider readiness. Called by InferenceLayer after initialization.
   */
  setProviderReady(provider: InferenceProvider, ready: boolean): void {
    this.providerReady.set(provider, ready)
  }

  /**
   * Record a successful call for health tracking.
   */
  recordSuccess(provider: InferenceProvider, latencyMs: number, tokens: number): void {
    const s = this.stats.get(provider) ?? freshStats()
    s.totalCalls++
    s.totalLatencyMs += latencyMs
    s.totalTokens += tokens
    s.lastCallAt = Date.now()
    s.consecutiveFailures = 0
    this.stats.set(provider, s)
  }

  /**
   * Record a failed call for health tracking.
   */
  recordFailure(provider: InferenceProvider): void {
    const s = this.stats.get(provider) ?? freshStats()
    s.totalCalls++
    s.failures++
    s.lastFailureAt = Date.now()
    s.consecutiveFailures++
    this.stats.set(provider, s)

    if (s.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      log.warn(`Circuit breaker tripped for ${provider}`, {
        consecutiveFailures: s.consecutiveFailures,
      })
    }
  }

  /**
   * Select the best provider for the given request.
   */
  route(request: InferenceRequest): RoutingDecision {
    const complexity = this.assessComplexity(request)
    const available = this.getAvailableProviders()
    let primaryCandidates = [...available]

    if (
      this.config.avoidRuleBasedGeneration &&
      this.config.localProvider === 'rule-based' &&
      request.type === 'generate'
    ) {
      const nonLocal = primaryCandidates.filter((p) => p !== 'local')
      if (nonLocal.length > 0) {
        primaryCandidates = nonLocal
      }
    }

    if (available.length === 0) {
      // Absolute fallback — local is always "available" even if degraded
      return {
        provider: 'local',
        reason: 'no providers available, falling back to rule-based local',
        fallbacks: [],
        complexity,
      }
    }

    // ─── Hard constraints: capability matching ─────────────────
    const needsToolCalling = (request.tools && request.tools.length > 0) ||
      (request.toolResults && request.toolResults.length > 0) ||
      (request.priorMessages && request.priorMessages.length > 0)

    if (needsToolCalling) {
      // Only cloud supports native tool calling
      if (available.includes('cloud')) {
        return {
          provider: 'cloud',
          reason: 'task requires tool calling (cloud only)',
          fallbacks: this.buildFallbacks('cloud', available),
          complexity,
        }
      }
      // Ollama doesn't support tool calling, but can still generate
      // Fall through to normal routing — the tool loop in agent-loop handles this
    }

    // ─── Explicit preference override ──────────────────────────
    if (!this.config.preferLocal && primaryCandidates.includes('cloud')) {
      return {
        provider: 'cloud',
        reason: 'user prefers cloud inference',
        fallbacks: this.buildFallbacks('cloud', available),
        complexity,
      }
    }

    // ─── Complexity-based routing ──────────────────────────────
    const complexityScore = this.complexityScore(complexity)

    if (complexityScore >= this.config.complexityThreshold) {
      // Complex tasks → prefer highest-quality provider
      const provider = this.selectByQuality(primaryCandidates)
      return {
        provider,
        reason: `high complexity (${complexity}) → routed to ${provider}`,
        fallbacks: this.buildFallbacks(provider, available),
        complexity,
      }
    }

    // ─── Cost-aware routing for simple tasks ───────────────────
    if (this.config.costAware && complexityScore < 0.4) {
      const cheapest = this.selectCheapest(primaryCandidates)
      return {
        provider: cheapest,
        reason: `low complexity (${complexity}) → cost-optimized to ${cheapest}`,
        fallbacks: this.buildFallbacks(cheapest, available),
        complexity,
      }
    }

    // ─── Default: prefer local/ollama, fallback to cloud ──────
    const provider = this.selectDefault(primaryCandidates)
    return {
      provider,
      reason: `standard routing → ${provider}`,
      fallbacks: this.buildFallbacks(provider, available),
      complexity,
    }
  }

  /**
   * Assess task complexity based on request characteristics.
   */
  assessComplexity(request: InferenceRequest): TaskComplexity {
    const score = this.complexityScore(this.computeComplexity(request))
    if (score < 0.25) return 'trivial'
    if (score < 0.5) return 'simple'
    if (score < 0.75) return 'moderate'
    return 'complex'
  }

  /**
   * Get health stats for a provider.
   */
  getStats(provider: InferenceProvider): ProviderStats {
    return { ...(this.stats.get(provider) ?? freshStats()) }
  }

  /**
   * Get health stats for all providers.
   */
  getAllStats(): Record<InferenceProvider, ProviderStats> {
    return {
      local: this.getStats('local'),
      cloud: this.getStats('cloud'),
      ollama: this.getStats('ollama'),
    }
  }

  /**
   * Get average latency for a provider in ms.
   */
  getAverageLatency(provider: InferenceProvider): number {
    const s = this.stats.get(provider)
    if (!s || s.totalCalls === 0) return 0
    return Math.round(s.totalLatencyMs / s.totalCalls)
  }

  /**
   * Get success rate for a provider (0-1).
   */
  getSuccessRate(provider: InferenceProvider): number {
    const s = this.stats.get(provider)
    if (!s || s.totalCalls === 0) return 1 // no data = assume healthy
    return (s.totalCalls - s.failures) / s.totalCalls
  }

  /**
   * Check if a provider is circuit-broken.
   */
  isCircuitBroken(provider: InferenceProvider): boolean {
    const s = this.stats.get(provider)
    if (!s) return false

    if (s.consecutiveFailures < this.config.circuitBreakerThreshold) return false

    // Check if cooldown has passed
    const elapsed = Date.now() - s.lastFailureAt
    if (elapsed >= this.config.circuitBreakerCooldownMs) {
      // Cooldown passed — allow a probe
      return false
    }

    return true
  }

  // ─── Private helpers ──────────────────────────────────────────

  private getAvailableProviders(): InferenceProvider[] {
    const providers: InferenceProvider[] = ['local', 'ollama', 'cloud']
    return providers.filter((p) => {
      if (!this.providerReady.get(p)) return false
      if (this.isCircuitBroken(p)) return false
      return true
    })
  }

  private computeComplexity(request: InferenceRequest): TaskComplexity {
    let score = 0

    // Task type complexity
    switch (request.type) {
      case 'classify': score += 0.1; break
      case 'embed': score += 0.1; break
      case 'plan': score += 0.5; break
      case 'generate': score += 0.4; break
    }

    // Input length complexity
    const inputLength = request.input.length
    if (inputLength > 2000) score += 0.3
    else if (inputLength > 500) score += 0.2
    else if (inputLength > 100) score += 0.1

    // Tool usage increases complexity
    if (request.tools && request.tools.length > 0) score += 0.3

    // Multi-turn conversations are more complex
    if (request.priorMessages && request.priorMessages.length > 0) score += 0.2

    // Context complexity
    if (request.context) {
      const contextSize = JSON.stringify(request.context).length
      if (contextSize > 1000) score += 0.15
    }

    // Token budget signals complexity expectation
    if (request.maxTokens && request.maxTokens > 2048) score += 0.1

    // Normalize to 0-1
    score = Math.min(score, 1)

    if (score < 0.25) return 'trivial'
    if (score < 0.5) return 'simple'
    if (score < 0.75) return 'moderate'
    return 'complex'
  }

  private complexityScore(complexity: TaskComplexity): number {
    switch (complexity) {
      case 'trivial': return 0.1
      case 'simple': return 0.35
      case 'moderate': return 0.65
      case 'complex': return 0.9
    }
  }

  private selectByQuality(available: InferenceProvider[]): InferenceProvider {
    // Quality priority: cloud > ollama > local
    if (available.includes('cloud')) return 'cloud'
    if (available.includes('ollama')) return 'ollama'
    return 'local'
  }

  private selectCheapest(available: InferenceProvider[]): InferenceProvider {
    // Cost priority: local (free) > ollama (free, local compute) > cloud (API cost)
    if (available.includes('local')) return 'local'
    if (available.includes('ollama')) return 'ollama'
    return 'cloud'
  }

  private selectDefault(available: InferenceProvider[]): InferenceProvider {
    // Default priority: ollama (good quality, free) > cloud > local
    if (available.includes('ollama')) return 'ollama'
    if (available.includes('cloud')) return 'cloud'
    return 'local'
  }

  private buildFallbacks(primary: InferenceProvider, available: InferenceProvider[]): InferenceProvider[] {
    // Quality-ordered fallback chain excluding the primary
    const order: InferenceProvider[] = ['cloud', 'ollama', 'local']
    return order.filter((p) => p !== primary && available.includes(p))
  }
}
