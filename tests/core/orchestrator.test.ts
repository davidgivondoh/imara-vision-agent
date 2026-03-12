import { describe, it, expect } from 'vitest'
import { Orchestrator, type SubTask } from '../../src/core/orchestrator.js'
import { InferenceLayer } from '../../src/inference/index.js'
import { Telemetry } from '../../src/core/telemetry.js'
import { EventBus } from '../../src/shared/events.js'
import type { TaskResult } from '../../src/shared/types.js'

function createTestOrchestrator(config?: Record<string, unknown>): Orchestrator {
  const bus = new EventBus()
  const telemetry = new Telemetry({ product: 'engine', enabled: false, bus })
  const inference = new InferenceLayer({
    preferLocal: true,
    localModelPath: './models',
    localProvider: 'rule-based',
    ollamaEndpoint: 'http://localhost:59999',
    ollamaModel: 'llama3.2',
    cloudApiKey: '',
    cloudEndpoint: 'https://api.anthropic.com',
    cloudProvider: 'anthropic',
    cloudModel: 'claude-sonnet-4-6',
    timeoutMs: 5000,
    telemetry,
  })

  // Initialize synchronously (rule-based is instant)
  inference.initialize()

  return new Orchestrator({
    telemetry,
    inference,
    config: config as Record<string, never>,
  })
}

function successResult(summary: string): TaskResult {
  return {
    success: true,
    summary,
    outputs: {},
    stepsCompleted: 1,
    durationMs: 10,
    confidence: 0.85,
  }
}

function failResult(error: string): TaskResult {
  return {
    success: false,
    summary: error,
    outputs: {},
    stepsCompleted: 0,
    durationMs: 5,
    confidence: 0,
  }
}

describe('Orchestrator', () => {
  describe('shouldDecompose', () => {
    it('should detect multi-step tasks with "and" conjunctions', async () => {
      const orch = createTestOrchestrator()
      const result = await orch.shouldDecompose(
        'Search the web for TypeScript tutorials and then summarise the best ones',
        {},
      )
      expect(result).toBe(true)
    })

    it('should detect sequential instructions with "first/then"', async () => {
      const orch = createTestOrchestrator()
      const result = await orch.shouldDecompose(
        'First read the file, then extract the key points',
        {},
      )
      expect(result).toBe(true)
    })

    it('should not decompose simple single-action tasks', async () => {
      const orch = createTestOrchestrator()
      const result = await orch.shouldDecompose('Summarise my notes', {})
      expect(result).toBe(false)
    })

    it('should respect autoDecompose=false config', async () => {
      const orch = createTestOrchestrator({ autoDecompose: false })
      const result = await orch.shouldDecompose(
        'Search and then summarise and also compare the results',
        {},
      )
      expect(result).toBe(false)
    })
  })

  describe('decompose', () => {
    it('should decompose a task into subtasks', async () => {
      const orch = createTestOrchestrator()
      const result = await orch.decompose(
        'task_123',
        'Search the web and summarise the results',
        {},
      )

      expect(result.subtasks.length).toBeGreaterThan(0)
      expect(result.strategy).toBeTruthy()
      expect(result.aggregation).toBeTruthy()
      expect(result.reasoning).toBeTruthy()

      for (const st of result.subtasks) {
        expect(st.id).toMatch(/^sub_/)
        expect(st.parentTaskId).toBe('task_123')
        expect(st.status).toBe('pending')
        expect(st.instruction).toBeTruthy()
      }
    })

    it('should limit subtasks to maxSubtasks config', async () => {
      const orch = createTestOrchestrator({ maxSubtasks: 2 })
      const result = await orch.decompose(
        'task_456',
        'Do many things: read file, search web, write summary, send email, generate quiz',
        {},
      )

      expect(result.subtasks.length).toBeLessThanOrEqual(2)
    })

    it('should choose summarise aggregation for summary-type tasks', async () => {
      const orch = createTestOrchestrator()
      const result = await orch.decompose(
        'task_789',
        'Summarise and combine the results from multiple sources',
        {},
      )

      expect(result.aggregation).toBe('summarise')
    })

    it('should choose best-of aggregation for comparison tasks', async () => {
      const orch = createTestOrchestrator()
      const result = await orch.decompose(
        'task_abc',
        'Compare the approaches and choose the best one',
        {},
      )

      expect(result.aggregation).toBe('best-of')
    })
  })

  describe('executeSubtasks', () => {
    it('should execute subtasks sequentially', async () => {
      const orch = createTestOrchestrator()
      const executionOrder: string[] = []

      const decomposition = await orch.decompose(
        'task_seq',
        'Step 1: gather data. Step 2: analyse results.',
        {},
      )

      // Force sequential strategy
      decomposition.strategy = 'sequential'

      const executor = async (subtask: SubTask): Promise<TaskResult> => {
        executionOrder.push(subtask.id)
        return successResult(`Done: ${subtask.instruction.slice(0, 30)}`)
      }

      const result = await orch.executeSubtasks(decomposition, executor)

      expect(result.success).toBe(true)
      expect(result.subtaskResults.length).toBe(decomposition.subtasks.length)
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0)
      // Sequential: all subtasks should have been executed in order
      expect(executionOrder.length).toBe(decomposition.subtasks.length)
    })

    it('should execute subtasks in parallel', async () => {
      const orch = createTestOrchestrator()
      const decomposition = await orch.decompose(
        'task_par',
        'Search web for topic A and search web for topic B',
        {},
      )

      decomposition.strategy = 'parallel'

      const executor = async (subtask: SubTask): Promise<TaskResult> => {
        return successResult(`Result for: ${subtask.instruction.slice(0, 30)}`)
      }

      const result = await orch.executeSubtasks(decomposition, executor)

      expect(result.success).toBe(true)
      expect(result.confidence).toBeGreaterThan(0)
    })

    it('should handle subtask failures gracefully', async () => {
      const orch = createTestOrchestrator()
      const decomposition = await orch.decompose(
        'task_fail',
        'Step 1: do something. Step 2: do another thing.',
        {},
      )

      decomposition.strategy = 'parallel'
      let callCount = 0

      const executor = async (subtask: SubTask): Promise<TaskResult> => {
        callCount++
        if (callCount === 1) {
          throw new Error('Simulated failure')
        }
        return successResult('OK')
      }

      const result = await orch.executeSubtasks(decomposition, executor)

      // Should still produce a result even with some failures
      expect(result.subtaskResults.length).toBe(decomposition.subtasks.length)
      const failedCount = result.subtaskResults.filter((r) => !r.success).length
      expect(failedCount).toBeGreaterThanOrEqual(1)
    })

    it('should stop sequential execution on failure', async () => {
      const orch = createTestOrchestrator()
      const decomposition = await orch.decompose(
        'task_stopfail',
        'Step 1: fail. Step 2: should not run. Step 3: should not run.',
        {},
      )

      decomposition.strategy = 'sequential'
      const executedIds: string[] = []

      const executor = async (subtask: SubTask): Promise<TaskResult> => {
        executedIds.push(subtask.id)
        // Fail on first subtask
        if (executedIds.length === 1) {
          throw new Error('First subtask failed')
        }
        return successResult('OK')
      }

      await orch.executeSubtasks(decomposition, executor)

      // Sequential should stop after first failure
      expect(executedIds.length).toBe(1)
    })

    it('should execute fan-out-fan-in strategy', async () => {
      const orch = createTestOrchestrator()
      const decomposition = await orch.decompose(
        'task_fanout',
        'Search for topic A and topic B, then combine results',
        {},
      )

      decomposition.strategy = 'fan-out-fan-in'
      // Mark first subtask as having a dependency
      if (decomposition.subtasks.length >= 2) {
        decomposition.subtasks[decomposition.subtasks.length - 1].dependsOn = [
          decomposition.subtasks[0].id,
        ]
      }

      const executor = async (subtask: SubTask): Promise<TaskResult> => {
        return successResult(`Result for: ${subtask.instruction.slice(0, 30)}`)
      }

      const result = await orch.executeSubtasks(decomposition, executor)
      expect(result.success).toBe(true)
    })
  })

  describe('aggregation', () => {
    it('should concatenate results by default', async () => {
      const orch = createTestOrchestrator()
      const decomposition = await orch.decompose(
        'task_concat',
        'Do task A and do task B',
        {},
      )

      decomposition.aggregation = 'concatenate'

      const executor = async (subtask: SubTask): Promise<TaskResult> => {
        return successResult(`Output ${subtask.id}`)
      }

      const result = await orch.executeSubtasks(decomposition, executor)
      expect(result.summary).toContain('[1]')
    })

    it('should merge results when requested', async () => {
      const orch = createTestOrchestrator()
      const decomposition = await orch.decompose(
        'task_merge',
        'Merge data from source A and source B',
        {},
      )

      decomposition.aggregation = 'merge'

      const executor = async (): Promise<TaskResult> => {
        return successResult('Data chunk')
      }

      const result = await orch.executeSubtasks(decomposition, executor)
      expect(result.summary).toContain('Data chunk')
    })
  })

  describe('stats and tracking', () => {
    it('should track subtask stats', async () => {
      const orch = createTestOrchestrator()
      const decomposition = await orch.decompose(
        'task_stats',
        'Do thing 1 and thing 2',
        {},
      )

      const executor = async (): Promise<TaskResult> => successResult('Done')

      await orch.executeSubtasks(decomposition, executor)

      const stats = orch.stats
      expect(stats.totalSubtasks).toBeGreaterThan(0)
      expect(stats.completed).toBeGreaterThan(0)
      expect(stats.failed).toBe(0)
    })

    it('should retrieve subtasks by parent task ID', async () => {
      const orch = createTestOrchestrator()
      const decomposition = await orch.decompose(
        'task_lookup',
        'Do step 1 and step 2',
        {},
      )

      const subtasks = orch.getSubtasks('task_lookup')
      expect(subtasks.length).toBe(decomposition.subtasks.length)
      for (const st of subtasks) {
        expect(st.parentTaskId).toBe('task_lookup')
      }
    })

    it('should return empty array for unknown parent task', () => {
      const orch = createTestOrchestrator()
      const subtasks = orch.getSubtasks('nonexistent')
      expect(subtasks.length).toBe(0)
    })
  })
})
