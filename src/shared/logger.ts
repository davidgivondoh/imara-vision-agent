export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export class Logger {
  private _fixedLevel: number | null

  constructor(
    private name: string,
    level?: LogLevel,
  ) {
    // If an explicit level is passed, lock to it; otherwise defer to env var at log time
    this._fixedLevel = level != null ? LEVEL_ORDER[level] : null
  }

  private get minLevel(): number {
    if (this._fixedLevel != null) return this._fixedLevel
    const envLevel = process.env.NEURA_LOG_LEVEL as LogLevel | undefined
    return envLevel && envLevel in LEVEL_ORDER ? LEVEL_ORDER[envLevel] : LEVEL_ORDER.info
  }

  setLevel(level: LogLevel) {
    this._fixedLevel = LEVEL_ORDER[level]
  }

  debug(message: string, data?: Record<string, unknown>) {
    this.log('debug', message, data)
  }

  info(message: string, data?: Record<string, unknown>) {
    this.log('info', message, data)
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.log('warn', message, data)
  }

  error(message: string, data?: Record<string, unknown>) {
    this.log('error', message, data)
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (LEVEL_ORDER[level] < this.minLevel) return

    const timestamp = new Date().toISOString()
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.name}]`
    const suffix = data ? ` ${JSON.stringify(data)}` : ''

    const line = `${prefix} ${message}${suffix}`

    switch (level) {
      case 'error':
        console.error(line)
        break
      case 'warn':
        console.warn(line)
        break
      case 'debug':
        console.debug(line)
        break
      default:
        console.log(line)
    }
  }

  child(name: string): Logger {
    const level = this._fixedLevel != null
      ? Object.entries(LEVEL_ORDER).find(([, v]) => v === this._fixedLevel)?.[0] as LogLevel
      : undefined
    return new Logger(`${this.name}:${name}`, level)
  }
}

export function createLogger(name: string, level?: LogLevel): Logger {
  return new Logger(name, level)
}
