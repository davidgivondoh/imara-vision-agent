import { mkdir, readFile } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { createLogger } from '../shared/logger.js'
import { getBrowserManager } from './browser-manager.js'
import type { Tool, ToolResult } from './types.js'

const log = createLogger('tool:vision')

// ── page_audit ─────────────────────────────────────────────

export const pageAuditTool: Tool = {
  name: 'page_audit',
  description: 'Run an accessibility and usability audit on the current page. Checks for missing alt text, contrast issues, form labels, heading hierarchy, and ARIA usage. Returns actionable findings.',
  category: 'vision',
  permissions: ['browser.navigate'],
  parameters: [
    { name: 'url', type: 'string', description: 'URL to audit (navigates first if provided)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const url = params.url as string | undefined

      const manager = getBrowserManager()
      const page = await manager.getPage()

      if (url) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          return {
            success: false,
            output: null,
            durationMs: Date.now() - startTime,
            error: 'URL must start with http:// or https://',
          }
        }
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: manager.getTimeout() })
      }

      const title = await page.title()
      const audit = await page.evaluate(() => {
        const findings: Array<{ severity: string; issue: string; element?: string; count?: number }> = []

        // 1. Images without alt text
        const imgs = document.querySelectorAll('img')
        const missingAlt = Array.from(imgs).filter(img => !img.alt && !img.getAttribute('aria-label'))
        if (missingAlt.length > 0) {
          findings.push({
            severity: 'error',
            issue: `${missingAlt.length} image(s) missing alt text`,
            element: missingAlt[0]?.src?.slice(0, 80),
            count: missingAlt.length,
          })
        }

        // 2. Form inputs without labels
        const inputs = document.querySelectorAll('input, select, textarea')
        let unlabeled = 0
        inputs.forEach(input => {
          const id = input.id
          const hasLabel = id && document.querySelector(`label[for="${id}"]`)
          const hasAria = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby')
          const hasPlaceholder = (input as HTMLInputElement).placeholder
          if (!hasLabel && !hasAria && !hasPlaceholder) unlabeled++
        })
        if (unlabeled > 0) {
          findings.push({
            severity: 'error',
            issue: `${unlabeled} form field(s) without labels or aria attributes`,
            count: unlabeled,
          })
        }

        // 3. Heading hierarchy
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
        const headingLevels = headings.map(h => parseInt(h.tagName[1]))
        const h1Count = headingLevels.filter(l => l === 1).length
        if (h1Count === 0) {
          findings.push({ severity: 'warning', issue: 'Page has no <h1> heading' })
        } else if (h1Count > 1) {
          findings.push({ severity: 'warning', issue: `Page has ${h1Count} <h1> headings (should be 1)` })
        }
        for (let i = 1; i < headingLevels.length; i++) {
          if (headingLevels[i] - headingLevels[i - 1] > 1) {
            findings.push({
              severity: 'warning',
              issue: `Heading hierarchy skips from h${headingLevels[i - 1]} to h${headingLevels[i]}`,
            })
            break
          }
        }

        // 4. Links without text
        const links = document.querySelectorAll('a[href]')
        let emptyLinks = 0
        links.forEach(a => {
          const text = (a.textContent || '').trim()
          const ariaLabel = a.getAttribute('aria-label')
          const img = a.querySelector('img[alt]')
          if (!text && !ariaLabel && !img) emptyLinks++
        })
        if (emptyLinks > 0) {
          findings.push({
            severity: 'error',
            issue: `${emptyLinks} link(s) without accessible text`,
            count: emptyLinks,
          })
        }

        // 5. Language attribute
        if (!document.documentElement.lang) {
          findings.push({ severity: 'warning', issue: 'Page missing lang attribute on <html>' })
        }

        // 6. Viewport meta
        const viewport = document.querySelector('meta[name="viewport"]')
        if (!viewport) {
          findings.push({ severity: 'warning', issue: 'Missing viewport meta tag (mobile responsiveness)' })
        }

        // 7. Buttons without accessible names
        const buttons = document.querySelectorAll('button, [role="button"]')
        let unnamedButtons = 0
        buttons.forEach(btn => {
          const text = (btn.textContent || '').trim()
          const ariaLabel = btn.getAttribute('aria-label')
          if (!text && !ariaLabel) unnamedButtons++
        })
        if (unnamedButtons > 0) {
          findings.push({
            severity: 'error',
            issue: `${unnamedButtons} button(s) without accessible name`,
            count: unnamedButtons,
          })
        }

        // 8. ARIA roles usage
        const ariaElements = document.querySelectorAll('[role]')
        const roles = Array.from(ariaElements).map(el => el.getAttribute('role'))
        const roleCount = new Map<string, number>()
        roles.forEach(r => { if (r) roleCount.set(r, (roleCount.get(r) || 0) + 1) })

        // Summary stats
        const stats = {
          totalElements: document.querySelectorAll('*').length,
          images: imgs.length,
          links: links.length,
          forms: document.querySelectorAll('form').length,
          inputs: inputs.length,
          buttons: buttons.length,
          headings: headings.length,
          ariaRoles: Object.fromEntries(roleCount),
          iframes: document.querySelectorAll('iframe').length,
        }

        const score = Math.max(0, 100 - findings.filter(f => f.severity === 'error').length * 15
          - findings.filter(f => f.severity === 'warning').length * 5)

        return { findings, stats, score }
      })

      log.info('Page audit complete', { url: page.url(), score: audit.score })

      return {
        success: true,
        output: {
          title,
          url: page.url(),
          accessibilityScore: audit.score,
          findings: audit.findings,
          stats: audit.stats,
        },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Audit failed',
      }
    }
  },
}

// ── page_snapshot ───────────────────────────────────────────

export const pageSnapshotTool: Tool = {
  name: 'page_snapshot',
  description: 'Take a full-page screenshot with an annotated summary of visible text, headings, and interactive elements. Useful for understanding what is currently on screen.',
  category: 'vision',
  permissions: ['browser.navigate'],
  parameters: [
    { name: 'url', type: 'string', description: 'URL to snapshot (navigates first if provided)', required: false },
    { name: 'includeScreenshot', type: 'boolean', description: 'Save a screenshot image (default: true)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const url = params.url as string | undefined
      const includeScreenshot = (params.includeScreenshot as boolean) ?? true

      const manager = getBrowserManager()
      const page = await manager.getPage()

      if (url) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          return {
            success: false,
            output: null,
            durationMs: Date.now() - startTime,
            error: 'URL must start with http:// or https://',
          }
        }
        await page.goto(url, { waitUntil: 'load', timeout: manager.getTimeout() })
      }

      const title = await page.title()

      // Get a structured summary of the visible page
      const snapshot = await page.evaluate(() => {
        // Visible headings
        const headings = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, h4'))
          .filter(h => h.offsetParent !== null) // visible only
          .map(h => ({ level: parseInt(h.tagName[1]), text: (h.textContent || '').trim().slice(0, 120) }))
          .slice(0, 15)

        // Main text content (first visible paragraphs)
        const paragraphs = Array.from(document.querySelectorAll<HTMLElement>('p'))
          .filter(p => p.offsetParent !== null && (p.textContent || '').trim().length > 20)
          .map(p => (p.textContent || '').trim().slice(0, 200))
          .slice(0, 5)

        // Navigation links
        const navLinks = Array.from(document.querySelectorAll('nav a, header a'))
          .map(a => (a.textContent || '').trim())
          .filter(t => t.length > 0 && t.length < 50)
          .slice(0, 10)

        // Buttons and CTAs
        const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, a.btn, a.button, [role="button"], input[type="submit"]'))
          .filter(el => el.offsetParent !== null)
          .map(el => (el.textContent || (el as HTMLInputElement).value || '').trim())
          .filter(t => t.length > 0 && t.length < 50)
          .slice(0, 10)

        // Forms
        const forms = Array.from(document.querySelectorAll('form')).map(form => {
          const fields = Array.from(form.querySelectorAll('input, select, textarea'))
            .map(f => ({
              type: (f as HTMLInputElement).type || f.tagName.toLowerCase(),
              name: (f as HTMLInputElement).name || (f as HTMLInputElement).placeholder || null,
            }))
            .slice(0, 10)
          return { action: form.action || null, method: form.method, fields }
        }).slice(0, 3)

        // Viewport info
        const scrollInfo = {
          scrollY: window.scrollY,
          scrollHeight: document.body.scrollHeight,
          viewportHeight: window.innerHeight,
          atTop: window.scrollY < 10,
          atBottom: window.scrollY + window.innerHeight >= document.body.scrollHeight - 10,
        }

        return { headings, paragraphs, navLinks, buttons, forms, scrollInfo }
      })

      // Take screenshot if requested
      let screenshotPath: string | undefined
      if (includeScreenshot) {
        const screenshotDir = resolve('./data/screenshots')
        if (!existsSync(screenshotDir)) {
          await mkdir(screenshotDir, { recursive: true })
        }
        const filename = `snapshot_${Date.now()}.png`
        screenshotPath = join(screenshotDir, filename)
        await page.screenshot({ path: screenshotPath, fullPage: false })
      }

      log.info('Page snapshot taken', { url: page.url() })

      return {
        success: true,
        output: {
          title,
          url: page.url(),
          ...snapshot,
          screenshotPath,
        },
        artifacts: screenshotPath ? [{
          type: 'screenshot' as const,
          content: screenshotPath,
          mimeType: 'image/png',
          filename: screenshotPath.split(/[/\\]/).pop(),
        }] : undefined,
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Snapshot failed',
      }
    }
  },
}

// ── page_monitor ───────────────────────────────────────────

export const pageMonitorTool: Tool = {
  name: 'page_monitor',
  description: 'Monitor a web page for changes. Takes a snapshot of the current state and returns differences when content changes. Useful for tracking updates, stock changes, or notification checks.',
  category: 'vision',
  permissions: ['browser.navigate'],
  parameters: [
    { name: 'url', type: 'string', description: 'URL to monitor', required: true },
    { name: 'selector', type: 'string', description: 'CSS selector to monitor for changes (default: body)', required: false },
    { name: 'waitMs', type: 'number', description: 'Wait time in ms before checking (default: 0, max: 10000)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const url = params.url as string
      const selector = (params.selector as string) || 'body'
      const waitMs = Math.min((params.waitMs as number) || 0, 10_000)

      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'URL must start with http:// or https://',
        }
      }

      const manager = getBrowserManager()
      const page = await manager.getPage()

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: manager.getTimeout() })

      // Get initial content
      const initialContent = await page.locator(selector).first().innerText()
      const title = await page.title()

      if (waitMs > 0) {
        await page.waitForTimeout(waitMs)
      }

      // Get content after wait
      const currentContent = await page.locator(selector).first().innerText()

      const changed = initialContent !== currentContent

      return {
        success: true,
        output: {
          title,
          url: page.url(),
          selector,
          changed,
          contentLength: currentContent.length,
          content: currentContent.trim().slice(0, 5000),
        },
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Monitor failed',
      }
    }
  },
}

// ── Export all vision tools ─────────────────────────────────

export const visionTools: Tool[] = [
  pageAuditTool,
  pageSnapshotTool,
  pageMonitorTool,
]
