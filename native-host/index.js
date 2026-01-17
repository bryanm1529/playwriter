#!/usr/bin/env node
/**
 * Playwriter Native Messaging Host
 *
 * Bridges communication between the Playwriter extension and MCP/CLI.
 * Chrome starts this process when the extension calls chrome.runtime.connectNative().
 *
 * Protocol:
 * - Chrome sends: 4-byte length (LE uint32) + JSON message
 * - We respond: 4-byte length (LE uint32) + JSON message
 *
 * Additionally, we create a Unix socket for the MCP/Relay to connect to,
 * enabling bidirectional communication: MCP <-> Socket <-> This Host <-> Chrome
 */

const net = require('net')
const os = require('os')
const fs = require('fs')

// Socket path for MCP communication
const SOCKET_PATH = `/tmp/playwriter-native-host-${os.userInfo().username}`

// Clean up stale socket file
if (fs.existsSync(SOCKET_PATH)) {
  try {
    fs.unlinkSync(SOCKET_PATH)
  } catch (err) {
    // Log and continue - server.listen() will fail if socket truly in use
    console.error('Warning: Could not remove stale socket:', err.message)
  }
}

// State
let mcpSocket = null

// ============= Chrome Native Messaging Protocol =============

/**
 * Send message to Chrome extension via stdout
 */
function sendToChrome(message) {
  const json = JSON.stringify(message)
  const length = Buffer.alloc(4)
  length.writeUInt32LE(json.length, 0)
  process.stdout.write(length)
  process.stdout.write(json)
}

/**
 * Read messages from Chrome extension via stdin
 */
function startChromeListener() {
  let pendingLength = null
  let buffer = Buffer.alloc(0)

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])

    while (true) {
      // Need to read length first
      if (pendingLength === null) {
        if (buffer.length < 4) break
        pendingLength = buffer.readUInt32LE(0)
        buffer = buffer.slice(4)
      }

      // Now read the message
      if (buffer.length < pendingLength) break

      const messageBytes = buffer.slice(0, pendingLength)
      buffer = buffer.slice(pendingLength)
      pendingLength = null

      try {
        const message = JSON.parse(messageBytes.toString('utf8'))
        handleChromeMessage(message)
      } catch (e) {
        sendToChrome({ type: 'error', message: `Invalid JSON: ${e.message}` })
      }
    }
  })

  process.stdin.on('end', () => {
    // Chrome closed the connection, exit cleanly
    cleanup()
    process.exit(0)
  })
}

/**
 * Handle message received from Chrome extension
 */
function handleChromeMessage(message) {
  // Forward to MCP socket if connected
  if (mcpSocket && !mcpSocket.destroyed) {
    mcpSocket.write(JSON.stringify(message) + '\n')
  }

  // Echo back as acknowledgment
  sendToChrome({ type: 'ack', originalType: message.type })
}

// ============= MCP Unix Socket Server =============

/**
 * Create Unix socket server for MCP/CLI to connect
 */
function startMcpServer() {
  const server = net.createServer((socket) => {
    // Only allow one MCP connection at a time
    if (mcpSocket && !mcpSocket.destroyed) {
      socket.write(JSON.stringify({ type: 'error', message: 'Already connected' }) + '\n')
      socket.destroy()
      return
    }

    mcpSocket = socket
    sendToChrome({ type: 'mcpConnected' })

    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const message = JSON.parse(line)
          handleMcpMessage(message)
        } catch (e) {
          socket.write(JSON.stringify({ type: 'error', message: `Invalid JSON: ${e.message}` }) + '\n')
        }
      }
    })

    socket.on('close', () => {
      mcpSocket = null
      sendToChrome({ type: 'mcpDisconnected' })
    })

    socket.on('error', (err) => {
      console.error('MCP socket error:', err.message)
      mcpSocket = null
    })
  })

  server.listen(SOCKET_PATH, () => {
    // Set socket permissions to user-only (0600) for security
    fs.chmodSync(SOCKET_PATH, 0o600)
  })

  server.on('error', (err) => {
    console.error('Failed to start MCP server:', err.message)
    sendToChrome({ type: 'error', message: `MCP server failed: ${err.message}` })
  })

  return server
}

/**
 * Handle message received from MCP socket
 */
function handleMcpMessage(message) {
  // Forward to Chrome
  sendToChrome(message)
}

// ============= Lifecycle =============

let mcpServer = null

function cleanup() {
  if (mcpServer) {
    mcpServer.close()
  }
  if (mcpSocket) {
    mcpSocket.destroy()
  }
  if (fs.existsSync(SOCKET_PATH)) {
    try {
      fs.unlinkSync(SOCKET_PATH)
    } catch {
      // Ignore cleanup errors during shutdown
    }
  }
}

process.on('SIGINT', () => {
  cleanup()
  process.exit(0)
})

process.on('SIGTERM', () => {
  cleanup()
  process.exit(0)
})

// Start everything
mcpServer = startMcpServer()
startChromeListener()

// Notify Chrome we're ready
sendToChrome({ type: 'ready', socketPath: SOCKET_PATH })
