import { createLogger } from '../shared/logger.js'
import type { SensorDescriptor, SensorReading, AgentAction, ActionResult } from '../shared/types.js'
import type { ProductAdapter, ProductConfig } from './adapter.js'

const log = createLogger('product:imara-plus')

export class ImaraPlusAdapter implements ProductAdapter {
  productId = 'imara-plus'

  async initialize(config: ProductConfig): Promise<void> {
    log.info('ImaraPlus adapter initialised', { settings: config.settings })
  }

  getSensors(): SensorDescriptor[] {
    return [
      { id: 'touchscreen', type: 'touch', name: 'Touchscreen' },
      { id: 'microphone', type: 'audio', name: 'Phone Microphone', unit: 'pcm' },
      { id: 'camera', type: 'video', name: 'Rear Camera' },
      { id: 'gps', type: 'location', name: 'GPS Module' },
      { id: 'accelerometer', type: 'motion', name: 'Accelerometer' },
      { id: 'proximity', type: 'proximity', name: 'Proximity Sensor' },
    ]
  }

  async readSensors(): Promise<SensorReading[]> {
    const now = new Date().toISOString()
    return [
      { sensorId: 'touchscreen', value: { active: true, touches: 0 }, timestamp: now },
      { sensorId: 'microphone', value: { active: false, level: 0 }, timestamp: now },
      { sensorId: 'camera', value: { active: false }, timestamp: now },
      { sensorId: 'gps', value: { lat: 0, lng: 0, accuracy: 0 }, timestamp: now },
      { sensorId: 'accelerometer', value: { x: 0, y: 0, z: -9.8 }, timestamp: now },
      { sensorId: 'proximity', value: { near: false }, timestamp: now },
    ]
  }

  async executeAction(action: AgentAction): Promise<ActionResult> {
    const start = Date.now()
    log.info(`ImaraPlus executing action: ${action.label}`, { type: action.type })

    return {
      actionId: action.id,
      success: true,
      output: {
        message: `ImaraPlus action "${action.label}" executed`,
        type: action.type,
      },
      durationMs: Date.now() - start,
    }
  }

  getCapabilities(): string[] {
    return [
      'adaptive-ui',
      'on-behalf-communication',
      'environment-navigation',
      'need-anticipation',
      'carer-alerts',
      'voice-assistant',
    ]
  }

  async shutdown(): Promise<void> {
    log.info('ImaraPlus adapter shut down')
  }
}
