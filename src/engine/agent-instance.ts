import { EventBus } from '../shared/events.js'
import { loadConfig, type AgentConfig } from '../shared/config.js'
import { createLogger } from '../shared/logger.js'
import { AgentLoop } from '../core/agent-loop.js'
import { Scheduler } from '../core/scheduler.js'
import { MemoryStore } from '../core/memory.js'
import { PolicyEngine } from '../core/policy.js'
import { Telemetry } from '../core/telemetry.js'
import { InferenceLayer } from '../inference/index.js'
import { PluginHost, builtinPlugins } from '../plugins/index.js'
import { ToolRegistry, filesystemTools, browserTools, browserInteractTools, desktopTools, codeTools, visionTools, closeBrowserManager } from '../tools/index.js'
import { AccessibilityManager } from '../core/accessibility.js'
import { Supervisor } from '../core/agents/index.js'
import type { ProductId } from '../shared/types.js'

const log = createLogger('agent-instance')

export class AgentInstance {
  readonly bus: EventBus
  readonly config: AgentConfig
  readonly telemetry: Telemetry
  readonly memory: MemoryStore
  readonly policy: PolicyEngine
  readonly scheduler: Scheduler
  readonly inference: InferenceLayer
  readonly plugins: PluginHost
  readonly tools: ToolRegistry
  readonly accessibility: AccessibilityManager
  readonly loop: AgentLoop
  readonly supervisor: Supervisor

  private startedAt: Date | null = null

  constructor(options?: { product?: ProductId; configOverrides?: Partial<AgentConfig> }) {
    this.config = loadConfig(options?.configOverrides)
    this.bus = new EventBus()

    this.telemetry = new Telemetry({
      product: options?.product ?? 'engine',
      enabled: this.config.privacy.telemetryEnabled,
      bus: this.bus,
    })

    this.memory = new MemoryStore({
      maxEntries: this.config.memory.maxEntries,
    })

    this.policy = new PolicyEngine({
      telemetry: this.telemetry,
    })

    this.scheduler = new Scheduler({
      maxConcurrent: this.config.agent.maxConcurrentTasks,
      defaultConstraints: {
        maxSteps: this.config.agent.maxStepsPerTask,
        requireConfirmation: false,
      },
      bus: this.bus,
      telemetry: this.telemetry,
    })

    this.inference = new InferenceLayer({
      preferLocal: this.config.inference.preferLocal,
      localModelPath: this.config.inference.localModelPath,
      localProvider: this.config.inference.localProvider,
      ollamaEndpoint: this.config.inference.ollamaEndpoint,
      ollamaModel: this.config.inference.ollamaModel,
      cloudApiKey: this.config.inference.cloudApiKey,
      cloudEndpoint: this.config.inference.cloudEndpoint,
      cloudProvider: this.config.inference.cloudProvider,
      cloudModel: this.config.inference.cloudModel,
      timeoutMs: this.config.inference.timeoutMs,
      telemetry: this.telemetry,
      routerConfig: {
        circuitBreakerThreshold: this.config.inference.routerCircuitBreakerThreshold,
        circuitBreakerCooldownMs: this.config.inference.routerCircuitBreakerCooldownMs,
        complexityThreshold: this.config.inference.routerComplexityThreshold,
        costAware: this.config.inference.routerCostAware,
      },
    })

    this.accessibility = new AccessibilityManager({
      telemetry: this.telemetry,
      config: {
        defaultReadingLevel: this.config.accessibility.defaultReadingLevel,
        defaultCognitiveLoadLimit: this.config.accessibility.defaultCognitiveLoadLimit,
        screenReaderVerbosity: this.config.accessibility.screenReaderVerbosity,
        contentMaxSentenceLength: this.config.accessibility.contentMaxSentenceLength,
        contentMaxParagraphSentences: this.config.accessibility.contentMaxParagraphSentences,
        defaultOutputModalities: ['text'],
      },
    })

    this.plugins = new PluginHost()

    this.tools = new ToolRegistry()
    const allTools = [
      ...filesystemTools,
      ...browserTools,
      ...browserInteractTools,
      ...desktopTools,
      ...codeTools,
      ...visionTools,
    ]
    for (const tool of allTools) {
      this.tools.register(tool)
    }

    this.loop = new AgentLoop({
      scheduler: this.scheduler,
      memory: this.memory,
      policy: this.policy,
      inference: this.inference,
      tools: this.tools,
      telemetry: this.telemetry,
      bus: this.bus,
      config: {
        autonomyLevel: this.config.agent.autonomyLevel,
        maxStepsPerTask: this.config.agent.maxStepsPerTask,
        confirmIrreversible: this.config.agent.confirmIrreversible,
      },
      accessibility: this.accessibility,
    })

    this.supervisor = new Supervisor({
      inference: this.inference,
      tools: this.tools,
      memory: this.memory,
      telemetry: this.telemetry,
      bus: this.bus,
    })
  }

  async start(): Promise<void> {
    log.info('Starting agent instance...')
    this.startedAt = new Date()

    // Initialize inference
    await this.inference.initialize()

    // Load built-in plugins
    for (const plugin of builtinPlugins) {
      await this.plugins.register(plugin)
    }

    log.info('Agent instance started', {
      autonomy: this.config.agent.autonomyLevel,
      inference: this.inference.getStatus(),
      plugins: this.plugins.count,
      memory: this.memory.size,
    })
  }

  async stop(options?: { clearMemory?: boolean }): Promise<void> {
    log.info('Stopping agent instance...')
    this.bus.removeAll()
    await closeBrowserManager()
    if (options?.clearMemory) {
      await this.memory.clear()
    }
    this.startedAt = null
    log.info('Agent instance stopped')
  }

  get uptime(): number {
    if (!this.startedAt) return 0
    return Math.floor((Date.now() - this.startedAt.getTime()) / 1000)
  }

  get isRunning(): boolean {
    return this.startedAt !== null
  }

  health(): Record<string, unknown> {
    const inf = this.inference.getStatus()
    return {
      status: this.isRunning ? 'healthy' : 'stopped',
      version: '0.1.0',
      uptime: this.uptime,
      inference: inf.activeProvider,
      inferenceLocal: inf.local,
      inferenceCloud: inf.cloud,
      inferenceOllama: inf.ollama,
      ollamaModel: inf.ollamaModel,
      cloudModel: inf.cloudModel,
      memory: this.memory.size,
      plugins: this.plugins.count,
      tools: this.tools.count,
      tasks: this.scheduler.stats,
      accessibility: this.accessibility.stats,
      agents: this.supervisor.registeredAgents,
    }
  }
}
