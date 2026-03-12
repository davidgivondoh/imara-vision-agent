import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { createLogger } from '../shared/logger.js'
import { AgentInstance } from './agent-instance.js'
import { createRoutes } from './routes.js'
import { setupWebSocket } from './websocket.js'
import {
  requestLogger,
  rateLimiter,
  requestSizeLimit,
  requestTimeout,
  securityHeaders,
  globalErrorHandler,
  setupProcessErrorHandlers,
} from './middleware.js'

const log = createLogger('server')

const SHUTDOWN_TIMEOUT_MS = 10_000

async function main() {
  // ── Process-level error handlers ─────────────────────────────
  setupProcessErrorHandlers()

  // ── Create Agent Instance ────────────────────────────────────
  const agent = new AgentInstance({ product: 'engine' })
  await agent.start()

  // ── Express App ──────────────────────────────────────────────
  const app = express()

  // Security headers (before everything)
  app.use(securityHeaders())

  // CORS
  app.use(cors({ origin: agent.config.engine.corsOrigins }))

  // Request size limit (1MB default, before body parsing)
  app.use(requestSizeLimit())

  // Body parsing
  app.use(express.json({ limit: '1mb' }))

  // Request logging
  app.use(requestLogger())

  // Rate limiting (100 req/min per IP)
  app.use(rateLimiter({ windowMs: 60_000, maxRequests: 100 }))

  // Request timeout (2 minutes for long-running tasks)
  app.use(requestTimeout(120_000))

  // ── Liveness probe (always responds, no deps) ───────────────
  app.get('/api/agent/live', (_req, res) => {
    res.json({ status: 'alive', timestamp: new Date().toISOString() })
  })

  // ── Readiness probe (checks dependencies) ───────────────────
  app.get('/api/agent/ready', (_req, res) => {
    if (!agent.isRunning) {
      res.status(503).json({ status: 'not_ready', reason: 'Agent not started' })
      return
    }

    const inferenceStatus = agent.inference.getStatus()
    const hasInference = inferenceStatus.local || inferenceStatus.cloud || inferenceStatus.ollama

    if (!hasInference) {
      res.status(503).json({ status: 'not_ready', reason: 'No inference provider available' })
      return
    }

    res.json({
      status: 'ready',
      inference: inferenceStatus.activeProvider,
      memory: agent.memory.size,
      uptime: agent.uptime,
    })
  })

  // Mount API routes
  app.use(createRoutes(agent))

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    })
  })

  // Global error handler (must be after all routes)
  app.use(globalErrorHandler())

  // ── HTTP Server + WebSocket ──────────────────────────────────
  const server = createServer(app)
  const wss = setupWebSocket(server, agent)

  const { port, host } = agent.config.engine
  server.listen(port, host, () => {
    log.info(`Imara Vision Agent engine running at http://${host}:${port}`)
    log.info(`WebSocket at ws://${host}:${port}/ws/agent/stream`)
    console.log('')
    console.log('  ┌─────────────────────────────────────────────────┐')
    console.log('  │                                                 │')
    console.log('  │   Imara Vision Agent  ·  App Engine             │')
    console.log(`  │   Running on http://${host}:${port}              │`)
    console.log('  │                                                 │')
    console.log('  │   Endpoints:                                    │')
    console.log('  │   POST /api/agent/run     — execute a task      │')
    console.log('  │   POST /api/agent/tasks   — create a task       │')
    console.log('  │   GET  /api/agent/health  — health check        │')
    console.log('  │   GET  /api/agent/live    — liveness probe      │')
    console.log('  │   GET  /api/agent/ready   — readiness probe     │')
    console.log('  │   WS   /ws/agent/stream   — realtime events     │')
    console.log('  │                                                 │')
    console.log('  └─────────────────────────────────────────────────┘')
    console.log('')
  })

  // ── Graceful Shutdown with Drain ─────────────────────────────
  let isShuttingDown = false

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return
    isShuttingDown = true

    log.info(`Received ${signal}, starting graceful shutdown...`)

    // Stop accepting new connections
    server.close(() => {
      log.info('HTTP server closed')
    })

    // Close all WebSocket connections gracefully
    for (const client of wss.clients) {
      client.close(1001, 'Server shutting down')
    }
    wss.close()

    // Wait for agent to finish in-flight work
    try {
      await agent.stop()
      log.info('Agent stopped cleanly')
    } catch (err) {
      log.error('Error during agent shutdown', {
        error: err instanceof Error ? err.message : 'Unknown',
      })
    }

    // Force exit if shutdown takes too long
    const forceTimer = setTimeout(() => {
      log.warn(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`)
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    forceTimer.unref()

    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err) => {
  log.error('Fatal error', { error: err instanceof Error ? err.message : 'Unknown' })
  process.exit(1)
})
