# Technology Stack & Tool Reference

> Complete reference for every technology, library, and tool used or planned for the Imara Vision Agent (Neura).

---

## Stack Overview

```
Layer              Current                     Target (Manus-grade)
---------------------------------------------------------------------------
Desktop Shell      Express + vanilla HTML/JS   Tauri 2.0 / Electron
Agent Runtime      TypeScript + Node.js 20     TypeScript + Node.js 22
Inference (local)  Rule-based + ONNX stub      Ollama + whisper.cpp + Piper
Inference (cloud)  Anthropic Claude API        Anthropic + fallback providers
Memory             JSON file persistence       SQLite + sqlite-vss vectors
Browser Control    --                          Playwright
Desktop Control    --                          nut.js + OS accessibility APIs
Code Execution     --                          Docker sandbox
Computer Vision    --                          Tesseract.js + Claude Vision
Voice (STT)        Web Speech API              whisper.cpp (local) + Web Speech
Voice (TTS)        Web Speech API              Piper (local) + Web Speech
Observability      Console logging             Pino + OpenTelemetry + Prometheus
Testing            Vitest                      Vitest + Playwright E2E + axe-core
Packaging          npm scripts                 electron-builder / Tauri bundler
```

---

## Core Runtime

| Technology | Version | Purpose | License | GitHub |
|---|---|---|---|---|
| **TypeScript** | 5.x (strict) | Primary language | Apache-2.0 | [microsoft/TypeScript](https://github.com/microsoft/TypeScript) |
| **Node.js** | 20+ LTS | Runtime environment | MIT | [nodejs/node](https://github.com/nodejs/node) |
| **Express** | 4.x | HTTP API server | MIT | [expressjs/express](https://github.com/expressjs/express) |
| **ws** | 8.x | WebSocket server | MIT | [websockets/ws](https://github.com/websockets/ws) |
| **Zod** | 3.x | Schema validation | MIT | [colinhacks/zod](https://github.com/colinhacks/zod) |
| **uuid** | 9.x | Unique ID generation | MIT | [uuidjs/uuid](https://github.com/uuidjs/uuid) |
| **cors** | 2.x | CORS middleware | MIT | [expressjs/cors](https://github.com/expressjs/cors) |
| **tsx** | 4.x | TypeScript execution (dev) | MIT | [privatenumber/tsx](https://github.com/privatenumber/tsx) |

---

## Desktop Shell

| Technology | Purpose | When | GitHub |
|---|---|---|---|
| **Electron** | Desktop app shell (current plan) | Phase 1-3 | [electron/electron](https://github.com/electron/electron) |
| **electron-builder** | Desktop packaging (.exe, .dmg, .AppImage) | Phase 1 | [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder) |
| **electron-updater** | Auto-update for desktop app | Phase 1 | Included with electron-builder |
| **Tauri 2.0** | Lightweight native shell (future migration) | Phase 6 | [tauri-apps/tauri](https://github.com/tauri-apps/tauri) |

---

## AI & Inference

### Large Language Models

| Technology | Type | Purpose | GitHub / Link |
|---|---|---|---|
| **Ollama** | Local LLM server | Run Llama 3, Mistral, Phi locally | [ollama/ollama](https://github.com/ollama/ollama) |
| **llama.cpp** | Local LLM runtime | Optimised CPU/GPU inference for GGUF models | [ggerganov/llama.cpp](https://github.com/ggerganov/llama.cpp) |
| **vLLM** | GPU inference server | High-throughput serving for multi-user | [vllm-project/vllm](https://github.com/vllm-project/vllm) |
| **ONNX Runtime** | Model runtime | Cross-platform edge inference | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |
| **Anthropic Claude** | Cloud LLM | Complex reasoning, tool use, long context | [anthropic.com](https://docs.anthropic.com) |
| **Anthropic SDK** | API client | TypeScript SDK for Claude API | [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) |

### Recommended Local Models

| Model | Size | Use Case | Source |
|---|---|---|---|
| **Llama 3.1 8B** | ~8 GB | General reasoning, planning | [meta-llama](https://huggingface.co/meta-llama) |
| **Mistral 7B** | ~7 GB | Fast reasoning, coding | [mistralai](https://huggingface.co/mistralai) |
| **Phi-3 Mini** | ~3.8 GB | Lightweight reasoning | [microsoft/Phi-3](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct) |
| **Gemma 2 2B** | ~2 GB | Ultra-lightweight tasks | [google/gemma-2](https://huggingface.co/google/gemma-2-2b) |
| **all-MiniLM-L6-v2** | ~90 MB | Text embeddings for memory search | [sentence-transformers](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) |

### Speech & Vision

| Technology | Purpose | GitHub |
|---|---|---|
| **whisper.cpp** | Local speech-to-text | [ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp) |
| **Piper TTS** | Local text-to-speech | [rhasspy/piper](https://github.com/rhasspy/piper) |
| **Tesseract.js** | OCR (text from images) | [naptha/tesseract.js](https://github.com/naptha/tesseract.js) |
| **Florence-2** | Vision: captioning, detection, OCR | [microsoft/Florence-2](https://huggingface.co/microsoft/Florence-2-large) |
| **Web Speech API** | Browser-native STT/TTS (current) | [MDN Docs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) |
| **Porcupine** | Wake word detection ("Hey Neura") | [Picovoice/porcupine](https://github.com/Picovoice/porcupine) |
| **OpenWakeWord** | Open-source wake word alternative | [dscripka/openWakeWord](https://github.com/dscripka/openWakeWord) |

---

## Computer Control

### Browser Automation

| Technology | Purpose | GitHub |
|---|---|---|
| **Playwright** | Full browser automation (Chromium, Firefox, WebKit) | [microsoft/playwright](https://github.com/microsoft/playwright) |
| **Puppeteer** | Chrome/Chromium automation (alternative) | [puppeteer/puppeteer](https://github.com/puppeteer/puppeteer) |

**Why Playwright over Puppeteer:**
- Multi-browser support (Chromium, Firefox, WebKit)
- Built-in accessibility tree selectors (`.getByRole()`, `.getByLabel()`)
- Better wait/auto-retry mechanisms
- Network interception for security monitoring
- First-party TypeScript support

### Desktop Automation

| Technology | Purpose | Platform | GitHub |
|---|---|---|---|
| **nut.js** | Mouse, keyboard, screen control | Windows, macOS, Linux | [nut-tree/nut.js](https://github.com/nut-tree/nut.js) |
| **RobotJS** | Low-level mouse/keyboard (alternative) | Windows, macOS, Linux | [octalmage/robotjs](https://github.com/octalmage/robotjs) |
| **node-window-manager** | Window listing, focus, resize | Windows, macOS, Linux | [nicknash/node-window-manager](https://github.com/nicknash/node-window-manager) |

### OS Accessibility APIs

| Platform | API | Node.js Binding | Purpose |
|---|---|---|---|
| Windows | UI Automation (UIA) | Native addon (N-API) | Read app accessibility tree, find elements by role/name |
| macOS | AX API | Native addon via Electron | Same for macOS apps |
| Linux | AT-SPI2 | D-Bus bindings | Same for GNOME/GTK apps |

---

## Memory & Data

| Technology | Purpose | GitHub |
|---|---|---|
| **better-sqlite3** | SQLite database (current) | [WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| **sqlite-vss** | Vector similarity search extension | [asg017/sqlite-vss](https://github.com/asg017/sqlite-vss) |
| **LanceDB** | Embedded vector DB (alternative) | [lancedb/lancedb](https://github.com/lancedb/lancedb) |
| **Chroma** | Vector DB (client-server) | [chroma-core/chroma](https://github.com/chroma-core/chroma) |
| **pgvector** | PostgreSQL vector extension (multi-user) | [pgvector/pgvector](https://github.com/pgvector/pgvector) |
| **Redis** | Working memory / cache (optional) | [redis/redis](https://github.com/redis/redis) |

---

## Sandboxing & Security

| Technology | Purpose | GitHub |
|---|---|---|
| **Docker** | Code execution sandbox | [moby/moby](https://github.com/moby/moby) |
| **dockerode** | Docker API client for Node.js | [apocas/dockerode](https://github.com/apocas/dockerode) |
| **Firecracker** | Lightweight microVMs (production) | [firecracker-microvm/firecracker](https://github.com/firecracker-microvm/firecracker) |
| **isolated-vm** | V8 isolate sandbox (plugins) | [laverdet/isolated-vm](https://github.com/laverdet/isolated-vm) |

---

## Observability

| Technology | Purpose | GitHub |
|---|---|---|
| **Pino** | Structured JSON logging | [pinojs/pino](https://github.com/pinojs/pino) |
| **OpenTelemetry JS** | Distributed tracing | [open-telemetry/opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js) |
| **prom-client** | Prometheus metrics | [siimon/prom-client](https://github.com/siimon/prom-client) |
| **Grafana** | Dashboards and alerting | [grafana/grafana](https://github.com/grafana/grafana) |
| **Sentry** | Error tracking and crash reporting | [getsentry/sentry-javascript](https://github.com/getsentry/sentry-javascript) |

---

## Testing

| Technology | Purpose | GitHub |
|---|---|---|
| **Vitest** | Unit and integration testing (current) | [vitest-dev/vitest](https://github.com/vitest-dev/vitest) |
| **Playwright Test** | End-to-end browser testing | [microsoft/playwright](https://github.com/microsoft/playwright) |
| **axe-core** | Automated accessibility testing | [dequelabs/axe-core](https://github.com/dequelabs/axe-core) |
| **jest-axe** | Accessibility assertions in tests | [nickcolley/jest-axe](https://github.com/nickcolley/jest-axe) |
| **pa11y** | CLI accessibility testing | [pa11y/pa11y](https://github.com/pa11y/pa11y) |
| **Lighthouse CI** | Performance and accessibility CI | [GoogleChrome/lighthouse-ci](https://github.com/GoogleChrome/lighthouse-ci) |

---

## Multi-Agent Orchestration Frameworks (Reference)

These are reference architectures and frameworks for multi-agent patterns:

| Framework | Architecture | Key Feature | GitHub |
|---|---|---|---|
| **CrewAI** | Role-based multi-agent | Agent crews with specialised roles | [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) |
| **LangGraph** | Graph-based workflows | Stateful agent orchestration | [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) |
| **AutoGen** | Conversational multi-agent | Agents communicate via messages | [microsoft/autogen](https://github.com/microsoft/autogen) |
| **Semantic Kernel** | Skills + planners | Microsoft's AI orchestration SDK | [microsoft/semantic-kernel](https://github.com/microsoft/semantic-kernel) |
| **OpenInterpreter** | Code execution agent | Natural language to computer actions | [OpenInterpreter/open-interpreter](https://github.com/OpenInterpreter/open-interpreter) |
| **AutoGPT** | Autonomous agent loop | Goal-driven autonomous execution | [Significant-Gravitas/AutoGPT](https://github.com/Significant-Gravitas/AutoGPT) |

---

## Accessibility Tools

| Tool | Purpose | GitHub |
|---|---|---|
| **NVDA** | Open-source screen reader (Windows) | [nvaccess/nvda](https://github.com/nvaccess/nvda) |
| **axe-core** | Accessibility rule engine | [dequelabs/axe-core](https://github.com/dequelabs/axe-core) |
| **pa11y** | Automated accessibility testing | [pa11y/pa11y](https://github.com/pa11y/pa11y) |
| **Accessibility Insights** | Manual + automated testing (Windows) | [microsoft/accessibility-insights-windows](https://github.com/microsoft/accessibility-insights-windows) |
| **Home Assistant** | Smart home automation for independent living | [home-assistant/core](https://github.com/home-assistant/core) |
| **OpenDyslexic** | Dyslexia-friendly font | [antijingoist/opendyslexic](https://github.com/antijingoist/opendyslexic) |

---

## Smart Home & IoT Integration

For independent living users, Neura can integrate with smart home systems:

| Technology | Purpose | GitHub |
|---|---|---|
| **Home Assistant** | Smart home hub (lights, locks, thermostats) | [home-assistant/core](https://github.com/home-assistant/core) |
| **Matter** | Universal smart home protocol | [project-chip/connectedhomeip](https://github.com/project-chip/connectedhomeip) |
| **Zigbee2MQTT** | Zigbee device integration | [Koenkk/zigbee2mqtt](https://github.com/Koenkk/zigbee2mqtt) |
| **Node-RED** | Visual automation flows | [node-red/node-red](https://github.com/node-red/node-red) |

---

## Deployment & Infrastructure

| Technology | Purpose | GitHub |
|---|---|---|
| **Docker** | Container packaging for app engine | [moby/moby](https://github.com/moby/moby) |
| **Docker Compose** | Multi-container orchestration | [docker/compose](https://github.com/docker/compose) |
| **GitHub Actions** | CI/CD pipeline | Built into GitHub |
| **electron-builder** | Desktop app packaging | [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder) |

---

## System Requirements

### Minimum (L1 - Suggestions Only)
| Resource | Requirement |
|---|---|
| CPU | 2 cores |
| RAM | 4 GB |
| Disk | 2 GB |
| GPU | Not required |
| Network | Required (cloud inference) |

### Recommended (L2-L3 - Local Inference)
| Resource | Requirement |
|---|---|
| CPU | 4+ cores |
| RAM | 16 GB |
| Disk | 20 GB (with local models) |
| GPU | 8 GB VRAM (for faster local inference) |
| Network | Optional (local-first) |

### Full Autonomy (L4 - Multi-Agent + Computer Control)
| Resource | Requirement |
|---|---|
| CPU | 8+ cores |
| RAM | 32 GB |
| Disk | 50 GB |
| GPU | 12+ GB VRAM |
| Docker | Required (for code sandbox) |
| Network | Recommended |

---

## NPM Package Additions (Planned)

```
Phase 2 (Computer Control):
  playwright             Browser automation
  @nut-tree/nut-js       Desktop control
  tesseract.js           OCR
  dockerode              Docker sandbox management

Phase 3 (Local Intelligence):
  ollama                 Local LLM client
  sqlite-vss             Vector search
  pino                   Structured logging

Phase 4 (Multi-Agent):
  @opentelemetry/sdk-node    Distributed tracing
  prom-client                Prometheus metrics

Phase 5 (Advanced Accessibility):
  @anthropic-ai/sdk          Claude API (vision, reasoning)

Phase 6 (Production):
  @sentry/node               Error tracking
  isolated-vm                Plugin sandbox (upgrade)
```
