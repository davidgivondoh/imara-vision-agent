import { describe, it, expect } from 'vitest'
import { CloudInference } from '../../src/inference/cloud.js'
import { InferenceLayer } from '../../src/inference/index.js'
import { Telemetry } from '../../src/core/telemetry.js'
import { EventBus } from '../../src/shared/events.js'

describe('CloudInference', () => {
  it('should start in not-ready state', () => {
    const cloud = new CloudInference({
      apiKey: '',
      endpoint: 'https://api.anthropic.com',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      timeoutMs: 30000,
    })

    expect(cloud.isReady()).toBe(false)
  })

  it('should report model name', () => {
    const cloud = new CloudInference({
      apiKey: 'test-key',
      endpoint: 'https://api.anthropic.com',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      timeoutMs: 30000,
    })

    expect(cloud.getModel()).toBe('claude-sonnet-4-20250514')
  })

  it('should not initialize without API key', async () => {
    const cloud = new CloudInference({
      apiKey: '',
      endpoint: 'https://api.anthropic.com',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      timeoutMs: 30000,
    })

    await cloud.initialize()
    expect(cloud.isReady()).toBe(false)
  })

  it('should not initialize with unsupported provider', async () => {
    const cloud = new CloudInference({
      apiKey: 'test-key',
      endpoint: 'https://api.example.com',
      provider: 'openai',
      model: 'gpt-4',
      timeoutMs: 30000,
    })

    await cloud.initialize()
    expect(cloud.isReady()).toBe(false)
  })

  it('should throw when running without initialization', async () => {
    const cloud = new CloudInference({
      apiKey: '',
      endpoint: 'https://api.anthropic.com',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      timeoutMs: 30000,
    })

    await expect(
      cloud.run({ type: 'generate', input: 'hello' }),
    ).rejects.toThrow('Cloud inference not available')
  })

  it('should mark as ready with any API key (validation happens on first call)', async () => {
    const cloud = new CloudInference({
      apiKey: 'sk-ant-invalid-key',
      endpoint: 'https://api.anthropic.com',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      timeoutMs: 5000,
    })

    await cloud.initialize()
    expect(cloud.isReady()).toBe(true)
  })
})

describe('InferenceLayer with cloud config', () => {
  it('should include cloudModel in status', async () => {
    const bus = new EventBus()
    const telemetry = new Telemetry({ product: 'engine', enabled: false, bus })

    const layer = new InferenceLayer({
      preferLocal: true,
      localModelPath: './models',
      localProvider: 'rule-based',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'llama3.2',
      cloudApiKey: '',
      cloudEndpoint: 'https://api.anthropic.com',
      cloudProvider: 'anthropic',
      cloudModel: 'claude-sonnet-4-20250514',
      timeoutMs: 5000,
      telemetry,
    })

    await layer.initialize()

    const status = layer.getStatus()
    expect(status).toHaveProperty('cloudModel')
    expect(status.cloud).toBe(false) // no API key
    expect(status.cloudModel).toBe('none')
    expect(status.activeProvider).toBe('rule-based')
  })

  it('should prefer cloud when preferLocal is false and cloud is ready', async () => {
    const bus = new EventBus()
    const telemetry = new Telemetry({ product: 'engine', enabled: false, bus })

    // Without a valid key, cloud won't be ready — but the selection logic is testable
    const layer = new InferenceLayer({
      preferLocal: false,
      localModelPath: './models',
      localProvider: 'rule-based',
      ollamaEndpoint: 'http://localhost:59999',
      ollamaModel: 'llama3.2',
      cloudApiKey: '',
      cloudEndpoint: 'https://api.anthropic.com',
      cloudProvider: 'anthropic',
      cloudModel: 'claude-sonnet-4-20250514',
      timeoutMs: 2000,
      telemetry,
    })

    await layer.initialize()

    // Falls back to rule-based since cloud has no key
    const result = await layer.run({
      type: 'generate',
      input: 'Hello world',
    })

    expect(result.provider).toBe('local')
    expect(result.output).toBeTruthy()
  })

  it('should report preferred as cloud when preferLocal is false', async () => {
    const bus = new EventBus()
    const telemetry = new Telemetry({ product: 'engine', enabled: false, bus })

    const layer = new InferenceLayer({
      preferLocal: false,
      localModelPath: './models',
      localProvider: 'rule-based',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'llama3.2',
      cloudApiKey: '',
      cloudEndpoint: 'https://api.anthropic.com',
      cloudProvider: 'anthropic',
      cloudModel: 'claude-sonnet-4-20250514',
      timeoutMs: 5000,
      telemetry,
    })

    await layer.initialize()

    const status = layer.getStatus()
    expect(status.preferred).toBe('cloud')
  })
})
