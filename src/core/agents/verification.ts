// ─── Verification Agent ─────────────────────────────────────────
// Evaluates task outputs for correctness and completeness.
// Implements a self-critique loop: execute → evaluate → retry if needed.
// Max 2 retries per step (spec §4.8).
// See IMARA-AGENT-SPEC.md §4.8

import { createLogger } from '../../shared/logger.js'
import type { InferenceLayer } from '../../inference/index.js'
import type {
  AgentRole,
  TaskNode,
  SharedState,
  AgentResult,
  AgentEmitFn,
  SpecialistAgent,
  VerificationResult,
  VerificationCriteria,
} from './types.js'

const log = createLogger('agent:verification')

export class VerificationAgent implements SpecialistAgent {
  readonly role: AgentRole = 'verification'
  readonly description = 'Evaluates outputs for correctness, completeness, and absence of hallucination'
  readonly toolNames = ['browser_screenshot', 'browser_read', 'page_audit']

  private inference: InferenceLayer

  constructor(options: { inference: InferenceLayer }) {
    this.inference = options.inference
  }

  async execute(node: TaskNode, state: SharedState, emit: AgentEmitFn): Promise<AgentResult> {
    const start = Date.now()

    log.info('Verification agent executing', { instruction: node.instruction.slice(0, 80) })
    emit('agent.verification.started', { nodeId: node.id })

    try {
      // Gather all results to verify
      const resultsToVerify = this.gatherResults(state)

      const vResult = await this.verify(
        state.taskGraph?.goal ?? node.instruction,
        resultsToVerify,
        state,
      )

      const durationMs = Date.now() - start
      emit('agent.verification.completed', {
        nodeId: node.id,
        passed: vResult.passed,
        durationMs,
      })

      return {
        success: vResult.passed,
        output: vResult.feedback,
        data: {
          passed: vResult.passed,
          criteria: vResult.criteria,
          shouldRetry: vResult.shouldRetry,
        },
        confidence: vResult.passed ? 0.9 : 0.3,
        toolsUsed: [],
        durationMs,
      }
    } catch (err) {
      const durationMs = Date.now() - start
      const error = err instanceof Error ? err.message : 'Verification failed'
      log.error('Verification agent error', { error })
      emit('agent.verification.failed', { nodeId: node.id, error })

      return {
        success: false,
        output: error,
        confidence: 0,
        toolsUsed: [],
        durationMs,
      }
    }
  }

  /**
   * Verify a set of results against the original goal.
   * Called by the Supervisor after all executor nodes complete.
   */
  async verify(
    goal: string,
    results: string,
    state: SharedState,
  ): Promise<VerificationResult> {
    log.info('Verifying task output', { goal: goal.slice(0, 80) })

    const prompt = `You are the Imara Verification Agent. Evaluate whether the task output correctly fulfils the user's goal.

User's original goal: "${goal}"

Task output:
${results.slice(0, 3000)}

Evaluate on these criteria:
1. MATCHES_INTENT — Does the output address what the user actually asked for?
2. OUTPUT_COMPLETE — Is the output complete, or is information missing?
3. NO_HALLUCINATION — Is the information factually grounded in the tool outputs (not made up)?
4. FIELDS_PRESENT — Are all required data fields present (URLs, names, numbers, etc.)?

Respond in this EXACT format:
MATCHES_INTENT: YES or NO
OUTPUT_COMPLETE: YES or NO
NO_HALLUCINATION: YES or NO
FIELDS_PRESENT: list of present fields, or NONE
VERDICT: PASS or FAIL
FEEDBACK: one sentence explaining your verdict
SHOULD_RETRY: YES or NO`

    const result = await this.inference.run({
      type: 'generate',
      input: prompt,
      context: state.userContext,
    })

    return this.parseVerification(result.output)
  }

  /**
   * Quick verification for single-step tasks (no full inference call).
   * Checks basic quality signals.
   */
  quickVerify(output: string, goal: string): VerificationResult {
    const hasContent = output.trim().length > 10
    const isError = /error|failed|exception|timeout/i.test(output) && output.length < 100
    const seemsRelevant = goal.split(/\s+/).some(word =>
      word.length > 3 && output.toLowerCase().includes(word.toLowerCase()),
    )

    const criteria: VerificationCriteria = {
      matchesIntent: seemsRelevant,
      outputComplete: hasContent && !isError,
      noHallucination: true, // Can't verify without inference
      fieldsPresent: [],
    }

    const passed = hasContent && !isError && seemsRelevant

    return {
      passed,
      criteria,
      feedback: passed
        ? 'Output appears to address the goal.'
        : 'Output may be incomplete or not relevant to the goal.',
      shouldRetry: !passed && !isError,
    }
  }

  private gatherResults(state: SharedState): string {
    if (!state.taskGraph) return ''

    const parts: string[] = []
    for (const node of state.taskGraph.nodes) {
      if (node.status === 'completed' && node.result) {
        const output = (node.result.payload as Record<string, unknown>)?.output
        if (typeof output === 'string') {
          parts.push(`[${node.assignedAgent}] ${node.instruction}\n→ ${output.slice(0, 500)}`)
        }
      }
    }
    return parts.join('\n\n')
  }

  private parseVerification(output: string): VerificationResult {
    const lines = output.split('\n').map(l => l.trim()).filter(Boolean)

    const get = (key: string): string => {
      const line = lines.find(l => l.toUpperCase().startsWith(key.toUpperCase()))
      return line?.replace(new RegExp(`^${key}:\\s*`, 'i'), '').trim() ?? ''
    }

    const matchesIntent = get('MATCHES_INTENT').toUpperCase() === 'YES'
    const outputComplete = get('OUTPUT_COMPLETE').toUpperCase() === 'YES'
    const noHallucination = get('NO_HALLUCINATION').toUpperCase() === 'YES'
    const fieldsStr = get('FIELDS_PRESENT')
    const fieldsPresent = fieldsStr && fieldsStr.toUpperCase() !== 'NONE'
      ? fieldsStr.split(',').map(f => f.trim())
      : []
    const verdict = get('VERDICT').toUpperCase()
    const feedback = get('FEEDBACK') || (verdict === 'PASS' ? 'Verification passed.' : 'Verification failed.')
    const shouldRetry = get('SHOULD_RETRY').toUpperCase() === 'YES'

    const criteria: VerificationCriteria = {
      matchesIntent,
      outputComplete,
      noHallucination,
      fieldsPresent,
    }

    return {
      passed: verdict === 'PASS' || (matchesIntent && outputComplete && noHallucination),
      criteria,
      feedback,
      shouldRetry,
    }
  }
}
