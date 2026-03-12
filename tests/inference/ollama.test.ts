import { describe, it, expect, beforeEach } from 'vitest'
import { OllamaInference } from '../../src/inference/ollama.js'
import { InferenceLayer } from '../../src/inference/index.js'
import { Telemetry } from '../../src/core/telemetry.js'
import { EventBus } from '../../src/shared/events.js'

describe('OllamaInference', () => {
  let ollama: OllamaInference

  beforeEach(() => {
    ollama = new OllamaInference({
      endpoint: 'http://localhost:11434',
      model: 'llama3.2',
      timeoutMs: 30000,
    })
  })

  it('should start in not-ready state', () => {
    expect(ollama.isReady()).toBe(false)
  })

  it('should report model name', () => {
    expect(ollama.getModel()).toBe('llama3.2')
  })

  it('should throw when running without initialization', async () => {
    await expect(
      ollama.run({ type: 'generate', input: 'hello' }),
    ).rejects.toThrow('Ollama inference not available')
  })

  it('should gracefully handle connection failure during init', async () => {
    const badOllama = new OllamaInference({
      endpoint: 'http://localhost:59999',
      model: 'nonexistent',
      timeoutMs: 2000,
    })

    const result = await badOllama.initialize()
    expect(result).toBe(false)
    expect(badOllama.isReady()).toBe(false)
  })
})

describe('InferenceLayer with Ollama config', () => {
  it('should initialize with ollama provider setting', async () => {
    const bus = new EventBus()
    const telemetry = new Telemetry({ product: 'engine', enabled: false, bus })

    const layer = new InferenceLayer({
      preferLocal: true,
      localModelPath: './models',
      localProvider: 'ollama',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'llama3.2',
      cloudApiKey: '',
      cloudEndpoint: '',
      cloudProvider: 'anthropic',
      cloudModel: 'claude-sonnet-4-20250514',
      timeoutMs: 5000,
      telemetry,
    })

    await layer.initialize()

    const status = layer.getStatus()
    expect(status.local).toBe(true) // rule-based always ready
    expect(status.preferred).toBe('local')
    // ollama may or may not be ready depending on whether it's running
    expect(typeof status.ollama).toBe('boolean')
    expect(typeof status.ollamaModel).toBe('string')
    expect(typeof status.activeProvider).toBe('string')
  })

  it('should fall back to rule-based when Ollama is not running', async () => {
    const bus = new EventBus()
    const telemetry = new Telemetry({ product: 'engine', enabled: false, bus })

    const layer = new InferenceLayer({
      preferLocal: true,
      localModelPath: './models',
      localProvider: 'ollama',
      ollamaEndpoint: 'http://localhost:59999', // definitely not running
      ollamaModel: 'nonexistent',
      cloudApiKey: '',
      cloudEndpoint: '',
      cloudProvider: 'anthropic',
      cloudModel: 'claude-sonnet-4-20250514',
      timeoutMs: 2000,
      telemetry,
    })

    await layer.initialize()

    // Should still work — falls back to rule-based local
    const result = await layer.run({
      type: 'generate',
      input: 'Summarise photosynthesis',
    })

    expect(result.provider).toBe('local')
    expect(result.output).toBeTruthy()
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('should initialize with rule-based provider setting', async () => {
    const bus = new EventBus()
    const telemetry = new Telemetry({ product: 'engine', enabled: false, bus })

    const layer = new InferenceLayer({
      preferLocal: true,
      localModelPath: './models',
      localProvider: 'rule-based',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'llama3.2',
      cloudApiKey: '',
      cloudEndpoint: '',
      cloudProvider: 'anthropic',
      cloudModel: 'claude-sonnet-4-20250514',
      timeoutMs: 5000,
      telemetry,
    })

    await layer.initialize()

    const status = layer.getStatus()
    expect(status.local).toBe(true)
    expect(status.ollama).toBe(false) // not initialized when provider is rule-based
    expect(status.activeProvider).toBe('rule-based')
  })

  it('should report status correctly in health check format', async () => {
    const bus = new EventBus()
    const telemetry = new Telemetry({ product: 'engine', enabled: false, bus })

    const layer = new InferenceLayer({
      preferLocal: true,
      localModelPath: './models',
      localProvider: 'ollama',
      ollamaEndpoint: 'http://localhost:59999',
      ollamaModel: 'llama3.2',
      cloudApiKey: '',
      cloudEndpoint: '',
      cloudProvider: 'anthropic',
      cloudModel: 'claude-sonnet-4-20250514',
      timeoutMs: 2000,
      telemetry,
    })

    await layer.initialize()

    const status = layer.getStatus()
    expect(status).toHaveProperty('local')
    expect(status).toHaveProperty('cloud')
    expect(status).toHaveProperty('ollama')
    expect(status).toHaveProperty('ollamaModel')
    expect(status).toHaveProperty('preferred')
    expect(status).toHaveProperty('activeProvider')
  })
})
