import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'http'
import {
  requestLogger,
  rateLimiter,
  requestSizeLimit,
  requestTimeout,
  securityHeaders,
  globalErrorHandler,
} from '../../src/engine/middleware.js'

// ─── Security, Timeout, Error Handling (high rate limit to avoid interference)

describe('Production Middleware — Core', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    const app = express()

    app.use(securityHeaders())
    app.use(requestSizeLimit(1024)) // 1KB limit for testing
    app.use(express.json({ limit: '1kb' }))
    app.use(requestLogger())
    app.use(rateLimiter({ windowMs: 60_000, maxRequests: 1000 })) // high limit
    app.use(requestTimeout(500)) // 500ms timeout for testing

    app.get('/test/ok', (_req, res) => {
      res.json({ ok: true })
    })

    app.get('/test/slow', (_req, res) => {
      setTimeout(() => {
        if (!res.headersSent) res.json({ ok: true })
      }, 1000)
    })

    app.get('/test/error', () => {
      throw new Error('Test error')
    })

    app.use(globalErrorHandler())

    server = createServer(app)
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })

    const addr = server.address() as { port: number }
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(() => {
    server.close()
  })

  it('should set security headers', async () => {
    const res = await fetch(`${baseUrl}/test/ok`)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-powered-by')).toBeNull()
  })

  it('should set rate limit headers', async () => {
    const res = await fetch(`${baseUrl}/test/ok`)
    expect(res.headers.get('x-ratelimit-limit')).toBe('1000')
    expect(res.headers.get('x-ratelimit-remaining')).toBeTruthy()
    expect(res.headers.get('x-ratelimit-reset')).toBeTruthy()
  })

  it('should timeout slow requests', async () => {
    const res = await fetch(`${baseUrl}/test/slow`)
    expect(res.status).toBe(504)
    const data = await res.json()
    expect(data.error.code).toBe('GATEWAY_TIMEOUT')
  })

  it('should catch unhandled errors and return 500', async () => {
    const res = await fetch(`${baseUrl}/test/error`)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.error.code).toBe('INTERNAL_ERROR')
  })
})

// ─── Rate Limiting (separate server with low limit)

describe('Rate Limiter', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    const app = express()
    app.use(rateLimiter({ windowMs: 60_000, maxRequests: 3 }))

    app.get('/ping', (_req, res) => {
      res.json({ pong: true })
    })

    app.get('/api/agent/health', (_req, res) => {
      res.json({ status: 'healthy' })
    })

    server = createServer(app)
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })

    const addr = server.address() as { port: number }
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(() => {
    server.close()
  })

  it('should allow requests within limit', async () => {
    const res = await fetch(`${baseUrl}/ping`)
    expect(res.status).toBe(200)
  })

  it('should return 429 when rate limit exceeded', async () => {
    // Already used 1 in previous test. Use 2 more to exhaust limit (3 total)
    await fetch(`${baseUrl}/ping`)
    await fetch(`${baseUrl}/ping`)

    // This should be blocked
    const res = await fetch(`${baseUrl}/ping`)
    expect(res.status).toBe(429)
    const data = await res.json()
    expect(data.error.code).toBe('RATE_LIMITED')
    expect(data.error.retryAfterMs).toBeGreaterThan(0)
  })

  it('should not rate limit health check endpoint', async () => {
    // Health check should bypass rate limiting even after limit is exceeded
    const res = await fetch(`${baseUrl}/api/agent/health`)
    expect(res.status).toBe(200)
  })
})
