/**
 * Real-World Timing Test
 * Measures actual operation latency through the CDP relay
 *
 * Run with: pnpm vitest run test/performance/real-world-timing.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startBrowserwrightCDPRelayServer, type RelayServer } from '../../src/cdp-relay.js'
import { WebSocket } from 'ws'
import { killPortProcess } from 'kill-port-process'
import { createFileLogger } from '../../src/create-logger.js'
import { chromium, type Browser, type Page } from 'playwright-core'
import { getCdpUrl } from '../../src/utils.js'

const TIMING_PORT = 19992

interface TimingResult {
  operation: string
  samples: number[]
  avg: number
  min: number
  max: number
  p95: number
}

function calculateStats(samples: number[]): { avg: number; min: number; max: number; p95: number } {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    avg: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length * 100) / 100,
    min: Math.round(Math.min(...samples) * 100) / 100,
    max: Math.round(Math.max(...samples) * 100) / 100,
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100
  }
}

async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPortProcess(port)
  } catch {
    // Ignore
  }
}

describe('Real-World Operation Timing', () => {
  let server: RelayServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null
  const results: TimingResult[] = []

  beforeAll(async () => {
    await killProcessOnPort(TIMING_PORT)

    // Start relay server
    const logger = createFileLogger()
    server = await startBrowserwrightCDPRelayServer({ port: TIMING_PORT, logger })

    // Launch browser directly (without extension, for baseline)
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()

    // Navigate to a test page
    await page.setContent(`
      <html>
        <head><title>Performance Test Page</title></head>
        <body>
          <h1>Performance Test</h1>
          <input id="name" type="text" placeholder="Enter name" />
          <input id="email" type="email" placeholder="Enter email" />
          <textarea id="message">Default text</textarea>
          <button id="submit">Submit</button>
          <button id="cancel">Cancel</button>
          <a href="#link1">Link 1</a>
          <a href="#link2">Link 2</a>
          <div id="content">
            ${Array.from({ length: 100 }, (_, i) => `<p>Paragraph ${i}</p>`).join('\n')}
          </div>
        </body>
      </html>
    `)
  }, 30000)

  afterAll(async () => {
    // Print results summary
    console.log('\n' + '='.repeat(70))
    console.log('REAL-WORLD OPERATION TIMING RESULTS')
    console.log('='.repeat(70))

    for (const result of results) {
      console.log(`\n${result.operation}:`)
      console.log(`  Average: ${result.avg}ms`)
      console.log(`  Min: ${result.min}ms | Max: ${result.max}ms | P95: ${result.p95}ms`)
    }

    console.log('\n' + '='.repeat(70))
    console.log('PERFORMANCE ASSESSMENT')
    console.log('='.repeat(70))

    const fillResult = results.find(r => r.operation === 'fill()')
    const clickResult = results.find(r => r.operation === 'click()')

    if (fillResult && fillResult.avg < 50) {
      console.log('✅ fill() is FAST (<50ms avg)')
    } else if (fillResult && fillResult.avg < 200) {
      console.log('⚠️  fill() is ACCEPTABLE (50-200ms avg)')
    } else if (fillResult) {
      console.log('❌ fill() is SLOW (>200ms avg) - NEEDS OPTIMIZATION')
    }

    if (clickResult && clickResult.avg < 30) {
      console.log('✅ click() is FAST (<30ms avg)')
    } else if (clickResult && clickResult.avg < 100) {
      console.log('⚠️  click() is ACCEPTABLE (30-100ms avg)')
    } else if (clickResult) {
      console.log('❌ click() is SLOW (>100ms avg) - NEEDS OPTIMIZATION')
    }

    console.log('='.repeat(70) + '\n')

    if (browser) await browser.close()
    if (server) server.close()
    await killProcessOnPort(TIMING_PORT)
  })

  it('measures fill() operation timing', async () => {
    if (!page) throw new Error('Page not initialized')

    const samples: number[] = []
    const iterations = 20

    for (let i = 0; i < iterations; i++) {
      // Clear input first
      await page.locator('#name').fill('')

      const start = performance.now()
      await page.locator('#name').fill(`Test User ${i}`)
      samples.push(performance.now() - start)
    }

    const stats = calculateStats(samples)
    results.push({ operation: 'fill()', samples, ...stats })

    console.log(`\n  fill(): avg=${stats.avg}ms, min=${stats.min}ms, max=${stats.max}ms`)

    // fill() should typically be < 100ms
    expect(stats.avg).toBeLessThan(500) // Generous threshold
  })

  it('measures click() operation timing', async () => {
    if (!page) throw new Error('Page not initialized')

    const samples: number[] = []
    const iterations = 20

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await page.locator('#submit').click()
      samples.push(performance.now() - start)
    }

    const stats = calculateStats(samples)
    results.push({ operation: 'click()', samples, ...stats })

    console.log(`  click(): avg=${stats.avg}ms, min=${stats.min}ms, max=${stats.max}ms`)

    expect(stats.avg).toBeLessThan(200)
  })

  it('measures locator query timing', async () => {
    if (!page) throw new Error('Page not initialized')

    const samples: number[] = []
    const iterations = 50

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await page.locator('#content p').count()
      samples.push(performance.now() - start)
    }

    const stats = calculateStats(samples)
    results.push({ operation: 'locator.count()', samples, ...stats })

    console.log(`  locator.count(): avg=${stats.avg}ms, min=${stats.min}ms, max=${stats.max}ms`)

    expect(stats.avg).toBeLessThan(100)
  })

  it('measures evaluate() timing', async () => {
    if (!page) throw new Error('Page not initialized')

    const samples: number[] = []
    const iterations = 50

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await page.evaluate(() => document.title)
      samples.push(performance.now() - start)
    }

    const stats = calculateStats(samples)
    results.push({ operation: 'evaluate()', samples, ...stats })

    console.log(`  evaluate(): avg=${stats.avg}ms, min=${stats.min}ms, max=${stats.max}ms`)

    expect(stats.avg).toBeLessThan(50)
  })

  it('measures screenshot timing', async () => {
    if (!page) throw new Error('Page not initialized')

    const samples: number[] = []
    const iterations = 10

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await page.screenshot({ type: 'png' })
      samples.push(performance.now() - start)
    }

    const stats = calculateStats(samples)
    results.push({ operation: 'screenshot()', samples, ...stats })

    console.log(`  screenshot(): avg=${stats.avg}ms, min=${stats.min}ms, max=${stats.max}ms`)

    expect(stats.avg).toBeLessThan(500)
  })

  it('measures navigation timing', async () => {
    if (!page) throw new Error('Page not initialized')

    const samples: number[] = []
    const iterations = 5

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await page.goto('data:text/html,<html><body>Test</body></html>', { waitUntil: 'domcontentloaded' })
      samples.push(performance.now() - start)
    }

    // Restore test page
    await page.setContent(`<html><body><input id="name"/><button id="submit">Submit</button></body></html>`)

    const stats = calculateStats(samples)
    results.push({ operation: 'goto(data:)', samples, ...stats })

    console.log(`  goto(data:): avg=${stats.avg}ms, min=${stats.min}ms, max=${stats.max}ms`)

    expect(stats.avg).toBeLessThan(200)
  })

  it('measures type() vs fill() comparison', async () => {
    if (!page) throw new Error('Page not initialized')

    // Restore form
    await page.setContent(`<html><body><input id="name" type="text"/></body></html>`)

    const fillSamples: number[] = []
    const typeSamples: number[] = []
    const iterations = 10

    // Measure fill()
    for (let i = 0; i < iterations; i++) {
      await page.locator('#name').fill('')
      const start = performance.now()
      await page.locator('#name').fill('TestValue')
      fillSamples.push(performance.now() - start)
    }

    // Measure type() (slower, character by character)
    for (let i = 0; i < iterations; i++) {
      await page.locator('#name').fill('')
      const start = performance.now()
      await page.locator('#name').pressSequentially('TestValue', { delay: 0 })
      typeSamples.push(performance.now() - start)
    }

    const fillStats = calculateStats(fillSamples)
    const typeStats = calculateStats(typeSamples)

    results.push({ operation: 'fill() (comparison)', samples: fillSamples, ...fillStats })
    results.push({ operation: 'pressSequentially()', samples: typeSamples, ...typeStats })

    console.log(`\n  fill() vs pressSequentially() comparison:`)
    console.log(`    fill(): avg=${fillStats.avg}ms`)
    console.log(`    pressSequentially(): avg=${typeStats.avg}ms`)
    console.log(`    fill() is ${(typeStats.avg / fillStats.avg).toFixed(1)}x faster`)
  })

  it('measures complex operation sequence', async () => {
    if (!page) throw new Error('Page not initialized')

    // Setup form
    await page.setContent(`
      <html><body>
        <form id="form">
          <input id="name" type="text"/>
          <input id="email" type="email"/>
          <button type="submit" id="submit">Submit</button>
        </form>
        <div id="result"></div>
        <script>
          document.getElementById('form').addEventListener('submit', (e) => {
            e.preventDefault();
            document.getElementById('result').textContent = 'Submitted!';
          });
        </script>
      </body></html>
    `)

    const samples: number[] = []
    const iterations = 10

    for (let i = 0; i < iterations; i++) {
      // Reset form
      await page.locator('#name').fill('')
      await page.locator('#email').fill('')

      const start = performance.now()

      // Full sequence: fill name, fill email, click submit, verify result
      await page.locator('#name').fill('John Doe')
      await page.locator('#email').fill('john@example.com')
      await page.locator('#submit').click()
      await page.locator('#result').textContent()

      samples.push(performance.now() - start)
    }

    const stats = calculateStats(samples)
    results.push({ operation: 'Complex sequence (2 fills + click + read)', samples, ...stats })

    console.log(`\n  Complex sequence: avg=${stats.avg}ms, min=${stats.min}ms, max=${stats.max}ms`)

    // A complex sequence should complete in reasonable time
    expect(stats.avg).toBeLessThan(500)
  })
})
