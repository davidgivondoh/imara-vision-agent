import { describe, it, expect } from 'vitest'
import { platform } from 'os'
import {
  screenCaptureTool,
  mouseClickTool,
  keyboardTypeTool,
  getActiveWindowTool,
  listWindowsTool,
  desktopTools,
} from '../../src/tools/desktop.js'

describe('Desktop Tools', () => {
  it('should export all 5 desktop tools', () => {
    expect(desktopTools.length).toBe(5)
    const names = desktopTools.map((t) => t.name)
    expect(names).toContain('screen_capture')
    expect(names).toContain('mouse_click')
    expect(names).toContain('keyboard_type')
    expect(names).toContain('get_active_window')
    expect(names).toContain('list_windows')
  })

  it('all desktop tools should have desktop category', () => {
    for (const tool of desktopTools) {
      expect(tool.category).toBe('desktop')
    }
  })

  it('control tools should require desktop.control permission', () => {
    expect(mouseClickTool.permissions).toContain('desktop.control')
    expect(keyboardTypeTool.permissions).toContain('desktop.control')
  })

  it('read tools should require desktop.read permission', () => {
    expect(screenCaptureTool.permissions).toContain('desktop.read')
    expect(getActiveWindowTool.permissions).toContain('desktop.read')
    expect(listWindowsTool.permissions).toContain('desktop.read')
  })
})

describe('mouse_click', () => {
  it('should reject non-number coordinates', async () => {
    const result = await mouseClickTool.execute({ x: 'abc', y: 'def' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('numbers')
  })
})

describe('keyboard_type', () => {
  it('should reject when neither text nor key is provided', async () => {
    const result = await keyboardTypeTool.execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('text')
  })
})

describe('screen_capture', () => {
  it('should attempt to capture a screenshot on Windows', async () => {
    if (platform() !== 'win32') return

    const result = await screenCaptureTool.execute({})
    // May fail in headless CI or restricted environments
    if (result.success) {
      const output = result.output as Record<string, unknown>
      expect(output.path).toBeTruthy()
      expect(output.filename).toBeTruthy()
      expect(result.artifacts).toBeDefined()
      expect(result.artifacts![0].type).toBe('screenshot')
    } else {
      // Acceptable: screenshot can fail without a desktop session
      expect(result.error).toBeTruthy()
    }
  }, 15000)
})

describe('list_windows', () => {
  it('should list open windows on Windows', async () => {
    if (platform() !== 'win32') return

    const result = await listWindowsTool.execute({})
    expect(result.success).toBe(true)
    const output = result.output as Record<string, unknown>
    expect(output.windows).toBeDefined()
    expect(output.count).toBeGreaterThan(0)
  }, 10000)
})
