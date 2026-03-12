# Implementation Plan

> Test-driven, phased build plan for Imara Vision Agent. Every phase is testable via `npm run dev:ui` (http://localhost:3210) and `npm test`.

---

## Current State

**Working:**
- Agent core loop (6-stage: sense-interpret-plan-act-verify-adapt)
- Task scheduler with priority queues, concurrency control
- Memory store (in-memory + file persistence at ~/.neura/)
- Policy engine (consent, role, autonomy L0-L4 gates)
- Plugin host with 3 built-in plugins (note-summariser, revision-planner, accessibility-assist)
- Inference layer (rule-based local + cloud Anthropic stub)
- App engine (REST API + WebSocket on port 4100)
- Desktop UI server (Express + static HTML/CSS/JS on port 3210)
- Chat UI with voice input/output, file attachments, accessibility settings
- 36 tests passing across 5 suites

**Not yet working:**
- No real LLM (local or cloud) -- rule-based stubs only
- No browser automation
- No desktop control
- No OCR / computer vision
- No code execution sandbox
- No multi-agent orchestration
- No vector memory search
- No local STT/TTS (Web Speech API only)

---

## Phase 1: Real LLM Integration

**Goal:** Replace rule-based inference stubs with actual LLM calls. The agent should give real, useful answers.

### 1A: Ollama Local LLM

**Install:**
```bash
npm install ollama
```

**Files to create/modify:**

| File | Action | Purpose |
|---|---|---|
| `src/inference/ollama.ts` | Create | Ollama client wrapping the `ollama` npm package |
| `src/inference/local.ts` | Modify | Add Ollama as a provider option, keep rule-based as fallback |
| `src/inference/index.ts` | Modify | Route to Ollama when available |
| `src/shared/config.ts` | Modify | Add `inference.localProvider` and `inference.ollamaEndpoint` config keys |
| `tests/inference/ollama.test.ts` | Create | Unit tests for Ollama provider |

**OllamaInference class:**
```typescript
// src/inference/ollama.ts
import { Ollama } from 'ollama'

export class OllamaInference {
  private client: Ollama
  private model: string
  private ready = false

  constructor(options: { endpoint: string; model: string }) {
    this.client = new Ollama({ host: options.endpoint })
    this.model = options.model
  }

  async initialize(): Promise<boolean> {
    // Try to connect and verify model exists
  }

  async run(request: InferenceRequest): Promise<InferenceResult> {
    // Map request.type to appropriate Ollama prompt
    // Return structured InferenceResult
  }
}
```

**Config additions:**
```typescript
inference: {
  // existing keys...
  localProvider: 'ollama' | 'onnx' | 'rule-based'  // default: 'rule-based'
  ollamaEndpoint: string                             // default: 'http://localhost:11434'
  ollamaModel: string                                // default: 'llama3.1:8b'
}
```

**Test via dev server:**
1. Install Ollama and pull a model: `ollama pull llama3.1:8b`
2. Start dev server: `npm run dev:ui`
3. Open http://localhost:3210
4. Type "Summarise photosynthesis for a Year 8 student" -- should get a real, coherent response
5. Type "Create 5 quiz questions about the water cycle" -- should get actual questions
6. Check API: `curl http://localhost:3210/api/agent/health` -- should show `inference: "ollama"`

**Unit tests:**
```typescript
// tests/inference/ollama.test.ts
describe('OllamaInference', () => {
  it('should detect when Ollama is not running and mark as not ready')
  it('should fall back to rule-based when Ollama is unavailable')
  it('should handle classify requests')
  it('should handle generate requests')
  it('should handle plan requests')
  it('should respect timeout settings')
  it('should include provider="ollama" in results')
})
```

**Acceptance criteria:**
- [ ] `npm test` passes (including new tests)
- [ ] Agent gives real LLM responses when Ollama is running
- [ ] Agent falls back to rule-based responses when Ollama is not running
- [ ] Health endpoint shows which provider is active
- [ ] No breaking changes to existing API or UI

---

### 1B: Cloud Anthropic LLM

**Install:**
```bash
npm install @anthropic-ai/sdk
```

**Files to create/modify:**

| File | Action | Purpose |
|---|---|---|
| `src/inference/cloud.ts` | Modify | Replace stub with real Anthropic SDK calls |
| `tests/inference/cloud.test.ts` | Create | Unit tests (mocked SDK) |

**Test via dev server:**
1. Set env: `NEURA_CLOUD_API_KEY=sk-ant-xxx NEURA_PREFER_LOCAL=false npm run dev:ui`
2. Ask complex questions that benefit from a large model
3. Check health: inference should show `cloud: true`

**Acceptance criteria:**
- [ ] Cloud inference works with a valid API key
- [ ] PII detection logs a warning before sending to cloud (stub, actual redaction in Phase 5)
- [ ] Timeout and retry logic works
- [ ] Falls back to local when cloud fails

---

### 1C: Inference Router Improvements

**Files to modify:**

| File | Action |
|---|---|
| `src/inference/index.ts` | Smarter routing: complexity estimation, latency requirements |
| `src/shared/types.ts` | Add `InferenceRequest.complexity` field |

**Routing rules:**
```
Simple classification/embedding -> always local (Ollama or rule-based)
Short generation (< 200 tokens) -> local preferred
Long generation / complex reasoning -> cloud preferred (if available)
PII present in input -> force local
Offline -> force local
```

**Test via dev server:**
1. Ask simple question -> check telemetry shows `provider: "local"`
2. Ask complex multi-step question -> should route to cloud if available
3. Disconnect network -> should fall back to local gracefully

---

## Phase 2: Tool System Foundation

**Goal:** Create a tool registry and execution framework. Tools are the building blocks for browser control, desktop control, file access, and code execution.

### 2A: Tool Registry & Types

**Files to create:**

| File | Purpose |
|---|---|
| `src/tools/types.ts` | Tool interface, ToolResult, ToolPermission types |
| `src/tools/registry.ts` | Tool registry: register, discover, execute |
| `src/tools/index.ts` | Public exports |
| `tests/tools/registry.test.ts` | Registry tests |

**Core types:**
```typescript
// src/tools/types.ts
export interface Tool {
  name: string
  description: string
  category: 'browser' | 'desktop' | 'filesystem' | 'code' | 'vision' | 'communication'
  permissions: ToolPermission[]
  parameters: ToolParameter[]
  execute(params: Record<string, unknown>): Promise<ToolResult>
}

export interface ToolResult {
  success: boolean
  output: unknown
  artifacts?: ToolArtifact[]
  durationMs: number
  error?: string
}

export interface ToolArtifact {
  type: 'text' | 'image' | 'file' | 'html' | 'screenshot'
  content: string | Buffer
  mimeType?: string
  filename?: string
}

export type ToolPermission =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'filesystem.delete'
  | 'network.http'
  | 'browser.navigate'
  | 'browser.interact'
  | 'desktop.read'
  | 'desktop.control'
  | 'code.execute'
  | 'notification.send'
```

**Tool registry:**
```typescript
// src/tools/registry.ts
export class ToolRegistry {
  register(tool: Tool): void
  get(name: string): Tool | undefined
  list(category?: string): Tool[]
  execute(name: string, params: Record<string, unknown>): Promise<ToolResult>
  checkPermissions(tool: Tool, grantedPermissions: ToolPermission[]): boolean
}
```

**API route:**
```
GET  /api/agent/tools          -> list available tools
POST /api/agent/tools/:name    -> execute a tool (with policy check)
```

**Test via dev server:**
1. `curl http://localhost:3210/api/agent/tools` -- should list registered tools
2. UI settings should show "Skills" section with available tools

**Acceptance criteria:**
- [ ] ToolRegistry registers and discovers tools
- [ ] Permission checking works (block tools that require ungrated permissions)
- [ ] API endpoint lists tools
- [ ] `npm test` passes

---

### 2B: File System Tool

**Files to create:**

| File | Purpose |
|---|---|
| `src/tools/filesystem.ts` | File read, write, list, search operations |
| `tests/tools/filesystem.test.ts` | Tests with temp directories |

**Operations:**
- `read_file` -- read text file contents
- `write_file` -- write/create text file (requires confirmation at L1-L2)
- `list_directory` -- list files and folders
- `search_files` -- glob pattern search
- `file_info` -- size, modified date, type

**Test via dev server:**
1. Chat: "List the files on my desktop" -> agent uses list_directory tool
2. Chat: "Read the contents of notes.txt" -> agent uses read_file tool
3. Chat: "Create a file called shopping-list.txt with milk, bread, eggs" -> requires confirmation

**Acceptance criteria:**
- [ ] File operations work with scoped paths (default: user home + data dir)
- [ ] Write/delete operations require confirmation at L1-L2
- [ ] Path traversal attacks blocked (no ../ escape)
- [ ] Tests pass using temp directories

---

### 2C: Agent Loop + Tool Integration

**Files to modify:**

| File | Action |
|---|---|
| `src/core/agent-loop.ts` | Act stage calls tools when the plan specifies tool use |
| `src/engine/agent-instance.ts` | Inject ToolRegistry into AgentLoop |
| `src/shared/types.ts` | Add `AgentAction.tool` field |

**How it works:**
1. **Plan stage** -- LLM generates a plan that may reference tools: `"Use read_file to read ~/notes.txt, then summarise"`
2. **Act stage** -- Agent parses tool references, checks policy, executes tools, feeds results back to LLM

**Test via dev server:**
1. Chat: "Read my config file and tell me what autonomy level I'm set to" -> agent uses read_file + inference
2. Chat: "Save this summary to a file" -> agent uses write_file with confirmation

---

## Phase 3: Browser Automation

**Goal:** Agent can browse the web, fill forms, extract content. Testable by asking the agent to perform web tasks.

### 3A: Browser Tool (Playwright)

**Install:**
```bash
npm install playwright
npx playwright install chromium
```

**Files to create:**

| File | Purpose |
|---|---|
| `src/tools/browser.ts` | Browser automation tool (Playwright wrapper) |
| `src/tools/browser-pool.ts` | Browser instance lifecycle management |
| `tests/tools/browser.test.ts` | Tests against local test server |

**Operations:**
- `browser_navigate` -- go to URL
- `browser_click` -- click element by selector or description
- `browser_type` -- type text into input
- `browser_read` -- extract text from page or element
- `browser_screenshot` -- capture screenshot (returns as artifact)
- `browser_fill_form` -- fill multiple form fields
- `browser_scroll` -- scroll page
- `browser_extract_links` -- get all links on page
- `browser_extract_table` -- extract table data

**Browser pool:**
```typescript
export class BrowserPool {
  async acquire(): Promise<{ browser: Browser; page: Page }>
  async release(page: Page): Promise<void>
  async shutdown(): Promise<void>
  getStatus(): { active: number; idle: number }
}
```

**API routes:**
```
POST /api/agent/tools/browser_navigate    { url: string }
POST /api/agent/tools/browser_read        { selector?: string }
POST /api/agent/tools/browser_screenshot  {}
GET  /api/agent/browser/status            -> pool status
```

**Test via dev server:**
1. Chat: "Go to wikipedia.org and tell me what today's featured article is"
2. Chat: "Search Google for accessible technology UK"
3. Chat: "Take a screenshot of the current page" -> should display screenshot in chat

**Test with local HTML:**
Create a test page at `src/desktop/ui/test-form.html` that the browser tool can interact with during automated tests.

**Acceptance criteria:**
- [ ] Can navigate to URLs
- [ ] Can read page content and return it as text
- [ ] Can take screenshots and return as artifacts
- [ ] Can fill forms and click buttons
- [ ] URL allowlist/blocklist works
- [ ] Browser runs in isolated profile (no user cookies/data)
- [ ] Browser pool manages lifecycle (timeout, cleanup)
- [ ] Tests pass against local test server

---

### 3B: Web Research Agent

**Files to create:**

| File | Purpose |
|---|---|
| `src/tools/web-search.ts` | Web search via DuckDuckGo/Brave API |
| `tests/tools/web-search.test.ts` | Search tests |

**Operations:**
- `web_search` -- search the web, return top N results with titles, URLs, snippets
- `web_read_page` -- navigate to URL, extract main content (reader mode)

**Test via dev server:**
1. Chat: "Search for wheelchair accessible restaurants in London"
2. Chat: "What are the latest disability benefits changes in the UK?"
3. Results should show source URLs and summaries

---

### 3C: Browser Automation in Chat UI

**Files to modify:**

| File | Action |
|---|---|
| `src/desktop/ui/app.js` | Display browser screenshots inline in chat, show "Agent is browsing..." status |
| `src/desktop/ui/styles.css` | Style for screenshot previews, browser status indicator |
| `src/desktop/ui/index.html` | Add browser status area |

**UI behaviour:**
- When agent uses browser tools, show a "Browsing..." indicator
- Screenshots appear inline in the chat as clickable thumbnails
- Agent narrates what it's doing: "I'm navigating to your bank's website..."
- User can say "Stop browsing" to cancel

**Test via dev server:**
1. Ask agent to look something up -> see browsing status in UI
2. Screenshots render inline
3. Voice output narrates browsing steps

---

## Phase 4: Desktop Control

**Goal:** Agent can see the screen, click, type, and control applications.

### 4A: Desktop Tool (nut.js)

**Install:**
```bash
npm install @nut-tree/nut-js
```

**Files to create:**

| File | Purpose |
|---|---|
| `src/tools/desktop.ts` | Desktop automation tool (nut.js wrapper) |
| `tests/tools/desktop.test.ts` | Tests for desktop operations |

**Operations:**
- `desktop_screenshot` -- capture screen or region
- `desktop_click` -- click at coordinates or find-and-click by image/text
- `desktop_type` -- type text
- `desktop_hotkey` -- press key combinations
- `desktop_active_window` -- get active window info
- `desktop_list_windows` -- list all windows
- `desktop_focus_window` -- bring window to front

**Test via dev server:**
1. Chat: "What app do I have open right now?" -> captures screenshot, uses vision to describe
2. Chat: "Open Notepad and type Hello World" -> opens app, types text
3. Chat: "Take a screenshot of my screen" -> shows desktop screenshot in chat

**Safety:**
- Desktop control is opt-in (disabled by default in config)
- Every action requires confirmation at L1-L2
- L3+ can chain actions but still confirms irreversible ones

---

### 4B: Screen Understanding (Vision)

**Install:**
```bash
npm install tesseract.js
```

**Files to create:**

| File | Purpose |
|---|---|
| `src/tools/vision.ts` | OCR + screen understanding |
| `tests/tools/vision.test.ts` | Vision tests with sample images |

**Operations:**
- `vision_ocr` -- extract text from image/screenshot
- `vision_describe` -- describe what's on screen (via LLM vision or OCR + inference)
- `vision_find_element` -- find UI element in screenshot by description
- `vision_read_document` -- extract text from PDF/image document

**Test via dev server:**
1. Upload an image in chat -> agent describes it
2. Chat: "Read the text in this image" (with image attachment) -> OCR result
3. Chat: "What's on my screen?" -> screenshot + description

---

## Phase 5: Multi-Agent Orchestration

**Goal:** Complex tasks are decomposed across specialist agents that work together.

### 5A: Orchestrator

**Files to create:**

| File | Purpose |
|---|---|
| `src/agents/orchestrator.ts` | Central conductor that decomposes and delegates |
| `src/agents/types.ts` | Agent message types, agent registry |
| `src/agents/index.ts` | Public exports |
| `tests/agents/orchestrator.test.ts` | Orchestrator tests |

**Orchestrator behaviour:**
1. Receive user request
2. Analyse complexity -- does this need multiple agents or can a single loop handle it?
3. If multi-agent: decompose into sub-tasks, assign to specialist agents
4. Monitor progress, aggregate results
5. Return unified result to user

**Test via dev server:**
1. Chat: "Research accessible restaurants near me and book a table for 2" -> decomposes into search + booking
2. Chat: "Summarise this document and create flashcards from it" -> decomposes into read + summarise + generate
3. Agent status shows sub-agents working

---

### 5B: Specialist Agents

**Files to create:**

| File | Purpose |
|---|---|
| `src/agents/planner.ts` | Plans multi-step strategies |
| `src/agents/researcher.ts` | Gathers information (web, files, memory) |
| `src/agents/executor.ts` | Carries out actions (browser, desktop, files) |
| `src/agents/verifier.ts` | Validates results |

**Test via dev server:**
1. Give a complex task -> see multiple agents working in the status panel
2. WebSocket events show which agent is active and what it's doing

---

## Phase 6: Advanced Accessibility

**Goal:** Deep accessibility features that differentiate Neura from generic agents.

### 6A: Local Speech (whisper.cpp + Piper)

Replace Web Speech API with local models for offline + better quality.

**Files to create:**

| File | Purpose |
|---|---|
| `src/tools/speech.ts` | Local STT (whisper) + TTS (Piper) |
| `src/desktop/ui/voice-local.js` | Client-side integration for local speech |

**Test via dev server:**
1. Click mic button -> speech recognized locally (no internet needed)
2. Agent responds with Piper voice (configurable voice/speed)
3. Works fully offline

---

### 6B: Accessibility Profile System

**Files to create:**

| File | Purpose |
|---|---|
| `src/core/accessibility.ts` | Accessibility profile manager |
| `src/desktop/ui/onboarding.html` | First-run onboarding wizard |
| `tests/core/accessibility.test.ts` | Profile tests |

**Test via dev server:**
1. First visit shows onboarding wizard
2. Select disability categories -> settings auto-configured
3. Profile persisted at `~/.neura/accessibility.json`
4. Agent adapts language, interaction style, and tool behaviour

---

### 6C: Screen Reader Integration

**Files to modify:**

| File | Action |
|---|---|
| `src/desktop/ui/index.html` | Add ARIA live regions for all agent status changes |
| `src/desktop/ui/app.js` | Announce tool actions, browsing steps, results to screen reader |

**Test via dev server (with NVDA or VoiceOver):**
1. Navigate entire UI using keyboard only
2. Agent actions announced via ARIA live regions
3. All buttons, inputs, status areas have correct ARIA labels

---

## Phase 7: Production Hardening

### 7A: Code Execution Sandbox

**Install:**
```bash
npm install dockerode
```

**Files to create:**

| File | Purpose |
|---|---|
| `src/tools/code-executor.ts` | Sandboxed code execution via Docker |
| `tests/tools/code-executor.test.ts` | Execution tests |

**Test via dev server:**
1. Chat: "Write a Python script that calculates compound interest" -> generates + runs in Docker
2. Chat: "Run this JavaScript: console.log(2+2)" -> executes in sandbox, returns "4"

---

### 7B: Observability

**Install:**
```bash
npm install pino @opentelemetry/sdk-node prom-client
```

**Files to create/modify:**

| File | Action |
|---|---|
| `src/shared/logger.ts` | Replace with Pino |
| `src/core/telemetry.ts` | Add OpenTelemetry spans |
| `src/engine/routes.ts` | Add `/api/agent/metrics` endpoint (Prometheus format) |

**Test via dev server:**
1. `curl http://localhost:3210/api/agent/metrics` -> Prometheus metrics
2. Logs are structured JSON (check terminal output)

---

### 7C: Vector Memory

**Install:**
```bash
npm install sqlite-vss
```

**Files to modify:**

| File | Action |
|---|---|
| `src/core/memory.ts` | Add vector embeddings, semantic search |
| `tests/core/memory.test.ts` | Add vector search tests |

**Test via dev server:**
1. Store several memories: "I like bullet point summaries", "My exam is on April 15"
2. Search: "what format do I prefer?" -> returns preference about bullet points
3. Search: "when is my exam?" -> returns April 15 fact

---

## Test Matrix

Every phase must pass these before moving to the next:

| Test | Command | What it Checks |
|---|---|---|
| Unit tests | `npm test` | All modules work in isolation |
| Type check | `npx tsc --noEmit` | No TypeScript errors |
| API health | `curl http://localhost:3210/api/agent/health` | Server starts, all systems ready |
| Chat works | Open http://localhost:3210, send a message | Full pipeline: UI -> API -> agent loop -> response |
| Voice works | Click mic, speak, verify response | STT -> agent -> TTS pipeline |
| Settings load | Click settings icon, verify all sections render | Config, plugins, status all populated |

### Phase-Specific Test Checklist

| Phase | Manual Test | Expected Result |
|---|---|---|
| 1A | Ask "Explain quantum tunneling simply" | Real LLM response (not rule-based template) |
| 1B | Set cloud API key, ask complex question | Response from Anthropic Claude |
| 2A | `GET /api/agent/tools` | JSON list of registered tools |
| 2B | Ask "List files in my documents folder" | Actual file listing from filesystem |
| 3A | Ask "Go to bbc.co.uk and read the headlines" | Agent navigates, returns real headlines |
| 3B | Ask "Search for disability benefits UK 2026" | Real search results with URLs |
| 4A | Ask "What app is open on my screen?" | Screenshot + description |
| 4B | Upload image, ask "What does this say?" | OCR text extraction |
| 5A | Ask "Research topic X and create study notes" | Multi-step orchestration visible in status |
| 6A | Speak without internet connection | Local speech recognition works |
| 6B | First visit shows onboarding | Accessibility wizard appears |
| 7A | Ask "Run this code: print(2+2)" | Returns "4" from Docker sandbox |
| 7C | Ask "What's my preferred summary format?" | Semantic search returns relevant memory |

---

## Development Workflow

```
For each phase:

1. Create feature branch:
   git checkout -b phase-1a-ollama

2. Write tests first:
   Create test files in tests/
   Run: npm test -- --watch

3. Implement the feature:
   Create/modify source files
   Verify tests pass: npm test

4. Test via dev server:
   npm run dev:ui
   Open http://localhost:3210
   Run manual test checklist for this phase

5. Verify no regressions:
   npm test            (all 36+ tests pass)
   npx tsc --noEmit    (no type errors)

6. Merge to main
```

---

## Estimated Dependency Additions Per Phase

| Phase | New Dependencies | Size Impact |
|---|---|---|
| 1A | `ollama` | ~50 KB |
| 1B | `@anthropic-ai/sdk` | ~200 KB |
| 2A | (none - pure TypeScript) | 0 |
| 2B | (none - uses Node.js fs) | 0 |
| 3A | `playwright` | ~50 MB (includes browser binaries) |
| 3B | (none or light fetch wrapper) | 0 |
| 4A | `@nut-tree/nut-js` | ~15 MB (includes native binaries) |
| 4B | `tesseract.js` | ~10 MB (includes WASM worker) |
| 5 | (none - pure TypeScript) | 0 |
| 6A | whisper + piper binaries | ~500 MB (local model files) |
| 7A | `dockerode` | ~200 KB |
| 7B | `pino`, `@opentelemetry/sdk-node`, `prom-client` | ~2 MB |
| 7C | `sqlite-vss` | ~5 MB |
