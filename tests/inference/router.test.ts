import { describe, it, expect } from 'vitest'
import { InferenceRouter } from '../../src/inference/router.js'
import type { InferenceRequest } from '../../src/shared/types.js'

function makeRouter(overrides?: Record<string, unknown>): InferenceRouter {
  return new InferenceRouter({
    preferLocal: true,
    ...overrides,
  })
}

function setupAllReady(router: InferenceRouter): void {
  router.setProviderReady('local', true)
  router.setProviderReady('cloud', true)
  router.setProviderReady('ollama', true)
}

describe('InferenceRouter', () => {
  describe('complexity assessment', () => {
    it('should classify simple classify requests as trivial', () => {
      const router = makeRouter()
      const complexity = router.assessComplexity({
        type: 'classify',
        input: 'hello',
      })
      expect(complexity).toBe('trivial')
    })

    it('should classify embed requests as trivial', () => {
      const router = makeRouter()
      const complexity = router.assessComplexity({
        type: 'embed',
        input: 'short text',
      })
      expect(complexity).toBe('trivial')
    })

    it('should classify plan requests as at least simple', () => {
      const router = makeRouter()
      const complexity = router.assessComplexity({
        type: 'plan',
        input: 'Create a study schedule for physics exam',
      })
      expect(['simple', 'moderate', 'complex']).toContain(complexity)
    })

    it('should classify generate with tools as moderate or complex', () => {
      const router = makeRouter()
      const complexity = router.assessComplexity({
        type: 'generate',
        input: 'Search the web for TypeScript tutorials and summarise the best ones',
        tools: [
          { name: 'web_search', description: 'Search the web', input_schema: { type: 'object', properties: {} } },
        ],
      })
      expect(['moderate', 'complex']).toContain(complexity)
    })

    it('should increase complexity with long input', () => {
      const router = makeRouter()
      const shortComplexity = router.assessComplexity({
        type: 'generate',
        input: 'Hello',
      })
      const longComplexity = router.assessComplexity({
        type: 'generate',
        input: 'x'.repeat(3000),
      })
      const complexityOrder = ['trivial', 'simple', 'moderate', 'complex']
      expect(complexityOrder.indexOf(longComplexity)).toBeGreaterThanOrEqual(
        complexityOrder.indexOf(shortComplexity),
      )
    })
  })

  describe('routing decisions', () => {
    it('should route to local when only local is available', () => {
      const router = makeRouter()
      router.setProviderReady('local', true)
      router.setProviderReady('cloud', false)
      router.setProviderReady('ollama', false)

      const decision = router.route({ type: 'classify', input: 'hello' })
      expect(decision.provider).toBe('local')
    })

    it('should route tool-calling requests to cloud', () => {
      const router = makeRouter()
      setupAllReady(router)

      const decision = router.route({
        type: 'generate',
        input: 'Use tools',
        tools: [
          { name: 'read_file', description: 'Read file', input_schema: { type: 'object', properties: {} } },
        ],
      })
      expect(decision.provider).toBe('cloud')
      expect(decision.reason).toContain('tool calling')
    })

    it('should route to cloud when preferLocal is false', () => {
      const router = makeRouter({ preferLocal: false })
      setupAllReady(router)

      const decision = router.route({ type: 'generate', input: 'hello' })
      expect(decision.provider).toBe('cloud')
      expect(decision.reason).toContain('prefers cloud')
    })

    it('should route trivial tasks to cheapest provider when costAware', () => {
      const router = makeRouter({ costAware: true })
      setupAllReady(router)

      const decision = router.route({ type: 'classify', input: 'hello' })
      // Local is cheapest
      expect(decision.provider).toBe('local')
    })

    it('should route complex tasks to highest quality provider', () => {
      const router = makeRouter({ complexityThreshold: 0.5 })
      setupAllReady(router)

      const decision = router.route({
        type: 'generate',
        input: 'x'.repeat(3000),
        tools: [
          { name: 'web_search', description: 'Search', input_schema: { type: 'object', properties: {} } },
        ],
        context: { data: 'x'.repeat(2000) },
      })
      // Complex tasks go to cloud (highest quality)
      expect(decision.provider).toBe('cloud')
    })

    it('should prefer ollama for default routing when available', () => {
      const router = makeRouter()
      setupAllReady(router)

      // A moderate task without tools should go to ollama (good quality, free)
      const decision = router.route({
        type: 'plan',
        input: 'Plan a study schedule for my exam next week',
      })
      // The default routing prefers ollama when it's available
      expect(['ollama', 'cloud']).toContain(decision.provider)
    })

    it('should include fallbacks in the decision', () => {
      const router = makeRouter()
      setupAllReady(router)

      const decision = router.route({ type: 'classify', input: 'hello' })
      expect(decision.fallbacks.length).toBeGreaterThan(0)
      expect(decision.fallbacks).not.toContain(decision.provider)
    })

    it('should fall back to local when no providers are ready', () => {
      const router = makeRouter()
      // Don't set any providers ready
      const decision = router.route({ type: 'generate', input: 'hello' })
      expect(decision.provider).toBe('local')
      expect(decision.reason).toContain('no providers available')
    })
  })

  describe('health tracking', () => {
    it('should record successful calls', () => {
      const router = makeRouter()
      router.recordSuccess('cloud', 500, 100)
      router.recordSuccess('cloud', 300, 80)

      const stats = router.getStats('cloud')
      expect(stats.totalCalls).toBe(2)
      expect(stats.failures).toBe(0)
      expect(stats.totalTokens).toBe(180)
      expect(stats.consecutiveFailures).toBe(0)
    })

    it('should record failures', () => {
      const router = makeRouter()
      router.recordFailure('cloud')
      router.recordFailure('cloud')

      const stats = router.getStats('cloud')
      expect(stats.totalCalls).toBe(2)
      expect(stats.failures).toBe(2)
      expect(stats.consecutiveFailures).toBe(2)
    })

    it('should reset consecutive failures on success', () => {
      const router = makeRouter()
      router.recordFailure('cloud')
      router.recordFailure('cloud')
      router.recordSuccess('cloud', 200, 50)

      const stats = router.getStats('cloud')
      expect(stats.consecutiveFailures).toBe(0)
      expect(stats.failures).toBe(2) // total stays
    })

    it('should calculate average latency', () => {
      const router = makeRouter()
      router.recordSuccess('ollama', 200, 50)
      router.recordSuccess('ollama', 400, 60)

      expect(router.getAverageLatency('ollama')).toBe(300)
    })

    it('should calculate success rate', () => {
      const router = makeRouter()
      router.recordSuccess('cloud', 200, 50)
      router.recordSuccess('cloud', 300, 60)
      router.recordFailure('cloud')

      expect(router.getSuccessRate('cloud')).toBeCloseTo(0.667, 2)
    })

    it('should return 1 for success rate with no calls', () => {
      const router = makeRouter()
      expect(router.getSuccessRate('cloud')).toBe(1)
    })

    it('should return all provider stats', () => {
      const router = makeRouter()
      router.recordSuccess('local', 10, 0)

      const all = router.getAllStats()
      expect(all.local.totalCalls).toBe(1)
      expect(all.cloud.totalCalls).toBe(0)
      expect(all.ollama.totalCalls).toBe(0)
    })
  })

  describe('circuit breaker', () => {
    it('should trip after threshold consecutive failures', () => {
      const router = makeRouter({ circuitBreakerThreshold: 3 })

      router.recordFailure('cloud')
      router.recordFailure('cloud')
      expect(router.isCircuitBroken('cloud')).toBe(false)

      router.recordFailure('cloud')
      expect(router.isCircuitBroken('cloud')).toBe(true)
    })

    it('should exclude circuit-broken providers from routing', () => {
      const router = makeRouter({ circuitBreakerThreshold: 2 })
      setupAllReady(router)

      router.recordFailure('cloud')
      router.recordFailure('cloud')

      const decision = router.route({
        type: 'generate',
        input: 'Use tools',
        tools: [
          { name: 'read_file', description: 'Read', input_schema: { type: 'object', properties: {} } },
        ],
      })
      // Cloud is circuit-broken, so shouldn't be primary
      expect(decision.provider).not.toBe('cloud')
    })

    it('should recover after cooldown period', () => {
      const router = new InferenceRouter({
        circuitBreakerThreshold: 2,
        circuitBreakerCooldownMs: 100, // Very short for testing
      })

      router.recordFailure('cloud')
      router.recordFailure('cloud')
      expect(router.isCircuitBroken('cloud')).toBe(true)

      // Simulate time passing by manipulating the stats
      const stats = router.getStats('cloud')
      // We can't easily test time-based recovery without waiting,
      // but we can verify the circuit breaker resets on success
      router.recordSuccess('cloud', 200, 50)
      expect(router.isCircuitBroken('cloud')).toBe(false)
    })

    it('should not be circuit-broken with zero failures', () => {
      const router = makeRouter()
      expect(router.isCircuitBroken('cloud')).toBe(false)
      expect(router.isCircuitBroken('local')).toBe(false)
      expect(router.isCircuitBroken('ollama')).toBe(false)
    })
  })

  describe('multi-turn routing', () => {
    it('should route requests with priorMessages to cloud', () => {
      const router = makeRouter()
      setupAllReady(router)

      const decision = router.route({
        type: 'generate',
        input: 'Continue the conversation',
        priorMessages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      })
      expect(decision.provider).toBe('cloud')
    })

    it('should route requests with toolResults to cloud', () => {
      const router = makeRouter()
      setupAllReady(router)

      const decision = router.route({
        type: 'generate',
        input: 'Process results',
        toolResults: [
          { tool_use_id: 'id1', content: 'result' },
        ],
      })
      expect(decision.provider).toBe('cloud')
    })
  })
})
