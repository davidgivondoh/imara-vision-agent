# Security & Governance

## Principles

The Imara Vision Agent is built for vulnerable users — people with disabilities, learners with additional needs, and people living independently. This demands a higher standard of safety, privacy, and transparency than general-purpose AI agents.

### Core Commitments

1. **Bounded autonomy** — The agent never takes irreversible high-impact actions without explicit user confirmation.
2. **Explainability** — Every action includes a plain-language "why this action" rationale.
3. **Privacy by default** — Core inference runs on-device. Cloud calls are opt-in and anonymised where possible.
4. **Consent-first** — No data collection, sharing, or action execution without informed consent.
5. **Auditability** — Full decision audit log for every agent action.

---

## Autonomy Model

### Levels

| Level | Name | What the Agent Can Do | What Requires Confirmation |
|---|---|---|---|
| L0 | Static | Display static content only | — |
| L1 | Context-Aware | Read-only suggestions based on current context | — |
| L2 | Goal-Driven | Reversible actions toward a stated goal | Irreversible actions |
| L3 | Multi-Step | Chained multi-step plans (all reversible) | Any irreversible step in the chain |
| L4 | Orchestrated | Coordinate across multiple agents or users | Any action affecting other users |

### Autonomy Rules

- Default level is **L1** (suggestions only).
- Users can increase autonomy up to L4 in settings.
- Even at L4, irreversible actions always require confirmation unless the user has explicitly pre-approved them.
- Administrators (school IT, care providers) can set a maximum autonomy level for managed accounts.
- Autonomy level can be overridden per-task in the SDK.

---

## Policy Engine

The policy engine runs before every action the agent attempts. It evaluates three gates in sequence:

### Gate 1: Consent Check

- Has the user consented to this type of action?
- Is the consent still valid (not expired or revoked)?
- For minors: has the guardian consented?

### Gate 2: Role Check

- Does the user's role permit this action?
- Is the action within the user's institutional permissions?
- For multi-tenant environments: does the institution's policy allow it?

### Gate 3: Autonomy Level Gate

- Is the action within the configured autonomy level?
- If not: escalate to confirmation prompt.
- If confirmation is denied: block the action and log the denial.

### Policy Evaluation Result

```ts
interface PolicyEvaluation {
  allowed: boolean
  reasonCode: 'ok' | 'missing_consent' | 'insufficient_role' | 'restricted_context' | 'data_retention_block' | 'autonomy_exceeded'
  message: string               // Human-readable explanation
  requiredApprovals?: string[]  // Who needs to approve
}
```

### Policy Logging

Every policy evaluation is logged:

```ts
{
  eventName: 'agent.policy.evaluated',
  timestamp: '2026-03-10T14:00:00Z',
  properties: {
    actionType: 'send_message',
    allowed: false,
    reasonCode: 'missing_consent',
    userId: 'user_123',
    product: 'imara-plus'
  }
}
```

---

## Privacy

### Data Processing Locations

| Data Type | Default Location | Cloud Alternative |
|---|---|---|
| Inference (classification, planning) | On-device (ONNX) | Cloud API (opt-in) |
| Memory store | Local SQLite | Cloud sync (opt-in) |
| Telemetry events | Local log file | Anonymous cloud upload (opt-in) |
| User preferences | Local config file | Cloud sync (opt-in) |
| Sensor data (Pen, Overlay) | On-device only | Never sent to cloud |

### Data Minimisation

- The agent collects only what is needed for the current task.
- Sensor data (handwriting, audio, camera) is processed locally and discarded after task completion unless the user explicitly saves it.
- Memory entries have configurable expiry (`expiresAt`).
- Users can export or delete all their data at any time.

### PII Handling

| Rule | Implementation |
|---|---|
| PII detection | Automatic PII scan before any cloud API call |
| PII redaction | Detected PII is stripped or replaced with placeholders before cloud transmission |
| PII storage | PII is stored only in the local memory store, never in cloud telemetry |
| PII export | Full PII export via `neura memory export` or SDK `agent.memory.export()` |
| PII deletion | Full deletion via `neura memory clear` or SDK `agent.memory.clear()` |

### Children and Vulnerable Users

- Accounts for users under 18 require guardian consent and are subject to additional restrictions.
- Guardian accounts can view and manage the agent's activity log.
- Communication actions (on-behalf messaging) are disabled by default for minor accounts.
- Telemetry for minor accounts is fully anonymised.

---

## Access Control

### Roles

| Role | Description | Typical User |
|---|---|---|
| `student` | Learner using Imara Pen or Wearable Overlay | School student, university student |
| `teacher` | Educator managing learners | Classroom teacher, tutor |
| `admin` | Institution administrator | School IT admin, university admin |
| `independent_living_user` | Primary ImaraPlus/Neura user | Person with disability |
| `carer` | Support person for an independent living user | Family member, care worker |

### Role Permissions

| Action | student | teacher | admin | independent_living_user | carer |
|---|---|---|---|---|---|
| View own data | Yes | Yes | Yes | Yes | Yes |
| View managed user data | — | Yes (own students) | Yes (all) | — | Yes (assigned user) |
| Create tasks | Yes | Yes | Yes | Yes | Yes (on behalf) |
| Execute irreversible actions | With confirmation | With confirmation | Yes | With confirmation | With confirmation |
| Manage plugins | — | — | Yes | — | — |
| Set autonomy level | Own only | Own + students | Global | Own only | Assigned user |
| Export/delete data | Own only | Own only | All | Own only | Own + assigned user |

---

## Audit Trail

Every significant agent action produces an audit entry:

```ts
interface AuditEntry {
  id: string
  timestamp: string
  userId: string
  sessionId: string
  action: string          // e.g. 'task.executed', 'memory.updated', 'policy.blocked'
  resource: string        // e.g. 'task_abc123', 'memory_def456'
  outcome: 'success' | 'denied' | 'failed'
  policyResult?: PolicyEvaluation
  metadata: Record<string, unknown>
}
```

### Audit Storage

- Stored locally in append-only log file.
- Retained for 90 days by default (configurable per institution).
- Exportable as JSON or CSV.
- Admin accounts can view the full audit trail for their institution.

### Audit Events

| Event | When |
|---|---|
| `task.created` | User or agent creates a task |
| `task.executed` | Task begins execution |
| `task.completed` | Task finishes |
| `task.cancelled` | Task is cancelled |
| `action.confirmed` | User confirms an escalated action |
| `action.denied` | User denies an escalated action |
| `policy.blocked` | Policy engine blocks an action |
| `memory.updated` | Memory store is modified |
| `memory.exported` | User exports their data |
| `memory.cleared` | User clears their data |
| `config.changed` | Configuration value is updated |
| `plugin.installed` | Plugin is installed |
| `plugin.uninstalled` | Plugin is removed |
| `auth.login` | User authenticates |
| `auth.logout` | User signs out |

---

## Threat Model

### Identified Risks

| Threat | Severity | Mitigation |
|---|---|---|
| Prompt injection via user input | High | Input sanitisation, output filtering, bounded action set |
| Plugin escape from sandbox | High | V8 isolate enforcement, memory/CPU limits, permission model |
| Unintended data exposure to cloud | High | PII detection/redaction before cloud calls, local-first default |
| Excessive autonomy causing harm | High | L0–L4 model, confirmation gates, admin-settable max level |
| Unauthorised access to other users' data | High | Role-based access control, tenant isolation |
| Model hallucination leading to bad advice | Medium | Confidence scoring, low-confidence fallback, human verification |
| Denial of service via task spam | Medium | Rate limiting, max concurrent tasks, task timeout |
| Stale memory causing outdated actions | Medium | Memory expiry, relevance scoring, periodic cleanup |
| Supply chain attack via plugin registry | Medium | Automated security scanning, code signing, manual review for featured plugins |

### Security Testing

- **Automated:** SAST and dependency scanning in CI.
- **Manual:** Quarterly penetration testing of the engine API surface.
- **Plugin audits:** Automated sandbox escape testing for all registry submissions.
- **Red team:** Annual red-team exercise covering prompt injection, data exfiltration, and privilege escalation.

---

## Compliance

### Standards Alignment

| Standard | Relevance | Status |
|---|---|---|
| GDPR | Data protection for EU users | Core design principle (data minimisation, consent, right to erasure) |
| UK Data Protection Act 2018 | UK users and institutions | Aligned with GDPR implementation |
| COPPA | Children under 13 | Guardian consent required, data minimisation enforced |
| WCAG 2.2 AA | Accessibility | Target for all user-facing surfaces |
| ISO 27001 | Information security management | Planned for enterprise tier |
| SOC 2 Type II | Service organisation controls | Planned for enterprise tier |

### Data Sovereignty

- All user data is stored on-device by default.
- Cloud sync destinations are configurable per institution.
- Enterprise customers can specify data residency region (EU, US, UK).
- No cross-border data transfer without explicit consent.

---

## Incident Response

### Severity Levels

| Level | Definition | Response Time |
|---|---|---|
| P0 | Data breach or safety-critical agent behaviour | 1 hour |
| P1 | Agent executing unintended actions | 4 hours |
| P2 | Policy engine bypass or audit failure | 24 hours |
| P3 | Non-critical bug affecting governance features | 72 hours |

### Response Steps

1. **Detect** — Automated monitoring or user report.
2. **Contain** — Disable affected feature or reduce autonomy to L0.
3. **Investigate** — Review audit trail and telemetry.
4. **Fix** — Deploy patch via auto-update (desktop) or rolling deploy (engine).
5. **Communicate** — Notify affected users and institutions.
6. **Review** — Post-incident review and documentation.
