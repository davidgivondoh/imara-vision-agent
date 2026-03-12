import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import { createLogger } from '../shared/logger.js'
import type { AgentInstance } from './agent-instance.js'

const log = createLogger('websocket')

interface WsClient {
  ws: WebSocket
  subscriptions: Set<string>
  isAlive: boolean
  messageCount: number
  messageWindowStart: number
}

export interface WebSocketConfig {
  heartbeatIntervalMs: number
  maxClients: number
  maxMessagesPerMinute: number
}

const DEFAULT_WS_CONFIG: WebSocketConfig = {
  heartbeatIntervalMs: 30_000,
  maxClients: 50,
  maxMessagesPerMinute: 60,
}

export function setupWebSocket(
  server: Server,
  agent: AgentInstance,
  config?: Partial<WebSocketConfig>,
): WebSocketServer {
  const wsConfig = { ...DEFAULT_WS_CONFIG, ...config }
  const wss = new WebSocketServer({ server, path: '/ws/agent/stream' })
  const clients = new Set<WsClient>()

  // ── Heartbeat (ping/pong) ───────────────────────────────────
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.isAlive) {
        log.info('Terminating unresponsive WebSocket client')
        client.ws.terminate()
        clients.delete(client)
        continue
      }
      client.isAlive = false
      client.ws.ping()
    }
  }, wsConfig.heartbeatIntervalMs)

  wss.on('close', () => {
    clearInterval(heartbeat)
  })

  // ── Connection handler ──────────────────────────────────────
  wss.on('connection', (ws) => {
    // Connection limit
    if (clients.size >= wsConfig.maxClients) {
      log.warn('WebSocket connection rejected: max clients reached', { max: wsConfig.maxClients })
      ws.close(1013, 'Max connections reached')
      return
    }

    const client: WsClient = {
      ws,
      subscriptions: new Set(),
      isAlive: true,
      messageCount: 0,
      messageWindowStart: Date.now(),
    }
    clients.add(client)
    log.info(`WebSocket client connected (total: ${clients.size})`)

    // Pong handler for heartbeat
    ws.on('pong', () => {
      client.isAlive = true
    })

    ws.on('message', (data) => {
      // Message rate limiting
      const now = Date.now()
      if (now - client.messageWindowStart > 60_000) {
        client.messageCount = 0
        client.messageWindowStart = now
      }
      client.messageCount++

      if (client.messageCount > wsConfig.maxMessagesPerMinute) {
        ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }))
        return
      }

      try {
        const message = JSON.parse(data.toString()) as { action: string; taskId?: string }

        if (message.action === 'subscribe' && message.taskId) {
          client.subscriptions.add(message.taskId)
          ws.send(JSON.stringify({ type: 'subscribed', taskId: message.taskId }))
        }

        if (message.action === 'unsubscribe' && message.taskId) {
          client.subscriptions.delete(message.taskId)
          ws.send(JSON.stringify({ type: 'unsubscribed', taskId: message.taskId }))
        }

        if (message.action === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }))
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }))
      }
    })

    ws.on('close', () => {
      clients.delete(client)
      log.info(`WebSocket client disconnected (total: ${clients.size})`)
    })

    ws.on('error', (err) => {
      log.error('WebSocket error', { error: err.message })
      clients.delete(client)
    })
  })

  // ── Broadcast helpers ───────────────────────────────────────

  function broadcast(taskId: string | undefined, payload: Record<string, unknown>): void {
    const data = JSON.stringify(payload)
    for (const client of clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue
      if (taskId && client.subscriptions.size > 0 && !client.subscriptions.has(taskId)) continue
      client.ws.send(data)
    }
  }

  // Forward agent events to subscribed WebSocket clients
  agent.bus.on('telemetry', (event: unknown) => {
    const e = event as { eventName: string; taskId?: string; timestamp: string; properties: Record<string, unknown> }
    broadcast(e.taskId, {
      type: 'event',
      eventName: e.eventName,
      taskId: e.taskId,
      timestamp: e.timestamp,
      properties: e.properties,
    })
  })

  agent.bus.on('task.stage', (event: unknown) => {
    const e = event as { taskId: string; stage: string; status: string; timestamp: string }
    broadcast(e.taskId, { type: 'stage', taskId: e.taskId, stage: e.stage, status: e.status, timestamp: e.timestamp })
  })

  agent.bus.on('task.step', (event: unknown) => {
    const e = event as { taskId: string; step: Record<string, unknown> }
    broadcast(e.taskId, { type: 'step', taskId: e.taskId, step: e.step })
  })

  agent.bus.on('task.tool', (event: unknown) => {
    const e = event as { taskId: string; tool: string; status: string; params?: string[]; durationMs?: number; timestamp: string }
    broadcast(e.taskId, {
      type: 'tool',
      taskId: e.taskId,
      tool: e.tool,
      status: e.status,
      params: e.params,
      durationMs: e.durationMs,
      timestamp: e.timestamp,
    })
  })

  agent.bus.on('task.token', (event: unknown) => {
    const e = event as { taskId: string; token: string; timestamp: string }
    broadcast(e.taskId, { type: 'token', taskId: e.taskId, token: e.token })
  })

  agent.bus.on('task.answer', (event: unknown) => {
    const e = event as { taskId: string; answer: string; confidence: number; timestamp: string }
    broadcast(e.taskId, { type: 'answer', taskId: e.taskId, answer: e.answer, confidence: e.confidence, timestamp: e.timestamp })
  })

  agent.bus.on('task.done', (event: unknown) => {
    const e = event as { taskId: string; result: Record<string, unknown> }
    broadcast(e.taskId, { type: 'task.completed', taskId: e.taskId, result: e.result })
  })

  log.info('WebSocket server ready at /ws/agent/stream', {
    heartbeatMs: wsConfig.heartbeatIntervalMs,
    maxClients: wsConfig.maxClients,
  })

  return wss
}
