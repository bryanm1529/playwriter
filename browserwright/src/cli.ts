#!/usr/bin/env node

import { cac } from 'cac'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startBrowserwrightCDPRelayServer } from './cdp-relay.js'
import { EXTENSION_IDS } from './extension-ids.js'
import { createFileLogger } from './create-logger.js'
import { VERSION } from './utils.js'

const require = createRequire(import.meta.url)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const RELAY_PORT = 19988

const cli = cac('browserwright')

cli
  .command('', 'Start the MCP server (default)')
  .option('--host <host>', 'Remote relay server host to connect to (or use BROWSERWRIGHT_HOST env var)')
  .option('--token <token>', 'Authentication token (or use BROWSERWRIGHT_TOKEN env var)')
  .option('--launch', 'Launch a new browser instead of connecting to extension (like official Playwright MCP)')
  .option('--headless', 'Run browser in headless mode (only with --launch)')
  .option('--user-data-dir <dir>', 'Custom user data directory for persistent profile (only with --launch)')
  .option('--isolated', 'Run in isolated mode with temporary profile (only with --launch)')
  .option('--cdp <endpoint>', 'Connect to existing browser via CDP endpoint instead of launching')
  .option('--channel <channel>', 'Browser channel: chrome, chrome-beta, chrome-dev, msedge (only with --launch)', { default: 'chrome' })
  .action(async (options: {
    host?: string
    token?: string
    launch?: boolean
    headless?: boolean
    userDataDir?: string
    isolated?: boolean
    cdp?: string
    channel?: string
  }) => {
    const { startMcp } = await import('./mcp.js')
    await startMcp({
      host: options.host,
      token: options.token,
      launch: options.launch,
      headless: options.headless,
      userDataDir: options.userDataDir,
      isolated: options.isolated,
      cdpEndpoint: options.cdp,
      channel: options.channel as any,
    })
  })

cli
  .command('serve', 'Start the CDP relay server for remote MCP connections')
  .option('--host <host>', 'Host to bind to', { default: '0.0.0.0' })
  .option('--token <token>', 'Authentication token (or use BROWSERWRIGHT_TOKEN env var)')
  .action(async (options: { host: string; token?: string }) => {
    const token = options.token || process.env.BROWSERWRIGHT_TOKEN
    if (!token) {
      console.error('Error: Authentication token is required.')
      console.error('Provide --token <token> or set BROWSERWRIGHT_TOKEN environment variable.')
      process.exit(1)
    }

    const logger = createFileLogger()

    process.title = 'browserwright-serve'

    process.on('uncaughtException', async (err) => {
      await logger.error('Uncaught Exception:', err)
      process.exit(1)
    })

    process.on('unhandledRejection', async (reason) => {
      await logger.error('Unhandled Rejection:', reason)
      process.exit(1)
    })

    const server = await startBrowserwrightCDPRelayServer({
      port: RELAY_PORT,
      host: options.host,
      token,
      logger,
    })

    console.log('Browserwright CDP relay server started')
    console.log(`  Host: ${options.host}`)
    console.log(`  Port: ${RELAY_PORT}`)
    console.log(`  Token: (configured)`)
    console.log(`  Logs: ${logger.logFilePath}`)
    console.log('')
    console.log('Endpoints:')
    console.log(`  Extension: ws://${options.host}:${RELAY_PORT}/extension`)
    console.log(`  CDP:       ws://${options.host}:${RELAY_PORT}/cdp/<client-id>?token=<token>`)
    console.log('')
    console.log('Press Ctrl+C to stop.')

    process.on('SIGINT', () => {
      console.log('\nShutting down...')
      server.close()
      process.exit(0)
    })

    process.on('SIGTERM', () => {
      console.log('\nShutting down...')
      server.close()
      process.exit(0)
    })
  })

// Extension IDs imported from shared config (extension-ids.json)

cli
  .command('install-native-host', 'Install native messaging host for seamless tab creation')
  .option('--host-path <path>', 'Path to native host script (default: bundled with browserwright)')
  .action(async (options: { hostPath?: string }) => {
    const platform = process.platform

    // Resolve and verify host path
    let hostPath = options.hostPath
    if (hostPath) {
      // User provided path - verify it exists
      try {
        await fs.access(hostPath)
      } catch {
        console.error(`Error: Native host not found at: ${hostPath}`)
        process.exit(1)
      }
    } else {
      // Try to resolve via Node module resolution first (works when npm-installed)
      try {
        hostPath = require.resolve('browserwright-native-host')
      } catch {
        // Fall back to relative paths (works in dev / monorepo)
        const candidates = [
          path.resolve(__dirname, '..', '..', 'native-host', 'index.js'), // Dev: from dist/
          path.resolve(__dirname, '..', 'native-host', 'index.js'), // Alt location
        ]
        for (const candidate of candidates) {
          try {
            await fs.access(candidate)
            hostPath = candidate
            break
          } catch {
            // Try next candidate
          }
        }
      }
      if (!hostPath) {
        console.error('Error: Native host script not found.')
        console.error('Specify --host-path or run from the browserwright repository.')
        process.exit(1)
      }
    }

    // Create manifest with absolute path
    const manifest = {
      name: 'com.browserwright.native_host',
      description: 'Browserwright Native Messaging Host - enables seamless browser automation',
      path: path.resolve(hostPath),
      type: 'stdio',
      allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
    }

    // Determine installation directory based on platform
    let manifestDir: string
    if (platform === 'darwin') {
      manifestDir = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts')
    } else if (platform === 'linux') {
      manifestDir = path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts')
    } else if (platform === 'win32') {
      console.error('Windows installation requires manual registry setup.')
      console.error('See: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host-location')
      console.error('')
      console.error('Manifest to install:')
      console.log(JSON.stringify(manifest, null, 2))
      process.exit(1)
    } else {
      console.error(`Unsupported platform: ${platform}`)
      process.exit(1)
    }

    try {
      await fs.mkdir(manifestDir, { recursive: true })
      const manifestPath = path.join(manifestDir, 'com.browserwright.native_host.json')
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))

      console.log('✓ Native messaging host installed successfully!')
      console.log('')
      console.log(`  Manifest: ${manifestPath}`)
      console.log(`  Host: ${manifest.path}`)
      console.log('')
      console.log('Restart Chrome to enable seamless tab creation.')
      console.log('')
      console.log('With native messaging installed, Browserwright can:')
      console.log('  - Create new tabs automatically (no user gesture needed)')
      console.log('  - Get status updates from the extension')
      console.log('')
      console.log('For existing tabs, use:')
      console.log('  - Ctrl+Shift+P (Cmd+Shift+P on Mac) to attach current tab')
    } catch (error: any) {
      console.error(`Failed to install native host: ${error.message}`)
      process.exit(1)
    }
  })

cli.help()
cli.version(VERSION)

cli.parse()
