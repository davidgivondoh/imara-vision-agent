import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { AgentInstance } from './agent-instance.js'
import type { UserRole } from '../shared/types.js'

export function createRoutes(agent: AgentInstance): Router {
  const router = Router()

  // ── Health ────────────────────────────────────────────────
  router.get('/api/agent/health', (_req: Request, res: Response) => {
    res.json(agent.health())
  })

  // ── Tasks ─────────────────────────────────────────────────
  const createTaskSchema = z.object({
    instruction: z.string().min(1, 'instruction is required'),
    context: z.record(z.unknown()).optional(),
    constraints: z.object({
      maxSteps: z.number().int().positive().optional(),
      requireConfirmation: z.boolean().optional(),
      timeout: z.number().int().positive().optional(),
      autonomyLevel: z.enum(['L0', 'L1', 'L2', 'L3', 'L4']).optional(),
    }).optional(),
  })

  // ── Stream (single-call: create + execute, returns immediately) ──
  router.post('/api/agent/stream', async (req: Request, res: Response) => {
    const parsed = createTaskSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
      return
    }

    try {
      const task = agent.scheduler.createTask({
        instruction: parsed.data.instruction,
        context: parsed.data.context,
        constraints: parsed.data.constraints,
      })

      // Fire-and-forget: enqueue and respond immediately
      agent.scheduler.enqueue(task.id).catch(() => {})

      res.json({ success: true, taskId: task.id })
    } catch (err) {
      res.status(500).json({
        success: false,
        error: { code: 'TASK_ERROR', message: err instanceof Error ? err.message : 'Failed to create task' },
      })
    }
  })

  router.post('/api/agent/tasks', async (req: Request, res: Response) => {
    const parsed = createTaskSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message, details: parsed.error.issues },
      })
      return
    }

    const task = agent.scheduler.createTask({
      instruction: parsed.data.instruction,
      context: parsed.data.context,
      constraints: parsed.data.constraints,
    })

    res.status(201).json({ success: true, task: { id: task.id, status: task.status, instruction: task.instruction, createdAt: task.createdAt } })
  })

  router.get('/api/agent/tasks/:id', (req: Request, res: Response) => {
    const task = agent.scheduler.getTask(req.params.id)
    if (!task) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Task not found' } })
      return
    }
    res.json({ success: true, task })
  })

  router.post('/api/agent/tasks/:id/execute', async (req: Request, res: Response) => {
    const task = agent.scheduler.getTask(req.params.id)
    if (!task) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Task not found' } })
      return
    }

    try {
      // Enqueue for async execution
      await agent.scheduler.enqueue(task.id)
      res.json({ success: true, message: 'Task queued for execution', taskId: task.id })
    } catch (err) {
      res.status(400).json({
        success: false,
        error: { code: 'TASK_ERROR', message: err instanceof Error ? err.message : 'Failed to execute task' },
      })
    }
  })

  router.post('/api/agent/tasks/:id/cancel', async (req: Request, res: Response) => {
    try {
      await agent.scheduler.cancelTask(req.params.id)
      res.json({ success: true, message: 'Task cancelled' })
    } catch (err) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: err instanceof Error ? err.message : 'Task not found' },
      })
    }
  })

  router.get('/api/agent/tasks', (req: Request, res: Response) => {
    const status = req.query.status as string | undefined
    const limit = parseInt(req.query.limit as string) || 20
    const offset = parseInt(req.query.offset as string) || 0

    const tasks = agent.scheduler.listTasks({
      status: status as any,
      limit,
      offset,
    })

    res.json({ success: true, tasks, count: tasks.length })
  })

  // ── Quick Execute (create + run in one call) ──────────────
  router.post('/api/agent/run', async (req: Request, res: Response) => {
    const parsed = createTaskSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
      return
    }

    try {
      const task = agent.scheduler.createTask({
        instruction: parsed.data.instruction,
        context: parsed.data.context,
        constraints: parsed.data.constraints,
      })

      const result = await agent.scheduler.executeTask(task.id)
      const completedTask = agent.scheduler.getTask(task.id)
      const steps = (completedTask?.steps ?? []).map(s => ({
        type: s.type,
        description: s.description,
        durationMs: s.durationMs,
      }))
      res.json({ success: true, taskId: task.id, result, steps })
    } catch (err) {
      res.status(500).json({
        success: false,
        error: { code: 'TASK_FAILED', message: err instanceof Error ? err.message : 'Task execution failed' },
      })
    }
  })

  // ── Recommendations ───────────────────────────────────────
  const recommendationSchema = z.object({
    role: z.enum(['student', 'teacher', 'admin', 'independent_living_user', 'carer']),
    intent: z.string().min(1),
    context: z.record(z.unknown()).optional(),
    limit: z.number().int().positive().optional(),
  })

  router.post('/api/agent/recommendations', async (req: Request, res: Response) => {
    const parsed = recommendationSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
      return
    }

    try {
      const recommendations = await agent.loop.generateRecommendations({
        role: parsed.data.role as UserRole,
        intent: parsed.data.intent,
        context: parsed.data.context ?? {},
        limit: parsed.data.limit,
      })

      res.json({ success: true, recommendations })
    } catch (err) {
      res.status(500).json({
        success: false,
        error: { code: 'TASK_FAILED', message: err instanceof Error ? err.message : 'Failed to generate recommendations' },
      })
    }
  })

  // ── Feedback ──────────────────────────────────────────────
  const feedbackSchema = z.object({
    recommendationId: z.string().min(1),
    sentiment: z.enum(['helpful', 'not_helpful', 'edited']),
    comment: z.string().optional(),
    completed: z.boolean().optional(),
  })

  router.post('/api/agent/feedback', (req: Request, res: Response) => {
    const parsed = feedbackSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
      return
    }

    agent.telemetry.emit('feedback.submitted', {
      recommendationId: parsed.data.recommendationId,
      sentiment: parsed.data.sentiment,
      completed: parsed.data.completed,
    })

    res.json({ success: true })
  })

  // ── Memory ────────────────────────────────────────────────
  const memorySearchSchema = z.object({
    query: z.string().min(1),
    limit: z.number().int().positive().optional(),
    type: z.enum(['preference', 'correction', 'context', 'fact', 'routine']).optional(),
    scope: z.enum(['user', 'session', 'task']).optional(),
  })

  router.post('/api/agent/memory/search', async (req: Request, res: Response) => {
    const parsed = memorySearchSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
      return
    }

    const results = await agent.memory.search(parsed.data.query, {
      limit: parsed.data.limit,
      type: parsed.data.type,
      scope: parsed.data.scope,
    })

    res.json({ success: true, entries: results, count: results.length })
  })

  const memoryStoreSchema = z.object({
    key: z.string().min(1),
    value: z.string().min(1),
    type: z.enum(['preference', 'correction', 'context', 'fact', 'routine']),
    scope: z.enum(['user', 'session', 'task']),
    expiresAt: z.string().optional(),
  })

  router.post('/api/agent/memory', async (req: Request, res: Response) => {
    const parsed = memoryStoreSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
      return
    }

    const id = await agent.memory.store(parsed.data)
    res.status(201).json({ success: true, id })
  })

  router.get('/api/agent/memory/export', async (_req: Request, res: Response) => {
    const entries = await agent.memory.export()
    res.json({ success: true, entries, count: entries.length })
  })

  router.delete('/api/agent/memory', async (_req: Request, res: Response) => {
    await agent.memory.clear()
    res.json({ success: true, message: 'Memory cleared' })
  })

  // ── Config ────────────────────────────────────────────────
  router.get('/api/agent/config', (_req: Request, res: Response) => {
    // Return safe config (strip API keys)
    const safe = { ...agent.config }
    res.json({
      success: true,
      config: {
        agent: safe.agent,
        privacy: safe.privacy,
        general: safe.general,
      },
    })
  })

  // ── Plugins ───────────────────────────────────────────────
  router.get('/api/agent/plugins', (_req: Request, res: Response) => {
    res.json({ success: true, plugins: agent.plugins.list() })
  })

  // ── Tools ──────────────────────────────────────────────────
  router.get('/api/agent/tools', (_req: Request, res: Response) => {
    res.json({ success: true, tools: agent.tools.toJSON(), count: agent.tools.count })
  })

  const toolExecSchema = z.object({
    params: z.record(z.unknown()).optional(),
  })

  router.post('/api/agent/tools/:name', async (req: Request, res: Response) => {
    const toolName = req.params.name
    if (!agent.tools.has(toolName)) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Tool "${toolName}" not found` },
      })
      return
    }

    const parsed = toolExecSchema.safeParse(req.body)
    const params = parsed.success ? (parsed.data.params ?? {}) : {}

    try {
      const result = await agent.tools.execute(toolName, params)
      res.json({ success: result.success, result })
    } catch (err) {
      res.status(500).json({
        success: false,
        error: { code: 'TOOL_ERROR', message: err instanceof Error ? err.message : 'Tool execution failed' },
      })
    }
  })

  // ── Accessibility ───────────────────────────────────────────
  const a11yProfileSchema = z.object({
    userId: z.string().min(1),
    needs: z.array(z.enum(['visual', 'auditory', 'motor', 'cognitive', 'speech'])).optional(),
  })

  router.post('/api/agent/accessibility/profiles', (req: Request, res: Response) => {
    const parsed = a11yProfileSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
      return
    }

    const profile = agent.accessibility.createProfile(parsed.data.userId, parsed.data.needs)
    res.status(201).json({ success: true, profile })
  })

  router.get('/api/agent/accessibility/profiles/:userId', (req: Request, res: Response) => {
    const profile = agent.accessibility.getProfile(req.params.userId)
    if (!profile) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Profile not found' } })
      return
    }
    res.json({ success: true, profile })
  })

  const a11yUpdateSchema = z.object({
    readingLevel: z.enum(['simple', 'standard', 'advanced']).optional(),
    highContrast: z.boolean().optional(),
    largeText: z.boolean().optional(),
    reducedMotion: z.boolean().optional(),
    screenReader: z.boolean().optional(),
    voiceControl: z.boolean().optional(),
    simplifiedLanguage: z.boolean().optional(),
    extendedTimeouts: z.boolean().optional(),
    cognitiveLoadLimit: z.enum(['low', 'medium', 'high']).optional(),
  })

  router.patch('/api/agent/accessibility/profiles/:userId', (req: Request, res: Response) => {
    const parsed = a11yUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
      return
    }

    const profile = agent.accessibility.updateProfile(req.params.userId, parsed.data)
    if (!profile) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Profile not found' } })
      return
    }
    res.json({ success: true, profile })
  })

  const a11yAdaptSchema = z.object({
    content: z.string().min(1),
    userId: z.string().optional(),
    readingLevel: z.enum(['simple', 'standard', 'advanced']).optional(),
  })

  router.post('/api/agent/accessibility/adapt', (req: Request, res: Response) => {
    const parsed = a11yAdaptSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
      return
    }

    let adaptation
    if (parsed.data.userId) {
      adaptation = agent.accessibility.adaptContent(parsed.data.content, parsed.data.userId)
    } else {
      adaptation = agent.accessibility.adaptContentByLevel(
        parsed.data.content,
        parsed.data.readingLevel ?? 'standard',
      )
    }

    res.json({ success: true, adaptation })
  })

  const a11yCognitiveSchema = z.object({
    content: z.string().min(1),
    userId: z.string().optional(),
    taskCount: z.number().optional(),
    sessionDurationMinutes: z.number().optional(),
  })

  router.post('/api/agent/accessibility/cognitive-load', (req: Request, res: Response) => {
    const parsed = a11yCognitiveSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
      return
    }

    const assessment = agent.accessibility.assessCognitiveLoad(
      parsed.data.content,
      parsed.data.userId,
      {
        taskCount: parsed.data.taskCount,
        sessionDurationMinutes: parsed.data.sessionDurationMinutes,
      },
    )

    res.json({ success: true, assessment })
  })

  router.get('/api/agent/accessibility/stats', (_req: Request, res: Response) => {
    res.json({ success: true, stats: agent.accessibility.stats })
  })

  // ── Telemetry (recent events) ─────────────────────────────
  router.get('/api/agent/telemetry', (req: Request, res: Response) => {
    const taskId = req.query.taskId as string | undefined
    const events = taskId
      ? agent.telemetry.getEventsByTask(taskId)
      : agent.telemetry.getEvents().slice(-100)

    res.json({ success: true, events, count: events.length })
  })

  return router
}
