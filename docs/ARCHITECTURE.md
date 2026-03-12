# Architecture

## Overview

The Imara Vision Agent is a modular agentic runtime with three deployment surfaces:

1. **Desktop Agent** — Electron app with system tray, local UI, and OS-level integrations.
2. **App Engine** — Headless Node.js server exposing HTTP/WebSocket APIs and the `@imara/neura-sdk`.
3. **Embedded Core** — Lightweight runtime compiled into Imara hardware firmware (Pen, Overlay, ImaraPlus).

All three share the same **Agent Core** — the loop, scheduler, memory, policy, and telemetry layers. The deployment surface determines the shell (Electron, server, or firmware bridge) and the I/O adapters.

---

## System Layers

```
┌─────────────────────────────────────────────────────────┐
│                    Deployment Shell                       │
│   ┌──────────┐   ┌──────────┐   ┌───────────────────┐   │
│   │ Desktop  │   │   App    │   │  Embedded (Imara  │   │
│   │ Electron │   │  Engine  │   │  Pen / Overlay /  │   │
│   │   Shell  │   │  Server  │   │  ImaraPlus)       │   │
│   └────┬─────┘   └────┬─────┘   └────────┬──────────┘   │
│        │              │                   │              │
│        └──────────────┼───────────────────┘              │
│                       │                                  │
│              ┌────────▼────────┐                         │
│              │   Agent Core    │                         │
│              └────────┬────────┘                         │
│   ┌───────────────────┼───────────────────┐              │
│   │                   │                   │              │
│   ▼                   ▼                   ▼              │
│ ┌──────────┐  ┌──────────────┐  ┌──────────────┐        │
│ │ Inference│  │   Memory     │  │   Plugin     │        │
│ │  Layer   │  │   Store      │  │   Host       │        │
│ └──────────┘  └──────────────┘  └──────────────┘        │
│                                                          │
│ ┌──────────────────────────────────────────────────┐     │
│ │            Governance & Telemetry                  │     │
│ └──────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

---

## Agent Core

The core is the heart of the system. It runs the agent loop and coordinates all subsystems.

### Agent Loop (`src/core/agent-loop.ts`)

Every tick of the agent follows this cycle:

```
Sense → Interpret → Plan → Act → Verify → Adapt
```

| Stage | Responsibility | Inputs | Outputs |
|---|---|---|---|
| Sense | Collect signals from active I/O adapters | Raw sensor data, user input, environment state | Normalised signal bundle |
| Interpret | Classify intent, assess confidence, detect user need | Signal bundle, user profile, memory | Task classification + confidence score |
| Plan | Generate ranked action candidates | Classification, goal state, policy constraints | Ordered action list with rationale |
| Act | Execute the top action or request confirmation | Action plan, autonomy level setting | Execution result or confirmation request |
| Verify | Measure outcome quality, capture corrections | Execution result, user feedback | Quality score + correction data |
| Adapt | Update memory, adjust future behaviour | Quality score, corrections, preference signals | Updated memory state |

### Loop Configuration

```ts
interface AgentLoopConfig {
  tickIntervalMs: number       // How often the loop runs (default: 1000)
  maxStepsPerTask: number      // Safety limit per task (default: 20)
  autonomyLevel: 'L0' | 'L1' | 'L2' | 'L3' | 'L4'
  confirmIrreversible: boolean // Always confirm destructive actions (default: true)
}
```

---

## Task Scheduler (`src/core/scheduler.ts`)

Manages the lifecycle of user-initiated and agent-initiated tasks.

### Task States

```
created → queued → running → completed
                          → failed
                          → cancelled
                          → awaiting_confirmation
```

### Features

- **Priority queues** — Tasks are ranked by urgency and user preference.
- **Concurrency control** — Configurable max parallel tasks (default: 3).
- **Task chaining** — A task can spawn follow-up tasks with dependency links.
- **Timeout enforcement** — Tasks exceeding `maxStepsPerTask` are paused for human review.
- **Cancellation** — Users can cancel any running task via CLI or UI.

### Task Contract

```ts
interface AgentTask {
  id: string
  instruction: string
  context: Record<string, unknown>
  constraints: {
    maxSteps: number
    requireConfirmation: boolean
    timeout?: number
  }
  status: 'created' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_confirmation'
  steps: AgentStep[]
  result?: TaskResult
  createdAt: string
  completedAt?: string
}

interface AgentStep {
  id: string
  type: 'sense' | 'interpret' | 'plan' | 'act' | 'verify' | 'adapt'
  description: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  durationMs: number
  timestamp: string
}
```

---

## Inference Layer (`src/inference/`)

### Local Inference (`local.ts`)

- Runs ONNX Runtime on-device for fast, private inference.
- Models stored in `models/` directory.
- Supports classification, embedding, and small generative tasks.
- Falls back to cloud when the task exceeds local model capacity.

### Cloud Inference (`cloud.ts`)

- Calls external LLM APIs for large reasoning, generation, and complex planning.
- Configurable provider (default: Anthropic Claude API).
- Request batching and rate limiting built in.
- All cloud calls are logged for auditability.

### Inference Router

The system automatically selects local or cloud based on:

| Signal | Local | Cloud |
|---|---|---|
| Task complexity | Simple classification, embedding | Multi-step reasoning, long generation |
| Latency requirement | < 100ms needed | Can tolerate 1–5s |
| Privacy sensitivity | PII present, user prefers local | Anonymised or user consents |
| Model availability | Model file exists locally | No local model for this task |
| Connectivity | Offline | Online |

---

## Memory Store (`src/core/memory.ts`)

Persistent knowledge base for the agent across sessions and devices.

### Storage Architecture

```
┌─────────────────────────┐
│    Memory API            │
├─────────────────────────┤
│  Vector Search Layer     │  ← Semantic similarity search
├─────────────────────────┤
│  SQLite Database         │  ← Structured storage
├─────────────────────────┤
│  Local Filesystem        │  ← On-device persistence
└─────────────────────────┘
        │
        ▼ (optional)
┌─────────────────────────┐
│  Cloud Sync Service      │  ← Cross-device synchronisation
└─────────────────────────┘
```

### Memory Types

| Type | Scope | Example |
|---|---|---|
| `preference` | User-level | "Prefers bullet-point summaries" |
| `correction` | Task-level | "User changed 'physics' to 'applied physics'" |
| `context` | Session-level | "Currently reviewing Chapter 5" |
| `fact` | Global | "User's exam is on March 20" |
| `routine` | Recurring | "User opens notes app at 9am on weekdays" |

### Memory API

```ts
interface MemoryStore {
  store(entry: MemoryEntry): Promise<string>
  search(query: string, options?: SearchOptions): Promise<MemoryEntry[]>
  get(id: string): Promise<MemoryEntry | null>
  update(id: string, patch: Partial<MemoryEntry>): Promise<void>
  delete(id: string): Promise<void>
  export(): Promise<MemoryEntry[]>
  clear(options?: { confirm: boolean }): Promise<void>
}

interface MemoryEntry {
  id: string
  type: 'preference' | 'correction' | 'context' | 'fact' | 'routine'
  key: string
  value: string
  embedding?: number[]
  scope: 'user' | 'session' | 'task'
  createdAt: string
  expiresAt?: string
}
```

---

## Policy Engine (`src/core/policy.ts`)

Enforces governance rules before any action is executed.

### Policy Check Flow

```
Action Candidate
      │
      ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Consent   │───▶│    Role     │───▶│  Autonomy   │
│   Check     │    │   Check     │    │  Level Gate  │
└─────────────┘    └─────────────┘    └─────────────┘
      │                  │                   │
      ▼                  ▼                   ▼
   Denied?            Denied?            Exceeds level?
      │                  │                   │
      ▼                  ▼                   ▼
  Block + log       Block + log      Request confirmation
```

### Policy Evaluation Result

```ts
interface PolicyEvaluation {
  allowed: boolean
  reasonCode: 'ok' | 'missing_consent' | 'insufficient_role' | 'restricted_context' | 'data_retention_block' | 'autonomy_exceeded'
  message: string
  requiredApprovals?: string[]
}
```

### Autonomy Enforcement

| Level | Allowed Without Confirmation | Requires Confirmation |
|---|---|---|
| L0 | Nothing (static only) | — |
| L1 | Read-only suggestions | — |
| L2 | Reversible actions | Irreversible actions |
| L3 | Multi-step chains (reversible) | Any irreversible step |
| L4 | Cross-agent coordination | Actions affecting other users |

---

## Telemetry (`src/core/telemetry.ts`)

All agent decisions emit structured telemetry events for observability and experimentation.

### Event Types

| Event | Trigger |
|---|---|
| `agent.task.created` | New task enters the scheduler |
| `agent.task.completed` | Task finishes (success or failure) |
| `agent.step.executed` | Each step of the agent loop |
| `agent.recommendation.generated` | A recommendation is produced |
| `agent.recommendation.accepted` | User accepts a recommendation |
| `agent.recommendation.overridden` | User modifies or rejects |
| `agent.feedback.submitted` | User provides explicit feedback |
| `agent.policy.evaluated` | Policy engine runs a check |
| `agent.policy.blocked` | An action is denied by policy |
| `agent.inference.routed` | Inference routes to local or cloud |
| `agent.memory.updated` | Memory store is modified |

### Event Schema

```ts
interface TelemetryEvent {
  eventName: string
  timestamp: string
  sessionId: string
  taskId?: string
  properties: Record<string, unknown>
  product?: 'desktop' | 'engine' | 'pen' | 'overlay' | 'imara-plus' | 'neura-standalone'
}
```

---

## Desktop Shell (`src/desktop/`)

The Electron wrapper provides:

- **System tray** — Agent runs in background, accessible from tray icon.
- **Floating panel** — Quick-access UI for current tasks and recommendations.
- **Settings window** — Configuration UI for autonomy, sync, privacy, and plugins.
- **OS integrations** — File access, notifications, accessibility permissions, global shortcuts.
- **Auto-update** — Checks for updates on launch and periodically.

---

## App Engine (`src/engine/`)

Headless deployment for server-side and third-party integration.

### API Surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/agent/tasks` | POST | Create a new task |
| `/api/agent/tasks/:id` | GET | Get task status and result |
| `/api/agent/tasks/:id/cancel` | POST | Cancel a running task |
| `/api/agent/recommendations` | POST | Generate recommendations for a given context |
| `/api/agent/feedback` | POST | Submit user feedback on a recommendation |
| `/api/agent/memory/search` | POST | Search agent memory |
| `/api/agent/memory` | POST | Store a memory entry |
| `/api/agent/config` | GET/PUT | Read or update configuration |
| `/api/agent/health` | GET | Health check |
| `/ws/agent/stream` | WebSocket | Real-time task events and streaming output |

### SDK Integration

The `@imara/neura-sdk` wraps the API surface for Node.js and browser clients:

```ts
import { NeuraAgent } from '@imara/neura-sdk'

const agent = new NeuraAgent({
  apiKey: process.env.NEURA_API_KEY,
  endpoint: 'https://engine.imaravision.com',
})

const task = await agent.createTask({
  instruction: 'Summarise my notes from today',
  context: { source: 'local-files', path: '~/notes/' },
})

const result = await task.execute()
```

---

## Product Adapters (`src/products/`)

Each Imara product has a thin adapter that maps hardware-specific I/O to the generic agent core.

| Adapter | Input Sources | Output Targets |
|---|---|---|
| `pen.ts` | Handwriting sensor, microphone | Structured notes, summaries, revision materials |
| `overlay.ts` | Camera, microphone, environment sensors | Visual overlays, captions, voice guidance |
| `imara-plus.ts` | Touchscreen, microphone, GPS, environment sensors | Adaptive UI, communication, navigation |
| `neura-standalone.ts` | Phone sensors, user input | Environment model, actions, notifications |

### Adapter Interface

```ts
interface ProductAdapter {
  productId: string
  initialize(config: ProductConfig): Promise<void>
  getSensors(): SensorDescriptor[]
  readSensors(): Promise<SensorReading[]>
  executeAction(action: AgentAction): Promise<ActionResult>
  getCapabilities(): string[]
  shutdown(): Promise<void>
}
```

---

## Data Flow: End-to-End Example

**Scenario:** User asks Imara Pen to "summarise today's lecture."

```
1. Pen adapter reads handwriting sensor buffer and microphone transcript
         │
         ▼
2. Sense stage normalises inputs into a signal bundle
         │
         ▼
3. Interpret stage classifies: intent="summarise", source="lecture", confidence=0.91
         │
         ▼
4. Plan stage generates: [{ action: "generate_summary", rationale: "user requested lecture summary" }]
         │
         ▼
5. Policy engine checks: consent=ok, role=student, autonomy=L2 → allowed
         │
         ▼
6. Act stage routes to local inference (small summarisation model)
         │
         ▼
7. Verify stage: summary produced, length=320 words, quality_score=0.88
         │
         ▼
8. Adapt stage: stores "user prefers lecture summaries" in memory
         │
         ▼
9. Telemetry emits: task.completed, recommendation.generated, inference.routed
         │
         ▼
10. Pen adapter renders summary on connected device
```

---

## Configuration Hierarchy

Configuration is resolved in this priority order (highest wins):

1. **Runtime flags** — CLI arguments or environment variables
2. **User config** — `~/.neura/config.json` (desktop) or API config (engine)
3. **Product defaults** — Per-product adapter defaults
4. **System defaults** — Hardcoded in `src/shared/config.ts`

### Key Configuration Options

| Key | Type | Default | Description |
|---|---|---|---|
| `agent.autonomyLevel` | string | `"L1"` | Default autonomy: L0–L4 |
| `agent.maxStepsPerTask` | number | `20` | Max steps before confirmation required |
| `agent.confirmIrreversible` | boolean | `true` | Always confirm destructive actions |
| `inference.preferLocal` | boolean | `true` | Prefer on-device inference |
| `inference.cloudProvider` | string | `"anthropic"` | Cloud inference provider |
| `memory.syncEnabled` | boolean | `true` | Enable cross-device memory sync |
| `memory.syncIntervalSec` | number | `300` | Sync interval in seconds |
| `privacy.telemetry` | boolean | `true` | Send anonymous usage data |
| `privacy.localInference` | boolean | `true` | Prefer local inference for PII |
| `plugins.autoUpdate` | boolean | `true` | Auto-update installed plugins |
