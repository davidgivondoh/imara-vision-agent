import { createLogger } from '../shared/logger.js'
import type {
  AutonomyLevel,
  UserRole,
  AgentAction,
  PolicyEvaluation,
} from '../shared/types.js'
import type { Telemetry } from './telemetry.js'

const log = createLogger('policy')

const AUTONOMY_ORDER: Record<AutonomyLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
}

interface ConsentRecord {
  userId: string
  actionType: string
  granted: boolean
  grantedAt: string
  expiresAt?: string
}

export class PolicyEngine {
  private consents = new Map<string, ConsentRecord>()
  private maxAutonomyLevel: AutonomyLevel
  private telemetry: Telemetry

  constructor(options: { maxAutonomyLevel?: AutonomyLevel; telemetry: Telemetry }) {
    this.maxAutonomyLevel = options.maxAutonomyLevel ?? 'L4'
    this.telemetry = options.telemetry
  }

  evaluate(params: {
    action: AgentAction
    userId: string
    userRole: UserRole
    autonomyLevel: AutonomyLevel
    taskId?: string
  }): PolicyEvaluation {
    const { action, userId, userRole, autonomyLevel, taskId } = params

    // Gate 1: Consent check
    const consentResult = this.checkConsent(userId, action.type)
    if (!consentResult.allowed) {
      this.logEvaluation(action, consentResult, taskId)
      return consentResult
    }

    // Gate 2: Role check
    const roleResult = this.checkRole(userRole, action)
    if (!roleResult.allowed) {
      this.logEvaluation(action, roleResult, taskId)
      return roleResult
    }

    // Gate 3: Autonomy level gate
    const autonomyResult = this.checkAutonomy(autonomyLevel, action)
    if (!autonomyResult.allowed) {
      this.logEvaluation(action, autonomyResult, taskId)
      return autonomyResult
    }

    const result: PolicyEvaluation = {
      allowed: true,
      reasonCode: 'ok',
      message: 'Action permitted',
    }

    this.logEvaluation(action, result, taskId)
    return result
  }

  grantConsent(userId: string, actionType: string, expiresAt?: string): void {
    const key = `${userId}:${actionType}`
    this.consents.set(key, {
      userId,
      actionType,
      granted: true,
      grantedAt: new Date().toISOString(),
      expiresAt,
    })
    log.info(`Consent granted: ${userId} → ${actionType}`)
  }

  revokeConsent(userId: string, actionType: string): void {
    const key = `${userId}:${actionType}`
    this.consents.delete(key)
    log.info(`Consent revoked: ${userId} → ${actionType}`)
  }

  setMaxAutonomyLevel(level: AutonomyLevel): void {
    this.maxAutonomyLevel = level
    log.info(`Max autonomy level set to ${level}`)
  }

  private checkConsent(userId: string, actionType: string): PolicyEvaluation {
    // For now, allow actions by default if no explicit consent record blocks them.
    // In production, this would check a consent database.
    const key = `${userId}:${actionType}`
    const record = this.consents.get(key)

    if (record && !record.granted) {
      return {
        allowed: false,
        reasonCode: 'missing_consent',
        message: `User has not consented to action type: ${actionType}`,
      }
    }

    if (record?.expiresAt && new Date(record.expiresAt) < new Date()) {
      return {
        allowed: false,
        reasonCode: 'missing_consent',
        message: `Consent for ${actionType} has expired`,
      }
    }

    return { allowed: true, reasonCode: 'ok', message: '' }
  }

  private checkRole(role: UserRole, action: AgentAction): PolicyEvaluation {
    // Role-based restrictions
    const restrictedActions: Partial<Record<UserRole, string[]>> = {
      student: ['assign', 'adapt_ui'],
      carer: ['assign'],
    }

    const blocked = restrictedActions[role]
    if (blocked?.includes(action.type)) {
      return {
        allowed: false,
        reasonCode: 'insufficient_role',
        message: `Role "${role}" cannot perform action type: ${action.type}`,
      }
    }

    return { allowed: true, reasonCode: 'ok', message: '' }
  }

  private checkAutonomy(level: AutonomyLevel, action: AgentAction): PolicyEvaluation {
    const currentLevel = AUTONOMY_ORDER[level]
    const maxLevel = AUTONOMY_ORDER[this.maxAutonomyLevel]
    const effectiveLevel = Math.min(currentLevel, maxLevel)

    // L0: nothing allowed
    if (effectiveLevel === 0) {
      return {
        allowed: false,
        reasonCode: 'autonomy_exceeded',
        message: 'Autonomy level L0: no actions permitted',
      }
    }

    // L1: read-only suggestions — block execute-type actions
    if (effectiveLevel === 1 && !action.reversible) {
      return {
        allowed: false,
        reasonCode: 'autonomy_exceeded',
        message: 'Autonomy level L1: only reversible suggestions permitted',
      }
    }

    // L2+: irreversible actions need confirmation
    if (!action.reversible && action.requiresConfirmation) {
      return {
        allowed: false,
        reasonCode: 'autonomy_exceeded',
        message: 'Irreversible action requires user confirmation',
        requiredApprovals: ['user'],
      }
    }

    return { allowed: true, reasonCode: 'ok', message: '' }
  }

  private logEvaluation(action: AgentAction, result: PolicyEvaluation, taskId?: string): void {
    const eventName = result.allowed ? 'policy.evaluated' : 'policy.blocked'
    this.telemetry.emit(eventName, {
      actionId: action.id,
      actionType: action.type,
      allowed: result.allowed,
      reasonCode: result.reasonCode,
    }, taskId)
  }
}
