/**
 * Browser launcher for "just works" mode
 * Spawns Chrome with debugging enabled and persistent profile
 *
 * Based on best practices from:
 * - Microsoft Playwright MCP: https://github.com/microsoft/playwright-mcp
 * - BrowserStack Guide: https://www.browserstack.com/guide/playwright-persistent-context
 */

import { chromium, BrowserContext, Browser, devices } from 'playwright-core'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

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
}

export interface LaunchedBrowser {
  context: BrowserContext
  browser: Browser | null
  wsEndpoint: string | null
  userDataDir: string | null
  mode: 'launch' | 'cdp' | 'isolated'
  close: () => Promise<void>
}

/**
 * Get the default user data directory for persistent browser profiles
 * Follows the same pattern as Microsoft Playwright MCP
 */
export function getDefaultUserDataDir(channel: BrowserChannel = 'chrome'): string {
  const platform = process.platform
  const cacheDir = platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Caches')
    : platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : path.join(os.homedir(), '.cache')

  // Match Playwright MCP pattern: mcp-{channel}-profile
  return path.join(cacheDir, 'browserwright', `mcp-${channel}-profile`)
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
 * Launch a browser with debugging enabled and persistent profile
 * This enables "just works" mode without needing the extension
 */
export async function launchBrowser(options: LaunchOptions = {}): Promise<LaunchedBrowser> {
  // If CDP endpoint provided, connect instead of launching
  if (options.cdpEndpoint) {
    return connectToCDP(options.cdpEndpoint)
  }

  const channel = options.channel ?? 'chrome'

  // Isolated mode uses temp directory
  const userDataDir = options.isolated
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'browserwright-'))
    : (options.userDataDir || getDefaultUserDataDir(channel))

  // Ensure the profile directory exists
  fs.mkdirSync(userDataDir, { recursive: true })

  console.error(`[browserwright] Launching browser...`)
  console.error(`[browserwright] Mode: ${options.isolated ? 'isolated' : 'persistent'}`)
  console.error(`[browserwright] Profile: ${userDataDir}`)
  console.error(`[browserwright] Channel: ${channel}`)

  // Get device emulation settings if specified
  const deviceDescriptor = options.device ? devices[options.device] : undefined
  if (options.device && !deviceDescriptor) {
    console.error(`[browserwright] Warning: Unknown device "${options.device}", ignoring`)
  }

  // Combine base args with any custom args
  const baseArgs = [
    // Reduce automation detection
    '--disable-blink-features=AutomationControlled',
  ]
  const allArgs = [...baseArgs, ...(options.args || [])]

  // Launch persistent context - this keeps logins between sessions
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: options.headless ?? false,
    channel,
    executablePath: options.executablePath,
    viewport: deviceDescriptor?.viewport || options.viewport || { width: 1280, height: 720 },
    userAgent: deviceDescriptor?.userAgent,
    deviceScaleFactor: deviceDescriptor?.deviceScaleFactor,
    isMobile: deviceDescriptor?.isMobile,
    hasTouch: deviceDescriptor?.hasTouch,
    args: allArgs,
    ignoreDefaultArgs: ['--enable-automation'],
  })

  // Get browser reference (may be null for persistent contexts)
  const browser = context.browser()

  // Create initial page if none exists
  if (context.pages().length === 0) {
    await context.newPage()
  }

  console.error(`[browserwright] Browser launched successfully`)

  return {
    context,
    browser,
    wsEndpoint: null, // Persistent contexts don't expose wsEndpoint
    userDataDir,
    mode: options.isolated ? 'isolated' : 'launch',
    close: async () => {
      await context.close()
      // Clean up temp directory for isolated mode
      if (options.isolated) {
        try {
          fs.rmSync(userDataDir, { recursive: true, force: true })
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}

/**
 * Check if a browser is already running with debugging enabled
 */
export async function findExistingBrowser(port: number = 9222): Promise<string | null> {
  try {
    const response = await fetch(`http://localhost:${port}/json/version`, {
      signal: AbortSignal.timeout(1000)
    })
    if (response.ok) {
      const data = await response.json() as { webSocketDebuggerUrl?: string }
      return data.webSocketDebuggerUrl || null
    }
  } catch {
    // No browser found
  }
  return null
}

/**
 * List available device emulation options
 */
export function listDevices(): string[] {
  return Object.keys(devices)
}
