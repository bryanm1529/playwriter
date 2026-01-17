# Test Coverage Gap Analysis

Generated: 2026-01-17

## Current Coverage Summary

| Layer | Tests | Status |
|-------|-------|--------|
| Unit Tests | 53 | ✅ All passing |
| Integration Tests | 26 | ✅ All passing |
| Performance Benchmarks | 17 | ✅ Working |

## CRITICAL GAPS (High Risk)

### Gap 1: Full MCP Execute Flow Not Tested
**What's missing:** The `execute` tool with actual Playwright commands going through the full stack (MCP → VM → Playwright → CDP Relay → Extension → Browser)

**Why it matters:** The 15000ms timeout the user experienced happens in this flow, but we're not testing it end-to-end without the browser.

**Risk Level:** 🔴 HIGH

**Files involved:**
- `src/mcp.ts` lines 744-1177 (execute tool)
- `src/cdp-relay.ts` lines 200-230 (extension request handling)

**Recommended test:**
```typescript
// test/e2e/mcp-execute-timeout.test.ts
it('should handle slow page operations without timeout', async () => {
  // Create page with slow-loading elements
  // Call execute with fill() operation
  // Verify completes within timeout
})
```

---

### Gap 2: Extension Request Timeout Path
**What's missing:** Testing the `Extension request timeout after ${timeout}ms` error path (cdp-relay.ts:218)

**Why it matters:** When extension is slow to respond, this timeout fires. Not tested.

**Risk Level:** 🔴 HIGH

**Current code:**
```typescript
// cdp-relay.ts:218
reject(new Error(`Extension request timeout after ${timeout}ms: ${method}`))
```

**Recommended test:**
```typescript
it('should return timeout error when extension is slow', async () => {
  // Mock slow extension response
  // Verify timeout error is properly propagated
})
```

---

### Gap 3: Target Attachment Failures
**What's missing:** Testing `Target not found` and `targetId is required` error paths

**Why it matters:** These errors indicate extension/browser disconnection issues

**Risk Level:** 🟡 MEDIUM

**Files involved:**
- `src/cdp-relay.ts` lines 302-311

---

### Gap 4: getCurrentPage Timeout
**What's missing:** Testing when `getCurrentPage(timeout)` takes longer than the timeout

**Why it matters:** This is called before every execute operation (mcp.ts:781)

**Risk Level:** 🟡 MEDIUM

**Current code:**
```typescript
// mcp.ts:592-604
async function getCurrentPage(timeout = 5000) {
  // ...waits for page to be ready
  await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {})
}
```

---

### Gap 5: waitForPageLoad Edge Cases
**What's missing:** Testing `waitForPageLoad` with slow/hanging pages

**Why it matters:** Network issues, heavy JS can cause this to hang

**Risk Level:** 🟡 MEDIUM

---

## MODERATE GAPS

### Gap 6: Extension Reconnection After Disconnect
**What's tested:** Extension disconnect is detected
**What's NOT tested:** Recovery after extension reconnects

### Gap 7: Concurrent CDP Commands
**What's tested:** Concurrent connections
**What's NOT tested:** Multiple CDP commands in flight simultaneously

### Gap 8: Large Message Handling
**What's tested:** Small message serialization
**What's NOT tested:** Very large DOM snapshots, accessibility trees

---

## WHAT THE TESTS COVER WELL ✅

1. **CodeExecutionTimeoutError** - Fully tested (creation, detection, race pattern)
2. **Extension ID validation** - Fully tested (whitelist, origins, URL formats)
3. **Message parsing** - Fully tested (JSON safety, CDP message types)
4. **WebSocket lifecycle** - Well tested (connect, disconnect, reconnect)
5. **Error recovery** - Well tested (server continues after client errors)
6. **CDP relay basics** - Well tested (routing, message forwarding)

---

## RECOMMENDED PRIORITY

1. **P0 (Immediate):** Add E2E test that reproduces the 15000ms timeout scenario
2. **P1 (Soon):** Test extension request timeout path
3. **P2 (Later):** Test getCurrentPage timeout
4. **P3 (Nice to have):** Large message handling, concurrent commands

---

## How to Run Gap-Filling Tests

```bash
# After adding new tests:
pnpm test:unit          # Fast feedback
pnpm test:integration   # Server-level tests
pnpm test:e2e           # Full browser tests (slower)
```

## Pre-Mortem: Why Could Tests Still Miss Issues?

1. **CI environment differs** - Tests pass locally but fail in GitHub Actions
2. **Real extension differs** - Tests use mock, real extension has bugs
3. **Network conditions** - Tests run on localhost, real usage has latency
4. **Heavy pages** - Tests use simple HTML, real pages have complex JS
5. **Extension not connected** - Tests assume connection, user may not have extension active
