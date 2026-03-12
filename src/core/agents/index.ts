// ─── Multi-Agent System Exports ─────────────────────────────────

export { Supervisor } from './supervisor.js'
export type { SupervisorDeps, SupervisorResult } from './supervisor.js'

export { PlannerAgent } from './planner.js'
export type { PlannerConfig } from './planner.js'

export { ResearchAgent } from './research.js'
export { BrowserAgent } from './browser-agent.js'
export { DesktopAgent } from './desktop-agent.js'
export { CodeAgent } from './code-agent.js'
export { MemoryAgent } from './memory-agent.js'
export { VerificationAgent } from './verification.js'

export type {
  AgentRole,
  TaskGraph,
  TaskNode,
  TaskNodeStatus,
  SharedState,
  AgentMessage,
  AgentResult,
  AgentEmitFn,
  SpecialistAgent,
  VerificationResult,
  VerificationCriteria,
  ExecutionLimits,
  SupervisorConfig,
  MessageType,
} from './types.js'

export {
  DEFAULT_EXECUTION_LIMITS,
  DEFAULT_SUPERVISOR_CONFIG,
} from './types.js'
