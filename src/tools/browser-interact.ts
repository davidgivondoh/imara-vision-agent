import { mkdir } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { createLogger } from '../shared/logger.js'
import { getBrowserManager, friendlyBrowserError } from './browser-manager.js'
import type { Tool, ToolResult } from './types.js'

const log = createLogger('tool:browser-interact')

// ── browser_click ──────────────────────────────────────────

export const browserClickTool: Tool = {
  name: 'browser_click',
  description: 'Click an element on the current web page by CSS selector or visible text',
  category: 'browser',
  permissions: ['browser.interact'],
  parameters: [
    { name: 'selector', type: 'string', description: 'CSS selector of the element to click', required: false },
    { name: 'text', type: 'string', description: 'Visible text of the element to click (uses getByText)', required: false },
    { name: 'button', type: 'string', description: 'Mouse button: "left", "right", or "middle" (default: "left")', required: false },
    { name: 'doubleClick', type: 'boolean', description: 'Double-click instead of single (default: false)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const selector = params.selector as string | undefined
      const text = params.text as string | undefined
      const button = (params.button as 'left' | 'right' | 'middle') || 'left'
      const doubleClick = (params.doubleClick as boolean) ?? false

      if (!selector && !text) {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'Either "selector" or "text" must be provided',
        }
      }

      const manager = getBrowserManager()
      const page = await manager.getPage()

      const locator = text
        ? page.getByText(text, { exact: false })
        : page.locator(selector as string)

      if (doubleClick) {
        await locator.first().dblclick({ button, timeout: 5000 })
      } else {
        await locator.first().click({ button, timeout: 5000 })
      }

      // Wait briefly for any navigation or DOM update
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {})

      const title = await page.title()
      log.info('Clicked element', { selector, text, button })

      return {
        success: true,
        output: {
          clicked: selector || text,
          pageTitle: title,
          url: page.url(),
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

// ── browser_fill ───────────────────────────────────────────

export const browserFillTool: Tool = {
  name: 'browser_fill',
  description: 'Fill in a form input, textarea, or content-editable field on the current page',
  category: 'browser',
  permissions: ['browser.interact'],
  parameters: [
    { name: 'selector', type: 'string', description: 'CSS selector of the input field', required: false },
    { name: 'label', type: 'string', description: 'Label text associated with the input (uses getByLabel)', required: false },
    { name: 'placeholder', type: 'string', description: 'Placeholder text of the input (uses getByPlaceholder)', required: false },
    { name: 'value', type: 'string', description: 'Text to fill in', required: true },
    { name: 'clear', type: 'boolean', description: 'Clear the field before filling (default: true)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const selector = params.selector as string | undefined
      const label = params.label as string | undefined
      const placeholder = params.placeholder as string | undefined
      const value = params.value as string
      const clear = (params.clear as boolean) ?? true

      if (!selector && !label && !placeholder) {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'One of "selector", "label", or "placeholder" must be provided',
        }
      }

      const manager = getBrowserManager()
      const page = await manager.getPage()

      const locator = label
        ? page.getByLabel(label)
        : placeholder
          ? page.getByPlaceholder(placeholder)
          : page.locator(selector as string)

      if (clear) {
        await locator.first().clear({ timeout: 5000 })
      }
      await locator.first().fill(value, { timeout: 5000 })

      log.info('Filled input', { selector, label, placeholder, valueLength: value.length })

      return {
        success: true,
        output: {
          filled: selector || label || placeholder,
          valueLength: value.length,
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

// ── browser_select ─────────────────────────────────────────

export const browserSelectTool: Tool = {
  name: 'browser_select',
  description: 'Select an option from a dropdown/select element on the current page',
  category: 'browser',
  permissions: ['browser.interact'],
  parameters: [
    { name: 'selector', type: 'string', description: 'CSS selector of the <select> element', required: true },
    { name: 'value', type: 'string', description: 'Option value to select', required: false },
    { name: 'label', type: 'string', description: 'Option visible text to select', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const selector = params.selector as string
      const value = params.value as string | undefined
      const label = params.label as string | undefined

      if (!value && !label) {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'Either "value" or "label" must be provided',
        }
      }

      const manager = getBrowserManager()
      const page = await manager.getPage()

      const selectOption = label ? { label } : { value: value as string }
      await page.locator(selector).first().selectOption(selectOption, { timeout: 5000 })

      log.info('Selected option', { selector, value, label })

      return {
        success: true,
        output: { selector, selected: value || label },
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

// ── browser_scroll ─────────────────────────────────────────

export const browserScrollTool: Tool = {
  name: 'browser_scroll',
  description: 'Scroll the page or a specific element up, down, or to a position',
  category: 'browser',
  permissions: ['browser.navigate'],
  parameters: [
    { name: 'direction', type: 'string', description: '"up", "down", "top", or "bottom" (default: "down")', required: false },
    { name: 'pixels', type: 'number', description: 'Number of pixels to scroll (default: 600)', required: false },
    { name: 'selector', type: 'string', description: 'CSS selector to scroll into view', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const direction = (params.direction as string) || 'down'
      const pixels = (params.pixels as number) || 600
      const selector = params.selector as string | undefined

      const manager = getBrowserManager()
      const page = await manager.getPage()

      if (selector) {
        await page.locator(selector).first().scrollIntoViewIfNeeded({ timeout: 5000 })
      } else if (direction === 'top') {
        await page.evaluate(() => window.scrollTo(0, 0))
      } else if (direction === 'bottom') {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      } else {
        const delta = direction === 'up' ? -pixels : pixels
        await page.evaluate((d) => window.scrollBy(0, d), delta)
      }

      // Get scroll position
      const scrollPos = await page.evaluate(() => ({
        scrollY: window.scrollY,
        scrollHeight: document.body.scrollHeight,
        viewportHeight: window.innerHeight,
      }))

      return {
        success: true,
        output: {
          direction,
          pixels,
          ...scrollPos,
          atBottom: scrollPos.scrollY + scrollPos.viewportHeight >= scrollPos.scrollHeight - 10,
          atTop: scrollPos.scrollY <= 10,
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

// ── browser_dom ────────────────────────────────────────────

export const browserDomTool: Tool = {
  name: 'browser_dom',
  description: 'Inspect the DOM structure of the current page. Returns interactive elements (links, buttons, inputs, forms) and page structure for understanding what actions are possible.',
  category: 'browser',
  permissions: ['browser.navigate'],
  parameters: [
    { name: 'selector', type: 'string', description: 'CSS selector to inspect a specific subtree (default: body)', required: false },
    { name: 'mode', type: 'string', description: '"interactive" (buttons/links/inputs), "structure" (headings/sections), "forms" (all form fields), or "all" (default: "interactive")', required: false },
    { name: 'maxElements', type: 'number', description: 'Maximum elements to return (default: 50)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const selector = (params.selector as string) || 'body'
      const mode = (params.mode as string) || 'interactive'
      const maxElements = (params.maxElements as number) || 50

      const manager = getBrowserManager()
      const page = await manager.getPage()
      const title = await page.title()

      const elements = await page.evaluate(
        ({ sel, md, max }) => {
          const root = document.querySelector(sel)
          if (!root) return { error: `Selector "${sel}" not found` }

          const results: Array<{
            tag: string
            type?: string
            text: string
            href?: string
            name?: string
            id?: string
            className?: string
            placeholder?: string
            value?: string
            role?: string
            ariaLabel?: string
            selector: string
          }> = []

          function cssSelector(el: Element): string {
            if (el.id) return `#${el.id}`
            const tag = el.tagName.toLowerCase()
            const cls = el.className && typeof el.className === 'string'
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
              : ''
            const nth = el.parentElement
              ? Array.from(el.parentElement.children).filter(c => c.tagName === el.tagName).indexOf(el) + 1
              : 1
            const nthSuffix = nth > 1 ? `:nth-of-type(${nth})` : ''
            return `${tag}${cls}${nthSuffix}`
          }

          let selectors: string
          switch (md) {
            case 'interactive':
              selectors = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [onclick], [tabindex]'
              break
            case 'structure':
              selectors = 'h1, h2, h3, h4, h5, h6, main, nav, header, footer, section, article, aside'
              break
            case 'forms':
              selectors = 'form, input, select, textarea, label, button[type="submit"], [role="form"]'
              break
            case 'all':
              selectors = 'a[href], button, input, select, textarea, h1, h2, h3, h4, h5, h6, img, form, nav, main, [role]'
              break
            default:
              selectors = 'a[href], button, input, select, textarea, [role="button"]'
          }

          const found = root.querySelectorAll(selectors)
          for (let i = 0; i < Math.min(found.length, max); i++) {
            const el = found[i]
            const tag = el.tagName.toLowerCase()
            const text = (el.textContent || '').trim().slice(0, 100)

            results.push({
              tag,
              type: (el as HTMLInputElement).type || undefined,
              text: text || undefined as unknown as string,
              href: (el as HTMLAnchorElement).href || undefined,
              name: (el as HTMLInputElement).name || undefined,
              id: el.id || undefined,
              className: el.className && typeof el.className === 'string'
                ? el.className.trim().slice(0, 80) || undefined
                : undefined,
              placeholder: (el as HTMLInputElement).placeholder || undefined,
              value: tag === 'input' || tag === 'textarea'
                ? ((el as HTMLInputElement).value || '').slice(0, 50) || undefined
                : undefined,
              role: el.getAttribute('role') || undefined,
              ariaLabel: el.getAttribute('aria-label') || undefined,
              selector: cssSelector(el),
            })
          }

          return {
            totalFound: found.length,
            elements: results,
          }
        },
        { sel: selector, md: mode, max: maxElements },
      )

      log.info('DOM inspected', { mode, selector, count: (elements as Record<string, unknown>).totalFound })

      return {
        success: true,
        output: {
          title,
          url: page.url(),
          mode,
          ...elements,
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

// ── browser_extract ────────────────────────────────────────

export const browserExtractTool: Tool = {
  name: 'browser_extract',
  description: 'Extract structured data from the current page: tables, lists, metadata, or custom selectors',
  category: 'browser',
  permissions: ['browser.navigate'],
  parameters: [
    { name: 'type', type: 'string', description: '"tables", "lists", "meta", "links", "images", or "custom" (default: "meta")', required: false },
    { name: 'selector', type: 'string', description: 'CSS selector for custom extraction', required: false },
    { name: 'attribute', type: 'string', description: 'Attribute to extract for custom type (default: textContent)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const type = (params.type as string) || 'meta'
      const selector = params.selector as string | undefined
      const attribute = (params.attribute as string) || 'textContent'

      const manager = getBrowserManager()
      const page = await manager.getPage()
      const title = await page.title()

      let data: unknown

      switch (type) {
        case 'tables':
          data = await page.evaluate(() => {
            const tables = document.querySelectorAll('table')
            return Array.from(tables).slice(0, 5).map((table, idx) => {
              const headers = Array.from(table.querySelectorAll('th')).map(th => (th.textContent || '').trim())
              const rows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 20).map(tr =>
                Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim())
              )
              return { tableIndex: idx, headers, rows, rowCount: table.querySelectorAll('tbody tr').length }
            })
          })
          break

        case 'lists':
          data = await page.evaluate(() => {
            const lists = document.querySelectorAll('ul, ol')
            return Array.from(lists).slice(0, 10).map((list, idx) => ({
              listIndex: idx,
              type: list.tagName.toLowerCase(),
              items: Array.from(list.querySelectorAll(':scope > li')).slice(0, 20).map(li =>
                (li.textContent || '').trim().slice(0, 200)
              ),
            }))
          })
          break

        case 'meta':
          data = await page.evaluate(() => {
            const metas = document.querySelectorAll('meta')
            const result: Record<string, string> = {}
            metas.forEach(m => {
              const name = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv')
              const content = m.getAttribute('content')
              if (name && content) result[name] = content
            })
            result['title'] = document.title
            const canonical = document.querySelector('link[rel="canonical"]')
            if (canonical) result['canonical'] = (canonical as HTMLLinkElement).href
            return result
          })
          break

        case 'links':
          data = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href]'))
              .filter(a => (a as HTMLAnchorElement).href.startsWith('http'))
              .slice(0, 30)
              .map(a => ({
                text: (a.textContent || '').trim().slice(0, 100),
                href: (a as HTMLAnchorElement).href,
              }))
          })
          break

        case 'images':
          data = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('img'))
              .slice(0, 20)
              .map(img => ({
                src: img.src,
                alt: img.alt || null,
                width: img.naturalWidth,
                height: img.naturalHeight,
              }))
          })
          break

        case 'custom':
          if (!selector) {
            return {
              success: false,
              output: null,
              durationMs: Date.now() - startTime,
              error: 'Selector is required for custom extraction',
            }
          }
          data = await page.evaluate(
            ({ sel, attr }) => {
              const elements = document.querySelectorAll(sel)
              return Array.from(elements).slice(0, 50).map(el => {
                if (attr === 'textContent') return (el.textContent || '').trim().slice(0, 500)
                if (attr === 'innerHTML') return el.innerHTML.slice(0, 1000)
                if (attr === 'outerHTML') return el.outerHTML.slice(0, 1000)
                return el.getAttribute(attr) || null
              })
            },
            { sel: selector, attr: attribute },
          )
          break

        default:
          return {
            success: false,
            output: null,
            durationMs: Date.now() - startTime,
            error: `Unknown extraction type: ${type}`,
          }
      }

      log.info('Data extracted', { type, selector })

      return {
        success: true,
        output: { title, url: page.url(), type, data },
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

// ── browser_pdf ────────────────────────────────────────────

export const browserPdfTool: Tool = {
  name: 'browser_pdf',
  description: 'Save the current page or a URL as a PDF document',
  category: 'browser',
  permissions: ['browser.navigate', 'filesystem.write'],
  parameters: [
    { name: 'url', type: 'string', description: 'URL to save as PDF (navigates first if provided)', required: false },
    { name: 'filename', type: 'string', description: 'Output filename (default: page_<timestamp>.pdf)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const url = params.url as string | undefined
      const filename = (params.filename as string) || `page_${Date.now()}.pdf`

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

      const outputDir = resolve('./data/pdfs')
      if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true })
      }

      const filePath = join(outputDir, filename)
      await page.pdf({ path: filePath, format: 'A4', printBackground: true })

      const title = await page.title()
      log.info(`PDF saved: ${filePath}`)

      return {
        success: true,
        output: {
          title,
          url: page.url(),
          path: filePath,
          filename,
        },
        artifacts: [
          { type: 'file', content: filePath, mimeType: 'application/pdf', filename },
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

// ── browser_wait ───────────────────────────────────────────

export const browserWaitTool: Tool = {
  name: 'browser_wait',
  description: 'Wait for a condition on the page: element to appear, text to be visible, or network to be idle',
  category: 'browser',
  permissions: ['browser.navigate'],
  parameters: [
    { name: 'selector', type: 'string', description: 'CSS selector to wait for', required: false },
    { name: 'text', type: 'string', description: 'Text to wait for on the page', required: false },
    { name: 'state', type: 'string', description: '"visible", "hidden", "attached", or "detached" (default: "visible")', required: false },
    { name: 'timeout', type: 'number', description: 'Maximum wait time in ms (default: 10000)', required: false },
  ],
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      const selector = params.selector as string | undefined
      const text = params.text as string | undefined
      const state = (params.state as 'visible' | 'hidden' | 'attached' | 'detached') || 'visible'
      const timeout = (params.timeout as number) || 10000

      if (!selector && !text) {
        return {
          success: false,
          output: null,
          durationMs: Date.now() - startTime,
          error: 'Either "selector" or "text" must be provided',
        }
      }

      const manager = getBrowserManager()
      const page = await manager.getPage()

      if (text) {
        await page.getByText(text).first().waitFor({ state, timeout })
      } else if (selector) {
        await page.locator(selector).first().waitFor({ state, timeout })
      }

      return {
        success: true,
        output: {
          waited: selector || text,
          state,
          elapsed: Date.now() - startTime,
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

// ── Export all browser interaction tools ────────────────────

export const browserInteractTools: Tool[] = [
  browserClickTool,
  browserFillTool,
  browserSelectTool,
  browserScrollTool,
  browserDomTool,
  browserExtractTool,
  browserPdfTool,
  browserWaitTool,
]
