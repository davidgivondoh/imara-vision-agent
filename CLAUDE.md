# CLAUDE.md — Imara Vision Agent

## Project Identity

- **Name:** Imara Vision Agent (codename: Neura)
- **Purpose:** Agentic AI runtime powering Imara products — deployable as standalone desktop agent, app engine, or embedded in Imara hardware.
- **Brand:** Imara Vision — assistive technology for inclusive learning and independent living.
- **Owner:** David (Precifarm AI Ltd / Imara Vision)

## Deployment Modes

1. **Desktop Agent** — Electron app, system tray, local UI (Windows/macOS/Linux)
2. **App Engine** — Headless Node.js server with HTTP/WebSocket API and `@imara/neura-sdk`
3. **Embedded Core** — Lightweight runtime inside Imara Pen, Wearable Overlay, ImaraPlus

## Architecture Summary

- Agent loop: Sense → Interpret → Plan → Act → Verify → Adapt
- Multi-agent orchestration: Planner, Research, Execution, Verification agents coordinated by an Orchestrator
- Inference: local LLM (Ollama) first, cloud API (Anthropic Claude) fallback
- Memory: SQLite + vector embeddings (sqlite-vss), optional cloud sync
- Policy engine: consent → role → autonomy level gates (L0–L4)
- Computer control: browser automation (Playwright), desktop control (nut.js), code execution (Docker sandbox)
- Plugins: sandboxed V8 isolates
- Telemetry: structured events via OpenTelemetry + Prometheus
- Accessibility-first: every feature designed for PWDs (visual, motor, cognitive, hearing, learning disabilities)

## Tech Stack

- TypeScript (strict), Node.js 20+, Electron/Tauri (desktop), Vitest + Playwright (tests)
- Ollama / ONNX Runtime (local inference), Anthropic Claude (cloud inference)
- SQLite + sqlite-vss (memory + vector search), Docker (sandboxing)
- Playwright (browser automation), nut.js (desktop control), Tesseract.js (OCR)
- whisper.cpp (local STT), Piper (local TTS), Web Speech API (browser fallback)
- Pino (logging), OpenTelemetry (tracing), Prometheus (metrics)
- Vanilla HTML/CSS/JS (desktop UI — current), accessible chat interface with voice-first interaction

## Code Conventions

- Use TypeScript strict mode. No `any` types.
- Prefer small, focused functions. One responsibility per module.
- All agent actions must pass through the policy engine before execution.
- All public APIs use Zod validation on inputs.
- Emit telemetry events for every significant decision.
- Use the product adapter interface for hardware-specific I/O — never put product logic in core.

## File Locations

| Purpose | Path |
|---|---|
| Agent core (loop, scheduler, memory, policy) | `src/core/` |
| Inference (local + cloud) | `src/inference/` |
| Plugin host | `src/plugins/` |
| Desktop shell (Electron) | `src/desktop/` |
| App engine server | `src/engine/` |
| Imara product adapters | `src/products/` |
| Shared types and config | `src/shared/` |
| Documentation | `docs/` |
| Tests | `tests/` |

## Safety Rules

- Never execute irreversible actions without user confirmation.
- Never send PII to cloud without detection/redaction pass.
- Always show "why this action" rationale in plain language.
- Default autonomy is L1 (suggestions only). User must opt in to higher levels.
- Plugins run in sandboxed isolates. Never trust plugin output without validation.

## Project Documentation

| Document | Purpose |
|---|---|
| `docs/ARCHITECTURE.md` | Core runtime architecture — agent loop, scheduler, memory, policy, telemetry |
| `docs/AUTONOMOUS-AGENT-BLUEPRINT.md` | Manus-grade autonomous agent blueprint — multi-agent orchestration, computer control, local models, roadmap |
| `docs/ACCESSIBILITY-ARCHITECTURE.md` | Accessibility-first design — disability profiles, voice interaction, screen reader integration, WCAG compliance |
| `docs/TOOLS-AND-STACK.md` | Complete technology stack reference with GitHub links for every library and tool |
| `docs/IMPLEMENTATION-PLAN.md` | Test-driven phased build plan — every phase testable via `npm run dev:ui` |
| `docs/GETTING-STARTED.md` | Setup, build, run, and first-run configuration |
| `docs/SDK-REFERENCE.md` | `@imara/neura-sdk` API for app engine integration |
| `docs/DEPLOYMENT.md` | Desktop packaging, app engine deployment, embedded core |
| `docs/PLUGIN-SYSTEM.md` | Plugin development, sandbox security, registry |
| `docs/SECURITY-AND-GOVERNANCE.md` | Safety model, privacy, policy enforcement, audit, threat model |

## Related External Docs

- ImaraVision website codebase: `C:\Users\san\Desktop\ImaraVision`
- Agentic strategy: `C:\Users\san\Desktop\ImaraVision\AGENTIC_CAPABILITIES.md`
- Implementation spec: `C:\Users\san\Desktop\ImaraVision\AGENTIC_DETAILS.md`
- Website instructions: `C:\Users\san\Desktop\ImaraVision\INSTRUCTIONS.md`
