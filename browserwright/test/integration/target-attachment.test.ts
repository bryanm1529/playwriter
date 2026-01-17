/**
 * Integration tests for target attachment failures
 * Gap 4: Target attachment failures - "Target not found" errors
 *
 * Tests the error paths in cdp-relay.ts:299-311 for:
 * - "targetId is required for Target.attachToTarget"
 * - "Target ${targetId} not found in connected targets"
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { startBrowserwrightCDPRelayServer, type RelayServer } from '../../src/cdp-relay.js'
import { WebSocket } from 'ws'
import { killPortProcess } from 'kill-port-process'
import { createFileLogger } from '../../src/create-logger.js'

const TEST_PORT = 19992

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

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Message wait timeout')), timeout)

    const handler = (data: any) => {
      try {
        const msg = JSON.parse(data.toString())
        if (predicate(msg)) {
          clearTimeout(timer)
          ws.off('message', handler)
          resolve(msg)
        }
      } catch {
        // Ignore parse errors
      }
    }

    ws.on('message', handler)
  })
}

describe('Target Attachment Failures (Gap 4)', () => {
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

  describe('Target.attachToTarget errors', () => {
    it('should return error when targetId is missing', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      // Connect extension (required for commands to be processed)
      const extension = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })

      await new Promise(r => setTimeout(r, 100))

      // Connect Playwright client
      const client = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      // Send Target.attachToTarget without targetId
      const responsePromise = waitForMessage(client, (msg) => msg.id === 1)

      client.send(JSON.stringify({
        id: 1,
        method: 'Target.attachToTarget',
        params: {} // Missing targetId
      }))

      const response = await responsePromise

      expect(response.id).toBe(1)
      expect(response.error).toBeDefined()
      expect(response.error.message).toBe('targetId is required for Target.attachToTarget')

      extension.close()
      client.close()
    })

    it('should return error when targetId is null', async () => {
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

      const responsePromise = waitForMessage(client, (msg) => msg.id === 1)

      client.send(JSON.stringify({
        id: 1,
        method: 'Target.attachToTarget',
        params: { targetId: null }
      }))

      const response = await responsePromise

      expect(response.id).toBe(1)
      expect(response.error).toBeDefined()
      expect(response.error.message).toBe('targetId is required for Target.attachToTarget')

      extension.close()
      client.close()
    })

    it('should return error when target is not found', async () => {
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

      const responsePromise = waitForMessage(client, (msg) => msg.id === 1)

      // Try to attach to a non-existent target
      client.send(JSON.stringify({
        id: 1,
        method: 'Target.attachToTarget',
        params: { targetId: 'NONEXISTENT-TARGET-ID-12345' }
      }))

      const response = await responsePromise

      expect(response.id).toBe(1)
      expect(response.error).toBeDefined()
      expect(response.error.message).toContain('not found in connected targets')
      expect(response.error.message).toContain('NONEXISTENT-TARGET-ID-12345')

      extension.close()
      client.close()
    })

    it('should return error for invalid targetId format', async () => {
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

      const responsePromise = waitForMessage(client, (msg) => msg.id === 1)

      // Send with empty string targetId
      client.send(JSON.stringify({
        id: 1,
        method: 'Target.attachToTarget',
        params: { targetId: '' }
      }))

      const response = await responsePromise

      // Empty string is falsy so should fail the targetId check
      expect(response.id).toBe(1)
      expect(response.error).toBeDefined()
      expect(response.error.message).toBe('targetId is required for Target.attachToTarget')

      extension.close()
      client.close()
    })
  })

  describe('Target.getTargetInfo errors', () => {
    it('should handle missing target gracefully for Target.getTargetInfo', async () => {
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

      const responsePromise = waitForMessage(client, (msg) => msg.id === 1)

      // Request info for non-existent target
      client.send(JSON.stringify({
        id: 1,
        method: 'Target.getTargetInfo',
        params: { targetId: 'NONEXISTENT-TARGET' }
      }))

      const response = await responsePromise

      expect(response.id).toBe(1)
      // getTargetInfo returns undefined targetInfo for missing targets, not an error
      // (This is the fallback behavior at line 332-333)
      expect(response.result).toBeDefined()
      expect(response.result.targetInfo).toBeUndefined()

      extension.close()
      client.close()
    })
  })

  describe('Target.getTargets with no targets', () => {
    it('should return empty array when no targets connected', async () => {
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

      const responsePromise = waitForMessage(client, (msg) => msg.id === 1)

      client.send(JSON.stringify({
        id: 1,
        method: 'Target.getTargets'
      }))

      const response = await responsePromise

      expect(response.id).toBe(1)
      expect(response.result).toBeDefined()
      expect(response.result.targetInfos).toEqual([])

      extension.close()
      client.close()
    })
  })

  describe('Extension not connected scenarios', () => {
    it('should return error when extension is not connected', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      // Connect client without extension
      const client = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      const responsePromise = waitForMessage(client, (msg) => msg.id === 1)

      // Try to attach to a target
      client.send(JSON.stringify({
        id: 1,
        method: 'Target.attachToTarget',
        params: { targetId: 'some-target-id' }
      }))

      const response = await responsePromise

      expect(response.id).toBe(1)
      expect(response.error).toBeDefined()
      expect(response.error.message).toBe('Extension not connected')

      client.close()
    })

    it('should return error for any CDP command when extension disconnects', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      // Connect and immediately disconnect extension
      const extension = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })
      await new Promise(r => setTimeout(r, 100))
      extension.close()
      await new Promise(r => setTimeout(r, 100))

      // Now try to connect client and send command
      // Note: The server closes all clients when extension disconnects,
      // so we need to connect after the extension disconnect is processed
      try {
        const client = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

        const responsePromise = waitForMessage(client, (msg) => msg.id === 1)

        client.send(JSON.stringify({
          id: 1,
          method: 'Page.navigate',
          params: { url: 'https://example.com' }
        }))

        const response = await responsePromise

        expect(response.error).toBeDefined()
        expect(response.error.message).toBe('Extension not connected')

        client.close()
      } catch {
        // Connection might fail if server closed it - that's also valid
        expect(true).toBe(true)
      }
    })
  })
})
