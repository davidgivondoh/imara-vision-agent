import { createLogger } from '../shared/logger.js'
import type { SensorDescriptor, SensorReading, AgentAction, ActionResult } from '../shared/types.js'
import type { ProductAdapter, ProductConfig } from './adapter.js'

const log = createLogger('product:overlay')

export class WearableOverlayAdapter implements ProductAdapter {
  productId = 'overlay'

  async initialize(config: ProductConfig): Promise<void> {
    log.info('Wearable Overlay adapter initialised', { settings: config.settings })
  }

  getSensors(): SensorDescriptor[] {
    return [
      { id: 'camera', type: 'video', name: 'Front-Facing Camera' },
      { id: 'microphone', type: 'audio', name: 'Ambient Microphone', unit: 'pcm' },
      { id: 'ambient_light', type: 'light', name: 'Ambient Light Sensor', unit: 'lux' },
      { id: 'imu', type: 'motion', name: 'Head Motion Sensor' },
    ]
  }

  async readSensors(): Promise<SensorReading[]> {
    const now = new Date().toISOString()
    return [
      { sensorId: 'camera', value: { active: false, resolution: '720p' }, timestamp: now },
      { sensorId: 'microphone', value: { active: false, level: 0 }, timestamp: now },
      { sensorId: 'ambient_light', value: 500, timestamp: now },
      { sensorId: 'imu', value: { pitch: 0, yaw: 0, roll: 0 }, timestamp: now },
    ]
  }

  async executeAction(action: AgentAction): Promise<ActionResult> {
    const start = Date.now()
    log.info(`Overlay executing action: ${action.label}`, { type: action.type })

    return {
      actionId: action.id,
      success: true,
      output: {
        message: `Overlay action "${action.label}" executed`,
        type: action.type,
      },
      durationMs: Date.now() - start,
    }
  }

  getCapabilities(): string[] {
    return [
      'visual-overlay',
      'real-time-captions',
      'concept-cues',
      'voice-guided-instructions',
      'contrast-adaptation',
    ]
  }

  async shutdown(): Promise<void> {
    log.info('Wearable Overlay adapter shut down')
  }
}
