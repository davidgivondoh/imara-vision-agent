import type { SensorDescriptor, SensorReading, AgentAction, ActionResult } from '../shared/types.js'

export interface ProductConfig {
  productId: string
  settings?: Record<string, unknown>
}

export interface ProductAdapter {
  productId: string
  initialize(config: ProductConfig): Promise<void>
  getSensors(): SensorDescriptor[]
  readSensors(): Promise<SensorReading[]>
  executeAction(action: AgentAction): Promise<ActionResult>
  getCapabilities(): string[]
  shutdown(): Promise<void>
}
