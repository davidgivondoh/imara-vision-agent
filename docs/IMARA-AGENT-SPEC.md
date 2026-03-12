# IMARA AGENT — Autonomous System Specification

**High-Autonomy AI Desktop Agent for Independent Digital Living**

| Field | Detail |
|---|---|
| Version | 2.0 |
| Date | March 2026 |
| Classification | Internal — Technical Specification |
| Status | Draft |
| Target Users | People with Disabilities (PWDs) |

## 1. Executive Summary

Imara is a high-autonomy AI desktop agent designed to enable independent digital living for people with disabilities (PWDs). The system functions as a digital operator capable of planning and executing multi-step tasks across the computer and internet with minimal human input.

The name "Imara" derives from the Swahili word meaning "strong" or "resilient," reflecting the project's mission to empower users who face barriers in conventional digital environments.

### 1.1 Design Principles

- **Autonomy first**: minimise the number of user interactions required to complete a task.
- **Accessibility by default**: every interface and interaction must be usable by people with motor, visual, auditory, or cognitive disabilities.
- **Deterministic execution**: tasks follow structured plans that can be inspected, retried, and audited.
- **Privacy and safety**: user data stays local wherever possible, and destructive actions require explicit confirmation.
- **Graceful degradation**: the system must remain useful even when individual tools or network connectivity are unavailable.

### 1.2 Scope

This document covers the technical specification for the Imara desktop agent. It does not cover commercial strategy, go-to-market planning, or detailed UX wireframes.

## 2. User Personas and Use Cases

| Persona | Disability Profile | Key Needs | Example Task |
|---|---|---|---|
| Amina | Motor impairment (limited hand dexterity) | Voice-controlled navigation; minimal mouse/keyboard reliance | Book an accessible taxi using voice commands |
| James | Visual impairment (low vision) | Screen reader compatibility; high-contrast UI; audio feedback | Research and compare insurance plans |
| Wanjiku | Cognitive disability | Simplified workflows; clear confirmations; step-by-step guidance | Pay a utility bill online |
| David | Hearing impairment | Visual alerts; text-based feedback; captioned outputs | Set up a recurring calendar reminder |

## 3. System Architecture

Imara implements a **Planner → Executor → Verifier** architecture. Every user request passes through three phases: intent detection and task planning, tool-based execution across specialised agents, and output verification with optional retry.

### 3.1 Execution Flow

1. User submits a request through voice, text, or gesture input.
2. **Supervisor Agent** performs intent detection and routes to the **Planner Agent**.
3. **Planner Agent** decomposes the request into a structured task graph.
4. **Supervisor Agent** dispatches each step to the appropriate Executor Agent (Browser, Desktop, Research, or Code).
5. Each Executor Agent invokes tools, observes results, and reports back.
6. **Verification Agent** evaluates outputs for correctness and completeness.
7. If verification fails, the Supervisor triggers a retry with an updated plan.

### 3.2 Communication Model

Agents communicate through a shared state object managed by the Supervisor. Agents do not communicate directly; all coordination flows through the Supervisor.

## 4. Agent Roles

### 4.1 Supervisor Agent
Central coordinator. Receives user requests, manages task lifecycle, enforces limits, escalates to user for confirmation.

### 4.2 Planner Agent
Converts natural-language intent into a structured task graph using ReAct (Reasoning + Acting) cycles.

### 4.3 Research Agent
Gathers information from the internet. Formulates search queries, evaluates relevance, extracts structured data.

### 4.4 Browser Agent
Interacts with websites via Playwright automation. Navigate, click, fill forms, download, extract content.

### 4.5 Desktop Automation Agent
Controls the OS directly. Open apps, move cursor, click UI elements, type text.

### 4.6 Code Execution Agent
Runs scripts in an isolated sandbox. Python/Node.js runtime with no host access.

### 4.7 Memory Agent
Maintains context across sessions: short-term context, long-term knowledge, user preferences.

### 4.8 Verification Agent
Evaluates outputs for correctness. Implements self-critique loop with max 2 retries per step.

## 5. Tool Catalogue

| Tool | Purpose |
|---|---|
| web_search | Query search engines |
| browser_navigate | Open a URL |
| read_page | Extract page content |
| fill_form | Enter form data |
| execute_code | Run sandboxed scripts |
| open_application | Launch desktop apps |
| read_file | Read local files |
| write_file | Write local files |
| speak | TTS output |
| listen | STT input |

## 6. Autonomous Execution Loop

### 6.1 Loop Steps
1. **Understand** — parse request, identify goal
2. **Plan** — generate/update task graph
3. **Execute** — dispatch to executor agent
4. **Observe** — capture tool output
5. **Evaluate** — verification agent assesses
6. **Update** — revise plan if failed
7. **Repeat** — until complete or stopped

### 6.2 Execution Limits

| Limit | Default |
|---|---|
| Max search queries | 3 per step |
| Max page navigations | 3 per step |
| Max total actions | 10 per task |
| Max retries per step | 2 |
| Execution timeout | 120s per step |

## 7. Local AI Runtime

### 7.1 Hybrid Strategy
- Cloud models (Claude) for complex planning and verification
- Local models for routine execution and fallback
- Automatic routing based on connectivity, complexity, user preference

### 7.2 Recommended Local Models
- DeepSeek (7B/67B) — reasoning and code
- Qwen (7B/72B) — multilingual including Swahili
- Llama 3 (8B/70B) — well-documented ecosystem
- Mistral (7B) — compact and fast

## 8. Accessibility Requirements

- **Voice**: Whisper STT, Coqui/Piper TTS, hands-free navigation
- **Motor**: Switch-access, keyboard-only, dwell-click, predictive input
- **Visual**: 7:1 contrast, 100–300% scaling, screen reader, audio descriptions
- **Cognitive**: Plain language, step-by-step progress, confirmations, consistent layout
- **Auditory**: Visual alerts, captions, vibration feedback

## 9. Privacy and Safety

- Local-first data storage; cloud opt-in and encrypted
- Minimal data collection; transient data purged after tasks
- User can inspect, export, delete all stored data
- No third-party sharing without explicit consent
- Compliance targets: Kenya Data Protection Act (2019), GDPR principles

## 10. Safety Controls

- Sandboxed code execution (Docker/Firecracker)
- Destructive/irreversible actions require user confirmation
- Schema + permission + safety validation on all tool inputs
- File access restricted to user-approved directories
- Rate limiting on all external API calls

## 11. Success Criteria

1. Tasks completed autonomously with minimal user input
2. Independently usable by all four persona groups
3. Accessibility barriers meaningfully reduced
4. 95%+ task completion rate on benchmark
5. No destructive actions without confirmation
6. Data handling complies with regulations

## 12. Example Workflows

### 12.1 Booking an Accessible Ride
User: "Find an accessible ride service near me and send me the booking link."
→ Research (search) → Browser (navigate) → Browser (extract) → Verification → Output

### 12.2 Paying a Utility Bill
User (voice): "Pay my electricity bill."
→ Memory (retrieve provider) → Browser (navigate) → Browser (fill form) → Supervisor (confirm) → Browser (submit) → Verification → Output
