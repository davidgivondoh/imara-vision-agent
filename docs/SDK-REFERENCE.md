# SDK & API Reference

## Overview

The `@imara/neura-sdk` is the official client library for integrating the Imara Vision Agent into third-party applications. It wraps the App Engine HTTP/WebSocket API into a typed, event-driven interface.

Use the SDK when you want to:
- Embed agentic capabilities into your own product.
- Build custom UIs on top of the Neura agent.
- Orchestrate agent tasks from a backend service.
- Connect Imara hardware products to the agent runtime.

---

## Installation

```bash
npm install @imara/neura-sdk
```

```bash
yarn add @imara/neura-sdk
```

---

## Quick Start

```ts
import { NeuraAgent } from '@imara/neura-sdk'

const agent = new NeuraAgent({
  apiKey: process.env.NEURA_API_KEY,
  endpoint: 'http://localhost:4100',  // or https://engine.imaravision.com
  model: 'neura-v1',
  autonomyLevel: 'L2',
})

await agent.connect()

const task = await agent.createTask({
  instruction: 'Summarise my meeting notes from today',
  context: { source: 'local-files', path: '~/Documents/meetings/' },
  constraints: { maxSteps: 10, requireConfirmation: true },
})

task.on('step', (step) => {
  console.log(`[${step.type}] ${step.description}`)
})

task.on('confirmation', async (action) => {
  const approved = await promptUser(action.description)
  action.respond(approved)
})

const result = await task.execute()
console.log(result.summary)
```

---

## NeuraAgent Class

### Constructor

```ts
new NeuraAgent(options: AgentOptions)
```

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `apiKey` | string | Yes | — | API key for authentication |
| `endpoint` | string | No | `http://localhost:4100` | App engine URL |
| `model` | string | No | `neura-v1` | Model identifier |
| `autonomyLevel` | string | No | `L1` | Default autonomy: L0–L4 |
| `timeout` | number | No | `30000` | Request timeout in ms |
| `retries` | number | No | `3` | Max retry attempts |

### Methods

#### `agent.connect(): Promise<void>`

Establishes a connection to the app engine. Validates the API key and checks engine health.

#### `agent.disconnect(): Promise<void>`

Gracefully disconnects. Running tasks continue server-side.

#### `agent.createTask(params: TaskParams): Promise<AgentTask>`

Creates a new task. Does not execute until `task.execute()` is called.

```ts
interface TaskParams {
  instruction: string
  context?: Record<string, unknown>
  constraints?: {
    maxSteps?: number           // default: 20
    requireConfirmation?: boolean // default: false
    timeout?: number            // ms, default: 60000
    autonomyLevel?: string      // override agent default
  }
  metadata?: Record<string, unknown>
}
```

#### `agent.getTask(taskId: string): Promise<AgentTask>`

Retrieves an existing task by ID.

#### `agent.listTasks(options?: ListOptions): Promise<AgentTask[]>`

Lists tasks with optional filters.

```ts
interface ListOptions {
  status?: 'created' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  limit?: number    // default: 20
  offset?: number   // default: 0
}
```

#### `agent.cancelTask(taskId: string): Promise<void>`

Cancels a running or queued task.

---

## AgentTask Class

Returned by `agent.createTask()` and `agent.getTask()`.

### Properties

| Property | Type | Description |
|---|---|---|
| `id` | string | Unique task identifier |
| `instruction` | string | Original instruction text |
| `status` | string | Current task status |
| `steps` | AgentStep[] | Completed steps |
| `result` | TaskResult \| null | Final result (when completed) |
| `createdAt` | string | ISO timestamp |
| `completedAt` | string \| null | ISO timestamp |

### Methods

#### `task.execute(): Promise<TaskResult>`

Starts task execution and returns the final result. Blocks until completion.

```ts
interface TaskResult {
  success: boolean
  summary: string
  outputs: Record<string, unknown>
  stepsCompleted: number
  durationMs: number
  confidence: number
}
```

#### `task.cancel(): Promise<void>`

Cancels this task.

#### `task.on(event: string, handler: Function): void`

Subscribes to real-time task events via WebSocket.

### Events

| Event | Payload | Description |
|---|---|---|
| `step` | `AgentStep` | Emitted after each loop step completes |
| `confirmation` | `ConfirmationRequest` | Agent needs user approval to proceed |
| `progress` | `{ percent: number, message: string }` | Progress update |
| `error` | `{ code: string, message: string }` | Non-fatal error |
| `completed` | `TaskResult` | Task finished |

### Confirmation Handling

```ts
task.on('confirmation', async (request) => {
  console.log('Action:', request.description)
  console.log('Rationale:', request.rationale)
  console.log('Reversible:', request.reversible)

  // Approve or deny
  request.respond(true)   // approve
  request.respond(false)  // deny
})
```

---

## Recommendations API

Generate context-aware recommendations without creating a full task.

#### `agent.getRecommendations(params: RecommendationParams): Promise<Recommendation[]>`

```ts
interface RecommendationParams {
  role: 'student' | 'teacher' | 'admin' | 'independent_living_user' | 'carer'
  intent: string
  context: Record<string, unknown>
  limit?: number  // default: 5
}

interface Recommendation {
  id: string
  type: string
  title: string
  summary: string
  actions: Array<{
    label: string
    actionType: 'navigate' | 'generate' | 'assign' | 'review' | 'communicate' | 'adapt_ui'
    payload: Record<string, unknown>
  }>
  confidence: number    // 0.0–1.0
  rationale: string[]
  inputsUsed: string[]
  createdAt: string
  expiresAt?: string
}
```

#### `agent.submitFeedback(params: FeedbackParams): Promise<void>`

```ts
interface FeedbackParams {
  recommendationId: string
  sentiment: 'helpful' | 'not_helpful' | 'edited'
  comment?: string
  completed?: boolean
}
```

---

## Memory API

#### `agent.memory.search(params: SearchParams): Promise<MemoryEntry[]>`

```ts
const results = await agent.memory.search({
  query: 'project deadlines',
  limit: 5,
  type: 'fact',  // optional filter
})
```

#### `agent.memory.store(entry: StoreParams): Promise<string>`

Returns the ID of the stored entry.

```ts
const id = await agent.memory.store({
  key: 'preferred_summary_format',
  value: 'bullet-points',
  scope: 'user',
  type: 'preference',
})
```

#### `agent.memory.get(id: string): Promise<MemoryEntry | null>`

#### `agent.memory.update(id: string, patch: Partial<MemoryEntry>): Promise<void>`

#### `agent.memory.delete(id: string): Promise<void>`

#### `agent.memory.export(): Promise<MemoryEntry[]>`

#### `agent.memory.clear(options?: { confirm: boolean }): Promise<void>`

---

## Configuration API

#### `agent.config.get(): Promise<AgentConfig>`

Returns the current agent configuration.

#### `agent.config.get(key: string): Promise<unknown>`

Returns a single configuration value.

#### `agent.config.set(key: string, value: unknown): Promise<void>`

Updates a configuration value at runtime.

```ts
await agent.config.set('agent.autonomyLevel', 'L3')
await agent.config.set('inference.preferLocal', false)
```

---

## REST API (Direct)

If you prefer raw HTTP instead of the SDK, the App Engine exposes these endpoints:

### POST `/api/agent/tasks`

Create a task.

**Request:**
```json
{
  "instruction": "Summarise my notes from today",
  "context": { "source": "local-files", "path": "~/notes/" },
  "constraints": { "maxSteps": 10, "requireConfirmation": true }
}
```

**Response (201):**
```json
{
  "success": true,
  "task": {
    "id": "task_abc123",
    "status": "created",
    "instruction": "Summarise my notes from today",
    "createdAt": "2026-03-10T14:00:00Z"
  }
}
```

### GET `/api/agent/tasks/:id`

Get task status and result.

### POST `/api/agent/tasks/:id/execute`

Start executing a created task. Returns immediately; use WebSocket or polling for updates.

### POST `/api/agent/tasks/:id/cancel`

Cancel a task.

### POST `/api/agent/recommendations`

**Request:**
```json
{
  "role": "student",
  "intent": "prepare_for_exam",
  "context": { "course": "physics", "artifacts": ["notes", "transcript"] }
}
```

**Response (200):**
```json
{
  "success": true,
  "recommendations": [
    {
      "id": "rec_456",
      "type": "study_plan",
      "title": "Physics exam revision plan",
      "summary": "Focus on weak areas: electromagnetism and wave optics",
      "actions": [
        { "label": "Generate practice quiz", "actionType": "generate", "payload": { "topic": "electromagnetism" } }
      ],
      "confidence": 0.87,
      "rationale": ["Low scores on electromagnetism in recent quizzes"],
      "inputsUsed": ["notes", "quiz_history"],
      "createdAt": "2026-03-10T14:05:00Z"
    }
  ]
}
```

### POST `/api/agent/feedback`

**Request:**
```json
{
  "recommendationId": "rec_456",
  "sentiment": "helpful",
  "completed": true
}
```

### POST `/api/agent/memory/search`

**Request:**
```json
{ "query": "exam dates", "limit": 5 }
```

### POST `/api/agent/memory`

**Request:**
```json
{
  "key": "physics_exam_date",
  "value": "2026-03-25",
  "type": "fact",
  "scope": "user"
}
```

### GET `/api/agent/config`

### PUT `/api/agent/config`

**Request:**
```json
{ "agent.autonomyLevel": "L2" }
```

### GET `/api/agent/health`

**Response:**
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "uptime": 3600,
  "inference": "local",
  "memory": "ready"
}
```

---

## WebSocket Streaming

Connect to `ws://localhost:4100/ws/agent/stream` for real-time events.

### Connection

```ts
const ws = new WebSocket('ws://localhost:4100/ws/agent/stream')

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  console.log(data.eventName, data.properties)
}
```

### Subscribe to a Task

```json
{ "action": "subscribe", "taskId": "task_abc123" }
```

### Event Format

```json
{
  "eventName": "agent.step.executed",
  "taskId": "task_abc123",
  "timestamp": "2026-03-10T14:01:00Z",
  "properties": {
    "stepType": "plan",
    "description": "Generated 3 action candidates",
    "durationMs": 240
  }
}
```

---

## Error Handling

All API responses follow a consistent error format:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "instruction is required",
    "details": {}
  }
}
```

### Error Codes

| Code | HTTP Status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid request payload |
| `AUTH_ERROR` | 401 | Invalid or missing API key |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `POLICY_BLOCKED` | 403 | Action blocked by policy engine |
| `TASK_FAILED` | 500 | Task execution error |
| `RATE_LIMITED` | 429 | Too many requests |
| `ENGINE_UNAVAILABLE` | 503 | Engine not ready |

### SDK Error Handling

```ts
import { NeuraError } from '@imara/neura-sdk'

try {
  await agent.createTask({ instruction: '' })
} catch (err) {
  if (err instanceof NeuraError) {
    console.log(err.code)     // 'VALIDATION_ERROR'
    console.log(err.message)  // 'instruction is required'
    console.log(err.status)   // 400
  }
}
```

---

## Rate Limits

| Plan | Requests/min | Concurrent Tasks | Memory Entries |
|---|---|---|---|
| Free | 30 | 2 | 1,000 |
| Pro | 300 | 10 | 50,000 |
| Enterprise | Custom | Custom | Custom |

---

## TypeScript Types

All types are exported from the SDK package:

```ts
import type {
  AgentOptions,
  TaskParams,
  TaskResult,
  AgentStep,
  Recommendation,
  RecommendationParams,
  FeedbackParams,
  MemoryEntry,
  PolicyEvaluation,
  TelemetryEvent,
  NeuraError,
} from '@imara/neura-sdk'
```
