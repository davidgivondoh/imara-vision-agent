// Suppress internal log noise — the UI provides its own feedback
process.env.NEURA_LOG_LEVEL = process.env.NEURA_LOG_LEVEL ?? 'warn'

import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { AgentInstance } from '../engine/agent-instance.js'
import { createRoutes } from '../engine/routes.js'
import { setupWebSocket } from '../engine/websocket.js'
import {
  loadMemory, saveMemory,
  loadPersistedConfig,
  getNeuraDir,
} from './persistence.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UI_DIR = join(__dirname, 'ui')

async function main() {
  // Load persisted config
  const persistedConfig = loadPersistedConfig()
  const agent = new AgentInstance({
    product: 'desktop',
    configOverrides: {
      ...persistedConfig,
      engine: { port: 3210, host: '127.0.0.1', corsOrigins: '*' },
    },
  })

  // Load persisted memory
  const savedMemory = loadMemory()
  if (savedMemory.length > 0) {
    agent.memory.loadEntries(savedMemory)
  }

  // Auto-save memory on changes (debounced)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  agent.memory.onChanged(async () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      const entries = await agent.memory.export()
      saveMemory(entries)
    }, 500)
  })

  await agent.start()

  // ── Express App ──────────────────────────────────────────
  const app = express()
  app.use(cors({ origin: '*' }))
  app.use(express.json())

  // Serve static UI files
  app.use(express.static(UI_DIR))

  // Mount API routes
  app.use(createRoutes(agent))

  // SPA fallback — serve index.html for non-API routes
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found' } })
      return
    }
    res.sendFile(join(UI_DIR, 'index.html'))
  })

  // ── HTTP Server + WebSocket ──────────────────────────────
  const server = createServer(app)
  setupWebSocket(server, agent)

  const port = 3210
  const host = '127.0.0.1'

  server.listen(port, host, () => {
    console.log('')
    console.log('  \x1b[1mImara Vision Agent\x1b[0m  \x1b[2mv0.1.0\x1b[0m')
    console.log('')
    console.log(`  \x1b[32m\x1b[1m  Desktop UI ready\x1b[0m`)
    console.log('')
    console.log(`  \x1b[36m  http://${host}:${port}\x1b[0m`)
    console.log('')
    console.log(`  \x1b[2m  API:  http://${host}:${port}/api/agent/health\x1b[0m`)
    console.log(`  \x1b[2m  WS:   ws://${host}:${port}/ws/agent/stream\x1b[0m`)
    console.log(`  \x1b[2m  Data: ${getNeuraDir()}\x1b[0m`)
    console.log('')
  })

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n  \x1b[2mSaving memory and shutting down...\x1b[0m')
    const entries = await agent.memory.export()
    saveMemory(entries)
    await agent.stop()
    server.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
