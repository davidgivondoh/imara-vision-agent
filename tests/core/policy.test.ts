import { describe, it, expect, beforeEach } from 'vitest'
import { PolicyEngine } from '../../src/core/policy.js'
import { Telemetry } from '../../src/core/telemetry.js'
import { EventBus } from '../../src/shared/events.js'
import type { AgentAction } from '../../src/shared/types.js'

describe('PolicyEngine', () => {
  let policy: PolicyEngine

  const makeAction = (overrides?: Partial<AgentAction>): AgentAction => ({
    id: 'action_1',
    type: 'generate',
    label: 'Test action',
    payload: {},
    reversible: true,
    requiresConfirmation: false,
    ...overrides,
  })

  beforeEach(() => {
    const bus = new EventBus()
    const telemetry = new Telemetry({ product: 'engine', enabled: false, bus })
    policy = new PolicyEngine({ telemetry })
  })

  it('should allow a reversible action at L2', () => {
    const result = policy.evaluate({
      action: makeAction({ reversible: true }),
      userId: 'user1',
      userRole: 'student',
      autonomyLevel: 'L2',
    })

    expect(result.allowed).toBe(true)
    expect(result.reasonCode).toBe('ok')
  })

  it('should block all actions at L0', () => {
    const result = policy.evaluate({
      action: makeAction(),
      userId: 'user1',
      userRole: 'student',
      autonomyLevel: 'L0',
    })

    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('autonomy_exceeded')
  })

  it('should block irreversible actions at L1', () => {
    const result = policy.evaluate({
      action: makeAction({ reversible: false }),
      userId: 'user1',
      userRole: 'student',
      autonomyLevel: 'L1',
    })

    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('autonomy_exceeded')
  })

  it('should block actions restricted by role', () => {
    const result = policy.evaluate({
      action: makeAction({ type: 'assign' }),
      userId: 'user1',
      userRole: 'student',
      autonomyLevel: 'L3',
    })

    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('insufficient_role')
  })

  it('should allow teacher to assign', () => {
    const result = policy.evaluate({
      action: makeAction({ type: 'assign' }),
      userId: 'teacher1',
      userRole: 'teacher',
      autonomyLevel: 'L2',
    })

    expect(result.allowed).toBe(true)
  })

  it('should enforce max autonomy level', () => {
    policy.setMaxAutonomyLevel('L1')

    const result = policy.evaluate({
      action: makeAction({ reversible: false }),
      userId: 'user1',
      userRole: 'teacher',
      autonomyLevel: 'L4', // Requested L4 but max is L1
    })

    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('autonomy_exceeded')
  })
})
