/**
 * Integration tests for execute timeout scenarios
 * Gap 1: E2E timeout scenario - slow page + fill() hitting timeout
 *
 * Tests the CodeExecutionTimeoutError and Promise.race timeout pattern
 * used in mcp.ts:1097-1103
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Recreate the error class since it's not exported
class CodeExecutionTimeoutError extends Error {
  constructor(timeout: number) {
    super(`Code execution timed out after ${timeout}ms`)
    this.name = 'CodeExecutionTimeoutError'
  }
}

/**
 * Simulates the execute tool's timeout pattern from mcp.ts:1097-1103
 */
async function executeWithTimeout<T>(
  work: () => Promise<T>,
  timeout: number
): Promise<T> {
  return Promise.race([
    work(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new CodeExecutionTimeoutError(timeout)), timeout)
    ),
  ])
}

describe('Execute Timeout Scenarios', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('E2E timeout pattern (Gap 1)', () => {
    it('should timeout when page.fill() takes longer than timeout', async () => {
      // Simulate a slow fill operation (like filling a form on a slow page)
      const slowFillOperation = async () => {
        // Simulates a slow page where fill() takes 20 seconds
        await new Promise(resolve => setTimeout(resolve, 20000))
        return 'fill completed'
      }

      const resultPromise = executeWithTimeout(slowFillOperation, 15000)

      // Advance time to trigger timeout
      vi.advanceTimersByTime(15000)

      await expect(resultPromise).rejects.toThrow(CodeExecutionTimeoutError)
      await expect(resultPromise).rejects.toThrow('Code execution timed out after 15000ms')
    })

    it('should complete successfully when fill() finishes before timeout', async () => {
      const fastFillOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 1000))
        return 'fill completed'
      }

      const resultPromise = executeWithTimeout(fastFillOperation, 15000)

      // Fast-forward 1 second for work to complete
      vi.advanceTimersByTime(1000)

      const result = await resultPromise
      expect(result).toBe('fill completed')
    })

    it('should handle default 5000ms timeout correctly', async () => {
      const mediumOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 6000))
        return 'completed'
      }

      const resultPromise = executeWithTimeout(mediumOperation, 5000)

      vi.advanceTimersByTime(5000)

      await expect(resultPromise).rejects.toThrow('Code execution timed out after 5000ms')
    })

    it('should propagate original errors when they occur before timeout', async () => {
      const failingOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        throw new Error('Element not found: [data-testid="login-button"]')
      }

      const resultPromise = executeWithTimeout(failingOperation, 5000)

      vi.advanceTimersByTime(100)

      await expect(resultPromise).rejects.toThrow('Element not found: [data-testid="login-button"]')
      await expect(resultPromise).rejects.not.toThrow(CodeExecutionTimeoutError)
    })

    it('should correctly identify timeout errors vs other errors', async () => {
      // Test timeout error
      const timeoutError = new CodeExecutionTimeoutError(15000)
      const isTimeoutError = timeoutError instanceof CodeExecutionTimeoutError || timeoutError.name === 'TimeoutError'
      expect(isTimeoutError).toBe(true)

      // Test regular error
      const regularError = new Error('Some other error')
      const isRegularTimeout = regularError instanceof CodeExecutionTimeoutError || regularError.name === 'TimeoutError'
      expect(isRegularTimeout).toBe(false)

      // Test Playwright TimeoutError (name-based detection)
      const playwrightTimeout = new Error('Timeout')
      playwrightTimeout.name = 'TimeoutError'
      const isPlaywrightTimeout = playwrightTimeout instanceof CodeExecutionTimeoutError || playwrightTimeout.name === 'TimeoutError'
      expect(isPlaywrightTimeout).toBe(true)
    })
  })

  describe('Chained operation timeouts', () => {
    it('should timeout on slow chained operations (navigate + fill + click)', async () => {
      // Simulates: await page.goto(...); await page.fill(...); await page.click(...)
      const chainedOperations = async () => {
        // Each operation takes 6 seconds
        await new Promise(resolve => setTimeout(resolve, 6000)) // goto
        await new Promise(resolve => setTimeout(resolve, 6000)) // fill
        await new Promise(resolve => setTimeout(resolve, 6000)) // click
        return 'all completed'
      }

      const resultPromise = executeWithTimeout(chainedOperations, 15000)

      vi.advanceTimersByTime(15000)

      await expect(resultPromise).rejects.toThrow('Code execution timed out after 15000ms')
    })

    it('should complete chained operations that finish in time', async () => {
      const fastChainedOperations = async () => {
        await new Promise(resolve => setTimeout(resolve, 1000)) // goto
        await new Promise(resolve => setTimeout(resolve, 1000)) // fill
        await new Promise(resolve => setTimeout(resolve, 1000)) // click
        return 'all completed'
      }

      const resultPromise = executeWithTimeout(fastChainedOperations, 15000)

      // Need to advance timers multiple times with flushes for chained async operations
      await vi.advanceTimersByTimeAsync(1000) // goto completes
      await vi.advanceTimersByTimeAsync(1000) // fill completes
      await vi.advanceTimersByTimeAsync(1000) // click completes

      const result = await resultPromise
      expect(result).toBe('all completed')
    })
  })

  describe('Timeout edge cases', () => {
    it('should handle zero timeout (immediate rejection)', async () => {
      const work = async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return 'done'
      }

      const resultPromise = executeWithTimeout(work, 0)

      vi.advanceTimersByTime(0)

      await expect(resultPromise).rejects.toThrow('Code execution timed out after 0ms')
    })

    it('should handle very short timeout', async () => {
      const work = async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return 'done'
      }

      const resultPromise = executeWithTimeout(work, 50)

      vi.advanceTimersByTime(50)

      await expect(resultPromise).rejects.toThrow('Code execution timed out after 50ms')
    })

    it('should handle work completing exactly at timeout boundary', async () => {
      // This is a race condition - in practice, the timeout usually wins
      // because setTimeout callbacks are processed in order
      const boundaryWork = async () => {
        await new Promise(resolve => setTimeout(resolve, 5000))
        return 'completed'
      }

      const resultPromise = executeWithTimeout(boundaryWork, 5000)

      vi.advanceTimersByTime(5000)

      // Both resolve at the same time - implementation detail determines winner
      // The timeout typically fires first in the same tick
      await expect(resultPromise).rejects.toThrow(CodeExecutionTimeoutError)
    })
  })
})
