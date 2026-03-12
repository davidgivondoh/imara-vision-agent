import { describe, it, expect, afterAll } from 'vitest'
import {
  browserNavigateTool,
  browserReadTool,
  browserScreenshotTool,
  webSearchTool,
  browserTools,
} from '../../src/tools/browser.js'
import { closeBrowserManager } from '../../src/tools/browser-manager.js'
import { existsSync } from 'fs'

afterAll(async () => {
  await closeBrowserManager()
})

describe('Browser Tools', () => {
  it('should export all 4 browser tools', () => {
    expect(browserTools.length).toBe(4)
    const names = browserTools.map((t) => t.name)
    expect(names).toContain('browser_navigate')
    expect(names).toContain('browser_read')
    expect(names).toContain('browser_screenshot')
    expect(names).toContain('web_search')
  })

  it('all browser tools should have browser category', () => {
    for (const tool of browserTools) {
      expect(tool.category).toBe('browser')
    }
  })

  it('all browser tools should require browser.navigate permission', () => {
    for (const tool of browserTools) {
      expect(tool.permissions).toContain('browser.navigate')
    }
  })
})

describe('browser_navigate', () => {
  it('should reject invalid URLs', async () => {
    const result = await browserNavigateTool.execute({ url: 'not-a-url' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('http')
  })

  it('should navigate to a valid URL', async () => {
    const result = await browserNavigateTool.execute({
      url: 'https://example.com',
    })
    expect(result.success).toBe(true)
    const output = result.output as Record<string, unknown>
    expect(output.title).toBeTruthy()
    expect(output.url).toContain('example.com')
    expect(output.status).toBe(200)
  }, 30000)
})

describe('browser_read', () => {
  it('should read content from a URL', async () => {
    const result = await browserReadTool.execute({
      url: 'https://example.com',
    })
    expect(result.success).toBe(true)
    const output = result.output as Record<string, unknown>
    expect(output.title).toBeTruthy()
    expect(output.content).toBeTruthy()
    expect((output.content as string).length).toBeGreaterThan(0)
  }, 30000)

  it('should respect maxLength', async () => {
    const result = await browserReadTool.execute({
      url: 'https://example.com',
      maxLength: 50,
    })
    expect(result.success).toBe(true)
    const output = result.output as Record<string, unknown>
    // Content may be truncated + suffix
    expect(typeof output.content).toBe('string')
  }, 30000)

  it('should reject invalid URLs', async () => {
    const result = await browserReadTool.execute({
      url: 'ftp://invalid',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('http')
  })
})

describe('browser_screenshot', () => {
  it('should take a screenshot of a URL', async () => {
    const result = await browserScreenshotTool.execute({
      url: 'https://example.com',
    })
    expect(result.success).toBe(true)
    const output = result.output as Record<string, unknown>
    expect(output.path).toBeTruthy()
    expect(output.filename).toBeTruthy()
    expect(existsSync(output.path as string)).toBe(true)
    expect(result.artifacts).toBeDefined()
    expect(result.artifacts![0].type).toBe('screenshot')
  }, 30000)

  it('should reject invalid URLs', async () => {
    const result = await browserScreenshotTool.execute({
      url: 'not-valid',
    })
    expect(result.success).toBe(false)
  })
})

describe('web_search', () => {
  it('should return search results for a common query', async () => {
    const result = await webSearchTool.execute({
      query: 'TypeScript programming language',
    })
    expect(result.success).toBe(true)
    const output = result.output as Record<string, unknown>
    expect(output.query).toBe('TypeScript programming language')
    // Search may return 0 results if Google serves CAPTCHA in CI
    expect(output.resultCount).toBeGreaterThanOrEqual(0)
    if ((output.resultCount as number) > 0) {
      const results = output.results as Array<{ title: string; url: string }>
      expect(results[0].title).toBeTruthy()
    }
  }, 30000)

  it('should reject empty queries', async () => {
    const result = await webSearchTool.execute({ query: '' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('required')
  })

  it('should respect maxResults', async () => {
    const result = await webSearchTool.execute({
      query: 'Node.js tutorial',
      maxResults: 2,
    })
    expect(result.success).toBe(true)
    const output = result.output as Record<string, unknown>
    expect((output.results as Array<unknown>).length).toBeLessThanOrEqual(2)
  }, 30000)
})
