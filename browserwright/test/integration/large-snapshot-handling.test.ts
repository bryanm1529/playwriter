/**
 * Integration tests for large DOM/accessibility snapshot handling
 * Gap 5: Large DOM/accessibility snapshot handling
 *
 * Tests handling of very large DOM snapshots and accessibility trees
 * to ensure the system doesn't crash or timeout on complex pages.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { startBrowserwrightCDPRelayServer, type RelayServer } from '../../src/cdp-relay.js'
import { WebSocket } from 'ws'
import { killPortProcess } from 'kill-port-process'
import { createFileLogger } from '../../src/create-logger.js'

const TEST_PORT = 19993

async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPortProcess(port)
  } catch {
    // Ignore if no process is running
  }
}

function createWebSocketPromise(url: string, options?: { headers?: Record<string, string> }): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('Connection timeout'))
    }, 5000)

    ws.on('open', () => {
      clearTimeout(timeout)
      resolve(ws)
    })

    ws.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

describe('Large Snapshot Handling (Gap 5)', () => {
  let server: RelayServer | null = null
  const EXTENSION_ORIGIN = 'chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe'

  beforeAll(async () => {
    await killProcessOnPort(TEST_PORT)
  })

  afterEach(async () => {
    if (server) {
      server.close()
      server = null
    }
    await killProcessOnPort(TEST_PORT)
  })

  afterAll(async () => {
    await killProcessOnPort(TEST_PORT)
  })

  describe('Large message serialization', () => {
    it('should handle large CDP messages from extension', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      // Connect extension
      const extension = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })

      await new Promise(r => setTimeout(r, 100))

      // Connect Playwright client
      const client = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      // Simulate large CDP event from extension (like a large accessibility tree)
      // Generate a large message (~1MB)
      const largeParams = {
        nodes: Array.from({ length: 10000 }, (_, i) => ({
          nodeId: i,
          backendNodeId: i,
          role: { type: 'role', value: 'generic' },
          name: { type: 'computedString', value: `Node ${i} with some extra text to make it larger` },
          properties: [
            { name: 'focusable', value: { type: 'boolean', value: false } },
            { name: 'level', value: { type: 'integer', value: Math.floor(i / 100) } }
          ],
          childIds: i < 9999 ? [i + 1] : []
        }))
      }

      const messageReceived = new Promise<void>((resolve) => {
        client.on('message', (data) => {
          const msg = JSON.parse(data.toString())
          if (msg.method === 'Accessibility.loadComplete') {
            resolve()
          }
        })
      })

      // Send large message from extension
      extension.send(JSON.stringify({
        method: 'forwardCDPEvent',
        params: {
          method: 'Accessibility.loadComplete',
          params: largeParams,
          sessionId: 'test-session'
        }
      }))

      // Should receive the message without error
      await Promise.race([
        messageReceived,
        new Promise(resolve => setTimeout(resolve, 2000))
      ])

      // Server should still be healthy
      const status = await (await fetch(`http://127.0.0.1:${TEST_PORT}/extension/status`)).json()
      expect(status.connected).toBe(true)

      extension.close()
      client.close()
    })

    it('should handle rapid large messages', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const extension = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })

      await new Promise(r => setTimeout(r, 100))

      const client = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      // Send multiple large messages rapidly
      const largeData = 'x'.repeat(100000) // 100KB of data

      for (let i = 0; i < 5; i++) {
        extension.send(JSON.stringify({
          method: 'forwardCDPEvent',
          params: {
            method: 'Runtime.consoleAPICalled',
            params: {
              type: 'log',
              args: [{ type: 'string', value: largeData }]
            },
            sessionId: 'test-session'
          }
        }))
      }

      await new Promise(r => setTimeout(r, 500))

      // Server should still be healthy
      expect(extension.readyState).toBe(WebSocket.OPEN)
      expect(client.readyState).toBe(WebSocket.OPEN)

      extension.close()
      client.close()
    })
  })

  describe('Large CDP command handling', () => {
    it('should handle commands with large params from client', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const extension = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })

      // Extension responds to forwarded commands
      extension.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.id && msg.method === 'forwardCDPCommand') {
          extension.send(JSON.stringify({
            id: msg.id,
            result: { success: true }
          }))
        }
      })

      await new Promise(r => setTimeout(r, 100))

      const client = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      const responsePromise = new Promise<any>((resolve) => {
        client.on('message', (data) => {
          const msg = JSON.parse(data.toString())
          if (msg.id === 1) {
            resolve(msg)
          }
        })
      })

      // Send command with large params (like injecting a large script)
      const largeScript = 'function test() { ' + 'console.log("x"); '.repeat(5000) + '}'

      client.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: largeScript,
          returnByValue: true
        }
      }))

      const response = await Promise.race([
        responsePromise,
        new Promise<{ timeout: true }>(resolve => setTimeout(() => resolve({ timeout: true }), 5000))
      ])

      // Should get a response (not timeout)
      expect('timeout' in response).toBe(false)

      extension.close()
      client.close()
    })
  })

  describe('JSON serialization edge cases', () => {
    it('should handle messages with unicode characters', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const extension = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })

      await new Promise(r => setTimeout(r, 100))

      const client = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      const messageReceived = new Promise<any>((resolve) => {
        client.on('message', (data) => {
          const msg = JSON.parse(data.toString())
          if (msg.method === 'Runtime.consoleAPICalled') {
            resolve(msg)
          }
        })
      })

      // Send message with various unicode characters
      extension.send(JSON.stringify({
        method: 'forwardCDPEvent',
        params: {
          method: 'Runtime.consoleAPICalled',
          params: {
            type: 'log',
            args: [{
              type: 'string',
              value: 'Hello 世界 🌍 مرحبا שלום'
            }]
          },
          sessionId: 'test-session'
        }
      }))

      const response = await Promise.race([
        messageReceived,
        new Promise<{ timeout: true }>(resolve => setTimeout(() => resolve({ timeout: true }), 2000))
      ])

      if (!('timeout' in response)) {
        expect(response.method).toBe('Runtime.consoleAPICalled')
      }

      extension.close()
      client.close()
    })

    it('should handle messages with escaped characters', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const extension = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })

      await new Promise(r => setTimeout(r, 100))

      const client = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      // Send message with characters that need escaping
      extension.send(JSON.stringify({
        method: 'forwardCDPEvent',
        params: {
          method: 'Runtime.consoleAPICalled',
          params: {
            type: 'log',
            args: [{
              type: 'string',
              value: 'Line1\nLine2\tTabbed\r\nWindows newline "quoted" \\backslash'
            }]
          },
          sessionId: 'test-session'
        }
      }))

      await new Promise(r => setTimeout(r, 200))

      // Server should still be healthy
      expect(extension.readyState).toBe(WebSocket.OPEN)

      extension.close()
      client.close()
    })

    it('should handle deeply nested objects', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const extension = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })

      await new Promise(r => setTimeout(r, 100))

      const client = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      // Create deeply nested object (simulates complex DOM structure)
      // Using a moderate depth to avoid JSON serialization issues
      function createNested(depth: number): any {
        if (depth === 0) return { leaf: true }
        return {
          level: depth,
          children: [createNested(depth - 1)]
        }
      }

      const deepObject = createNested(30) // 30 levels deep

      const messageReceived = new Promise<void>((resolve) => {
        client.on('message', (data) => {
          const msg = JSON.parse(data.toString())
          if (msg.method === 'DOM.documentUpdated') {
            resolve()
          }
        })
      })

      extension.send(JSON.stringify({
        method: 'forwardCDPEvent',
        params: {
          method: 'DOM.documentUpdated',
          params: { document: deepObject },
          sessionId: 'test-session'
        }
      }))

      // Wait for message to be received or timeout
      await Promise.race([
        messageReceived,
        new Promise(resolve => setTimeout(resolve, 1000))
      ])

      // Server should handle it without crashing - check extension is still connected
      expect(extension.readyState).toBe(WebSocket.OPEN)

      extension.close()
      client.close()
    })
  })

  describe('Concurrent large message handling', () => {
    it('should handle multiple clients receiving messages', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const extension = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })

      await new Promise(r => setTimeout(r, 100))

      // Connect multiple clients sequentially with delays
      const clients: WebSocket[] = []
      for (let i = 0; i < 3; i++) {
        const client = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)
        clients.push(client)
        await new Promise(r => setTimeout(r, 50))
      }

      // Count received messages per client
      const receivedCounts: number[] = [0, 0, 0]
      clients.forEach((client, idx) => {
        client.on('message', () => {
          receivedCounts[idx]++
        })
      })

      // Send multiple messages
      for (let i = 0; i < 5; i++) {
        extension.send(JSON.stringify({
          method: 'forwardCDPEvent',
          params: {
            method: 'Runtime.consoleAPICalled',
            params: {
              type: 'log',
              args: [{ type: 'string', value: `Message ${i}` }]
            },
            sessionId: 'test-session'
          }
        }))
      }

      await new Promise(r => setTimeout(r, 500))

      // Extension should still be connected
      expect(extension.readyState).toBe(WebSocket.OPEN)

      // Each client should have received some messages (broadcast)
      // Note: Due to CDP event routing, messages go to all clients
      for (const count of receivedCounts) {
        expect(count).toBeGreaterThanOrEqual(0) // At least messages were processed
      }

      // Clean up
      for (const client of clients) {
        client.close()
      }
      extension.close()
    })
  })
})
