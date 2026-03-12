import { mkdir } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { createLogger } from '../shared/logger.js'
import { getBrowserManager, friendlyBrowserError } from './browser-manager.js'
import type { Tool, ToolResult } from './types.js'

const log = createLogger('tool:browser')

// ── browser_navigate ────────────────────────────────────────

export const browserNavigateTool: Tool = {
  name: 'browser_navigate',
  description: 'Navigate to a URL in the browser and return the page title and status',
  category: 'browser',
  permissions: ['browser.navigate'],
  parameters: [
    { name: 'url', type: 'string', description: 'URL to navigate to', required: true },
    { name: 'waitFor', type: 'string', description: 'Wait strategy: "load", "domcontentloaded", or "networkidle" (default: "load")', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const url = params.url as string
      const waitFor = (params.waitFor as string) || 'load'

      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'URL must start with http:// or https://',
        }
      }

      const manager = getBrowserManager()
      const page = await manager.getPage()

      log.info(`Navigating to: ${url}`)
      const response = await page.goto(url, {
        waitUntil: waitFor as 'load' | 'domcontentloaded' | 'networkidle',
        timeout: manager.getTimeout(),
      })

      const title = await page.title()
      const finalUrl = page.url()

      return {
        success: true,
        output: {
          title,
          url: finalUrl,
          status: response?.status() ?? 0,
          redirected: finalUrl !== url,
        },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: friendlyBrowserError(err),
      }
    }
  },
}

// ── browser_read ────────────────────────────────────────────

export const browserReadTool: Tool = {
  name: 'browser_read',
  description: 'Extract text content from the current page or a specific URL',
  category: 'browser',
  permissions: ['browser.navigate'],
  parameters: [
    { name: 'url', type: 'string', description: 'URL to read (navigates first if provided)', required: false },
    { name: 'selector', type: 'string', description: 'CSS selector to extract from (default: body)', required: false },
    { name: 'maxLength', type: 'number', description: 'Maximum text length to return (default: 5000)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const url = params.url as string | undefined
      const selector = (params.selector as string) || 'body'
      const maxLength = (params.maxLength as number) || 5000

      const manager = getBrowserManager()
      const page = await manager.getPage()

      // Navigate if URL provided
      if (url) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          return {
            success: false,
            output: null,
            durationMs: Date.now() - startTime,
            error: 'URL must start with http:// or https://',
          }
        }
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: manager.getTimeout(),
        })
      }

      const title = await page.title()
      const currentUrl = page.url()

      // Extract text content using Playwright's built-in methods
      const locator = page.locator(selector)
      const count = await locator.count()
      if (count === 0) {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: `No element found for selector: ${selector}`,
        }
      }

      const rawText = await locator.first().innerText()

      // Clean and truncate
      const cleaned = rawText
        .replace(/\n{3,}/g, '\n\n')
        .trim()

      const truncated = cleaned.length > maxLength
        ? cleaned.slice(0, maxLength) + `\n... (truncated, ${cleaned.length} total chars)`
        : cleaned

      // Extract links using $$eval (runs in browser context with proper types)
      const links = await page.$$eval('a[href]', (anchors, max) => {
        return anchors
          .map((a) => ({
            text: (a.textContent || '').trim().slice(0, 80),
            href: (a as unknown as { href: string }).href,
          }))
          .filter((l) => l.text && l.href.startsWith('http'))
          .slice(0, max)
      }, 10)

      return {
        success: true,
        output: {
          title,
          url: currentUrl,
          content: truncated,
          contentLength: cleaned.length,
          links,
        },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: friendlyBrowserError(err),
      }
    }
  },
}

// ── browser_screenshot ──────────────────────────────────────

export const browserScreenshotTool: Tool = {
  name: 'browser_screenshot',
  description: 'Take a screenshot of the current page or a specific URL',
  category: 'browser',
  permissions: ['browser.navigate'],
  parameters: [
    { name: 'url', type: 'string', description: 'URL to screenshot (navigates first if provided)', required: false },
    { name: 'fullPage', type: 'boolean', description: 'Capture full page (default: false, viewport only)', required: false },
    { name: 'selector', type: 'string', description: 'CSS selector to screenshot a specific element', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const url = params.url as string | undefined
      const fullPage = (params.fullPage as boolean) ?? false
      const selector = params.selector as string | undefined

      const manager = getBrowserManager()
      const page = await manager.getPage()

      // Navigate if URL provided
      if (url) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          return {
            success: false,
            output: null,
            durationMs: Date.now() - startTime,
            error: 'URL must start with http:// or https://',
          }
        }
        await page.goto(url, {
          waitUntil: 'load',
          timeout: manager.getTimeout(),
        })
      }

      const title = await page.title()

      // Ensure screenshot directory exists
      const screenshotDir = resolve(manager.getScreenshotDir())
      if (!existsSync(screenshotDir)) {
        await mkdir(screenshotDir, { recursive: true })
      }

      const filename = `screenshot_${Date.now()}.png`
      const filePath = join(screenshotDir, filename)

      if (selector) {
        const element = await page.$(selector)
        if (!element) {
          return {
            success: false,
            output: null,
            durationMs: Date.now() - startTime,
            error: `No element found for selector: ${selector}`,
          }
        }
        await element.screenshot({ path: filePath })
      } else {
        await page.screenshot({ path: filePath, fullPage })
      }

      log.info(`Screenshot saved: ${filePath}`)

      return {
        success: true,
        output: {
          title,
          url: page.url(),
          path: filePath,
          filename,
          fullPage,
        },
        artifacts: [
          {
            type: 'screenshot',
            content: filePath,
            mimeType: 'image/png',
            filename,
          },
        ],
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: friendlyBrowserError(err),
      }
    }
  },
}

// ── web_search ──────────────────────────────────────────────

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web and return results',
  category: 'browser',
  permissions: ['browser.navigate', 'network.http'],
  parameters: [
    { name: 'query', type: 'string', description: 'Search query', required: true },
    { name: 'maxResults', type: 'number', description: 'Maximum results to return (default: 5)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const query = params.query as string
      const maxResults = (params.maxResults as number) || 5

      if (!query || query.trim().length === 0) {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'Search query is required',
        }
      }

      log.info(`Searching: ${query}`)

      // Use fetch-based approach with DuckDuckGo instant answer API + scraping fallback
      const results = await fetchSearchResults(query, maxResults)

      return {
        success: true,
        output: {
          query,
          results,
          resultCount: results.length,
        },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: friendlyBrowserError(err),
      }
    }
  },
}

async function fetchSearchResults(
  query: string,
  maxResults: number,
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  // 1. Try Bing via Playwright (most bot-friendly major search engine)
  try {
    const results = await fetchBingResults(query, maxResults)
    if (results.length > 0) return results
  } catch (err) {
    log.warn('Bing search failed', {
      error: err instanceof Error ? err.message : 'Unknown',
    })
  }

  // 2. Try Google via Playwright
  try {
    const results = await fetchGoogleResults(query, maxResults)
    if (results.length > 0) return results
  } catch (err) {
    log.warn('Google search failed', {
      error: err instanceof Error ? err.message : 'Unknown',
    })
  }

  // 3. Try DuckDuckGo HTML via Playwright
  try {
    return await fetchDuckDuckGoResults(query, maxResults)
  } catch (err) {
    log.warn('DuckDuckGo search also failed', {
      error: err instanceof Error ? err.message : 'Unknown',
    })
    return []
  }
}

/**
 * Bing search via Playwright — most reliable for automated queries.
 */
async function fetchBingResults(
  query: string,
  maxResults: number,
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const manager = getBrowserManager()
  const page = await manager.getPage()

  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&ensearch=1&FORM=BESBTB&setlang=en-us&mkt=en-US`

  await page.goto(searchUrl, {
    waitUntil: 'domcontentloaded',
    timeout: manager.getTimeout(),
  })

  // Wait briefly for results to render
  await page.waitForTimeout(1500)

  const results = await page.evaluate((max) => {
    const items: Array<{ title: string; url: string; snippet: string }> = []

    // Bing organic results use <li class="b_algo">
    const resultElements = Array.from(document.querySelectorAll('li.b_algo'))

    for (const el of resultElements) {
      if (items.length >= max) break

      const linkEl = el.querySelector('h2 a') as HTMLAnchorElement | null
      const snippetEl = el.querySelector('.b_caption p, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4')

      if (linkEl && linkEl.href) {
        // Extract actual URL from Bing redirect wrapper
        let actualUrl = linkEl.href
        try {
          const urlObj = new URL(linkEl.href)
          const uParam = urlObj.searchParams.get('u')
          if (uParam) {
            // Bing uses base64-like encoding: a1<base64url>
            const encoded = uParam.startsWith('a1') ? uParam.slice(2) : uParam
            actualUrl = atob(encoded)
          }
        } catch {
          // Keep the original href if decoding fails
        }

        items.push({
          title: (linkEl.textContent || '').trim(),
          url: actualUrl,
          snippet: (snippetEl?.textContent || '').trim(),
        })
      }
    }

    return items
  }, maxResults)

  log.info(`Bing: ${results.length} results for "${query}"`)
  return results
}

async function fetchGoogleResults(
  query: string,
  maxResults: number,
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const manager = getBrowserManager()
  const page = await manager.getPage()

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}`

  await page.goto(searchUrl, {
    waitUntil: 'domcontentloaded',
    timeout: manager.getTimeout(),
  })

  // Check for CAPTCHA / consent page
  const pageContent = await page.title()
  if (pageContent.includes('unusual traffic') || pageContent.includes('consent')) {
    log.warn('Google may be showing CAPTCHA or consent page')
    return []
  }

  const results = await page.locator('div.g').evaluateAll((elements, max) => {
    const items: Array<{ title: string; url: string; snippet: string }> = []

    for (const el of elements) {
      if (items.length >= max) break

      const linkEl = el.querySelector('a[href]')
      const titleEl = el.querySelector('h3')
      const snippetEl = el.querySelector('[data-sncf]') ||
        el.querySelector('.VwiC3b') ||
        el.querySelector('[style*="-webkit-line-clamp"]')

      if (linkEl && titleEl) {
        const href = (linkEl as unknown as { href: string }).href
        if (href.startsWith('https://www.google.com/') || href.startsWith('https://accounts.google.com/')) continue

        items.push({
          title: (titleEl.textContent || '').trim(),
          url: href,
          snippet: (snippetEl?.textContent || '').trim(),
        })
      }
    }

    return items
  }, maxResults)

  return results
}

async function fetchDuckDuckGoResults(
  query: string,
  maxResults: number,
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const manager = getBrowserManager()
  const page = await manager.getPage()

  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

  await page.goto(searchUrl, {
    waitUntil: 'domcontentloaded',
    timeout: manager.getTimeout(),
  })

  const results = await page.locator('.result').evaluateAll((elements, max) => {
    const items: Array<{ title: string; url: string; snippet: string }> = []

    for (const el of elements) {
      if (items.length >= max) break

      const linkEl = el.querySelector('.result__a')
      const snippetEl = el.querySelector('.result__snippet')

      if (linkEl) {
        const href = (linkEl as unknown as { href: string }).href
        // DuckDuckGo HTML uses redirect URLs — extract the actual URL
        let actualUrl = href
        const udMatch = href.match(/uddg=([^&]+)/)
        if (udMatch) {
          try { actualUrl = decodeURIComponent(udMatch[1]) } catch { /* keep original */ }
        }

        items.push({
          title: (linkEl.textContent || '').trim(),
          url: actualUrl,
          snippet: (snippetEl?.textContent || '').trim(),
        })
      }
    }

    return items
  }, maxResults)

  return results
}

// ── Export all browser tools ─────────────────────────────────

export const browserTools: Tool[] = [
  browserNavigateTool,
  browserReadTool,
  browserScreenshotTool,
  webSearchTool,
]
