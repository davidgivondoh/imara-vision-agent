// ─── Multi-Agent Type System ────────────────────────────────────
// Shared types for all specialist agents in the Imara multi-agent architecture.
// Follows the Planner → Executor → Verifier pattern from IMARA-AGENT-SPEC.md

import type { TaskResult, InferenceProvider } from '../../shared/types.js'

// ─── Agent Roles ───────────────────────────────────────────────

export type AgentRole =
  | 'supervisor'
  | 'planner'
  | 'research'
  | 'browser'
  | 'desktop'
  | 'code'
  | 'memory'
  | 'verification'

// ─── Task Graph ────────────────────────────────────────────────

export type TaskNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface TaskNode {
  id: string
  instruction: string
  assignedAgent: AgentRole
  dependsOn: string[]
  status: TaskNodeStatus
  result?: AgentMessage
  retryCount: number
  maxRetries: number
  timeoutMs: number
}

export interface TaskGraph {
  id: string
  goal: string
  nodes: TaskNode[]
  strategy: 'sequential' | 'parallel' | 'mixed'
  createdAt: string
}

// ─── Agent Messages ────────────────────────────────────────────
// All inter-agent communication goes through these message types.

export type MessageType =
  | 'task_request'
  | 'task_result'
  | 'verification_request'
  | 'verification_result'
  | 'status_update'
  | 'escalation'

export interface AgentMessage {
  id: string
  from: AgentRole
  to: AgentRole
  type: MessageType
  taskNodeId?: string
  payload: Record<string, unknown>
  timestamp: string
}

// ─── Shared State ──────────────────────────────────────────────
// The Supervisor manages this state object. Agents read/write through the Supervisor.

export interface SharedState {
  taskGraph: TaskGraph | null
  currentNodeId: string | null
  history: AgentMessage[]
  toolOutputs: Record<string, unknown>
  errorLog: Array<{ nodeId: string; error: string; timestamp: string }>
  userContext: Record<string, unknown>
  memoryContext: string
}

// ─── Specialist Agent Interface ────────────────────────────────
// Every specialist agent implements this contract.

export interface SpecialistAgent {
  readonly role: AgentRole
  readonly description: string
  readonly toolNames: string[]

  execute(
    node: TaskNode,
    state: SharedState,
    emit: AgentEmitFn,
  ): Promise<AgentResult>
}

export interface AgentResult {
  success: boolean
  output: string
  data?: Record<string, unknown>
  confidence: number
  toolsUsed: string[]
  durationMs: number
}

export type AgentEmitFn = (event: string, data: Record<string, unknown>) => void

// ─── Execution Limits (from spec §6.2) ─────────────────────────

export interface ExecutionLimits {
  maxSearchQueriesPerStep: number
  maxNavigationsPerStep: number
  maxPageReadsPerStep: number
  maxTotalActions: number
  maxRetriesPerStep: number
  stepTimeoutMs: number
}

export const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = {
  maxSearchQueriesPerStep: 3,
  maxNavigationsPerStep: 3,
  maxPageReadsPerStep: 3,
  maxTotalActions: 10,
  maxRetriesPerStep: 2,
  stepTimeoutMs: 120_000,
}

// ─── Verification ──────────────────────────────────────────────

export interface VerificationCriteria {
  matchesIntent: boolean
  outputComplete: boolean
  noHallucination: boolean
  fieldsPresent: string[]
}

export interface VerificationResult {
  passed: boolean
  criteria: VerificationCriteria
  feedback: string
  shouldRetry: boolean
}

// ─── Supervisor Config ─────────────────────────────────────────

export interface SupervisorConfig {
  limits: ExecutionLimits
  confirmDestructive: boolean
  maxPlanRetries: number
  streamTokens: boolean
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  limits: DEFAULT_EXECUTION_LIMITS,
  confirmDestructive: true,
  maxPlanRetries: 2,
  streamTokens: true,
}
