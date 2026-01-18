/**
 * Browser launcher for "just works" mode
 * Spawns Chrome with debugging enabled and persistent profile
 *
 * Session Persistence Solution:
 * - Uses spawn() instead of launchPersistentContext (which uses --remote-debugging-pipe)
 * - Launches Chrome with --remote-debugging-port for CDP access
 * - Lock file tracks browser PID for cross-session reconnection
 * - Subsequent MCP sessions connect to existing browser via CDP
 *
 * Based on research from:
 * - Chrome DevTools Blog: https://developer.chrome.com/blog/remote-debugging-port
 * - Playwright MCP #1130: https://github.com/microsoft/playwright-mcp/issues/1130
 * - mcp-playwright-cdp: https://github.com/lars-hagen/mcp-playwright-cdp
 */

import { chromium, BrowserContext, Browser, devices } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// Default debugging port for multi-session support
const DEFAULT_DEBUG_PORT = 9222

// Lock file for tracking browser process across sessions
const LOCK_FILE_NAME = 'browser.lock'

export type BrowserChannel = 'chrome' | 'chrome-beta' | 'chrome-dev' | 'chrome-canary' | 'msedge' | 'msedge-beta' | 'msedge-dev'

export interface LaunchOptions {
  /** Run browser in headless mode (default: false - headed) */
  headless?: boolean
  /** Custom user data directory for persistent profile */
  userDataDir?: string
  /** Browser channel (default: 'chrome') */
  channel?: BrowserChannel
  /** Viewport size (default: 1280x720) */
  viewport?: { width: number; height: number }
  /** Device to emulate (e.g., 'iPhone 15', 'Pixel 7') */
  device?: string
  /** Run in isolated mode - no persistent profile */
  isolated?: boolean
  /** CDP endpoint to connect to existing browser instead of launching */
  cdpEndpoint?: string
  /** Custom executable path */
  executablePath?: string
  /** Additional browser args */
  args?: string[]
  /** Debugging port (default: 9222) */
  port?: number
}

export interface LaunchedBrowser {
  context: BrowserContext
  browser: Browser | null
  wsEndpoint: string | null
  userDataDir: string | null
  mode: 'launch' | 'cdp' | 'isolated'
  close: () => Promise<void>
}

interface LockFileData {
  port: number
  pid: number
  started: string
  userDataDir: string
}

/**
 * Get the browserwright cache directory
 */
function getCacheDir(): string {
  const platform = process.platform
  const cacheDir = platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Caches')
    : platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : path.join(os.homedir(), '.cache')

  return path.join(cacheDir, 'browserwright')
}

/**
 * Get the default user data directory for persistent browser profiles
 */
export function getDefaultUserDataDir(channel: BrowserChannel = 'chrome'): string {
  return path.join(getCacheDir(), `mcp-${channel}-profile`)
}

/**
 * Get the lock file path
 */
function getLockFilePath(): string {
  return path.join(getCacheDir(), LOCK_FILE_NAME)
}

/**
 * Read the lock file if it exists
 */
function readLockFile(): LockFileData | null {
  try {
    const lockPath = getLockFilePath()
    if (fs.existsSync(lockPath)) {
      const data = JSON.parse(fs.readFileSync(lockPath, 'utf-8'))
      return data as LockFileData
    }
  } catch {
    // Lock file doesn't exist or is corrupted
  }
  return null
}

/**
 * Write the lock file
 */
function writeLockFile(data: LockFileData): void {
  const lockPath = getLockFilePath()
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  fs.writeFileSync(lockPath, JSON.stringify(data, null, 2))
}

/**
 * Remove the lock file
 */
function removeLockFile(): void {
  try {
    fs.unlinkSync(getLockFilePath())
  } catch {
    // Ignore if doesn't exist
  }
}

/**
 * Check if a process is still running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0) // Signal 0 just checks if process exists
    return true
  } catch {
    return false
  }
}

/**
 * Try to connect to an existing browser on the debugging port
 * Returns the WebSocket URL if successful, null otherwise
 */
export async function tryConnectToExistingBrowser(port: number = DEFAULT_DEBUG_PORT): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(2000)
    })
    if (response.ok) {
      const data = await response.json() as { webSocketDebuggerUrl?: string }
      return data.webSocketDebuggerUrl || null
    }
  } catch {
    // No browser found on this port
  }
  return null
}

/**
 * Connect to an existing browser via CDP endpoint
 */
export async function connectToCDP(cdpEndpoint: string): Promise<LaunchedBrowser> {
  console.error(`[browserwright] Connecting to CDP endpoint: ${cdpEndpoint}`)

  const browser = await chromium.connectOverCDP(cdpEndpoint)
  const contexts = browser.contexts()
  const context = contexts[0] || await browser.newContext()

  // Ensure at least one page exists
  if (context.pages().length === 0) {
    await context.newPage()
  }

  console.error(`[browserwright] Connected to existing browser via CDP`)

  return {
    context,
    browser,
    wsEndpoint: cdpEndpoint,
    userDataDir: null,
    mode: 'cdp',
    close: async () => {
      // Don't close user's browser, just disconnect
      await browser.close()
    }
  }
}

/**
 * Get the default Chrome/Chromium arguments
 * Based on Playwright's defaults but without --remote-debugging-pipe
 */
function getDefaultArgs(options: {
  port: number
  userDataDir: string
  headless: boolean
}): string[] {
  const args = [
    // CDP port for multi-session support (required for session persistence)
    `--remote-debugging-port=${options.port}`,
    // User data dir (required with --remote-debugging-port per Chrome 136)
    `--user-data-dir=${options.userDataDir}`,
    // Playwright defaults for automation
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-extensions-with-background-pages',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--enable-features=NetworkService,NetworkServiceInProcess',
    '--force-color-profile=srgb',
    '--metrics-recording-only',
    '--no-first-run',
    '--password-store=basic',
    '--use-mock-keychain',
    // Reduce automation detection
    '--disable-blink-features=AutomationControlled',
    // Docker/container support
    '--no-sandbox',
    '--disable-setuid-sandbox',
  ]

  if (options.headless) {
    args.push('--headless=new')
  }

  return args
}

/**
 * Spawn Chrome as a detached background process
 */
async function spawnChrome(options: {
  executablePath: string
  args: string[]
  userDataDir: string
  port: number
}): Promise<{ pid: number }> {
  console.error(`[browserwright] Spawning Chrome...`)
  console.error(`[browserwright] Executable: ${options.executablePath}`)
  console.error(`[browserwright] Port: ${options.port}`)
  console.error(`[browserwright] Profile: ${options.userDataDir}`)

  // Spawn Chrome as detached background process
  const child = spawn(options.executablePath, [...options.args, 'about:blank'], {
    detached: true,
    stdio: 'ignore',
  })

  // Don't wait for the process - let it run in background
  child.unref()

  const pid = child.pid
  if (!pid) {
    throw new Error('Failed to spawn Chrome - no PID returned')
  }

  // Write lock file for cross-session tracking
  writeLockFile({
    port: options.port,
    pid,
    started: new Date().toISOString(),
    userDataDir: options.userDataDir,
  })

  console.error(`[browserwright] Chrome spawned with PID ${pid}`)

  // Wait for Chrome to be ready with diagnostic feedback
  const maxWait = 10000 // 10 seconds
  const startTime = Date.now()
  let lastAttempt = 0

  while (Date.now() - startTime < maxWait) {
    lastAttempt++
    const wsUrl = await tryConnectToExistingBrowser(options.port)
    if (wsUrl) {
      console.error(`[browserwright] Chrome is ready on port ${options.port}`)
      return { pid }
    }
    // Progress feedback every 2 seconds
    if (lastAttempt % 20 === 0) {
      console.error(`[browserwright] Waiting for Chrome... (${Math.round((Date.now() - startTime) / 1000)}s)`)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  // Provide diagnostic hints for common issues
  const processStillRunning = isProcessRunning(pid)
  let diagnosticHints = ''

  if (!processStillRunning) {
    diagnosticHints = '\n  - Chrome process exited unexpectedly. Check for crash dialogs or permission issues.'
  } else {
    diagnosticHints = `\n  - Chrome process (PID ${pid}) is running but not responding on port ${options.port}.`
    diagnosticHints += '\n  - Possible causes: port already in use by another process, firewall blocking, or Chrome hanging during startup.'
    diagnosticHints += `\n  - Try: kill any existing Chrome processes, or use a different port via the 'port' option.`
  }

  throw new Error(
    `Chrome did not become ready on port ${options.port} within ${maxWait}ms.${diagnosticHints}`
  )
}

/**
 * Kill Chrome process and its children
 * Uses spawnSync instead of exec for security (no shell injection)
 */
function killChrome(pid: number): void {
  console.error(`[browserwright] Killing Chrome process ${pid}...`)

  if (process.platform === 'win32') {
    // Windows: use taskkill with /T (tree) and /F (force)
    // Using spawnSync with args array prevents shell injection
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
    })
  } else {
    // Unix: kill process group
    try {
      process.kill(-pid, 'SIGKILL') // Negative PID kills process group
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Process already dead
      }
    }
  }

  removeLockFile()
  console.error(`[browserwright] Chrome process killed`)
}

/**
 * Launch a browser with debugging enabled and persistent profile
 * Uses spawn() instead of launchPersistentContext for session persistence
 */
export async function launchBrowser(options: LaunchOptions = {}): Promise<LaunchedBrowser> {
  // If CDP endpoint provided, connect instead of launching
  if (options.cdpEndpoint) {
    return connectToCDP(options.cdpEndpoint)
  }

  const channel = options.channel ?? 'chrome'
  const port = options.port ?? DEFAULT_DEBUG_PORT

  // Isolated mode uses temp directory
  const userDataDir = options.isolated
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'browserwright-'))
    : (options.userDataDir || getDefaultUserDataDir(channel))

  // Ensure the profile directory exists
  fs.mkdirSync(userDataDir, { recursive: true })

  // Step 1: Check for existing browser via lock file
  const lockData = readLockFile()
  if (lockData && !options.isolated) {
    console.error(`[browserwright] Found lock file (PID: ${lockData.pid}, port: ${lockData.port})`)

    // Check if the process is still running
    const pidAlive = isProcessRunning(lockData.pid)
    if (pidAlive) {
      // PID exists, but verify port actually responds (catches zombie processes)
      const wsUrl = await tryConnectToExistingBrowser(lockData.port)
      if (wsUrl) {
        console.error(`[browserwright] Connecting to existing browser...`)
        return connectToCDP(wsUrl)
      }
      // PID alive but port not responding - likely a zombie or crashed browser
      console.error(`[browserwright] Process ${lockData.pid} exists but port ${lockData.port} not responding (zombie or crashed)`)
    } else {
      console.error(`[browserwright] Process ${lockData.pid} no longer exists`)
    }

    // Lock file is stale - clean it up
    console.error(`[browserwright] Cleaning up stale lock file...`)
    removeLockFile()
  }

  // Step 2: Check if browser is running on the port (might have been started externally)
  if (!options.isolated) {
    const existingWsUrl = await tryConnectToExistingBrowser(port)
    if (existingWsUrl) {
      console.error(`[browserwright] Found existing browser on port ${port}, connecting...`)
      return connectToCDP(existingWsUrl)
    }
  }

  // Step 3: Launch new browser
  console.error(`[browserwright] Launching new browser...`)
  console.error(`[browserwright] Mode: ${options.isolated ? 'isolated' : 'persistent'}`)

  // Get executable path
  const executablePath = options.executablePath || chromium.executablePath()

  // Build args
  const defaultArgs = getDefaultArgs({
    port,
    userDataDir,
    headless: options.headless ?? false,
  })
  const allArgs = [...defaultArgs, ...(options.args || [])]

  // Spawn Chrome
  await spawnChrome({
    executablePath,
    args: allArgs,
    userDataDir,
    port,
  })

  // Connect via CDP
  const wsUrl = await tryConnectToExistingBrowser(port)
  if (!wsUrl) {
    throw new Error('Failed to connect to Chrome after spawning')
  }

  const browser = await chromium.connectOverCDP(wsUrl)
  const contexts = browser.contexts()
  let context = contexts[0]

  // Get device emulation settings if specified
  const deviceDescriptor = options.device ? devices[options.device] : undefined
  if (options.device && !deviceDescriptor) {
    console.error(`[browserwright] Warning: Unknown device "${options.device}", ignoring`)
  }

  // Create new context with viewport settings if needed
  if (!context) {
    context = await browser.newContext({
      viewport: deviceDescriptor?.viewport || options.viewport || { width: 1280, height: 720 },
      userAgent: deviceDescriptor?.userAgent,
      deviceScaleFactor: deviceDescriptor?.deviceScaleFactor,
      isMobile: deviceDescriptor?.isMobile,
      hasTouch: deviceDescriptor?.hasTouch,
    })
  }

  // Ensure at least one page exists
  if (context.pages().length === 0) {
    await context.newPage()
  }

  console.error(`[browserwright] Browser launched successfully`)
  console.error(`[browserwright] Debugging port: ${port} (other sessions can connect)`)

  return {
    context,
    browser,
    wsEndpoint: wsUrl,
    userDataDir,
    mode: options.isolated ? 'isolated' : 'launch',
    close: async () => {
      // For isolated mode, kill the browser entirely
      if (options.isolated) {
        const lockData = readLockFile()
        if (lockData?.pid) {
          killChrome(lockData.pid)
        }
        // Clean up temp directory
        try {
          fs.rmSync(userDataDir, { recursive: true, force: true })
        } catch {
          // Ignore cleanup errors
        }
      } else {
        // For persistent mode, just disconnect (browser stays running)
        await browser.close()
      }
    }
  }
}

/**
 * Check if a browser profile is currently locked
 */
export function isProfileLocked(userDataDir: string): boolean {
  const lockFile = path.join(userDataDir, 'SingletonLock')
  try {
    const stats = fs.lstatSync(lockFile)
    if (stats.isSymbolicLink()) {
      try {
        const target = fs.readlinkSync(lockFile)
        const pidMatch = target.match(/-(\d+)$/)
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10)
          process.kill(pid, 0)
          return true
        }
      } catch {
        return false
      }
    }
    return stats.isFile() || stats.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Check if a browser is already running with debugging enabled
 */
export async function findExistingBrowser(port: number = DEFAULT_DEBUG_PORT): Promise<string | null> {
  return tryConnectToExistingBrowser(port)
}

/**
 * List available device emulation options
 */
export function listDevices(): string[] {
  return Object.keys(devices)
}

/**
 * Kill any existing browserwright browser and clean up
 */
export function cleanupBrowser(): void {
  const lockData = readLockFile()
  if (lockData?.pid) {
    killChrome(lockData.pid)
  }
  removeLockFile()
}
