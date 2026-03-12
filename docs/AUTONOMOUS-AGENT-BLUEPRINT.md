# Autonomous Agent Blueprint

> Building a Manus-grade autonomous desktop agent for people with disabilities (PWDs) -- inclusive learning, independent living, and full computer autonomy.

---

## Why Manus Feels So Powerful

Manus is not powerful because of any single model. **The key reason is architecture, not the model.** Three pillars make it behave like a digital worker rather than a chatbot:

| Pillar | What It Does | Neura Equivalent |
|---|---|---|
| **Multi-Agent Orchestration** | Decomposes complex tasks across specialist agents that collaborate -- planner, researcher, executor, verifier | Orchestrator pattern with role-based sub-agents (see below) |
| **Tool Execution Environment** | Agents can control browsers, desktop apps, file systems, run code in sandboxes -- real computer interaction, not just text generation | Playwright (browser), nut.js (desktop), Docker (code sandbox), Node.js fs (files) |
| **Self-Verification Loops** | Every action is verified against acceptance criteria. If it fails, the system re-plans and retries. The agent checks its own work | Verify stage in agent loop + dedicated Verification Agent that screenshots results and validates |

**Neura adds a fourth pillar that Manus lacks:**

| Pillar | What It Does |
|---|---|
| **Accessibility-First Governance** | Every action passes through consent, role, and autonomy gates designed for vulnerable users. Voice-first interaction, screen reader integration, disability-adaptive UI, plain-language explanations |

---

## Equivalent Model Stack

Manus-level performance requires strong reasoning models. Neura supports multiple providers:

### Cloud Reasoning Models (for complex tasks)

| Model | Provider | Best For | How Neura Uses It |
|---|---|---|---|
| **Claude Sonnet/Opus** | Anthropic | Complex reasoning, tool use, long context, safety | Primary cloud provider -- planning, multi-step reasoning, code generation |
| **GPT-4o** | OpenAI | Multimodal, fast reasoning | Alternative cloud provider |
| **DeepSeek-R1** | DeepSeek | Chain-of-thought reasoning, cost-effective | Budget-friendly cloud alternative |
| **Qwen 2.5** | Alibaba | Multilingual, coding, reasoning | Alternative for non-English users |

### Local Models (for privacy, offline, low-latency)

| Model | Size | Best For | Runtime |
|---|---|---|---|
| **Llama 3.1 8B** | ~8 GB | General reasoning, planning | Ollama |
| **Mistral 7B** | ~7 GB | Fast reasoning, instruction following | Ollama / llama.cpp |
| **Qwen 2.5 7B** | ~7 GB | Multilingual, coding | Ollama |
| **Phi-3 Mini 3.8B** | ~3.8 GB | Lightweight reasoning on modest hardware | Ollama / ONNX |
| **Gemma 2 2B** | ~2 GB | Ultra-lightweight, edge devices | Ollama / ONNX |

### Agent Orchestration Frameworks (reference)

| Framework | Architecture | Key Strength | GitHub |
|---|---|---|---|
| **CrewAI** | Role-based agent crews | Easiest multi-agent setup, great for defined roles | [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) |
| **AutoGen** | Conversational multi-agent | Agents negotiate and collaborate via messages | [microsoft/autogen](https://github.com/microsoft/autogen) |
| **LangGraph** | Graph-based state machines | Most flexible orchestration, conditional branching | [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) |

Neura implements its own orchestrator in TypeScript (see Multi-Agent Orchestration below) inspired by patterns from all three frameworks, with accessibility-specific extensions.

---

## Vision

Imara Vision Agent (Neura) is an autonomous desktop agent that gives people with disabilities full, independent control over their computers and digital lives. Like Manus, it can browse the web, control desktop applications, read and write files, execute code, and orchestrate multi-step workflows -- but every capability is designed through an accessibility-first lens.

Where Manus targets general-purpose autonomy, Neura targets **autonomy for people who need it most**: learners with additional needs, people with motor/visual/cognitive disabilities, and individuals living independently who need an AI partner that acts on their behalf with safety and consent.

---

## Architecture Overview

```
+-----------------------------------------------------------------------+
|                         Neura Desktop Agent                           |
|                                                                       |
|  +------------------+  +------------------+  +---------------------+  |
|  |   Tauri / Electron   |  |   Agent Core     |  |  Accessibility    |  |
|  |   Desktop Shell      |  |   (TypeScript)   |  |  Engine           |  |
|  |                      |  |                  |  |                   |  |
|  |  - System tray       |  |  - Agent loop    |  |  - Screen reader  |  |
|  |  - Native UI         |  |  - Scheduler     |  |  - Voice control  |  |
|  |  - OS integration    |  |  - Memory        |  |  - Switch access  |  |
|  |  - Global hotkeys    |  |  - Policy engine |  |  - Eye tracking   |  |
|  +--------+-------------+  +--------+---------+  +--------+----------+  |
|           |                         |                      |            |
|           +-------------------------+----------------------+            |
|                                     |                                   |
|  +----------------------------------v---------------------------------+ |
|  |                    Multi-Agent Orchestrator                        | |
|  |                                                                    | |
|  |  +-----------+ +-----------+ +------------+ +------------------+  | |
|  |  | Planner   | | Research  | | Execution  | | Verification     |  | |
|  |  | Agent     | | Agent     | | Agent      | | Agent            |  | |
|  |  +-----------+ +-----------+ +------------+ +------------------+  | |
|  +--------------------------------------------------------------------+ |
|                                     |                                   |
|  +----------------------------------v---------------------------------+ |
|  |                      Tool Layer                                    | |
|  |                                                                    | |
|  |  +----------+ +----------+ +---------+ +--------+ +-----------+  | |
|  |  | Browser  | | Desktop  | | File    | | Code   | | Computer  |  | |
|  |  | Control  | | Control  | | System  | | Exec   | | Vision    |  | |
|  |  +----------+ +----------+ +---------+ +--------+ +-----------+  | |
|  +--------------------------------------------------------------------+ |
|                                     |                                   |
|  +----------------------------------v---------------------------------+ |
|  |                    Inference Layer                                 | |
|  |                                                                    | |
|  |  +------------+ +------------+ +-------------+ +---------------+  | |
|  |  | Local LLM  | | Cloud LLM  | | Vision      | | Speech/TTS   |  | |
|  |  | (Ollama)   | | (Anthropic) | | Models      | | Models       |  | |
|  |  +------------+ +------------+ +-------------+ +---------------+  | |
|  +--------------------------------------------------------------------+ |
|                                     |                                   |
|  +----------------------------------v---------------------------------+ |
|  |                    Memory & State                                  | |
|  |                                                                    | |
|  |  +----------+ +-------------+ +----------+ +------------------+   | |
|  |  | Working  | | Episodic    | | Semantic | | User Profile     |   | |
|  |  | Memory   | | Memory      | | Memory   | | & Preferences    |   | |
|  |  +----------+ +-------------+ +----------+ +------------------+   | |
|  +--------------------------------------------------------------------+ |
|                                     |                                   |
|  +----------------------------------v---------------------------------+ |
|  |              Governance, Safety & Telemetry                        | |
|  +--------------------------------------------------------------------+ |
+-----------------------------------------------------------------------+
```

---

## Core Subsystems

### 1. Desktop Shell (UI Layer)

The desktop shell provides the native application wrapper and all OS-level integrations.

**Current:** Vanilla HTML/CSS/JS served via Express (port 3210)
**Target:** Tauri 2.0 or Electron with native accessibility APIs

| Capability | Purpose | PWD Benefit |
|---|---|---|
| System tray agent | Always-available assistant | One-click/voice access without navigating windows |
| Global hotkeys | Trigger agent from any app | Motor-impaired users can summon help anywhere |
| Native notifications | Alert user to completed tasks | Works with screen readers and notification centres |
| Screen overlay | Floating assistant panel | Non-intrusive guidance for cognitive support |
| File drag & drop | Attach files to tasks | Simplified file handling without file picker navigation |

**Technology choices:**

| Option | Pros | Cons | GitHub |
|---|---|---|---|
| **Tauri 2.0** | Small binary (~5 MB), Rust performance, native webview | Younger ecosystem, less electron plugin support | [tauri-apps/tauri](https://github.com/tauri-apps/tauri) |
| **Electron** | Mature, huge ecosystem, Chromium-based | Large binary (~150 MB), higher memory | [electron/electron](https://github.com/electron/electron) |
| **Neutralinojs** | Lightweight, no bundled runtime | Limited native API surface | [neutralinojs/neutralinojs](https://github.com/neutralinojs/neutralinojs) |

**Recommendation:** Start with Electron (current Node.js stack compatibility), migrate to Tauri 2.0 when the Rust core layer is ready.

### 2. Agent Core (Brain)

The agent core runs the sense-interpret-plan-act-verify-adapt loop documented in [ARCHITECTURE.md](ARCHITECTURE.md). For Manus-grade autonomy, the core is extended with:

#### Multi-Agent Orchestration

Instead of a single agent loop, Neura uses specialised sub-agents that coordinate through a central orchestrator:

```
User Request
     |
     v
+--------------------+
|   Orchestrator     |  Decomposes request, assigns to specialist agents,
|   (Conductor)      |  manages dependencies, aggregates results
+----+-----+---------+
     |     |     |
     v     v     v
  Planner  Research  Execution
  Agent    Agent     Agent
     |                  |
     v                  v
  Verification       Adaptation
  Agent              Agent
```

| Agent | Responsibility | Tools Available |
|---|---|---|
| **Planner** | Decompose complex requests into sub-tasks, determine ordering and dependencies | Memory search, inference |
| **Research** | Gather information from web, files, databases | Browser, file system, web search |
| **Execution** | Carry out actions: fill forms, click buttons, write files, run code | Browser control, desktop control, code execution, file system |
| **Verification** | Validate results, check for errors, compare against acceptance criteria (Manus Pillar 3) | Screenshot analysis, file comparison, test runners |
| **Adaptation** | Update user profile, learn from corrections, adjust future behaviour | Memory store, user profile |

#### Self-Verification Loop (Manus Pillar 3)

This is what separates an autonomous agent from a chatbot. After every execution, the Verification Agent checks the work:

```
Execution Agent completes action
         |
         v
Verification Agent inspects result
         |
         +--- Pass? ---> Return result to user
         |
         +--- Fail? ---> Feed error back to Planner
                               |
                               v
                          Re-plan with error context
                               |
                               v
                          Execution Agent retries
                               |
                               v
                          Verification Agent re-checks
                               |
                          (max 3 retry cycles)
```

**Verification methods:**
| Method | When Used | Example |
|---|---|---|
| **Screenshot comparison** | Browser/desktop actions | Take screenshot after form submit, verify confirmation page appeared |
| **Content validation** | Text generation | Check output contains required sections, meets length/quality criteria |
| **File existence check** | File operations | Verify file was created/modified at expected path |
| **API response check** | Web interactions | Verify HTTP status code and response body |
| **User criteria match** | All tasks | Compare result against the user's original instruction |
| **Accessibility check** | UI operations | Verify action didn't break screen reader compatibility |

#### Agent Communication Protocol

```typescript
interface AgentMessage {
  from: string          // agent ID
  to: string            // target agent ID or 'orchestrator'
  type: 'task' | 'result' | 'error' | 'status' | 'handoff'
  payload: {
    taskId: string
    instruction: string
    context: Record<string, unknown>
    artifacts?: Artifact[]    // files, screenshots, data
    confidence: number
  }
  timestamp: string
}

interface Artifact {
  type: 'screenshot' | 'file' | 'data' | 'html' | 'text'
  content: string | Buffer
  metadata: Record<string, unknown>
}
```

#### Orchestration Patterns

| Pattern | When to Use | Example |
|---|---|---|
| **Sequential** | Steps depend on previous results | Research topic -> Write essay -> Proofread |
| **Parallel** | Independent sub-tasks | Search 3 websites simultaneously |
| **Pipeline** | Each agent transforms and passes forward | Extract text -> Summarise -> Format as flashcards |
| **Supervisor** | One agent monitors others | Verification agent checks execution agent's work |
| **Consensus** | Multiple agents vote on best approach | 3 planner agents propose strategies, best one wins |

### 3. Tool Layer

The tool layer gives agents the ability to interact with the computer and the world. Each tool is a sandboxed capability with defined inputs, outputs, and permission requirements.

#### Browser Automation

Full web browser control for form filling, web research, online shopping, booking appointments, and accessing web applications.

```typescript
interface BrowserTool {
  // Navigation
  navigate(url: string): Promise<void>
  goBack(): Promise<void>
  goForward(): Promise<void>
  refresh(): Promise<void>

  // Interaction
  click(selector: string): Promise<void>
  type(selector: string, text: string): Promise<void>
  select(selector: string, value: string): Promise<void>
  scroll(direction: 'up' | 'down', amount: number): Promise<void>
  hover(selector: string): Promise<void>

  // Reading
  getText(selector: string): Promise<string>
  getHTML(): Promise<string>
  screenshot(): Promise<Buffer>
  extractTable(selector: string): Promise<string[][]>
  extractLinks(): Promise<Array<{ text: string; href: string }>>

  // Forms
  fillForm(fields: Record<string, string>): Promise<void>
  submitForm(selector: string): Promise<void>

  // Waiting
  waitForSelector(selector: string, timeout?: number): Promise<void>
  waitForNavigation(timeout?: number): Promise<void>
}
```

**Implementation:** [Playwright](https://github.com/microsoft/playwright) -- Microsoft's browser automation library. Supports Chromium, Firefox, and WebKit. Accessibility-tree-based selectors align perfectly with screen reader compatibility.

**PWD-specific browser capabilities:**
- Auto-fill forms that are inaccessible to screen readers
- Navigate CAPTCHAs on behalf of visually impaired users
- Simplify cluttered web pages into readable summaries
- Read aloud web content with context-aware emphasis
- Fill out government/benefits forms with stored personal data
- Book medical appointments through complex booking portals

#### Desktop Automation

Control native desktop applications -- click buttons, type text, read screen content, manage windows.

```typescript
interface DesktopTool {
  // Screen reading
  screenshot(region?: { x: number; y: number; w: number; h: number }): Promise<Buffer>
  getActiveWindow(): Promise<WindowInfo>
  listWindows(): Promise<WindowInfo[]>
  getScreenText(region?: Region): Promise<string>  // OCR

  // Mouse control
  moveMouse(x: number, y: number): Promise<void>
  click(x: number, y: number, button?: 'left' | 'right'): Promise<void>
  doubleClick(x: number, y: number): Promise<void>
  drag(from: Point, to: Point): Promise<void>

  // Keyboard
  typeText(text: string): Promise<void>
  pressKey(key: string, modifiers?: string[]): Promise<void>
  hotkey(...keys: string[]): Promise<void>

  // Window management
  focusWindow(title: string): Promise<void>
  resizeWindow(title: string, width: number, height: number): Promise<void>
  minimizeWindow(title: string): Promise<void>

  // Accessibility tree (native)
  getAccessibilityTree(windowTitle: string): Promise<AccessibilityNode>
  findElement(role: string, name: string): Promise<AccessibilityNode | null>
  activateElement(node: AccessibilityNode): Promise<void>
}
```

**Implementation options:**

| Library | Language | Platform | GitHub |
|---|---|---|---|
| **nut.js** | TypeScript/Node.js | Windows, macOS, Linux | [nut-tree/nut.js](https://github.com/nut-tree/nut.js) |
| **RobotJS** | Node.js (native addon) | Windows, macOS, Linux | [octalmage/robotjs](https://github.com/octalmage/robotjs) |
| **PyAutoGUI** | Python | Windows, macOS, Linux | [asweigart/pyautogui](https://github.com/asweigart/pyautogui) |
| **Accessibility Insights** | .NET/TS | Windows (UIA) | [microsoft/accessibility-insights-windows](https://github.com/microsoft/accessibility-insights-windows) |

**Recommendation:** Use **nut.js** for cross-platform desktop control (native Node.js, TypeScript types). Supplement with platform-specific accessibility APIs (Windows UI Automation, macOS Accessibility API, AT-SPI on Linux) for reading application state without screenshots.

**PWD-specific desktop capabilities:**
- Operate applications that lack keyboard shortcuts (motor impairment)
- Read and describe on-screen content for visually impaired users
- Automate repetitive multi-step workflows (cognitive load reduction)
- Control applications via voice commands mapped to desktop actions
- Resize and reposition windows for optimal viewing (low vision)

#### File System Operations

```typescript
interface FileSystemTool {
  readFile(path: string, encoding?: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  listDirectory(path: string, recursive?: boolean): Promise<FileInfo[]>
  createDirectory(path: string): Promise<void>
  deleteFile(path: string): Promise<void>          // requires confirmation
  moveFile(from: string, to: string): Promise<void>
  copyFile(from: string, to: string): Promise<void>
  searchFiles(pattern: string, directory: string): Promise<string[]>
  getFileInfo(path: string): Promise<FileInfo>
  watchFile(path: string, callback: (event: string) => void): void
}
```

#### Code Execution (Sandboxed)

```typescript
interface CodeExecutionTool {
  execute(params: {
    language: 'javascript' | 'typescript' | 'python' | 'bash'
    code: string
    timeout?: number        // default: 30s
    memoryLimit?: number    // default: 256 MB
    networkAccess?: boolean // default: false
  }): Promise<{
    stdout: string
    stderr: string
    exitCode: number
    artifacts?: Artifact[]
  }>
}
```

**Sandbox implementation:**

| Technology | Use Case | GitHub |
|---|---|---|
| **Docker** | Isolated containers for code execution | [moby/moby](https://github.com/moby/moby) |
| **Firecracker** | Lightweight microVMs (production) | [firecracker-microvm/firecracker](https://github.com/firecracker-microvm/firecracker) |
| **isolated-vm** | V8 isolates for JavaScript (plugins) | [laverdet/isolated-vm](https://github.com/laverdet/isolated-vm) |
| **WebAssembly** | In-process sandboxing | [aspect-build/aspect-workflows](https://webassembly.org/) |

**Recommendation:** Use Docker containers for general code execution. Use `isolated-vm` for plugin sandboxing (already planned). Add Firecracker microVMs for production multi-tenant deployments.

#### Computer Vision

```typescript
interface ComputerVisionTool {
  // Screen understanding
  describeScreen(screenshot: Buffer): Promise<string>
  locateElement(screenshot: Buffer, description: string): Promise<BoundingBox>
  readText(image: Buffer): Promise<string>  // OCR
  identifyUI(screenshot: Buffer): Promise<UIElement[]>

  // Document understanding
  extractFromPDF(path: string): Promise<{ text: string; tables: Table[]; images: Image[] }>
  extractFromImage(path: string): Promise<{ text: string; objects: DetectedObject[] }>

  // Accessibility
  describeImage(image: Buffer, context?: string): Promise<string>  // Alt-text generation
  analyzeContrast(screenshot: Buffer): Promise<ContrastReport>
  detectSmallText(screenshot: Buffer): Promise<SmallTextRegion[]>
}
```

**Implementation:**

| Model/Library | Purpose | GitHub/Source |
|---|---|---|
| **Tesseract.js** | OCR (text extraction from images) | [naptha/tesseract.js](https://github.com/naptha/tesseract.js) |
| **ONNX Runtime** | Run vision models locally | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |
| **Claude Vision** | Screenshot understanding, UI element detection | Anthropic API (cloud) |
| **Florence-2** | Object detection, OCR, captioning | [microsoft/Florence-2](https://huggingface.co/microsoft/Florence-2-large) |
| **OpenCV.js** | Image processing, contrast analysis | [opencv/opencv](https://github.com/opencv/opencv) |

### 4. Inference Layer

#### Local Model Support

Running models locally is critical for PWDs: it ensures privacy, works offline, and reduces latency for real-time accessibility features.

| Runtime | Purpose | Models | GitHub |
|---|---|---|---|
| **Ollama** | Local LLM serving (easiest setup) | Llama 3, Mistral, Phi-3, Gemma 2 | [ollama/ollama](https://github.com/ollama/ollama) |
| **llama.cpp** | Optimised CPU/GPU inference | GGUF-format models | [ggerganov/llama.cpp](https://github.com/ggerganov/llama.cpp) |
| **vLLM** | High-throughput GPU inference | Any HuggingFace model | [vllm-project/vllm](https://github.com/vllm-project/vllm) |
| **ONNX Runtime** | Cross-platform, edge-optimised | ONNX-format models | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |
| **Whisper.cpp** | Local speech-to-text | Whisper models | [ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp) |
| **Piper TTS** | Local text-to-speech | Piper voice models | [rhasspy/piper](https://github.com/rhasspy/piper) |

#### Recommended Local Model Stack

```
+---------------------------+
|  Orchestration LLM        |  Llama 3.1 8B or Mistral 7B (via Ollama)
|  Planning, reasoning      |  ~8 GB VRAM / 16 GB RAM
+---------------------------+
|  Vision Model             |  Florence-2 or moondream (via ONNX)
|  Screen understanding     |  ~2 GB VRAM
+---------------------------+
|  Speech-to-Text           |  Whisper medium/large (via whisper.cpp)
|  Voice commands           |  ~1.5 GB RAM
+---------------------------+
|  Text-to-Speech           |  Piper (via piper-tts)
|  Voice output             |  ~100 MB RAM
+---------------------------+
|  Embedding Model          |  all-MiniLM-L6 (via ONNX)
|  Memory search            |  ~90 MB RAM
+---------------------------+
```

#### Cloud Inference (Fallback)

| Provider | Best For | API |
|---|---|---|
| **Anthropic Claude** | Complex reasoning, long context, tool use | [anthropic.com/api](https://docs.anthropic.com) |
| **OpenAI GPT-4** | Alternative reasoning provider | OpenAI API |
| **Google Gemini** | Multimodal (vision + text) | Google AI API |

#### Inference Router

```typescript
interface InferenceRouter {
  route(request: InferenceRequest): Promise<InferenceResponse>
}

// Routing logic:
// 1. Check if task can be handled locally (model available + task within capacity)
// 2. Check privacy requirements (PII present -> force local)
// 3. Check connectivity (offline -> force local)
// 4. Check latency requirements (real-time accessibility -> prefer local)
// 5. Fallback to cloud with PII redaction
```

### 5. Memory System

Manus-grade agents need sophisticated memory to maintain context across sessions, learn from user behaviour, and personalise over time.

#### Memory Architecture

```
+----------------------------------------------------------------+
|                    Memory Manager                               |
+----------------------------------------------------------------+
|                                                                  |
|  +------------------+  +------------------+  +----------------+ |
|  | Working Memory   |  | Episodic Memory  |  | Semantic       | |
|  | (In-process)     |  | (SQLite)         |  | Memory         | |
|  |                  |  |                  |  | (Vector DB)    | |
|  | Current task     |  | Past sessions    |  |                | |
|  | context, active  |  | Completed tasks  |  | User knowledge | |
|  | conversation,    |  | User corrections |  | Learned facts  | |
|  | tool outputs     |  | Interaction logs |  | Embeddings     | |
|  +------------------+  +------------------+  +----------------+ |
|                                                                  |
|  +------------------+  +------------------+                      |
|  | User Profile     |  | Procedural       |                     |
|  | (JSON file)      |  | Memory           |                     |
|  |                  |  | (SQLite)         |                     |
|  | Accessibility    |  |                  |                     |
|  | preferences,     |  | Learned routines |                     |
|  | disabilities,    |  | Automation steps |                     |
|  | communication    |  | Workflow recipes |                     |
|  | style            |  |                  |                     |
|  +------------------+  +------------------+                      |
+----------------------------------------------------------------+
```

| Memory Type | Storage | Retention | Purpose |
|---|---|---|---|
| **Working** | In-process (RAM) | Current session | Active task context, conversation buffer |
| **Episodic** | SQLite | 90 days (configurable) | What happened: completed tasks, corrections, interactions |
| **Semantic** | SQLite + vector embeddings | Permanent (user-deletable) | What the agent knows: facts, preferences, learned patterns |
| **User Profile** | JSON file | Permanent | Accessibility needs, communication preferences, disability profile |
| **Procedural** | SQLite | Permanent | How to do things: learned workflows, automation sequences |

#### Vector Storage Options

| Technology | Type | Best For | GitHub |
|---|---|---|---|
| **sqlite-vss** | SQLite extension | Embedded, single-user | [asg017/sqlite-vss](https://github.com/asg017/sqlite-vss) |
| **Chroma** | Standalone vector DB | Local or client-server | [chroma-core/chroma](https://github.com/chroma-core/chroma) |
| **FAISS** | Facebook's vector search | High-performance search | [facebookresearch/faiss](https://github.com/facebookresearch/faiss) |
| **LanceDB** | Embedded vector DB | Serverless, Rust-based | [lancedb/lancedb](https://github.com/lancedb/lancedb) |
| **pgvector** | PostgreSQL extension | Multi-user, server deployments | [pgvector/pgvector](https://github.com/pgvector/pgvector) |

**Recommendation:** Use **sqlite-vss** for the desktop agent (zero infrastructure, embedded). Use **pgvector** for the app engine (multi-user, scalable). Use **LanceDB** as a potential future migration (Rust-native, performant).

### 6. Execution Sandbox

All agent-executed code and browser automation runs inside sandboxed environments to prevent accidental damage.

```
+-------------------------------------------+
|  User's Computer                          |
|                                           |
|  +-------------------------------------+ |
|  |  Neura Agent (main process)         | |
|  |                                     | |
|  |  +-------------------------------+  | |
|  |  |  Docker Container             |  | |
|  |  |  (code execution sandbox)     |  | |
|  |  |                               |  | |
|  |  |  - No network (by default)    |  | |
|  |  |  - Read-only filesystem       |  | |
|  |  |  - Memory limited (256 MB)    |  | |
|  |  |  - CPU limited (1 core)       |  | |
|  |  |  - 30s timeout                |  | |
|  |  +-------------------------------+  | |
|  |                                     | |
|  |  +-------------------------------+  | |
|  |  |  Playwright Browser           |  | |
|  |  |  (browser automation sandbox) |  | |
|  |  |                               |  | |
|  |  |  - Separate browser profile   |  | |
|  |  |  - No access to user cookies  |  | |
|  |  |  - Screenshot-based feedback  |  | |
|  |  |  - URL allowlist (optional)   |  | |
|  |  +-------------------------------+  | |
|  |                                     | |
|  |  +-------------------------------+  | |
|  |  |  V8 Isolate                   |  | |
|  |  |  (plugin sandbox)             |  | |
|  |  |                               |  | |
|  |  |  - 128 MB memory limit        |  | |
|  |  |  - No filesystem access       |  | |
|  |  |  - Controlled API surface     |  | |
|  |  +-------------------------------+  | |
|  +-------------------------------------+ |
+-------------------------------------------+
```

### 7. Observability

Production-grade observability for monitoring agent health, debugging failures, and understanding user patterns.

| Layer | Technology | Purpose | GitHub |
|---|---|---|---|
| **Metrics** | Prometheus client | Agent performance, task throughput, inference latency | [siimon/prom-client](https://github.com/siimon/prom-client) |
| **Tracing** | OpenTelemetry | Distributed tracing across agent stages | [open-telemetry/opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js) |
| **Logging** | Pino | Structured JSON logs | [pinojs/pino](https://github.com/pinojs/pino) |
| **Dashboards** | Grafana | Visual monitoring | [grafana/grafana](https://github.com/grafana/grafana) |
| **Error tracking** | Sentry | Crash reporting, error aggregation | [getsentry/sentry-javascript](https://github.com/getsentry/sentry-javascript) |

#### Key Metrics

| Metric | Type | Description |
|---|---|---|
| `neura_tasks_total` | Counter | Total tasks created |
| `neura_tasks_completed` | Counter | Successfully completed tasks |
| `neura_tasks_failed` | Counter | Failed tasks |
| `neura_task_duration_seconds` | Histogram | Task execution time |
| `neura_inference_duration_seconds` | Histogram | Inference latency (local vs cloud) |
| `neura_policy_blocks_total` | Counter | Actions blocked by policy engine |
| `neura_memory_entries` | Gauge | Total memory entries |
| `neura_active_agents` | Gauge | Currently running sub-agents |
| `neura_browser_actions_total` | Counter | Browser automation actions |
| `neura_desktop_actions_total` | Counter | Desktop automation actions |

---

## PWD-Specific Use Cases

### Independent Living

| Use Case | Agent Actions | Tools Used |
|---|---|---|
| **Pay utility bills online** | Navigate to provider website, log in, find balance, initiate payment, confirm | Browser, vision, memory |
| **Book medical appointments** | Search NHS/provider portal, find available slots, fill booking form | Browser, form fill, calendar |
| **Order groceries** | Browse supermarket website, add items from saved list, checkout | Browser, memory, payment |
| **Read and reply to emails** | Open email client, read messages aloud, compose reply from voice | Browser/desktop, TTS, STT |
| **Fill out benefits forms** | Navigate government portal, fill complex forms with stored personal data | Browser, form fill, memory, file system |
| **Set up smart home devices** | Open device app, configure settings, create routines | Desktop control, browser |
| **Manage finances** | Log into banking app, categorise transactions, flag unusual activity | Browser, vision, memory |

### Inclusive Learning

| Use Case | Agent Actions | Tools Used |
|---|---|---|
| **Summarise lecture recordings** | Transcribe audio, extract key points, generate study notes | STT, inference, file system |
| **Create revision materials** | Analyse notes, identify weak areas, generate flashcards and quizzes | Inference, memory, file system |
| **Research assignments** | Search academic sources, extract relevant information, compile bibliography | Browser, inference, file system |
| **Write and proofread essays** | Draft from outline, check grammar, format according to guidelines | Inference, file system |
| **Read textbooks aloud** | Extract text from PDF/images, read with adjustable speed and voice | File system, OCR, TTS |
| **Explain complex concepts** | Break down difficult topics using analogies and visual aids | Inference, vision |
| **Take notes during class** | Real-time transcription, highlight key points, organise by topic | STT, inference, file system |

### Communication Support

| Use Case | Agent Actions | Tools Used |
|---|---|---|
| **Draft messages** | Compose emails/texts from voice input or keywords | STT, inference |
| **Translate and simplify** | Convert complex text to plain language or other languages | Inference |
| **AAC (Augmentative Communication)** | Generate contextual phrases, predict next words | Inference, memory |
| **Social story generation** | Create visual social narratives for autism support | Inference, vision, file system |

### Educator & Carer Support

| Use Case | Agent Actions | Tools Used |
|---|---|---|
| **Generate IEP materials** | Create individualised education plan documents | Inference, memory, file system |
| **Track student progress** | Analyse task history, identify patterns, generate reports | Memory, inference |
| **Create accessible materials** | Convert documents to accessible formats (large print, audio, simplified) | File system, inference, TTS |
| **Monitor wellbeing signals** | Detect changes in interaction patterns, flag concerns | Memory, inference |

---

## Implementation Roadmap

### Phase 1: Foundation (Current)
- [x] Agent core loop (sense-interpret-plan-act-verify-adapt)
- [x] Task scheduler with priority queues
- [x] Persistent memory (file-based)
- [x] Policy engine (consent, role, autonomy gates)
- [x] Plugin system (sandboxed V8 isolates)
- [x] App engine (REST + WebSocket API)
- [x] Desktop CLI agent
- [x] Chat UI with accessibility settings
- [x] Voice input/output (Web Speech API)
- [x] File attachment system

### Phase 2: Computer Control (Next)
- [ ] Integrate Playwright for browser automation
- [ ] Integrate nut.js for desktop control
- [ ] Add screenshot-based UI understanding (Claude Vision)
- [ ] Add OCR pipeline (Tesseract.js)
- [ ] Build form-filling engine
- [ ] Implement URL allowlist and browser sandbox
- [ ] Add multi-step browser workflow recording/replay

### Phase 3: Local Intelligence
- [ ] Integrate Ollama for local LLM inference
- [ ] Add whisper.cpp for local speech-to-text
- [ ] Add Piper for local text-to-speech
- [ ] Build inference router (local/cloud auto-selection)
- [ ] Add vector memory with sqlite-vss
- [ ] Implement user profile system (disability, preferences)

### Phase 4: Multi-Agent Orchestration
- [ ] Build orchestrator (conductor agent)
- [ ] Implement planner, research, execution, verification agents
- [ ] Add inter-agent communication protocol
- [ ] Build parallel execution pipeline
- [ ] Add agent health monitoring and recovery
- [ ] Implement consensus-based planning

### Phase 5: Advanced Accessibility
- [ ] Windows UI Automation integration
- [ ] macOS Accessibility API integration
- [ ] Switch access and eye tracking support
- [ ] AAC (augmentative communication) system
- [ ] Smart home integration (Home Assistant)
- [ ] Mobile companion app (React Native)

### Phase 6: Production Hardening
- [ ] Migrate to Tauri 2.0 (optional)
- [ ] Add Docker sandbox for code execution
- [ ] Implement OpenTelemetry tracing
- [ ] Add Prometheus metrics
- [ ] Build admin dashboard for carers/educators
- [ ] Security audit and penetration testing
- [ ] WCAG 2.2 AA certification

---

## Security Model

### Threat Model for PWD Users

PWD users are disproportionately targeted by scams and phishing. The agent must protect them:

| Threat | Mitigation |
|---|---|
| Phishing sites during browser automation | URL reputation checking, visual similarity detection against known legitimate sites |
| Financial fraud during payment automation | Transaction amount verification, double-confirmation for payments above threshold |
| PII exposure to cloud APIs | PII detection and redaction before any cloud call, local-first default |
| Agent performing unintended destructive actions | L0-L4 autonomy model, confirmation gates, undo buffer for reversible actions |
| Malicious plugins exploiting vulnerable users | Sandbox isolation, permission model, curated plugin registry |
| Social engineering via AI manipulation | Bounded action set, no actions outside defined capabilities |
| Stale data causing outdated medical/legal actions | Memory expiry, confidence scoring, "data last verified" timestamps |

### Permission Model for Computer Control

```typescript
interface ToolPermissions {
  browser: {
    enabled: boolean
    allowedDomains: string[]      // empty = all allowed
    blockedDomains: string[]      // always blocked
    canLogin: boolean             // can agent use stored credentials
    canMakePayments: boolean      // can agent complete purchases
    canSubmitForms: boolean       // can agent submit government/medical forms
    requireScreenshotReview: boolean // show user what agent sees
  }
  desktop: {
    enabled: boolean
    allowedApps: string[]         // empty = all allowed
    canTypePasswords: boolean     // default: false
    canDeleteFiles: boolean       // default: false (requires confirmation)
    canInstallSoftware: boolean   // default: false
  }
  codeExecution: {
    enabled: boolean
    allowedLanguages: string[]
    networkAccess: boolean        // default: false
    maxExecutionTime: number      // seconds
    maxMemory: number             // MB
  }
  fileSystem: {
    enabled: boolean
    allowedPaths: string[]        // scoped access
    canDelete: boolean            // default: false
    canModifySystem: boolean      // default: false
  }
}
```

---

## Reference Architectures

### Open-Source Autonomous Agents (Inspiration)

| Project | Architecture | Key Learning | GitHub |
|---|---|---|---|
| **OpenInterpreter** | Python, local code execution, conversational | Natural language to computer actions | [OpenInterpreter/open-interpreter](https://github.com/OpenInterpreter/open-interpreter) |
| **AutoGPT** | Multi-agent, plugin system, web browsing | Agent loop patterns, plugin architecture | [Significant-Gravitas/AutoGPT](https://github.com/Significant-Gravitas/AutoGPT) |
| **CrewAI** | Multi-agent orchestration, role-based agents | Agent roles, task delegation | [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) |
| **LangChain** | LLM framework, tool use, chains | Tool abstraction, agent patterns | [langchain-ai/langchain](https://github.com/langchain-ai/langchain) |
| **LangGraph** | Stateful multi-agent workflows | Graph-based agent orchestration | [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) |
| **Semantic Kernel** | Microsoft's AI orchestration | Planner patterns, memory, skills | [microsoft/semantic-kernel](https://github.com/microsoft/semantic-kernel) |
| **Haystack** | NLP framework, RAG pipelines | Document processing, retrieval | [deepset-ai/haystack](https://github.com/deepset-ai/haystack) |
| **Jan** | Local-first AI desktop app | Offline LLM, privacy-first UI | [janhq/jan](https://github.com/janhq/jan) |
| **AnythingLLM** | All-in-one AI desktop app | Document chat, multi-model | [Mintplex-Labs/anything-llm](https://github.com/Mintplex-Labs/anything-llm) |
| **Magentic-One** | Microsoft's multi-agent system | Orchestrator + specialist agents | [microsoft/autogen](https://github.com/microsoft/autogen) |

### Accessibility-Focused References

| Project | Purpose | GitHub |
|---|---|---|
| **NVDA** | Open-source screen reader (Windows) | [nvaccess/nvda](https://github.com/nvaccess/nvda) |
| **Orca** | Linux screen reader | [GNOME/orca](https://gitlab.gnome.org/GNOME/orca) |
| **axe-core** | Accessibility testing engine | [dequelabs/axe-core](https://github.com/dequelabs/axe-core) |
| **pa11y** | Automated accessibility testing | [pa11y/pa11y](https://github.com/pa11y/pa11y) |
| **Home Assistant** | Smart home automation | [home-assistant/core](https://github.com/home-assistant/core) |
| **OpenAT** | Open assistive technology projects | Various community projects |

---

## Configuration: Computer Control

Add these to the existing configuration hierarchy:

```typescript
// New configuration keys for autonomous computer control
interface AutonomousConfig {
  // Browser automation
  'browser.enabled': boolean              // default: true
  'browser.allowedDomains': string[]      // default: [] (all allowed)
  'browser.blockedDomains': string[]      // default: known malicious
  'browser.canMakePayments': boolean      // default: false
  'browser.requireReview': boolean        // default: true
  'browser.headless': boolean             // default: false (show browser)

  // Desktop control
  'desktop.enabled': boolean              // default: false (opt-in)
  'desktop.allowedApps': string[]         // default: []
  'desktop.canDelete': boolean            // default: false

  // Code execution
  'code.enabled': boolean                 // default: false (opt-in)
  'code.sandbox': 'docker' | 'isolate'   // default: 'docker'
  'code.timeout': number                  // default: 30

  // Local models
  'inference.localProvider': 'ollama' | 'llamacpp' | 'onnx' | 'none'
  'inference.localModel': string          // default: 'llama3.1:8b'
  'inference.localEndpoint': string       // default: 'http://localhost:11434'
  'inference.sttProvider': 'whisper' | 'web-speech' | 'cloud'
  'inference.ttsProvider': 'piper' | 'web-speech' | 'cloud'

  // Multi-agent
  'agents.maxConcurrent': number          // default: 3
  'agents.timeout': number                // default: 300 (5 min)
  'agents.consensus': boolean             // default: false
}
```

---

## NPM Dependencies to Add

```json
{
  "dependencies": {
    "playwright": "^1.42.0",
    "@nut-tree/nut-js": "^4.2.0",
    "tesseract.js": "^5.0.0",
    "pino": "^8.19.0",
    "@opentelemetry/sdk-node": "^0.49.0",
    "@opentelemetry/auto-instrumentations-node": "^0.43.0",
    "prom-client": "^15.1.0",
    "dockerode": "^4.0.0",
    "isolated-vm": "^4.7.0",
    "sqlite-vss": "^0.1.2"
  },
  "optionalDependencies": {
    "ollama": "^0.5.0",
    "@anthropic-ai/sdk": "^0.20.0"
  }
}
```

---

## Summary

Neura is not just another AI assistant. It is a **digital autonomy engine for people with disabilities** -- combining the computer-control capabilities of Manus with the safety, consent, and accessibility guarantees that vulnerable users need.

The architecture prioritises:
1. **Local-first**: Privacy and offline capability for users who may not have reliable internet
2. **Safety-first**: Bounded autonomy, confirmation gates, and undo buffers for every action
3. **Accessibility-first**: Every tool, every UI, every interaction designed for the widest range of abilities
4. **Extensibility**: Plugin system and multi-agent orchestration for growing capabilities over time
5. **Transparency**: Every action explained in plain language, every decision logged and auditable

See also:
- [ARCHITECTURE.md](ARCHITECTURE.md) -- Current system architecture
- [ACCESSIBILITY-ARCHITECTURE.md](ACCESSIBILITY-ARCHITECTURE.md) -- Accessibility-specific design decisions
- [TOOLS-AND-STACK.md](TOOLS-AND-STACK.md) -- Complete technology stack reference
- [SECURITY-AND-GOVERNANCE.md](SECURITY-AND-GOVERNANCE.md) -- Safety model and policy engine
