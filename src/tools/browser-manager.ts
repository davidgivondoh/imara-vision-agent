import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createLogger } from '../shared/logger.js'

const log = createLogger('browser-manager')

export interface BrowserManagerOptions {
  headless?: boolean
  timeout?: number
  screenshotDir?: string
}

/**
 * Translate raw Playwright errors into friendly, actionable messages.
 */
export function friendlyBrowserError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)

  if (msg.includes('net::ERR_NAME_NOT_RESOLVED')) return 'Could not reach that website — the domain name was not found. Check the URL and try again.'
  if (msg.includes('net::ERR_CONNECTION_REFUSED')) return 'The website refused the connection. It may be down or blocking automated access.'
  if (msg.includes('net::ERR_CONNECTION_TIMED_OUT')) return 'The website took too long to respond. Try again or use a different source.'
  if (msg.includes('net::ERR_INTERNET_DISCONNECTED')) return 'No internet connection available. Check your network and try again.'
  if (msg.includes('net::ERR_CERT')) return 'The website has a security certificate issue. Try a different source.'
  if (msg.includes('Timeout') && msg.includes('exceeded')) return 'The page took too long to load. Try a different URL or simplify the request.'
  if (msg.includes('waiting for selector') || msg.includes('waiting for locator')) return 'Could not find the requested element on the page. The page layout may have changed — try reading the page first to see what elements are available.'
  if (msg.includes('Target closed') || msg.includes('Target page, context or browser has been closed')) return 'The browser tab was closed unexpectedly. Retrying with a fresh page.'
  if (msg.includes('browser has been closed') || msg.includes('Browser closed')) return 'The browser closed unexpectedly. Restarting and retrying.'
  if (msg.includes('Executable doesn\'t exist') || msg.includes('browserType.launch')) return 'Browser not available. Run "npx playwright install chromium" to set up the browser.'
  if (msg.includes('Navigation interrupted')) return 'The page navigation was interrupted — the website may have redirected. Try navigating again.'
  if (msg.includes('403') || msg.includes('Forbidden')) return 'The website blocked access (403 Forbidden). Try a different source or approach.'
  if (msg.includes('404') || msg.includes('Not Found')) return 'The page was not found (404). Check the URL or search for the correct page.'
  if (msg.includes('429') || msg.includes('Too Many Requests')) return 'The website is rate-limiting requests. Wait a moment and try a different source.'
  if (msg.includes('detached')) return 'The page element is no longer available. The page may have reloaded — try reading the page again.'

  // Fallback: clean up the raw error
  return `Browser action failed: ${msg.split('\n')[0].slice(0, 200)}`
}

/**
 * Manages a shared browser instance for all browser tools.
 * Lazy-launches Chromium on first use, reuses across tool calls.
 * Automatically recovers from stale pages and crashed browsers.
 */
export class BrowserManager {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private headless: boolean
  private timeout: number
  private screenshotDir: string

  constructor(options?: BrowserManagerOptions) {
    this.headless = options?.headless ?? true
    this.timeout = options?.timeout ?? 30000
    this.screenshotDir = options?.screenshotDir ?? './data/screenshots'
  }

  async getPage(): Promise<Page> {
    // Check if existing page is still usable
    if (this.page && !this.page.isClosed()) {
      return this.page
    }

    // Reset stale refs if page died
    if (this.page) {
      log.info('Recovering from stale page')
      this.page = null
    }

    // Check if browser is still alive
    if (!this.browser || !this.browser.isConnected()) {
      // Clean up dead refs
      this.context = null
      this.page = null

      log.info('Launching browser...', { headless: this.headless })
      this.browser = await chromium.launch({
        headless: this.headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-infobars',
          '--window-size=1280,720',
        ],
      })

      // Auto-recover on unexpected disconnects
      this.browser.on('disconnected', () => {
        log.warn('Browser disconnected unexpectedly')
        this.browser = null
        this.context = null
        this.page = null
      })
    }

    if (!this.context) {
      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'en-US',
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
        },
      })

      // Stealth: override navigator.webdriver to avoid bot detection
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false })
      })
    }

    this.page = await this.context.newPage()
    this.page.setDefaultTimeout(this.timeout)

    return this.page
  }

  getTimeout(): number {
    return this.timeout
  }

  getScreenshotDir(): string {
    return this.screenshotDir
  }

  isActive(): boolean {
    return this.browser !== null && this.browser.isConnected()
  }

  async close(): Promise<void> {
    if (this.browser) {
      log.info('Closing browser...')
      await this.browser.close()
      this.browser = null
      this.context = null
      this.page = null
    }
  }
}

// Singleton instance shared across all browser tools
let instance: BrowserManager | null = null

export function getBrowserManager(options?: BrowserManagerOptions): BrowserManager {
  if (!instance) {
    instance = new BrowserManager(options)
  }
  return instance
}

export async function closeBrowserManager(): Promise<void> {
  if (instance) {
    await instance.close()
    instance = null
  }
}
