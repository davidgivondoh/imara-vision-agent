import { createLogger } from '../shared/logger.js'
import type { SensorDescriptor, SensorReading, AgentAction, ActionResult } from '../shared/types.js'
import type { ProductAdapter, ProductConfig } from './adapter.js'

const log = createLogger('product:pen')

export class ImaraPenAdapter implements ProductAdapter {
  productId = 'pen'
  private initialized = false

  async initialize(config: ProductConfig): Promise<void> {
    log.info('Imara Pen adapter initialised', { settings: config.settings })
    this.initialized = true
  }

  getSensors(): SensorDescriptor[] {
    return [
      { id: 'handwriting', type: 'stroke_data', name: 'Handwriting Sensor' },
      { id: 'microphone', type: 'audio', name: 'Built-in Microphone', unit: 'pcm' },
      { id: 'imu', type: 'motion', name: 'Pen Motion Sensor' },
    ]
  }

  async readSensors(): Promise<SensorReading[]> {
    const now = new Date().toISOString()
    return [
      { sensorId: 'handwriting', value: { strokes: [], pressure: 0.5, active: false }, timestamp: now },
      { sensorId: 'microphone', value: { active: false, level: 0 }, timestamp: now },
      { sensorId: 'imu', value: { x: 0, y: 0, z: -9.8 }, timestamp: now },
    ]
  }

  async executeAction(action: AgentAction): Promise<ActionResult> {
    const start = Date.now()
    log.info(`Pen executing action: ${action.label}`, { type: action.type })

    // Simulated execution
    return {
      actionId: action.id,
      success: true,
      output: {
        message: `Pen action "${action.label}" executed`,
        type: action.type,
      },
      durationMs: Date.now() - start,
    }
  }

  getCapabilities(): string[] {
    return [
      'handwriting-capture',
      'note-generation',
      'lecture-summarisation',
      'revision-material-production',
      'audio-transcript',
    ]
  }

  async shutdown(): Promise<void> {
    this.initialized = false
    log.info('Imara Pen adapter shut down')
  }
}
