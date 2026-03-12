import type { AutonomyLevel } from './types.js'

export interface AgentConfig {
  agent: {
    autonomyLevel: AutonomyLevel
    maxStepsPerTask: number
    confirmIrreversible: boolean
    tickIntervalMs: number
    maxConcurrentTasks: number
  }
  inference: {
    preferLocal: boolean
    cloudProvider: string
    cloudApiKey: string
    cloudEndpoint: string
    cloudModel: string
    localModelPath: string
    localProvider: 'ollama' | 'onnx' | 'rule-based'
    ollamaEndpoint: string
    ollamaModel: string
    timeoutMs: number
    routerCircuitBreakerThreshold: number
    routerCircuitBreakerCooldownMs: number
    routerComplexityThreshold: number
    routerCostAware: boolean
  }
  memory: {
    databasePath: string
    syncEnabled: boolean
    syncIntervalSec: number
    maxEntries: number
  }
  privacy: {
    telemetryEnabled: boolean
    localInference: boolean
    piiDetection: boolean
  }
  engine: {
    port: number
    host: string
    corsOrigins: string
  }
  accessibility: {
    defaultReadingLevel: 'simple' | 'standard' | 'advanced'
    defaultCognitiveLoadLimit: 'low' | 'medium' | 'high'
    screenReaderVerbosity: 'brief' | 'normal' | 'verbose'
    contentMaxSentenceLength: number
    contentMaxParagraphSentences: number
    autoAdaptContent: boolean
  }
  general: {
    logLevel: 'debug' | 'info' | 'warn' | 'error'
    dataDir: string
  }
}

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[key]
  if (val === undefined) return fallback
  return val === 'true' || val === '1'
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key]
  if (val === undefined) return fallback
  const parsed = parseInt(val, 10)
  return isNaN(parsed) ? fallback : parsed
}

export function loadConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  const defaults: AgentConfig = {
    agent: {
      autonomyLevel: env('NEURA_AUTONOMY_LEVEL', 'L1') as AutonomyLevel,
      maxStepsPerTask: envInt('NEURA_MAX_STEPS_PER_TASK', 20),
      confirmIrreversible: true,
      tickIntervalMs: 1000,
      maxConcurrentTasks: envInt('NEURA_MAX_CONCURRENT_TASKS', 3),
    },
    inference: {
      preferLocal: envBool('NEURA_PREFER_LOCAL', true),
      cloudProvider: env('NEURA_CLOUD_PROVIDER', 'anthropic'),
      cloudApiKey: env('NEURA_CLOUD_API_KEY', ''),
      cloudEndpoint: env('NEURA_CLOUD_ENDPOINT', 'https://api.anthropic.com'),
      cloudModel: env('NEURA_CLOUD_MODEL', 'claude-sonnet-4-6'),
      localModelPath: env('NEURA_MODEL_PATH', './models'),
      localProvider: env('NEURA_LOCAL_PROVIDER', 'ollama') as 'ollama' | 'onnx' | 'rule-based',
      ollamaEndpoint: env('NEURA_OLLAMA_ENDPOINT', 'http://localhost:11434'),
      ollamaModel: env('NEURA_OLLAMA_MODEL', 'llama3.2'),
      timeoutMs: envInt('NEURA_INFERENCE_TIMEOUT', 30000),
      routerCircuitBreakerThreshold: envInt('NEURA_ROUTER_CB_THRESHOLD', 3),
      routerCircuitBreakerCooldownMs: envInt('NEURA_ROUTER_CB_COOLDOWN', 60000),
      routerComplexityThreshold: envInt('NEURA_ROUTER_COMPLEXITY_THRESHOLD', 60) / 100,
      routerCostAware: envBool('NEURA_ROUTER_COST_AWARE', true),
    },
    memory: {
      databasePath: env('NEURA_DATABASE_PATH', './data/neura.db'),
      syncEnabled: envBool('NEURA_SYNC_ENABLED', false),
      syncIntervalSec: envInt('NEURA_SYNC_INTERVAL', 300),
      maxEntries: envInt('NEURA_MAX_MEMORY_ENTRIES', 50000),
    },
    privacy: {
      telemetryEnabled: envBool('NEURA_TELEMETRY', true),
      localInference: envBool('NEURA_PREFER_LOCAL', true),
      piiDetection: true,
    },
    engine: {
      port: envInt('NEURA_ENGINE_PORT', 4100),
      host: env('NEURA_ENGINE_HOST', '0.0.0.0'),
      corsOrigins: env('NEURA_CORS_ORIGINS', '*'),
    },
    accessibility: {
      defaultReadingLevel: env('NEURA_A11Y_READING_LEVEL', 'standard') as 'simple' | 'standard' | 'advanced',
      defaultCognitiveLoadLimit: env('NEURA_A11Y_COGNITIVE_LIMIT', 'medium') as 'low' | 'medium' | 'high',
      screenReaderVerbosity: env('NEURA_A11Y_SR_VERBOSITY', 'normal') as 'brief' | 'normal' | 'verbose',
      contentMaxSentenceLength: envInt('NEURA_A11Y_MAX_SENTENCE_LEN', 20),
      contentMaxParagraphSentences: envInt('NEURA_A11Y_MAX_PARA_SENTENCES', 4),
      autoAdaptContent: envBool('NEURA_A11Y_AUTO_ADAPT', true),
    },
    general: {
      logLevel: env('NEURA_LOG_LEVEL', 'info') as AgentConfig['general']['logLevel'],
      dataDir: env('NEURA_DATA_DIR', './data'),
    },
  }

  if (!overrides) return defaults

  return deepMerge(defaults as unknown as Record<string, unknown>, overrides as unknown as Record<string, unknown>) as unknown as AgentConfig
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const sourceVal = source[key]
    const targetVal = target[key]
    if (
      sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal) &&
      targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal as Record<string, unknown>, sourceVal as Record<string, unknown>)
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal
    }
  }
  return result
}
