// ── Imara Vision Agent — Electron Main Process ──────────────────────
// Wraps the Express UI server in a native desktop window with system tray.

import { app, BrowserWindow, Tray, Menu, nativeImage, shell } from 'electron'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { fork, type ChildProcess } from 'child_process'

// ── Constants ────────────────────────────────────────────────────────
const APP_NAME = 'Imara Vision Agent'
const UI_PORT = 3210
const UI_URL = `http://127.0.0.1:${UI_PORT}`
const IS_DEV = !app.isPackaged
const ICON_DIR = join(__dirname, '..', '..', 'assets', 'icons')

// ── State ────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let serverProcess: ChildProcess | null = null
let isQuitting = false

// ── Single instance lock ─────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

// ── Start the UI server as a child process ───────────────────────────
function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverScript = IS_DEV
      ? join(__dirname, '..', '..', 'src', 'desktop', 'ui-server.ts')
      : join(__dirname, 'ui-server.js')

    const execArgv = IS_DEV ? ['--import', 'tsx'] : []

    serverProcess = fork(serverScript, [], {
      cwd: join(__dirname, '..', '..'),
      execArgv,
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: IS_DEV ? 'development' : 'production' },
    })

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString()
      console.log('[server]', msg.trim())
      if (msg.includes('Desktop UI ready') || msg.includes(String(UI_PORT))) {
        resolve()
      }
    })

    serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[server:err]', data.toString().trim())
    })

    serverProcess.on('error', reject)

    serverProcess.on('exit', (code) => {
      console.log(`Server process exited with code ${code}`)
      serverProcess = null
    })

    // Timeout — server should start within 15s
    setTimeout(() => resolve(), 15000)
  })
}

// ── Create the main window ───────────────────────────────────────────
function createWindow(): void {
  const iconPath = getIconPath()

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 480,
    minHeight: 500,
    title: APP_NAME,
    icon: iconPath,
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
    },
  })

  mainWindow.loadURL(UI_URL)

  // Show when ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── System tray ──────────────────────────────────────────────────────
function createTray(): void {
  const iconPath = getIconPath()
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })

  tray = new Tray(icon)
  tray.setToolTip(APP_NAME)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Imara',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      },
    },
    { type: 'separator' },
    {
      label: 'Open in Browser',
      click: () => shell.openExternal(UI_URL),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus()
    } else {
      mainWindow?.show()
    }
  })
}

// ── Icon helper ──────────────────────────────────────────────────────
function getIconPath(): string {
  const platform = process.platform
  if (platform === 'win32') {
    const ico = join(ICON_DIR, 'icon.ico')
    if (existsSync(ico)) return ico
  }
  if (platform === 'darwin') {
    const icns = join(ICON_DIR, 'icon.icns')
    if (existsSync(icns)) return icns
  }
  const png = join(ICON_DIR, 'icon.png')
  if (existsSync(png)) return png
  // Fallback — no icon
  return ''
}

// ── App lifecycle ────────────────────────────────────────────────────
app.on('ready', async () => {
  console.log(`Starting ${APP_NAME}...`)

  // Start the backend server
  await startServer()

  // Create window and tray
  createWindow()
  createTray()

  console.log(`${APP_NAME} ready`)
})

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray
  if (process.platform !== 'darwin') {
    // Don't quit — the tray keeps it alive
  }
})

app.on('activate', () => {
  // macOS dock click
  if (!mainWindow) {
    createWindow()
  } else {
    mainWindow.show()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  // Stop the server process
  if (serverProcess) {
    serverProcess.kill('SIGTERM')
    serverProcess = null
  }
})
