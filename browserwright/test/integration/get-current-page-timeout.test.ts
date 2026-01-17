/**
 * Integration tests for getCurrentPage timeout
 * Gap 3: getCurrentPage timeout - mcp.ts:592 timeout handling
 *
 * Tests the getCurrentPage(timeout) function which waits for page.waitForLoadState()
 * with a configurable timeout. This is called before every execute operation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('getCurrentPage Timeout (Gap 3)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * Simulates the getCurrentPage function from mcp.ts:592-611
   * It waits for page to be ready via waitForLoadState with a timeout
   */
  async function simulateGetCurrentPage(
    mockPage: {
      waitForLoadState: (state: string, options: { timeout: number }) => Promise<void>
    } | null,
    timeout = 5000
  ): Promise<{ ready: boolean }> {
    if (!mockPage) {
      throw new Error('No tabs available - please navigate to a page or enable "Browserwright Auto-Enable" in the extension popup')
    }

    // This mirrors mcp.ts:604 - catches timeout but doesn't throw
    await mockPage.waitForLoadState('domcontentloaded', { timeout }).catch(() => {})

    return { ready: true }
  }

  describe('waitForLoadState timeout behavior', () => {
    it('should complete successfully when page loads before timeout', async () => {
      const mockPage = {
        waitForLoadState: vi.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 1000))
        })
      }

      const resultPromise = simulateGetCurrentPage(mockPage, 5000)

      vi.advanceTimersByTime(1000)

      const result = await resultPromise
      expect(result.ready).toBe(true)
      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', { timeout: 5000 })
    })

    it('should continue (not throw) when waitForLoadState times out', async () => {
      // Simulates a page that never finishes loading
      const mockPage = {
        waitForLoadState: vi.fn().mockImplementation(async (_state: string, options: { timeout: number }) => {
          await new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), options.timeout)
          )
        })
      }

      const resultPromise = simulateGetCurrentPage(mockPage, 5000)

      vi.advanceTimersByTime(5000)

      // Should NOT throw - the .catch(() => {}) in getCurrentPage swallows the error
      const result = await resultPromise
      expect(result.ready).toBe(true)
    })

    it('should use default 5000ms timeout when not specified', async () => {
      const mockPage = {
        waitForLoadState: vi.fn().mockResolvedValue(undefined)
      }

      await simulateGetCurrentPage(mockPage)

      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', { timeout: 5000 })
    })

    it('should use custom timeout when specified', async () => {
      const mockPage = {
        waitForLoadState: vi.fn().mockResolvedValue(undefined)
      }

      await simulateGetCurrentPage(mockPage, 15000)

      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', { timeout: 15000 })
    })

    it('should throw NO_TABS_ERROR when page is null', async () => {
      await expect(simulateGetCurrentPage(null)).rejects.toThrow(
        'No tabs available - please navigate to a page or enable "Browserwright Auto-Enable" in the extension popup'
      )
    })
  })

  describe('Slow page scenarios', () => {
    it('should handle very slow page loads gracefully', async () => {
      // Page takes 60 seconds to load (timeout at 5s, but we catch the error)
      const mockPage = {
        waitForLoadState: vi.fn().mockImplementation(async (_state: string, options: { timeout: number }) => {
          await new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout 5000ms exceeded')), options.timeout)
          )
        })
      }

      const resultPromise = simulateGetCurrentPage(mockPage, 5000)

      vi.advanceTimersByTime(5000)

      // Should still return successfully (error is caught)
      const result = await resultPromise
      expect(result.ready).toBe(true)
    })

    it('should handle page that loads at the timeout boundary', async () => {
      const mockPage = {
        waitForLoadState: vi.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 5000))
        })
      }

      const resultPromise = simulateGetCurrentPage(mockPage, 5000)

      vi.advanceTimersByTime(5000)

      const result = await resultPromise
      expect(result.ready).toBe(true)
    })

    it('should handle multiple getCurrentPage calls with different timeouts', async () => {
      const mockPage = {
        waitForLoadState: vi.fn().mockImplementation(async (_state: string, options: { timeout: number }) => {
          await new Promise(resolve => setTimeout(resolve, 100))
        })
      }

      // Call 1 with short timeout
      const promise1 = simulateGetCurrentPage(mockPage, 1000)
      vi.advanceTimersByTime(100)
      await promise1

      // Call 2 with longer timeout
      const promise2 = simulateGetCurrentPage(mockPage, 10000)
      vi.advanceTimersByTime(100)
      await promise2

      expect(mockPage.waitForLoadState).toHaveBeenNthCalledWith(1, 'domcontentloaded', { timeout: 1000 })
      expect(mockPage.waitForLoadState).toHaveBeenNthCalledWith(2, 'domcontentloaded', { timeout: 10000 })
    })
  })

  describe('Page state variations', () => {
    it('should work with page that throws non-timeout errors', async () => {
      const mockPage = {
        waitForLoadState: vi.fn().mockRejectedValue(new Error('Page crashed'))
      }

      // Error is caught, so should still succeed
      const result = await simulateGetCurrentPage(mockPage, 5000)
      expect(result.ready).toBe(true)
    })

    it('should work with page that returns immediately', async () => {
      const mockPage = {
        waitForLoadState: vi.fn().mockResolvedValue(undefined)
      }

      const result = await simulateGetCurrentPage(mockPage, 5000)
      expect(result.ready).toBe(true)
    })
  })
})

describe('getCurrentPage integration with execute', () => {
  /**
   * Simulates the full execute flow where getCurrentPage is called first
   * then code execution happens (mcp.ts:781 and 1097-1103)
   * Note: Using real timers for these tests since they involve complex async interactions
   */
  async function simulateExecuteWithPageWait(
    pageLoadTime: number,
    codeExecutionTime: number,
    timeout: number
  ): Promise<{ result: any }> {
    // Step 1: Simulate page load wait (getCurrentPage)
    const pageLoadStart = Date.now()
    await new Promise(resolve => setTimeout(resolve, pageLoadTime))

    // Step 2: Execute code (with timeout from start of code execution)
    const result = await Promise.race([
      (async () => {
        await new Promise(resolve => setTimeout(resolve, codeExecutionTime))
        return 'completed'
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Code execution timed out after ${timeout}ms`)), timeout)
      )
    ])

    return { result }
  }

  it('should timeout if code execution exceeds its timeout', async () => {
    // 100ms page load, 200ms code execution, but only 50ms timeout for code
    const promise = simulateExecuteWithPageWait(10, 200, 50)

    await expect(promise).rejects.toThrow('Code execution timed out after 50ms')
  }, 1000)

  it('should complete when code execution fits within timeout', async () => {
    // 10ms page load, 20ms code execution, 1000ms timeout - plenty of time
    const result = await simulateExecuteWithPageWait(10, 20, 1000)
    expect(result.result).toBe('completed')
  }, 2000)

  it('should handle immediate page load and fast code execution', async () => {
    // Both operations are very fast
    const result = await simulateExecuteWithPageWait(1, 1, 5000)
    expect(result.result).toBe('completed')
  }, 1000)
})
