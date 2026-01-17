# CDP Event Timing and Synchronization

This document describes the timing issues we discovered and fixed in the CDP relay server, and outlines potential future improvements.

## The Problem

When Playwright connects to Chrome via our CDP relay, there's a race condition between:
1. **Target attachment** - Extension attaches to a tab and sends `Target.attachedToTarget`
2. **Runtime initialization** - Playwright calls `Runtime.enable` to set up JavaScript execution contexts
3. **Page visibility** - `context.pages()` returns pages that are fully ready

### Symptom
Tests or MCP calls that run immediately after toggling the extension would fail with "page not found" because `context.pages()` didn't include the newly attached page yet.

### Root Cause
The `Runtime.enable` CDP command triggers `Runtime.executionContextCreated` events that tell Playwright the page's JavaScript context is ready. Without these events, pages aren't fully visible to `context.pages()`.

Previously, the extension had an arbitrary `sleep(200ms)` in the `Runtime.enable` handler to work around this. When this was increased to 400ms, tests started failing due to timing mismatches.

## The Fix

We replaced the arbitrary sleep with **event-based synchronization** in the relay server:

```typescript
case 'Runtime.enable': {
  // Set up listener for executionContextCreated
  const contextCreatedPromise = new Promise<void>((resolve) => {
    const handler = ({ event }) => {
      if (event.method === 'Runtime.executionContextCreated' && 
          event.sessionId === sessionId) {
        clearTimeout(timeout)
        emitter.off('cdp:event', handler)
        resolve()
      }
    }
    const timeout = setTimeout(() => {
      emitter.off('cdp:event', handler)
      logger?.log('IMPORTANT: Runtime.enable timed out...')
      resolve()
    }, 3000)
    emitter.on('cdp:event', handler)
  })

  // Forward command to extension
  const result = await sendToExtension(...)
  
  // Wait for the event before returning
  await contextCreatedPromise
  
  return result
}
```

### Why This Works
- When Playwright calls `Runtime.enable`, we forward it to the extension
- The extension enables Runtime on the Chrome tab
- Chrome sends `Runtime.executionContextCreated` events
- We wait for at least one such event before returning
- By the time `Runtime.enable` returns, the page's context is ready

## Event Flow

```
Test toggles extension
       ↓
Extension attaches to tab
       ↓
Extension sends Target.attachedToTarget to relay
       ↓
Relay broadcasts to Playwright clients
       ↓
Playwright calls Runtime.enable ──────────────────┐
       ↓                                          │
Relay forwards to extension                       │
       ↓                                          │
Extension enables Runtime on Chrome tab           │
       ↓                                          │
Chrome sends Runtime.executionContextCreated      │
       ↓                                          │
Relay receives event, resolves promise ───────────┘
       ↓
Runtime.enable returns to Playwright
       ↓
Page is now visible in context.pages()
```

## Future Improvements

### 1. Wait for Target Attachment

Currently, tests still need small waits after `toggleExtensionForActiveTab()` because the MCP's Playwright browser needs time to process `Target.attachedToTarget`. 

A potential improvement: Track "pending" vs "ready" targets in the relay server:
- When `Target.attachedToTarget` arrives → mark as pending
- When `Runtime.executionContextCreated` arrives → mark as ready
- Expose an endpoint or mechanism for MCP to wait for all targets to be ready

### 2. Extension-Level Confirmation

The extension could wait for confirmation from the relay server before returning from `attachTab()`:
- Extension sends `Target.attachedToTarget`
- Relay waits for `Runtime.executionContextCreated`
- Relay sends acknowledgment back to extension
- Extension's `attachTab()` returns
- `toggleExtensionForActiveTab()` returns with page fully ready

This would eliminate the need for any waits in test code.

### 3. MCP-Level Page Readiness Check

The MCP could check page readiness before executing code:
- Before running user code, verify each page in `context.pages()` has a ready execution context
- Use Playwright's `page.evaluate()` with a simple expression to confirm the page is responsive

## Test Implications

The current test waits (100ms after toggle) exist for multiple reasons:
1. **Target attachment** - Waiting for `Target.attachedToTarget` to be processed
2. **Navigation completion** - Waiting for page loads/navigations
3. **State cleanup** - Ensuring previous test state is cleared
4. **Debugger synchronization** - Waiting for breakpoints/pause states

The `Runtime.enable` fix addresses reason #1 at the CDP level, but test waits are still needed for the other reasons.

## Files Changed

- `playwriter/src/cdp-relay.ts` - Added event-based wait in `Runtime.enable` handler
- `extension/src/background.ts` - Removed arbitrary `sleep(200)` from `Runtime.enable` handler
