import { startBrowserwrightCDPRelayServer } from '../src/cdp-relay.js'

async function main() {
  const server = await startBrowserwrightCDPRelayServer({ port: 19988 })

  console.log('Server running. Press Ctrl+C to stop.')

}

main().catch(console.error)
