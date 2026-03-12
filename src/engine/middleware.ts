import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express'
import { createLogger } from '../shared/logger.js'

const log = createLogger('http')

// ─── Request Logging ────────────────────────────────────────────

export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now()

    // Capture response finish
    res.on('finish', () => {
      const durationMs = Date.now() - start
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'

      log[level](`${req.method} ${req.path} ${res.statusCode}`, {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
        contentLength: res.get('content-length'),
        userAgent: req.get('user-agent')?.slice(0, 100),
      })
    })

    next()
  }
}

// ─── Rate Limiter ───────────────────────────────────────────────

interface RateLimitConfig {
  windowMs: number
  maxRequests: number
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

export function rateLimiter(config: RateLimitConfig = { windowMs: 60_000, maxRequests: 100 }) {
  const store = new Map<string, RateLimitEntry>()

  // Periodic cleanup to prevent memory leak
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key)
    }
  }, config.windowMs)
  cleanupInterval.unref()

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip health checks from rate limiting
    if (req.path === '/api/agent/health') {
      next()
      return
    }

    const clientKey = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    const now = Date.now()

    let entry = store.get(clientKey)
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + config.windowMs }
      store.set(clientKey, entry)
    }

    entry.count++

    // Set rate limit headers
    const remaining = Math.max(0, config.maxRequests - entry.count)
    res.set('X-RateLimit-Limit', String(config.maxRequests))
    res.set('X-RateLimit-Remaining', String(remaining))
    res.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (entry.count > config.maxRequests) {
      log.warn('Rate limit exceeded', { clientKey, count: entry.count })
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again later.',
          retryAfterMs: entry.resetAt - now,
        },
      })
      return
    }

    next()
  }
}

// ─── Request Size Limit ─────────────────────────────────────────

export function requestSizeLimit(maxBytes: number = 1_048_576) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.get('content-length') ?? '0', 10)
    if (contentLength > maxBytes) {
      res.status(413).json({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds maximum size of ${Math.round(maxBytes / 1024)}KB`,
        },
      })
      return
    }
    next()
  }
}

// ─── Request Timeout ────────────────────────────────────────────

export function requestTimeout(timeoutMs: number = 120_000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        log.warn('Request timed out', { method: req.method, path: req.path, timeoutMs })
        res.status(504).json({
          success: false,
          error: {
            code: 'GATEWAY_TIMEOUT',
            message: `Request timed out after ${timeoutMs / 1000}s`,
          },
        })
      }
    }, timeoutMs)

    res.on('finish', () => clearTimeout(timer))
    res.on('close', () => clearTimeout(timer))
    next()
  }
}

// ─── Security Headers ───────────────────────────────────────────

export function securityHeaders() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('X-Frame-Options', 'DENY')
    res.set('X-XSS-Protection', '0')
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    res.set('Cache-Control', 'no-store')
    // Remove Express fingerprint
    res.removeHeader('X-Powered-By')
    next()
  }
}

// ─── Global Error Handler ───────────────────────────────────────

export function globalErrorHandler(): ErrorRequestHandler {
  return (err: Error, req: Request, res: Response, _next: NextFunction): void => {
    log.error('Unhandled error', {
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 3).join(' | '),
      method: req.method,
      path: req.path,
    })

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: process.env.NODE_ENV === 'production'
            ? 'An internal error occurred'
            : err.message,
        },
      })
    }
  }
}

// ─── Process Error Handlers ─────────────────────────────────────

export function setupProcessErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', {
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 5).join(' | '),
    })
    // Give time for logs to flush, then exit
    setTimeout(() => process.exit(1), 1000)
  })

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    log.error('Unhandled promise rejection', { reason: message })
  })
}
