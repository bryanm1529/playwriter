import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { Page, Browser, BrowserContext, chromium } from 'playwright-core'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import dedent from 'string-dedent'
import { createPatch } from 'diff'
import { getCdpUrl, LOG_FILE_PATH, VERSION, sleep } from './utils.js'
import { killPortProcess } from 'kill-port-process'
import { waitForPageLoad, WaitForPageLoadOptions, WaitForPageLoadResult } from './wait-for-page-load.js'
import { getCDPSessionForPage, CDPSession, ICDPSession } from './cdp-session.js'
import { Debugger } from './debugger.js'
import { Editor } from './editor.js'
import { getStylesForLocator, formatStylesAsText, type StylesResult } from './styles.js'
import { getReactSource, type ReactSourceLocation } from './react-source.js'
import { ScopedFS } from './scoped-fs.js'
import { screenshotWithAccessibilityLabels, type ScreenshotResult } from './aria-snapshot.js'
import { getCleanHTML, type GetCleanHTMLOptions } from './clean-html.js'
import { RefRegistry, addShortRefPrefix } from './ref-registry.js'
import { filterSnapshot, type SnapshotFilterOptions } from './snapshot-filter.js'
import { launchBrowser, type LaunchOptions, type LaunchedBrowser, type BrowserChannel } from './launcher.js'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

class CodeExecutionTimeoutError extends Error {
  constructor(timeout: number) {
    super(`Code execution timed out after ${timeout}ms`)
    this.name = 'CodeExecutionTimeoutError'
  }
}

const require = createRequire(import.meta.url)

const usefulGlobals = {
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval,
  URL,
  URLSearchParams,
  fetch,
  Buffer,
  TextEncoder,
  TextDecoder,
  crypto,
  AbortController,
  AbortSignal,
  structuredClone,
} as const

interface State {
  isConnected: boolean
  page: Page | null
  browser: Browser | null
  context: BrowserContext | null
  launchMode: boolean
  launchedBrowser: LaunchedBrowser | null
}

interface VMContext {
  page: Page
  context: BrowserContext
  state: Record<string, any>
  console: {
    log: (...args: any[]) => void
    info: (...args: any[]) => void
    warn: (...args: any[]) => void
    error: (...args: any[]) => void
    debug: (...args: any[]) => void
  }
  accessibilitySnapshot: (options: {
    page: Page
    search?: string | RegExp
    showDiffSinceLastCall?: boolean
    /** Only show interactive elements (button, link, textbox, etc.) - 70-80% token reduction */
    interactive?: boolean
    /** Output in compact format: "@e5 link Home" - additional 30% reduction */
    compact?: boolean
    /** Maximum indentation depth to include */
    maxDepth?: number
    /** Use @eN format in refs (e.g., [ref=@e5] instead of [ref=e5]) */
    useShortRefs?: boolean
  }) => Promise<string>
  getCleanHTML: (options: GetCleanHTMLOptions) => Promise<string>
  getLocatorStringForElement: (element: any) => Promise<string>
  resetPlaywright: () => Promise<{ page: Page; context: BrowserContext }>
  getLatestLogs: (options?: { page?: Page; count?: number; search?: string | RegExp }) => Promise<string[]>
  clearAllLogs: () => void
  waitForPageLoad: (options: WaitForPageLoadOptions) => Promise<WaitForPageLoadResult>
  getCDPSession: (options: { page: Page }) => Promise<CDPSession>
  createDebugger: (options: { cdp: ICDPSession }) => Debugger
  createEditor: (options: { cdp: ICDPSession }) => Editor
  getStylesForLocator: (options: { locator: any }) => Promise<StylesResult>
  formatStylesAsText: (styles: StylesResult) => string
  getReactSource: (options: { locator: any }) => Promise<ReactSourceLocation | null>
  screenshotWithAccessibilityLabels: (options: { page: Page; interactiveOnly?: boolean; timeout?: number }) => Promise<void>
  require: NodeRequire
  import: (specifier: string) => Promise<any>
}

type VMContextWithGlobals = VMContext & typeof usefulGlobals

type SelectorGenerator = typeof import('@mizchi/selector-generator')

const state: State = {
  isConnected: false,
  page: null,
  browser: null,
  context: null,
  launchMode: false,
  launchedBrowser: null,
}

// Launch options set via CLI, used when launchMode is true
let launchOptions: LaunchOptions = {}

const userState: Record<string, any> = {}

// Store logs per page targetId
const browserLogs: Map<string, string[]> = new Map()
const MAX_LOGS_PER_PAGE = 5000

// Store last accessibility snapshot per page for diff feature
const lastSnapshots: WeakMap<Page, string> = new WeakMap()

// Cache CDP sessions per page
const cdpSessionCache: WeakMap<Page, CDPSession> = new WeakMap()

const RELAY_PORT = Number(process.env.BROWSERWRIGHT_PORT) || 19988
const NO_TABS_ERROR = `No browser tabs are connected. Please install and enable the Browserwright extension on at least one tab: https://chromewebstore.google.com/detail/browserwright/jfeammnjpkecdekppnclgkkffahnhfhe`

// Create a scoped fs instance that allows access to cwd, /tmp, and os.tmpdir()
const scopedFs = new ScopedFS()

/**
 * Allowlist of Node.js built-in modules that are safe to use in the sandbox.
 * Dangerous modules like child_process, cluster, worker_threads, vm, net are blocked.
 */
const ALLOWED_MODULES = new Set([
  // Safe utility modules
  'path',
  'node:path',
  'url',
  'node:url',
  'querystring',
  'node:querystring',
  'punycode',
  'node:punycode',

  // Crypto and encoding
  'crypto',
  'node:crypto',
  'buffer',
  'node:buffer',
  'string_decoder',
  'node:string_decoder',

  // Utilities
  'util',
  'node:util',
  'assert',
  'node:assert',
  'events',
  'node:events',
  'timers',
  'node:timers',

  // Streams and compression
  'stream',
  'node:stream',
  'zlib',
  'node:zlib',

  // HTTP (fetch is already available, these are consistent)
  'http',
  'node:http',
  'https',
  'node:https',
  'http2',
  'node:http2',

  // System info (read-only, useful for debugging)
  'os',
  'node:os',

  // fs is allowed but returns sandboxed version
  'fs',
  'node:fs',
])

/**
 * Create a sandboxed require function that:
 * 1. Returns scoped fs for 'fs' and 'node:fs'
 * 2. Only allows modules in the ALLOWED_MODULES allowlist
 * 3. Blocks all other modules (child_process, net, vm, third-party packages, etc.)
 */
function createSandboxedRequire(originalRequire: NodeRequire): NodeRequire {
  const sandboxedRequire = ((id: string) => {
    // Check allowlist first
    if (!ALLOWED_MODULES.has(id)) {
      const error = new Error(
        `Module "${id}" is not allowed in the sandbox. ` +
          `Only safe Node.js built-ins are permitted: ${[...ALLOWED_MODULES].filter((m) => !m.startsWith('node:')).join(', ')}`,
      )
      error.name = 'ModuleNotAllowedError'
      throw error
    }

    // Return sandboxed fs
    if (id === 'fs' || id === 'node:fs') {
      return scopedFs
    }

    return originalRequire(id)
  }) as NodeRequire

  // Copy over require properties
  sandboxedRequire.resolve = originalRequire.resolve
  sandboxedRequire.cache = originalRequire.cache
  sandboxedRequire.extensions = originalRequire.extensions
  sandboxedRequire.main = originalRequire.main

  return sandboxedRequire
}

const sandboxedRequire = createSandboxedRequire(require)

interface RemoteConfig {
  host: string
  port: number
  token?: string
}

function getRemoteConfig(): RemoteConfig | null {
  const host = process.env.BROWSERWRIGHT_HOST
  if (!host) {
    return null
  }
  return {
    host,
    port: RELAY_PORT,
    token: process.env.BROWSERWRIGHT_TOKEN,
  }
}

async function setDeviceScaleFactorForMacOS(context: BrowserContext): Promise<void> {
  if (os.platform() !== 'darwin') {
    return
  }
  const options = (context as any)._options
  if (!options || options.deviceScaleFactor === 2) {
    return
  }
  options.deviceScaleFactor = 2
}

async function preserveSystemColorScheme(context: BrowserContext): Promise<void> {
  const options = (context as any)._options
  if (!options) {
    return
  }
  options.colorScheme = 'no-override'
  options.reducedMotion = 'no-override'
  options.forcedColors = 'no-override'
}

function isRegExp(value: any): value is RegExp {
  return (
    typeof value === 'object' && value !== null && typeof value.test === 'function' && typeof value.exec === 'function'
  )
}

function clearUserState() {
  Object.keys(userState).forEach((key) => delete userState[key])
}

function clearConnectionState() {
  state.isConnected = false
  state.browser = null
  state.page = null
  state.context = null
  // Don't clear launchMode - that's set once at startup
  // Don't clear launchedBrowser - that persists across reconnections
}

function getLogServerUrl(): string {
  const remote = getRemoteConfig()
  if (remote) {
    return `http://${remote.host}:${remote.port}/mcp-log`
  }
  return `http://127.0.0.1:${RELAY_PORT}/mcp-log`
}

async function sendLogToRelayServer(level: string, ...args: any[]) {
  try {
    await fetch(getLogServerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, args }),
      signal: AbortSignal.timeout(1000),
    })
  } catch {
    // Silently fail if relay server is not available
  }
}

/**
 * Log to both console.error (for early startup) and relay server log file.
 * Fire-and-forget to avoid blocking.
 */
function mcpLog(...args: any[]) {
  console.error(...args)
  sendLogToRelayServer('log', ...args)
}

async function getServerVersion(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/version`, {
      signal: AbortSignal.timeout(500),
    })
    if (!response.ok) {
      return null
    }
    const data = (await response.json()) as { version: string }
    return data.version
  } catch (error) {
    return null
  }
}

async function killRelayServer(port: number): Promise<void> {
  try {
    await killPortProcess(port)
    await sleep(500)
  } catch {}
}

/**
 * Compare two semver versions. Returns:
 * - negative if v1 < v2
 * - 0 if v1 === v2
 * - positive if v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  const len = Math.max(parts1.length, parts2.length)

  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 !== p2) {
      return p1 - p2
    }
  }
  return 0
}

async function ensureRelayServer(): Promise<void> {
  const serverVersion = await getServerVersion(RELAY_PORT)

  if (serverVersion === VERSION) {
    return
  }

  // Don't restart if server version is higher than MCP version.
  // This prevents older MCPs from killing a newer server.
  if (serverVersion !== null && compareVersions(serverVersion, VERSION) > 0) {
    return
  }

  if (serverVersion !== null) {
    mcpLog(`CDP relay server version mismatch (server: ${serverVersion}, mcp: ${VERSION}), restarting...`)
    await killRelayServer(RELAY_PORT)
  } else {
    mcpLog('CDP relay server not running, starting it...')
  }

  const dev = process.env.BROWSERWRIGHT_NODE_ENV === 'development'
  const scriptPath = dev
    ? path.resolve(__dirname, '../src/start-relay-server.ts')
    : require.resolve('../dist/start-relay-server.js')

  const serverProcess = spawn(dev ? 'tsx' : process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
    },
  })

  serverProcess.unref()

  for (let i = 0; i < 10; i++) {
    await sleep(500)
    const newVersion = await getServerVersion(RELAY_PORT)
    if (newVersion === VERSION) {
      mcpLog('CDP relay server started successfully, waiting for extension to connect...')
      await sleep(1000)
      return
    }
  }

  throw new Error(`Failed to start CDP relay server after 5 seconds. Check logs at: ${LOG_FILE_PATH}`)
}

async function ensureConnection(): Promise<{ browser: Browser; page: Page }> {
  // Validate that cached connection is actually still alive
  if (state.isConnected && state.browser && state.page) {
    // Check if page or browser has been closed
    const pageStillValid = !state.page.isClosed()
    const browserStillConnected = state.browser.isConnected()

    if (pageStillValid && browserStillConnected) {
      return { browser: state.browser, page: state.page }
    }

    // Cached connection is stale - clear and reconnect
    mcpLog(`Connection stale (page closed: ${!pageStillValid}, browser disconnected: ${!browserStillConnected}) - reconnecting...`)
    clearConnectionState()
  }

  // Launch mode: use launched browser instead of relay server
  if (state.launchMode) {
    return ensureLaunchModeConnection()
  }

  // Extension mode: try to connect via CDP relay server
  const remote = getRemoteConfig()
  if (!remote) {
    await ensureRelayServer()
  }

  const cdpEndpoint = getCdpUrl(remote || { port: RELAY_PORT })

  let browser: Browser
  let hasExtensionTabs = false

  try {
    browser = await chromium.connectOverCDP(cdpEndpoint)
    const contexts = browser.contexts()
    const context = contexts.length > 0 ? contexts[0] : null
    hasExtensionTabs = context !== null && context.pages().length > 0

    if (!hasExtensionTabs) {
      // No tabs from extension - close this connection and fall back to launch mode
      await browser.close()
    }
  } catch (error: any) {
    // Connection failed - will fall back to launch mode
    hasExtensionTabs = false
  }

  // Auto-fallback: if no extension tabs, launch a browser automatically
  if (!hasExtensionTabs) {
    mcpLog('No extension tabs connected - auto-launching browser for seamless experience')
    state.launchMode = true
    launchOptions = { headless: false } // Headed by default for visibility
    return ensureLaunchModeConnection()
  }

  // Extension mode: we have tabs, proceed with connection
  browser = await chromium.connectOverCDP(cdpEndpoint)

  // Clear connection state when browser disconnects (e.g., extension reconnects, relay server restarts)
  browser.on('disconnected', () => {
    mcpLog('Browser disconnected, clearing connection state')
    clearConnectionState()
  })

  const contexts = browser.contexts()
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext()

  // Set up console listener for all future pages
  context.on('page', (page) => {
    setupPageConsoleListener(page)
  })

  const pages = context.pages()
  const page = pages[0]

  // Set up console listener for all existing pages
  context.pages().forEach((p) => setupPageConsoleListener(p))

  // These functions only set context-level options, they do NOT send CDP commands to pages.
  // Sending CDP commands (like Emulation.setEmulatedMedia or setDeviceMetricsOverride) to pages
  // immediately after connectOverCDP causes pages to render white/blank with about:blank URLs,
  // because pages may not be fully initialized yet. Playwright applies these settings lazily.
  await preserveSystemColorScheme(context)
  await setDeviceScaleFactorForMacOS(context)

  state.browser = browser
  state.page = page
  state.context = context
  state.isConnected = true

  return { browser, page }
}

/**
 * Ensure connection in launch mode - uses launched browser with persistent profile
 */
async function ensureLaunchModeConnection(): Promise<{ browser: Browser; page: Page }> {
  // If we don't have a launched browser yet, launch one
  if (!state.launchedBrowser) {
    mcpLog('Launch mode: starting browser...')
    state.launchedBrowser = await launchBrowser(launchOptions)
    mcpLog(`Launch mode: browser started (${state.launchedBrowser.mode})`)
  }

  const { context, browser } = state.launchedBrowser

  // Set up console listener for all future pages
  context.on('page', (page) => {
    setupPageConsoleListener(page)
  })

  const pages = context.pages()
  if (pages.length === 0) {
    // In launch mode, we can create a page since we own the browser
    await context.newPage()
  }
  const page = context.pages()[0]

  // Set up console listener for all existing pages
  context.pages().forEach((p) => setupPageConsoleListener(p))

  await preserveSystemColorScheme(context)
  await setDeviceScaleFactorForMacOS(context)

  state.browser = browser
  state.page = page
  state.context = context
  state.isConnected = true

  return { browser: browser!, page }
}

async function getPageTargetId(page: Page): Promise<string> {
  if (!page) {
    throw new Error('Page is null or undefined')
  }

  const guid = (page as any)._guid
  if (guid) {
    return guid
  }

  throw new Error('Could not get page identifier: _guid not available')
}

function setupPageConsoleListener(page: Page) {
  // Get targetId synchronously using _guid
  const targetId = (page as any)._guid as string | undefined

  if (!targetId) {
    // If no _guid, silently fail - this shouldn't happen in normal operation
    return
  }

  // Initialize logs array for this page
  if (!browserLogs.has(targetId)) {
    browserLogs.set(targetId, [])
  }

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      browserLogs.set(targetId, [])
    }
  })

  page.on('close', () => {
    browserLogs.delete(targetId)
  })

  page.on('console', (msg) => {
    try {
      let logEntry = `[${msg.type()}] ${msg.text()}`

      if (!browserLogs.has(targetId)) {
        browserLogs.set(targetId, [])
      }
      const pageLogs = browserLogs.get(targetId)!

      pageLogs.push(logEntry)
      if (pageLogs.length > MAX_LOGS_PER_PAGE) {
        pageLogs.shift()
      }
    } catch (e) {
      mcpLog('[MCP] Failed to get console message text:', e)
      return
    }
  })
}

async function getCurrentPage(timeout = 5000) {
  if (state.page) {
    return state.page
  }

  if (state.browser) {
    const contexts = state.browser.contexts()
    if (contexts.length > 0) {
      const pages = contexts[0].pages()

      if (pages.length > 0) {
        const page = pages[0]
        await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {})
        return page
      }
    }
  }

  throw new Error(NO_TABS_ERROR)
}

async function resetConnection(): Promise<{ browser: Browser; page: Page; context: BrowserContext }> {
  if (state.browser) {
    try {
      await state.browser.close()
    } catch (e) {
      mcpLog('Error closing browser:', e)
    }
  }

  clearConnectionState()
  clearUserState()

  // DO NOT clear browser logs on reset - logs should persist across reconnections
  // browserLogs.clear()

  const remote = getRemoteConfig()
  if (!remote) {
    await ensureRelayServer()
  }

  const cdpEndpoint = getCdpUrl(remote || { port: RELAY_PORT })
  const browser = await chromium.connectOverCDP(cdpEndpoint)

  // Clear connection state when browser disconnects (e.g., extension reconnects, relay server restarts)
  browser.on('disconnected', () => {
    mcpLog('Browser disconnected, clearing connection state')
    clearConnectionState()
  })

  const contexts = browser.contexts()
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext()

  // Set up console listener for all future pages
  context.on('page', (page) => {
    setupPageConsoleListener(page)
  })

  const pages = context.pages()
  if (pages.length === 0) {
    throw new Error(NO_TABS_ERROR)
  }
  const page = pages[0]

  // Set up console listener for all existing pages
  context.pages().forEach((p) => setupPageConsoleListener(p))

  await preserveSystemColorScheme(context)
  await setDeviceScaleFactorForMacOS(context)

  state.browser = browser
  state.page = page
  state.context = context
  state.isConnected = true

  return { browser, page, context }
}

const server = new McpServer({
  name: 'browserwright',
  title: 'Browser automation that just works. Auto-launches Chrome when needed, or uses existing tabs via extension. Persistent logins across sessions.',
  version: '1.0.0',
})

const promptContent =
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'prompt.md'), 'utf-8') +
  `\n\nfor debugging internal browserwright errors, check browserwright relay server logs at: ${LOG_FILE_PATH}`

server.resource(
  'debugger-api',
  'browserwright://resources/debugger-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const packageJsonPath = require.resolve('browserwright/package.json')
    const packageDir = path.dirname(packageJsonPath)
    const content = fs.readFileSync(path.join(packageDir, 'dist', 'debugger-api.md'), 'utf-8')

    return {
      contents: [
        {
          uri: 'browserwright://resources/debugger-api.md',
          text: content,
          mimeType: 'text/plain',
        },
      ],
    }
  },
)

server.resource(
  'editor-api',
  'browserwright://resources/editor-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const packageJsonPath = require.resolve('browserwright/package.json')
    const packageDir = path.dirname(packageJsonPath)
    const content = fs.readFileSync(path.join(packageDir, 'dist', 'editor-api.md'), 'utf-8')

    return {
      contents: [
        {
          uri: 'browserwright://resources/editor-api.md',
          text: content,
          mimeType: 'text/plain',
        },
      ],
    }
  },
)

server.resource(
  'styles-api',
  'browserwright://resources/styles-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const packageJsonPath = require.resolve('browserwright/package.json')
    const packageDir = path.dirname(packageJsonPath)
    const content = fs.readFileSync(path.join(packageDir, 'dist', 'styles-api.md'), 'utf-8')

    return {
      contents: [
        {
          uri: 'browserwright://resources/styles-api.md',
          text: content,
          mimeType: 'text/plain',
        },
      ],
    }
  },
)

server.tool(
  'execute',
  promptContent,
  {
    code: z
      .string()
      .describe(
        'js playwright code, has {page, state, context} in scope. Should be one line, using ; to execute multiple statements. you MUST call execute multiple times instead of writing complex scripts in a single tool call.',
      ),
    timeout: z.number().default(5000).describe('Timeout in milliseconds for code execution (default: 5000ms)'),
  },
  async ({ code, timeout }) => {
    const consoleLogs: Array<{ method: string; args: any[] }> = []

    const formatConsoleLogs = (logs: Array<{ method: string; args: any[] }>, prefix = 'Console output') => {
      if (logs.length === 0) {
        return ''
      }

      let text = `${prefix}:\n`
      logs.forEach(({ method, args }) => {
        const formattedArgs = args
          .map((arg) => {
            if (typeof arg === 'object') {
              return JSON.stringify(arg, null, 2)
            }
            return String(arg)
          })
          .join(' ')
        text += `[${method}] ${formattedArgs}\n`
      })
      return text + '\n'
    }

    try {
      await ensureRelayServer()
      await ensureConnection()

      const page = await getCurrentPage(timeout)
      const context = state.context || page.context()

      mcpLog('Executing code:', code)

      const customConsole = {
        log: (...args: any[]) => {
          consoleLogs.push({ method: 'log', args })
        },
        info: (...args: any[]) => {
          consoleLogs.push({ method: 'info', args })
        },
        warn: (...args: any[]) => {
          consoleLogs.push({ method: 'warn', args })
        },
        error: (...args: any[]) => {
          consoleLogs.push({ method: 'error', args })
        },
        debug: (...args: any[]) => {
          consoleLogs.push({ method: 'debug', args })
        },
      }

      const accessibilitySnapshot = async (options: {
        page: Page
        search?: string | RegExp
        showDiffSinceLastCall?: boolean
        interactive?: boolean
        compact?: boolean
        maxDepth?: number
        useShortRefs?: boolean
      }) => {
        const {
          page: targetPage,
          search,
          showDiffSinceLastCall = false,
          interactive = false,
          compact = false,
          maxDepth,
          useShortRefs = true, // Default to short refs for cleaner output
        } = options

        if ((targetPage as any)._snapshotForAI) {
          const snapshot = await (targetPage as any)._snapshotForAI()
          // Sanitize to remove unpaired surrogates that break JSON encoding for Claude API
          const rawStr = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot, null, 2)
          let snapshotStr = rawStr.toWellFormed?.() ?? rawStr

          // Apply short ref prefix (@eN format) if enabled
          if (useShortRefs) {
            snapshotStr = addShortRefPrefix(snapshotStr)
          }

          // Apply filtering options (interactive, compact, maxDepth)
          if (interactive || compact || maxDepth !== undefined) {
            snapshotStr = filterSnapshot(snapshotStr, {
              interactive,
              compact,
              maxDepth,
            })
          }

          if (showDiffSinceLastCall) {
            const previousSnapshot = lastSnapshots.get(targetPage)

            if (!previousSnapshot) {
              lastSnapshots.set(targetPage, snapshotStr)
              return 'No previous snapshot available. This is the first call for this page. Full snapshot stored for next diff.'
            }

            const patch = createPatch('snapshot', previousSnapshot, snapshotStr, 'previous', 'current', {
              context: 3,
            })
            if (patch.split('\n').length <= 4) {
              return 'No changes detected since last snapshot'
            }
            return patch
          }

          lastSnapshots.set(targetPage, snapshotStr)

          if (!search) {
            return snapshotStr
          }

          const lines = snapshotStr.split('\n')
          const matchIndices: number[] = []

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            let isMatch = false
            if (isRegExp(search)) {
              isMatch = search.test(line)
            } else {
              isMatch = line.includes(search)
            }

            if (isMatch) {
              matchIndices.push(i)
              if (matchIndices.length >= 10) break
            }
          }

          if (matchIndices.length === 0) {
            return 'No matches found'
          }

          // Collect lines with 5 lines of context above and below each match
          const CONTEXT_LINES = 5
          const includedLines = new Set<number>()
          for (const idx of matchIndices) {
            const start = Math.max(0, idx - CONTEXT_LINES)
            const end = Math.min(lines.length - 1, idx + CONTEXT_LINES)
            for (let i = start; i <= end; i++) {
              includedLines.add(i)
            }
          }

          // Build result with separators between non-contiguous sections
          const sortedIndices = [...includedLines].sort((a, b) => a - b)
          const result: string[] = []
          for (let i = 0; i < sortedIndices.length; i++) {
            const lineIdx = sortedIndices[i]
            if (i > 0 && sortedIndices[i - 1] !== lineIdx - 1) {
              result.push('---')
            }
            result.push(lines[lineIdx])
          }

          return result.join('\n')
        }
        throw new Error('accessibilitySnapshot is not available on this page')
      }

      const getLocatorStringForElement = async (element: any) => {
        if (!element || typeof element.evaluate !== 'function') {
          throw new Error('getLocatorStringForElement: argument must be a Playwright Locator or ElementHandle')
        }

        const elementPage = element.page ? element.page() : page
        const hasGenerator = await elementPage.evaluate(() => !!(globalThis as any).__selectorGenerator)

        if (!hasGenerator) {
          const currentDir = path.dirname(fileURLToPath(import.meta.url))
          const scriptPath = path.join(currentDir, '..', 'dist', 'selector-generator.js')
          const scriptContent = fs.readFileSync(scriptPath, 'utf-8')
          const cdp = await getCDPSession({ page: elementPage })
          await cdp.send('Runtime.evaluate', { expression: scriptContent })
        }

        return await element.evaluate((el: any) => {
          const { createSelectorGenerator, toLocator } = (globalThis as any).__selectorGenerator
          const generator = createSelectorGenerator(globalThis)
          const result = generator(el)
          return toLocator(result.selector, 'javascript')
        })
      }

      const getLatestLogs = async (options?: { page?: Page; count?: number; search?: string | RegExp }) => {
        const { page: filterPage, count, search } = options || {}

        let allLogs: string[] = []

        if (filterPage) {
          const targetId = await getPageTargetId(filterPage)
          const pageLogs = browserLogs.get(targetId) || []
          allLogs = [...pageLogs]
        } else {
          for (const pageLogs of browserLogs.values()) {
            allLogs.push(...pageLogs)
          }
        }

        if (search) {
          const matchIndices: number[] = []
          for (let i = 0; i < allLogs.length; i++) {
            const log = allLogs[i]
            let isMatch = false
            if (typeof search === 'string') {
              isMatch = log.includes(search)
            } else if (isRegExp(search)) {
              isMatch = search.test(log)
            }
            if (isMatch) {
              matchIndices.push(i)
            }
          }

          // Collect logs with 5 lines of context above and below each match
          const CONTEXT_LINES = 5
          const includedIndices = new Set<number>()
          for (const idx of matchIndices) {
            const start = Math.max(0, idx - CONTEXT_LINES)
            const end = Math.min(allLogs.length - 1, idx + CONTEXT_LINES)
            for (let i = start; i <= end; i++) {
              includedIndices.add(i)
            }
          }

          // Build result with separators between non-contiguous sections
          const sortedIndices = [...includedIndices].sort((a, b) => a - b)
          const result: string[] = []
          for (let i = 0; i < sortedIndices.length; i++) {
            const logIdx = sortedIndices[i]
            if (i > 0 && sortedIndices[i - 1] !== logIdx - 1) {
              result.push('---')
            }
            result.push(allLogs[logIdx])
          }

          allLogs = result
        }

        return count !== undefined ? allLogs.slice(-count) : allLogs
      }

      const clearAllLogs = () => {
        browserLogs.clear()
      }

      const getCDPSession = async (options: { page: Page }) => {
        const cached = cdpSessionCache.get(options.page)
        if (cached) {
          return cached
        }
        const wsUrl = getCdpUrl(getRemoteConfig() || { port: RELAY_PORT })
        const session = await getCDPSessionForPage({ page: options.page, wsUrl })
        cdpSessionCache.set(options.page, session)
        return session
      }

      const createDebugger = (options: { cdp: ICDPSession }) => {
        return new Debugger(options)
      }

      const createEditor = (options: { cdp: ICDPSession }) => {
        return new Editor(options)
      }

      const getStylesForLocatorFn = async (options: { locator: any }) => {
        const cdp = await getCDPSession({ page: options.locator.page() })
        return getStylesForLocator({ locator: options.locator, cdp })
      }

      const getReactSourceFn = async (options: { locator: any }) => {
        const cdp = await getCDPSession({ page: options.locator.page() })
        return getReactSource({ locator: options.locator, cdp })
      }

      // Collector for screenshots taken during this execution
      const screenshotCollector: ScreenshotResult[] = []

      const screenshotWithAccessibilityLabelsFn = async (options: { page: Page; interactiveOnly?: boolean; timeout?: number }) => {
        return screenshotWithAccessibilityLabels({ ...options, collector: screenshotCollector })
      }

      let vmContextObj: VMContextWithGlobals = {
        page,
        context,
        state: userState,
        console: customConsole,
        accessibilitySnapshot,
        getCleanHTML,
        getLocatorStringForElement,
        getLatestLogs,
        clearAllLogs,
        waitForPageLoad,
        getCDPSession,
        createDebugger,
        createEditor,
        getStylesForLocator: getStylesForLocatorFn,
        formatStylesAsText,
        getReactSource: getReactSourceFn,
        screenshotWithAccessibilityLabels: screenshotWithAccessibilityLabelsFn,
        resetPlaywright: async () => {
          const { page: newPage, context: newContext } = await resetConnection()

          const resetObj: VMContextWithGlobals = {
            page: newPage,
            context: newContext,
            state: userState,
            console: customConsole,
            accessibilitySnapshot,
            getCleanHTML,
            getLocatorStringForElement,
            getLatestLogs,
            clearAllLogs,
            waitForPageLoad,
            getCDPSession,
            createDebugger,
            createEditor,
            getStylesForLocator: getStylesForLocatorFn,
            formatStylesAsText,
            getReactSource: getReactSourceFn,
            screenshotWithAccessibilityLabels: screenshotWithAccessibilityLabelsFn,
            resetPlaywright: vmContextObj.resetPlaywright,
            require: sandboxedRequire,
            // TODO --experimental-vm-modules is needed to make import work in vm
            import: vmContextObj.import,
            ...usefulGlobals,
          }
          Object.keys(vmContextObj).forEach((key) => delete (vmContextObj as any)[key])
          Object.assign(vmContextObj, resetObj)
          return { page: newPage, context: newContext }
        },
        require: sandboxedRequire,
        import: (specifier: string) => import(specifier),
        ...usefulGlobals,
      }

      const vmContext = vm.createContext(vmContextObj)

      // Resolve short refs (@e5 -> aria-ref=e5) before execution
      const resolvedCode = RefRegistry.resolveShortRefs(code)
      const wrappedCode = `(async () => { ${resolvedCode} })()`

      const result = await Promise.race([
        vm.runInContext(wrappedCode, vmContext, {
          timeout,
          displayErrors: true,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new CodeExecutionTimeoutError(timeout)), timeout)),
      ])

      let responseText = formatConsoleLogs(consoleLogs)

      if (result !== undefined) {
        responseText += 'Return value:\n'
        if (typeof result === 'string') {
          responseText += result
        } else {
          responseText += JSON.stringify(result, null, 2)
        }
      } else if (consoleLogs.length === 0) {
        responseText += 'Code executed successfully (no output)'
      }

      // Add screenshot info to response text
      for (const screenshot of screenshotCollector) {
        responseText += `\nScreenshot saved to: ${screenshot.path}\n`
        responseText += `Labels shown: ${screenshot.labelCount}\n\n`
        responseText += `Accessibility snapshot:\n${screenshot.snapshot}\n`
      }

      const MAX_LENGTH = 6000
      let finalText = responseText.trim()
      if (finalText.length > MAX_LENGTH) {
        finalText =
          finalText.slice(0, MAX_LENGTH) +
          `\n\n[Truncated to ${MAX_LENGTH} characters. Better manage your logs or paginate them to read the full logs]`
      }

      // Build content array with text and any collected screenshots
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        {
          type: 'text',
          text: finalText,
        },
      ]

      // Add all collected screenshots as images
      for (const screenshot of screenshotCollector) {
        content.push({
          type: 'image',
          data: screenshot.base64,
          mimeType: screenshot.mimeType,
        })
      }

      return { content }
    } catch (error: any) {
      const errorStack = error.stack || error.message
      const isTimeoutError = error instanceof CodeExecutionTimeoutError || error.name === 'TimeoutError'

      // Always log to stderr, but only send non-timeout errors to relay server
      console.error('Error in execute tool:', errorStack)
      if (!isTimeoutError) {
        sendLogToRelayServer('error', 'Error in execute tool:', errorStack)
      }

      const logsText = formatConsoleLogs(consoleLogs, 'Console output (before error)')

      const resetHint = isTimeoutError
        ? ''
        : '\n\n[HINT: If this is an internal Playwright error, page/browser closed, or connection issue, call the `reset` tool to reconnect. Do NOT reset for other non-connection non-internal errors.]'

      return {
        content: [
          {
            type: 'text',
            text: `${logsText}\nError executing code: ${error.message}\n${errorStack}${resetHint}`,
          },
        ],
        isError: true,
      }
    }
  },
)

server.tool(
  'reset',
  dedent`
    Recreates the CDP connection and resets the browser/page/context. Use this when the MCP stops responding, you get connection errors, if there are no pages in context, assertion failures, page closed, or other issues.

    After calling this tool, the page and context variables are automatically updated in the execution environment.

    This tools also removes any custom properties you may have added to the global scope AND clearing all keys from the \`state\` object. Only \`page\`, \`context\`, \`state\` (empty), \`console\`, and utility functions will remain.

    if playwright always returns all pages as about:blank urls and evaluate does not work you should ask the user to restart Chrome. This is a known Chrome bug.
  `,
  {},
  async () => {
    try {
      const { page, context } = await resetConnection()
      const pagesCount = context.pages().length
      return {
        content: [
          {
            type: 'text',
            text: `Connection reset successfully. ${pagesCount} page(s) available. Current page URL: ${page.url()}`,
          },
        ],
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to reset connection: ${error.message}`,
          },
        ],
        isError: true,
      }
    }
  },
)

server.tool(
  'browser_status',
  dedent`
    Get Browserwright browser connection status. Shows current mode (extension or launched) and available tabs.
    Usually not needed - just use 'execute' directly and Browserwright auto-launches Chrome if needed.
  `,
  {},
  async () => {
    try {
      // Check if we're already in launch mode
      if (state.launchMode && state.launchedBrowser) {
        const context = state.launchedBrowser.context
        const pages = context.pages()
        const tabList = await Promise.all(
          pages.map(async (p, i) => `${i + 1}. ${await p.title().catch(() => 'Unknown')}\n   ${p.url()}`),
        )
        return {
          content: [
            {
              type: 'text',
              text: `Launch mode active (persistent profile)\n${pages.length} tab(s):\n${tabList.join('\n')}`,
            },
          ],
        }
      }

      // Check extension mode
      const remote = getRemoteConfig()
      if (!remote) {
        await ensureRelayServer()
      }

      const cdpEndpoint = getCdpUrl(remote || { port: RELAY_PORT })
      const browser = await chromium.connectOverCDP(cdpEndpoint)

      const allTabs: Array<{ url: string; title: string }> = []
      try {
        for (const ctx of browser.contexts()) {
          for (const page of ctx.pages()) {
            allTabs.push({
              url: page.url(),
              title: await page.title().catch(() => 'Unknown'),
            })
          }
        }
      } finally {
        await browser.close()
      }

      if (allTabs.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No extension tabs attached. Will auto-launch Chrome when you use 'execute'.`,
            },
          ],
        }
      }

      const tabList = allTabs.map((t, i) => `${i + 1}. ${t.title}\n   ${t.url}`).join('\n')

      return {
        content: [
          {
            type: 'text',
            text: `Extension mode - ${allTabs.length} tab(s) attached:\n${tabList}`,
          },
        ],
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `No browser connected yet. Will auto-launch Chrome when you use 'execute'.`,
          },
        ],
      }
    }
  },
)

async function checkRemoteServer({ host, port }: { host: string; port: number }): Promise<void> {
  const versionUrl = `http://${host}:${port}/version`
  try {
    const response = await fetch(versionUrl, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`)
    }
  } catch (error: any) {
    const isConnectionError = error.cause?.code === 'ECONNREFUSED' || error.name === 'TimeoutError'
    if (isConnectionError) {
      throw new Error(
        `Cannot connect to remote relay server at ${host}:${port}. ` +
          `Make sure 'npx -y browserwright serve' is running on the host machine.`,
      )
    }
    throw new Error(`Failed to connect to remote relay server: ${error.message}`)
  }
}

export interface StartMcpOptions {
  // Remote relay options
  host?: string
  token?: string
  // Launch mode options (like official Playwright MCP)
  launch?: boolean
  headless?: boolean
  userDataDir?: string
  isolated?: boolean
  cdpEndpoint?: string
  channel?: BrowserChannel
}

export async function startMcp(options: StartMcpOptions = {}) {
  if (options.host) {
    process.env.BROWSERWRIGHT_HOST = options.host
  }
  if (options.token) {
    process.env.BROWSERWRIGHT_TOKEN = options.token
  }

  // Check if we're in launch mode (explicit --launch flag or --cdp endpoint)
  const isLaunchMode = options.launch || options.cdpEndpoint

  if (isLaunchMode) {
    // Launch mode: spawn our own browser or connect to existing via CDP
    state.launchMode = true
    launchOptions = {
      headless: options.headless,
      userDataDir: options.userDataDir,
      isolated: options.isolated,
      cdpEndpoint: options.cdpEndpoint,
      channel: options.channel,
    }

    mcpLog('Browserwright MCP starting in launch mode')
    if (options.cdpEndpoint) {
      mcpLog(`Will connect to CDP endpoint: ${options.cdpEndpoint}`)
    } else if (options.isolated) {
      mcpLog('Will launch browser with isolated (temp) profile')
    } else {
      mcpLog('Will launch browser with persistent profile')
    }
  } else {
    // Extension mode: use relay server
    const remote = getRemoteConfig()
    if (!remote) {
      await ensureRelayServer()
    } else {
      mcpLog(`Using remote CDP relay server: ${remote.host}:${remote.port}`)
      await checkRemoteServer(remote)
    }
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)

  // In launch mode, close the browser when MCP disconnects
  if (isLaunchMode) {
    process.on('SIGINT', async () => {
      if (state.launchedBrowser) {
        await state.launchedBrowser.close()
      }
      process.exit(0)
    })
    process.on('SIGTERM', async () => {
      if (state.launchedBrowser) {
        await state.launchedBrowser.close()
      }
      process.exit(0)
    })
  }
}
