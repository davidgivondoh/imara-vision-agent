import { v4 as uuid } from 'uuid'
import { createLogger } from '../shared/logger.js'
import { EventBus } from '../shared/events.js'
import type { TelemetryEvent, ProductId, AgentEventName } from '../shared/types.js'

const log = createLogger('telemetry')

export class Telemetry {
  private sessionId: string
  private product: ProductId
  private enabled: boolean
  private events: TelemetryEvent[] = []
  private bus: EventBus

  constructor(options: { product: ProductId; enabled?: boolean; bus: EventBus }) {
    this.sessionId = uuid()
    this.product = options.product
    this.enabled = options.enabled ?? true
    this.bus = options.bus
  }

  emit(eventName: AgentEventName | string, properties: Record<string, unknown> = {}, taskId?: string): void {
    const event: TelemetryEvent = {
      eventName,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      taskId,
      properties,
      product: this.product,
    }

    this.events.push(event)
    this.bus.emit('telemetry', event)

    if (this.enabled) {
      log.debug(`${eventName}`, { taskId, ...properties })
    }
  }

  getEvents(): TelemetryEvent[] {
    return [...this.events]
  }

  getEventsByTask(taskId: string): TelemetryEvent[] {
    return this.events.filter((e) => e.taskId === taskId)
  }

  clear(): void {
    this.events = []
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }
}
