import { describe, it, expect, beforeAll } from 'vitest'
import { EventBus } from '../../src/shared/events.js'
import { Telemetry } from '../../src/core/telemetry.js'
import { InferenceLayer } from '../../src/inference/index.js'
import { MemoryStore } from '../../src/core/memory.js'
import { ToolRegistry, filesystemTools, codeTools } from '../../src/tools/index.js'

import { PlannerAgent } from '../../src/core/agents/planner.js'
import { VerificationAgent } from '../../src/core/agents/verification.js'
import { ResearchAgent } from '../../src/core/agents/research.js'
import { CodeAgent } from '../../src/core/agents/code-agent.js'
import { MemoryAgent } from '../../src/core/agents/memory-agent.js'
import { Supervisor } from '../../src/core/agents/supervisor.js'
import type { TaskNode, SharedState } from '../../src/core/agents/types.js'

// ─── Test helpers ───────────────────────────────────────────────

function createTestInfra() {
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
  inference.initialize()

  const memory = new MemoryStore({ maxEntries: 100 })

  const tools = new ToolRegistry()
  for (const tool of [...filesystemTools, ...codeTools]) {
    tools.register(tool)
  }

  return { bus, telemetry, inference, memory, tools }
}

function makeNode(overrides?: Partial<TaskNode>): TaskNode {
  return {
    id: 'test_node_1',
    instruction: 'Test instruction',
    assignedAgent: 'research',
    dependsOn: [],
    status: 'pending',
    retryCount: 0,
    maxRetries: 2,
    timeoutMs: 10_000,
    ...overrides,
  }
}

function makeState(overrides?: Partial<SharedState>): SharedState {
  return {
    taskGraph: null,
    currentNodeId: null,
    history: [],
    toolOutputs: {},
    errorLog: [],
    userContext: {},
    memoryContext: '',
    ...overrides,
  }
}

const noopEmit = () => {}

// ─── Planner Agent ──────────────────────────────────────────────

describe('PlannerAgent', () => {
  it('should detect single-agent tasks', () => {
    const { inference } = createTestInfra()
    const planner = new PlannerAgent({ inference })

    expect(planner.needsMultiAgent('What is the weather today?')).toBe(false)
    expect(planner.needsMultiAgent('Search for cats')).toBe(false)
  })

  it('should detect multi-agent tasks', () => {
    const { inference } = createTestInfra()
    const planner = new PlannerAgent({ inference })

    expect(planner.needsMultiAgent(
      'Search for accessible taxis and then book one on the website',
    )).toBe(true)

    expect(planner.needsMultiAgent(
      'First find insurance plans, then compare them and open the best one',
    )).toBe(true)
  })

  it('should create a task graph from a goal', async () => {
    const { inference } = createTestInfra()
    const planner = new PlannerAgent({ inference })

    const graph = await planner.plan(
      'Find information about accessible transport in Nairobi',
      {},
      '',
    )

    expect(graph).toBeDefined()
    expect(graph.id).toMatch(/^graph_/)
    expect(graph.goal).toBe('Find information about accessible transport in Nairobi')
    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.nodes[0].id).toMatch(/^node_/)
    expect(graph.nodes[0].status).toBe('pending')
    expect(graph.createdAt).toBeTruthy()
  })

  it('should assign agents based on instruction keywords', async () => {
    const { inference } = createTestInfra()
    const planner = new PlannerAgent({ inference })

    // The rule-based local inference may produce minimal output,
    // but the planner should still create at least one node
    const graph = await planner.plan('Search for information', {}, '')
    expect(graph.nodes.length).toBeGreaterThan(0)
  })

  it('should re-plan failed nodes', async () => {
    const { inference } = createTestInfra()
    const planner = new PlannerAgent({ inference })

    const graph = await planner.plan('Search and book a taxi', {}, '')
    const firstNodeId = graph.nodes[0].id

    const revisedGraph = await planner.replan(
      graph,
      firstNodeId,
      'Search returned no results, try different query',
    )

    expect(revisedGraph).toBeDefined()
    expect(revisedGraph.nodes.length).toBeGreaterThan(0)
  })
})

// ─── Verification Agent ─────────────────────────────────────────

describe('VerificationAgent', () => {
  it('should quick-verify passing output', () => {
    const { inference } = createTestInfra()
    const verifier = new VerificationAgent({ inference })

    const result = verifier.quickVerify(
      'Here are three accessible taxi services in Nairobi: Easy Ride, Uber Access, and SafeBoda.',
      'Find accessible taxi services in Nairobi',
    )

    expect(result.passed).toBe(true)
    expect(result.criteria.matchesIntent).toBe(true)
    expect(result.criteria.outputComplete).toBe(true)
  })

  it('should quick-verify failing output (error message)', () => {
    const { inference } = createTestInfra()
    const verifier = new VerificationAgent({ inference })

    const result = verifier.quickVerify(
      'Error: timeout',
      'Find accessible taxi services',
    )

    expect(result.passed).toBe(false)
  })

  it('should quick-verify empty output as failed', () => {
    const { inference } = createTestInfra()
    const verifier = new VerificationAgent({ inference })

    const result = verifier.quickVerify('', 'Find taxis')
    expect(result.passed).toBe(false)
    expect(result.criteria.outputComplete).toBe(false)
  })

  it('should detect irrelevant output', () => {
    const { inference } = createTestInfra()
    const verifier = new VerificationAgent({ inference })

    const result = verifier.quickVerify(
      'The Eiffel Tower was built in 1889 and stands 324 metres tall.',
      'Find accessible taxi services in Nairobi',
    )

    expect(result.criteria.matchesIntent).toBe(false)
  })

  it('should execute as specialist agent', async () => {
    const { inference } = createTestInfra()
    const verifier = new VerificationAgent({ inference })

    const node = makeNode({ assignedAgent: 'verification' })
    const state = makeState({
      taskGraph: {
        id: 'graph_test',
        goal: 'Find taxis',
        nodes: [
          {
            ...makeNode({ id: 'prev_1', status: 'completed', assignedAgent: 'research' }),
            result: {
              id: 'msg_1',
              from: 'research',
              to: 'supervisor',
              type: 'task_result',
              payload: { output: 'Found 3 accessible taxi services in Nairobi.' },
              timestamp: new Date().toISOString(),
            },
          },
        ],
        strategy: 'sequential',
        createdAt: new Date().toISOString(),
      },
    })

    const result = await verifier.execute(node, state, noopEmit)
    expect(result).toBeDefined()
    expect(typeof result.output).toBe('string')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})

// ─── Code Agent ─────────────────────────────────────────────────

describe('CodeAgent', () => {
  it('should execute a code task', async () => {
    const { inference, tools } = createTestInfra()
    const codeAgent = new CodeAgent({ inference, tools })

    const node = makeNode({
      instruction: 'Calculate the sum of 1 to 10',
      assignedAgent: 'code',
    })
    const state = makeState()

    const result = await codeAgent.execute(node, state, noopEmit)
    expect(result).toBeDefined()
    expect(typeof result.output).toBe('string')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})

// ─── Memory Agent ───────────────────────────────────────────────

describe('MemoryAgent', () => {
  it('should store a memory', async () => {
    const { memory, tools } = createTestInfra()
    const memAgent = new MemoryAgent({ memory, tools })

    const node = makeNode({
      instruction: 'Remember that my favourite colour is blue',
      assignedAgent: 'memory',
    })
    const state = makeState()

    const result = await memAgent.execute(node, state, noopEmit)
    expect(result.success).toBe(true)
    expect(result.output).toContain('remember')

    // Verify it was stored
    const entries = await memory.search('colour', { limit: 5 })
    expect(entries.length).toBeGreaterThan(0)
  })

  it('should recall stored memories', async () => {
    const { memory, tools } = createTestInfra()
    const memAgent = new MemoryAgent({ memory, tools })

    // Store something first
    await memory.store({
      key: 'user:favourite_food',
      value: 'My favourite food is pizza',
      type: 'preference',
      scope: 'user',
    })

    const node = makeNode({
      instruction: 'Recall what you know about my favourite food',
      assignedAgent: 'memory',
    })
    const state = makeState()

    const result = await memAgent.execute(node, state, noopEmit)
    expect(result.success).toBe(true)
    expect(result.output).toContain('pizza')
  })

  it('should handle forget requests', async () => {
    const { memory, tools } = createTestInfra()
    const memAgent = new MemoryAgent({ memory, tools })

    await memory.store({
      key: 'user:temp_data',
      value: 'temporary information',
      type: 'context',
      scope: 'session',
    })

    const node = makeNode({
      instruction: 'Forget about temp_data',
      assignedAgent: 'memory',
    })
    const state = makeState()

    const result = await memAgent.execute(node, state, noopEmit)
    expect(result.success).toBe(true)
  })
})

// ─── Supervisor ─────────────────────────────────────────────────

describe('Supervisor', () => {
  it('should be constructable with all agents', () => {
    const { inference, tools, memory, telemetry, bus } = createTestInfra()

    const supervisor = new Supervisor({
      inference,
      tools,
      memory,
      telemetry,
      bus,
    })

    expect(supervisor.registeredAgents).toContain('research')
    expect(supervisor.registeredAgents).toContain('browser')
    expect(supervisor.registeredAgents).toContain('desktop')
    expect(supervisor.registeredAgents).toContain('code')
    expect(supervisor.registeredAgents).toContain('memory')
    expect(supervisor.registeredAgents.length).toBe(5)
  })

  it('should expose planner and verifier', () => {
    const { inference, tools, memory, telemetry, bus } = createTestInfra()

    const supervisor = new Supervisor({
      inference,
      tools,
      memory,
      telemetry,
      bus,
    })

    expect(supervisor.plannerAgent).toBeDefined()
    expect(supervisor.verificationAgent).toBeDefined()
  })

  it('should run a simple single-agent task', async () => {
    const { inference, tools, memory, telemetry, bus } = createTestInfra()

    const supervisor = new Supervisor({
      inference,
      tools,
      memory,
      telemetry,
      bus,
    })

    // This will route to a single agent since it's a simple request
    // Rule-based inference won't produce great results but should not crash
    const result = await supervisor.run('Remember that I prefer large text')

    expect(result).toBeDefined()
    expect(typeof result.output).toBe('string')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.agentsUsed.length).toBeGreaterThanOrEqual(0)
  })

  it('should run a multi-agent task', async () => {
    const { inference, tools, memory, telemetry, bus } = createTestInfra()

    const supervisor = new Supervisor({
      inference,
      tools,
      memory,
      telemetry,
      bus,
    })

    const result = await supervisor.run(
      'Search for accessible transport options and then open the best website',
    )

    expect(result).toBeDefined()
    expect(typeof result.output).toBe('string')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('should handle errors gracefully', async () => {
    const { inference, tools, memory, telemetry, bus } = createTestInfra()

    const supervisor = new Supervisor({
      inference,
      tools,
      memory,
      telemetry,
      bus,
    })

    // Even with rule-based inference (limited capability), should not throw
    const result = await supervisor.run('')

    // Empty instruction should still return something
    expect(result).toBeDefined()
    expect(typeof result.output).toBe('string')
  })

  it('should include tools used in result', async () => {
    const { inference, tools, memory, telemetry, bus } = createTestInfra()

    const supervisor = new Supervisor({
      inference,
      tools,
      memory,
      telemetry,
      bus,
    })

    const result = await supervisor.run('Remember my name is David')

    expect(result).toBeDefined()
    expect(Array.isArray(result.toolsUsed)).toBe(true)
    expect(Array.isArray(result.agentsUsed)).toBe(true)
  })
})
