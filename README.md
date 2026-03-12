# Imara Vision Agent

The agentic AI core powering all Imara products — deployable as a **standalone desktop agent**, an **app engine** for third-party integration, and the **embedded intelligence** inside Imara hardware.

> Built by [Imara Vision](https://imaravision.com) — assistive technology for inclusive learning and independent living.

---

## What Is the Imara Vision Agent?

The Imara Vision Agent (codenamed **Neura**) is a general-purpose agentic runtime that observes context, reasons over user goals, plans multi-step actions, and executes them under strict governance guardrails. It is purpose-built for accessibility — but its architecture is domain-agnostic.

### Three Deployment Modes

| Mode | Description | Use Case |
|---|---|---|
| **Desktop Agent** | Standalone application for Windows, macOS, and Linux. Runs locally with optional cloud sync. | End users who want an AI assistant on their machine — independent living support, productivity, accessibility. |
| **App Engine** | Embeddable runtime and SDK (`@imara/neura-sdk`) that developers integrate into their own applications. | Third-party apps, SaaS platforms, and enterprise tools that need agentic capabilities. |
| **Embedded Core** | Pre-integrated inside Imara hardware products. | Imara Pen, Imara Wearable Overlay, ImaraPlus phone. |

### Powering the Imara Product Line

| Product | Domain | Agent Role |
|---|---|---|
| **Imara Pen** | Inclusive Learning | Handwriting digitisation, structured note generation, lecture summarisation, revision material production |
| **Imara Wearable Overlay** | Inclusive Learning | Real-time visual overlays, captions, concept cues, voice-guided instructions |
| **ImaraPlus** | Independent Living | Proactive need anticipation, on-behalf communication, environment navigation, adaptive interfaces |
| **Neura (standalone)** | Independent Living | Environment learning, need anticipation, autonomous action, real-time adaptation |

---

## Agent Loop

Every capability follows a six-step cycle:

```
Sense → Interpret → Plan → Act → Verify → Adapt
```

1. **Sense** — Collect multimodal signals: handwriting, voice, visual context, environmental cues, user intent.
2. **Interpret** — Classify the task, assess confidence, identify the user's need (learning gap or daily living barrier).
3. **Plan** — Generate ranked next actions with rationale and confidence scores.
4. **Act** — Execute bounded actions or request human confirmation for irreversible operations.
5. **Verify** — Measure result quality and capture user corrections.
6. **Adapt** — Update personalisation, memory, and future suggestions.

---

## Key Capabilities

- **Local-first inference** — Core reasoning runs on-device for privacy and speed. Cloud fallback for large tasks.
- **Persistent memory** — Vector-backed memory store for preferences, corrections, and context. Searchable and exportable.
- **Task scheduling** — Priority queues, task chaining, dependency resolution, and concurrency control.
- **Plugin system** — Extend capabilities via community or custom plugins in a sandboxed environment.
- **Bounded autonomy** — Configurable autonomy levels (L0–L4) with confirmation gates for high-impact actions.
- **Cross-device sync** — Same agent, same memory, across desktop and mobile.
- **Telemetry and observability** — Decision audit logs, quality metrics, and experimentation hooks.

---

## Autonomy Levels

| Level | Name | Behavior | Example |
|---|---|---|---|
| L0 | Static | Fixed content, no adaptation | Generic tips; static accessibility settings |
| L1 | Context-Aware | Uses current session inputs | Suggests notes by topic; detects lighting for overlay contrast |
| L2 | Goal-Driven | Optimises toward explicit objective | Builds revision plan for exam; adjusts UI to motor profile |
| L3 | Multi-Step Agent | Plans and executes chained actions | Summarise → quiz → weak-topic drill; navigate route + send ETA |
| L4 | Orchestrated Agents | Multiple role agents coordinate | Teacher copilot + student copilot + compliance guardrail |

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/imara-vision/imara-vision-agent.git
cd imara-vision-agent

# Install dependencies
npm install

# Start the agent in development mode
npm run dev

# Build for production
npm run build

# Run the desktop agent
npm run agent:start

# Run as app engine (headless mode)
npm run engine:start
```

See [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) for full setup instructions.

---

## Documentation

| Document | Purpose |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | System design — core runtime, layers, data flow, and deployment topology |
| [Autonomous Agent Blueprint](docs/AUTONOMOUS-AGENT-BLUEPRINT.md) | Manus-grade autonomous agent design — multi-agent orchestration, computer control, local models, PWD use cases, and implementation roadmap |
| [Accessibility Architecture](docs/ACCESSIBILITY-ARCHITECTURE.md) | Accessibility-first design — disability profiles, voice interaction, screen reader integration, onboarding, WCAG 2.2 compliance |
| [Tools & Stack](docs/TOOLS-AND-STACK.md) | Complete technology stack reference with GitHub links for every library and tool |
| [Implementation Plan](docs/IMPLEMENTATION-PLAN.md) | Test-driven phased build plan -- every phase testable via `npm run dev:ui` |
| [Getting Started](docs/GETTING-STARTED.md) | Setup, build, run, and first-run configuration |
| [SDK Reference](docs/SDK-REFERENCE.md) | `@imara/neura-sdk` API for app engine integration |
| [Deployment](docs/DEPLOYMENT.md) | Desktop packaging, app engine deployment, and Imara product embedding |
| [Plugin System](docs/PLUGIN-SYSTEM.md) | Building and registering custom plugins |
| [Security & Governance](docs/SECURITY-AND-GOVERNANCE.md) | Safety model, privacy, policy enforcement, and audit |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js / Electron (desktop), Node.js (app engine) |
| Language | TypeScript (strict mode) |
| Inference | On-device ONNX Runtime + cloud API fallback |
| Memory | SQLite + vector embeddings (local), optional cloud sync |
| UI (desktop) | Electron + React + Tailwind CSS |
| Task System | Custom event-driven scheduler |
| Plugins | Sandboxed V8 isolates |
| Packaging | electron-builder (desktop), Docker (app engine) |
| Testing | Vitest + Playwright (E2E) |

---

## Project Structure

```
imara-vision-agent/
├── src/
│   ├── core/                  # Agent runtime — loop, scheduler, memory, policy
│   │   ├── agent-loop.ts      # Sense-Interpret-Plan-Act-Verify-Adapt cycle
│   │   ├── scheduler.ts       # Task queue, priority, concurrency
│   │   ├── memory.ts          # Vector memory store
│   │   ├── policy.ts          # Governance and consent checks
│   │   └── telemetry.ts       # Decision logging and metrics
│   ├── inference/             # Model execution layer
│   │   ├── local.ts           # On-device ONNX inference
│   │   └── cloud.ts           # Cloud API fallback
│   ├── plugins/               # Plugin host and registry
│   │   ├── host.ts            # Sandboxed plugin runtime
│   │   └── registry.ts        # Plugin discovery and lifecycle
│   ├── desktop/               # Electron desktop shell
│   │   ├── main.ts            # Electron main process
│   │   ├── tray.ts            # System tray integration
│   │   └── ui/                # React UI components
│   ├── engine/                # App engine (headless mode)
│   │   ├── server.ts          # HTTP/WebSocket API server
│   │   └── sdk.ts             # SDK entry point
│   ├── products/              # Imara product-specific adapters
│   │   ├── pen.ts             # Imara Pen integration
│   │   ├── overlay.ts         # Wearable Overlay integration
│   │   ├── imara-plus.ts      # ImaraPlus phone integration
│   │   └── neura-standalone.ts # Neura mobile standalone
│   └── shared/                # Shared types, utilities, constants
│       ├── types.ts
│       └── config.ts
├── plugins/                   # Built-in plugins
├── models/                    # Local model files (ONNX)
├── docs/                      # Documentation
├── tests/                     # Test suites
├── scripts/                   # Build and packaging scripts
├── electron.config.ts         # Electron builder config
├── tsconfig.json
├── package.json
└── CLAUDE.md                  # AI-assisted development conventions
```

---

## CLI Reference

```bash
neura start                       # Start the agent daemon
neura stop                        # Stop the running agent
neura status                      # Check status, version, and sync state
neura update                      # Check for and apply updates
neura config set <key> <value>    # Set a configuration value
neura config get <key>            # Read a configuration value
neura logs                        # Stream real-time agent logs
neura task list                   # List active and recent tasks
neura task cancel <id>            # Cancel a running task by ID
neura memory export               # Export agent memory as JSON
neura memory clear                # Clear agent memory (requires confirmation)
neura plugin list                 # List installed plugins
neura plugin install <name>       # Install a plugin from the registry
```

---

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/my-capability`.
3. Follow the [RFC template](docs/templates/agentic-feature-rfc.md) for new agentic capabilities.
4. Ensure `npm run build` and `npm test` pass.
5. Submit a pull request.

---

## License

Proprietary. Copyright Imara Vision. All rights reserved.
