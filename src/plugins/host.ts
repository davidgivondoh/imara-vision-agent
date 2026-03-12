import { createLogger } from '../shared/logger.js'
import type { PluginManifest, PluginPermission, PluginStatus } from '../shared/types.js'

const log = createLogger('plugins')

export interface PluginContext {
  memory: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
  }
  log: {
    info(message: string): void
    warn(message: string): void
    error(message: string): void
  }
  config: Record<string, unknown>
}

export interface PluginDefinition {
  name: string
  version: string
  capabilities: string[]
  onInit?(context: PluginContext): Promise<void>
  onTask?(context: PluginContext, task: { intent: string; input: string; context: Record<string, unknown> }): Promise<Record<string, unknown> | null>
  onDestroy?(context: PluginContext): Promise<void>
}

interface PluginInstance {
  manifest: PluginManifest
  definition: PluginDefinition
  status: PluginStatus
  context: PluginContext
}

export class PluginHost {
  private plugins = new Map<string, PluginInstance>()
  private pluginMemory = new Map<string, Map<string, unknown>>()

  async register(definition: PluginDefinition, manifest?: PluginManifest): Promise<void> {
    const resolvedManifest: PluginManifest = manifest ?? {
      name: definition.name,
      version: definition.version,
      description: '',
      author: 'unknown',
      capabilities: definition.capabilities,
      permissions: [],
    }

    const context = this.createContext(definition.name)

    const instance: PluginInstance = {
      manifest: resolvedManifest,
      definition,
      status: 'installed',
      context,
    }

    this.plugins.set(definition.name, instance)
    log.info(`Plugin registered: ${definition.name} v${definition.version}`)

    // Auto-initialize
    try {
      if (definition.onInit) {
        await definition.onInit(context)
      }
      instance.status = 'active'
      log.info(`Plugin active: ${definition.name}`)
    } catch (err) {
      instance.status = 'error'
      log.error(`Plugin init failed: ${definition.name}`, {
        error: err instanceof Error ? err.message : 'Unknown',
      })
    }
  }

  async unregister(name: string): Promise<void> {
    const instance = this.plugins.get(name)
    if (!instance) return

    try {
      if (instance.definition.onDestroy) {
        await instance.definition.onDestroy(instance.context)
      }
    } catch (err) {
      log.warn(`Plugin destroy error: ${name}`, {
        error: err instanceof Error ? err.message : 'Unknown',
      })
    }

    this.plugins.delete(name)
    this.pluginMemory.delete(name)
    log.info(`Plugin unregistered: ${name}`)
  }

  async routeTask(intent: string, input: string, context: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    for (const [name, instance] of this.plugins) {
      if (instance.status !== 'active' || !instance.definition.onTask) continue

      try {
        const result = await instance.definition.onTask(instance.context, { intent, input, context })
        if (result !== null) {
          log.debug(`Plugin "${name}" handled task: ${intent}`)
          return result
        }
      } catch (err) {
        log.error(`Plugin "${name}" task error`, {
          error: err instanceof Error ? err.message : 'Unknown',
        })
      }
    }

    return null
  }

  list(): Array<{ name: string; version: string; status: PluginStatus; capabilities: string[] }> {
    return Array.from(this.plugins.values()).map((p) => ({
      name: p.manifest.name,
      version: p.manifest.version,
      status: p.status,
      capabilities: p.manifest.capabilities,
    }))
  }

  get(name: string): PluginInstance | undefined {
    return this.plugins.get(name)
  }

  get count(): number {
    return this.plugins.size
  }

  private createContext(pluginName: string): PluginContext {
    if (!this.pluginMemory.has(pluginName)) {
      this.pluginMemory.set(pluginName, new Map())
    }
    const mem = this.pluginMemory.get(pluginName)!

    return {
      memory: {
        async get(key: string) {
          return mem.get(key) ?? null
        },
        async set(key: string, value: unknown) {
          mem.set(key, value)
        },
        async delete(key: string) {
          mem.delete(key)
        },
      },
      log: {
        info: (msg: string) => log.info(`[plugin:${pluginName}] ${msg}`),
        warn: (msg: string) => log.warn(`[plugin:${pluginName}] ${msg}`),
        error: (msg: string) => log.error(`[plugin:${pluginName}] ${msg}`),
      },
      config: {},
    }
  }
}
