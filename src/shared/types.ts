// ─── Autonomy Levels ────────────────────────────────────────────
export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'

// ─── Roles ──────────────────────────────────────────────────────
export type UserRole =
  | 'student'
  | 'teacher'
  | 'admin'
  | 'independent_living_user'
  | 'carer'

// ─── Agent Loop Stages ──────────────────────────────────────────
export type AgentStageType =
  | 'sense'
  | 'interpret'
  | 'plan'
  | 'act'
  | 'verify'
  | 'adapt'

// ─── Task ───────────────────────────────────────────────────────
export type TaskStatus =
  | 'created'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'awaiting_confirmation'

export interface TaskConstraints {
  maxSteps: number
  requireConfirmation: boolean
  timeout?: number
  autonomyLevel?: AutonomyLevel
}

export interface AgentTask {
  id: string
  instruction: string
  context: Record<string, unknown>
  constraints: TaskConstraints
  status: TaskStatus
  steps: AgentStep[]
  result?: TaskResult
  createdAt: string
  completedAt?: string
}

export interface AgentStep {
  id: string
  type: AgentStageType
  description: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  durationMs: number
  timestamp: string
}

export interface TaskResult {
  success: boolean
  summary: string
  outputs: Record<string, unknown>
  stepsCompleted: number
  durationMs: number
  confidence: number
}

// ─── Recommendations ────────────────────────────────────────────
export type RecommendationType =
  | 'study_plan'
  | 'quiz_set'
  | 'concept_clarification'
  | 'teacher_intervention'
  | 'policy_notice'
  | 'daily_living_action'
  | 'communication_assist'
  | 'environment_navigation'

export type ActionType =
  | 'navigate'
  | 'generate'
  | 'assign'
  | 'review'
  | 'communicate'
  | 'adapt_ui'

export interface RecommendationAction {
  label: string
  actionType: ActionType
  payload: Record<string, unknown>
}

export interface Recommendation {
  id: string
  role: UserRole
  type: RecommendationType
  title: string
  summary: string
  actions: RecommendationAction[]
  confidence: number
  rationale: string[]
  inputsUsed: string[]
  createdAt: string
  expiresAt?: string
}

// ─── Policy ─────────────────────────────────────────────────────
export type PolicyReasonCode =
  | 'ok'
  | 'missing_consent'
  | 'insufficient_role'
  | 'restricted_context'
  | 'data_retention_block'
  | 'autonomy_exceeded'

export interface PolicyEvaluation {
  allowed: boolean
  reasonCode: PolicyReasonCode
  message: string
  requiredApprovals?: string[]
}

// ─── Memory ─────────────────────────────────────────────────────
export type MemoryType =
  | 'preference'
  | 'correction'
  | 'context'
  | 'fact'
  | 'routine'

export type MemoryScope = 'user' | 'session' | 'task'

export interface MemoryEntry {
  id: string
  type: MemoryType
  key: string
  value: string
  scope: MemoryScope
  embedding?: number[]
  createdAt: string
  updatedAt: string
  expiresAt?: string
}

// ─── Feedback ───────────────────────────────────────────────────
export type FeedbackSentiment = 'helpful' | 'not_helpful' | 'edited'

export interface RecommendationFeedback {
  recommendationId: string
  userId: string
  sentiment: FeedbackSentiment
  comment?: string
  completed?: boolean
  submittedAt: string
}

// ─── Telemetry ──────────────────────────────────────────────────
export type ProductId =
  | 'desktop'
  | 'engine'
  | 'pen'
  | 'overlay'
  | 'imara-plus'
  | 'neura-standalone'

export interface TelemetryEvent {
  eventName: string
  timestamp: string
  sessionId: string
  taskId?: string
  properties: Record<string, unknown>
  product?: ProductId
}

// ─── Inference ──────────────────────────────────────────────────
export type InferenceProvider = 'local' | 'cloud' | 'ollama'

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface ToolUseRequest {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolUseResult {
  tool_use_id: string
  content: string
  is_error?: boolean
}

export interface InferenceRequest {
  type: 'classify' | 'embed' | 'generate' | 'plan'
  input: string
  context?: Record<string, unknown>
  maxTokens?: number
  tools?: ToolDefinition[]
  toolResults?: ToolUseResult[]
  priorMessages?: Array<{ role: 'user' | 'assistant'; content: unknown }>
}

export interface InferenceResult {
  provider: InferenceProvider
  output: string
  confidence: number
  durationMs: number
  tokenCount?: number
  toolCalls?: ToolUseRequest[]
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens'
}

export type TokenCallback = (token: string) => void

// ─── Plugin ─────────────────────────────────────────────────────
export interface PluginManifest {
  name: string
  version: string
  description: string
  author: string
  capabilities: string[]
  permissions: PluginPermission[]
  minAgentVersion?: string
  entryPoint?: string
}

export type PluginPermission = 'network' | 'storage' | 'filesystem' | 'notifications'

export type PluginStatus = 'installed' | 'active' | 'disabled' | 'error'

// ─── Product Adapter ────────────────────────────────────────────
export interface SensorDescriptor {
  id: string
  type: string
  name: string
  unit?: string
}

export interface SensorReading {
  sensorId: string
  value: unknown
  timestamp: string
}

export interface AgentAction {
  id: string
  type: ActionType
  label: string
  payload: Record<string, unknown>
  reversible: boolean
  requiresConfirmation: boolean
}

export interface ActionResult {
  actionId: string
  success: boolean
  output: Record<string, unknown>
  durationMs: number
}

// ─── Confirmation ───────────────────────────────────────────────
export interface ConfirmationRequest {
  taskId: string
  action: AgentAction
  description: string
  rationale: string
  reversible: boolean
}

// ─── Accessibility ──────────────────────────────────────────────

export type AccessibilityNeed =
  | 'visual'          // low vision, blindness
  | 'auditory'        // deaf, hard of hearing
  | 'motor'           // limited fine motor control
  | 'cognitive'       // learning disabilities, ADHD, autism
  | 'speech'          // speech impairments

export type ReadingLevel = 'simple' | 'standard' | 'advanced'

export type OutputModality = 'text' | 'speech' | 'braille' | 'visual' | 'haptic'

export interface AccessibilityProfile {
  id: string
  userId: string
  needs: AccessibilityNeed[]
  preferences: {
    readingLevel: ReadingLevel
    outputModalities: OutputModality[]
    highContrast: boolean
    largeText: boolean
    reducedMotion: boolean
    screenReader: boolean
    voiceControl: boolean
    simplifiedLanguage: boolean
    extendedTimeouts: boolean
    cognitiveLoadLimit: CognitiveLoadLevel
  }
  createdAt: string
  updatedAt: string
}

export type CognitiveLoadLevel = 'low' | 'medium' | 'high'

export interface ContentAdaptation {
  originalContent: string
  adaptedContent: string
  readingLevel: ReadingLevel
  modifications: string[]
  screenReaderText?: string
  wordCount: { original: number; adapted: number }
}

export interface CognitiveLoadAssessment {
  level: CognitiveLoadLevel
  score: number           // 0-1, higher = more cognitive load
  factors: string[]
  recommendations: string[]
}

// ─── Events ─────────────────────────────────────────────────────
export type AgentEventName =
  | 'task.created'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'step.executed'
  | 'recommendation.generated'
  | 'recommendation.accepted'
  | 'recommendation.overridden'
  | 'feedback.submitted'
  | 'policy.evaluated'
  | 'policy.blocked'
  | 'inference.routed'
  | 'memory.updated'
  | 'confirmation.requested'
  | 'confirmation.responded'
  | 'orchestrator.decomposed'
  | 'orchestrator.subagent.started'
  | 'orchestrator.subagent.completed'
  | 'orchestrator.subagent.failed'
  | 'orchestrator.aggregated'
  | 'accessibility.profile.created'
  | 'accessibility.profile.updated'
  | 'accessibility.content.adapted'
  | 'accessibility.cognitive.assessed'

export interface AgentEvent {
  name: AgentEventName
  timestamp: string
  taskId?: string
  data: Record<string, unknown>
}
