# Browserwright User Guide

> Control your actual Chrome browser with AI - like Playwright, but for tabs you're already using.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Core Concepts](#core-concepts)
3. [Common Workflows](#common-workflows)
4. [Advanced Features](#advanced-features)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start

Get Browserwright running in under 5 minutes.

### Step 1: Install the Extension

Load the extension in Chrome:

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extension/dist` folder

**Or** install from Chrome Web Store (if published).

### Step 2: Configure Your AI Agent

Add to your MCP client config (e.g., Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "browserwright": {
      "command": "npx",
      "args": ["-y", "browserwright@latest"]
    }
  }
}
```

For local development:

```json
{
  "mcpServers": {
    "browserwright": {
      "command": "node",
      "args": ["/home/sicmundus/browserwright/browserwright/bin.js"]
    }
  }
}
```

### Step 3: Connect a Tab

Three ways to connect:

1. **Keyboard shortcut**: Press `Ctrl+Shift+P` (Cmd+Shift+P on Mac) on any tab
2. **Click the icon**: Click the Browserwright extension icon
3. **Tab group**: Drag any tab into the green "browserwright" tab group

The extension icon turns **green** when connected.

### Step 4: Start Automating

Your AI agent now has access to the `execute` tool. Example:

```js
// Navigate and take a screenshot
await page.goto('https://example.com');
const snapshot = await accessibilitySnapshot({ page });
console.log(snapshot);
```

---

## Core Concepts

### How Browserwright Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Your Chrome   │     │  Relay Server    │     │   AI Agent      │
│                 │     │  localhost:19988 │     │   (Claude)      │
│  ┌───────────┐  │ WS  │                  │ WS  │                 │
│  │ Extension │◄─┼─────┼──► /extension    │     │  ┌───────────┐  │
│  └─────┬─────┘  │     │                  │◄────┼──┤  execute  │  │
│        │ CDP    │     │      /cdp ◄──────┼─────┼──┤   tool    │  │
│  ┌─────▼─────┐  │     │                  │     │  └───────────┘  │
│  │  Tab 1    │  │     └──────────────────┘     └─────────────────┘
│  │  (green)  │  │
│  └───────────┘  │
└─────────────────┘
```

**Key insight**: Browserwright doesn't spawn a new browser. It connects to tabs you're already using via Chrome's DevTools Protocol (CDP).

### The Execute Tool

Your AI agent uses a single `execute` tool that runs Playwright code. Available in the execution context:

| Variable | Description |
|----------|-------------|
| `page` | Current active page (Playwright Page) |
| `context` | Browser context with all pages |
| `state` | Persistent object across executions |
| `console` | Log output (visible in MCP response) |

### Accessibility Snapshots vs Screenshots

Browserwright uses **accessibility snapshots** - structured text describing the page:

```
- banner [ref=e3]:
    - link "Home" [ref=e5] [cursor=pointer]
    - navigation [ref=e12]:
        - link "Products" [ref=e13]
        - link "About" [ref=e14]
```

**Why this matters:**
- 90% smaller than screenshots (5-20KB vs 100KB-1MB)
- LLMs can parse and reason about structure
- Elements have `aria-ref` for direct interaction

To click an element:
```js
await page.locator('aria-ref=e13').click();
```

---

## Common Workflows

### 1. Navigate and Extract Data

```js
// Go to a page
await page.goto('https://news.ycombinator.com');

// Get the accessibility snapshot
const snapshot = await accessibilitySnapshot({ page });
console.log(snapshot);

// Extract specific data
const titles = await page.locator('.titleline > a').allTextContents();
console.log('Top stories:', titles.slice(0, 5));
```

### 2. Fill Forms and Submit

```js
// Find and fill form fields
await page.locator('input[name="email"]').fill('user@example.com');
await page.locator('input[name="password"]').fill('secretpassword');

// Click submit
await page.locator('button[type="submit"]').click();

// Wait for navigation
await page.waitForURL('**/dashboard');
console.log('Logged in successfully');
```

### 3. Scrape Dynamic Content

```js
// Wait for content to load
await page.waitForSelector('.product-card');

// Scroll to load more
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.scrollBy(0, window.innerHeight));
  await page.waitForTimeout(1000);
}

// Extract all products
const products = await page.locator('.product-card').evaluateAll(cards =>
  cards.map(card => ({
    name: card.querySelector('.name')?.textContent,
    price: card.querySelector('.price')?.textContent
  }))
);
console.log(JSON.stringify(products, null, 2));
```

### 4. Handle Popups and New Tabs

```js
// Capture popup before triggering
const [popup] = await Promise.all([
  page.waitForEvent('popup'),
  page.click('a[target="_blank"]')
]);

await popup.waitForLoadState();
console.log('Popup URL:', popup.url());

// Work with the popup
const popupSnapshot = await accessibilitySnapshot({ page: popup });
console.log(popupSnapshot);
```

### 5. Download Files

```js
// Capture download
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('button.download')
]);

// Save the file
const path = `/tmp/${download.suggestedFilename()}`;
await download.saveAs(path);
console.log('Downloaded to:', path);
```

### 6. Monitor Network Requests

```js
// Set up listener
state.apiCalls = [];
page.on('response', async (res) => {
  if (res.url().includes('/api/')) {
    try {
      const body = await res.json();
      state.apiCalls.push({ url: res.url(), status: res.status(), body });
    } catch {}
  }
});

// Trigger the action that makes API calls
await page.click('button.load-data');
await page.waitForTimeout(2000);

// Review captured calls
console.log('API calls:', JSON.stringify(state.apiCalls, null, 2));

// Clean up
page.removeAllListeners('response');
```

### 7. Take Visual Screenshots with Labels

```js
// Screenshot with Vimium-style labels on interactive elements
await screenshotWithAccessibilityLabels({ page });
// Image is automatically included in MCP response

// Now you can reference elements by their labels
await page.locator('aria-ref=e15').click();
```

---

## Advanced Features

### Debugger API

Set breakpoints and inspect variables in page scripts.

```js
const cdp = await getCDPSession({ page });
const dbg = createDebugger({ cdp });
await dbg.enable();

// Find scripts
const scripts = await dbg.listScripts({ search: 'app' });

// Set a breakpoint
await dbg.setBreakpoint({ file: scripts[0].url, line: 42 });

// When paused (after breakpoint hits)
if (dbg.isPaused()) {
  const vars = await dbg.inspectLocalVariables();
  console.log('Variables:', vars);

  const location = await dbg.getLocation();
  console.log('Paused at:', location.sourceContext);

  await dbg.resume();
}
```

**Use cases:**
- Debug why a function returns wrong values
- Understand unfamiliar code flow
- Catch where exceptions are thrown

### Editor API

View and live-edit page scripts at runtime.

```js
const cdp = await getCDPSession({ page });
const editor = createEditor({ cdp });
await editor.enable();

// List available scripts
const scripts = await editor.list({ pattern: /app/ });

// Read a script
const { content } = await editor.read({ url: scripts[0] });
console.log(content);

// Edit live (changes apply immediately)
await editor.edit({
  url: scripts[0],
  oldString: 'const DEBUG = false',
  newString: 'const DEBUG = true'
});

// Search across all scripts
const matches = await editor.grep({ regex: /TODO|FIXME/ });
console.log('Found:', matches);
```

**Use cases:**
- Toggle feature flags without reloading
- Remove console.log statements
- Patch bugs for testing

### Styles API

Inspect CSS like browser DevTools.

```js
const cdp = await getCDPSession({ page });
const styles = await getStylesForLocator({
  locator: page.locator('.my-button'),
  cdp
});

console.log(formatStylesAsText(styles));

// Find where a property is defined
const bgRule = styles.rules.find(r => 'background-color' in r.declarations);
if (bgRule?.source) {
  console.log(`background-color defined in ${bgRule.source.url}:${bgRule.source.line}`);
}
```

**Use cases:**
- Find which CSS rule sets a property
- Debug specificity issues
- Check inherited styles

---

## Best Practices

### 1. Use Accessibility Snapshots First

Always start with `accessibilitySnapshot()` to understand the page structure:

```js
// Good: Understand structure first
const snapshot = await accessibilitySnapshot({ page });
console.log(snapshot);
// Then interact based on what you see

// Avoid: Clicking blindly
await page.click('.some-class'); // May not exist
```

### 2. Use aria-ref for Reliable Selectors

Elements in snapshots have stable `aria-ref` identifiers:

```js
// Good: Use aria-ref from snapshot
await page.locator('aria-ref=e15').click();

// Okay: Semantic selectors
await page.getByRole('button', { name: 'Submit' }).click();

// Avoid: Fragile CSS selectors
await page.click('div.container > form > button.btn-primary');
```

### 3. Store State Across Executions

Use the `state` object to persist data between execute calls:

```js
// First execution
state.products = [];
state.pageNumber = 1;

// Later executions
state.products.push(...newProducts);
state.pageNumber++;
console.log(`Collected ${state.products.length} products over ${state.pageNumber} pages`);
```

### 4. Clean Up Listeners

Always remove event listeners when done:

```js
// Set up
page.on('response', myHandler);

// ... do work ...

// Clean up (important!)
page.removeAllListeners('response');
```

### 5. Don't Close the Browser

```js
// WRONG: This closes the user's Chrome!
await browser.close();

// RIGHT: Just close the server when done
server.close();
```

### 6. Handle Errors Gracefully

```js
try {
  await page.locator('.modal-close').click({ timeout: 3000 });
} catch (e) {
  // Modal might not be open, that's okay
  console.log('No modal to close');
}
```

### 7. Wait for the Right Things

```js
// Good: Wait for specific element
await page.waitForSelector('.results-loaded');

// Good: Wait for network idle
await page.waitForLoadState('networkidle');

// Avoid: Arbitrary timeouts
await page.waitForTimeout(5000); // Usually unnecessary
```

---

## Troubleshooting

### Extension Icon is Gray

**Problem**: The extension isn't connected to the tab.

**Solutions**:
1. Press `Ctrl+Shift+P` to attach
2. Click the extension icon
3. Refresh the page and try again
4. Check that the relay server is running (`localhost:19988`)

### "No browser tabs are connected"

**Problem**: MCP can't find any attached tabs.

**Solutions**:
1. Attach at least one tab (see above)
2. Check if Chrome is running
3. Restart the MCP server
4. Check relay server logs: `cat /tmp/browserwright/relay-server.log`

### Page Returns about:blank

**Problem**: Chrome bug where CDP returns wrong URL.

**Solution**: Restart Chrome completely. This is a known Chrome bug in the debugger API.

### Automation Detection Blocking

**Problem**: Sites detect and block automation.

**Solution**:
1. Disconnect the extension temporarily (click icon to detach)
2. Complete the action manually (e.g., login, captcha)
3. Reconnect the extension
4. Continue automation

### Extension Not Working in WSL

**Problem**: Native messaging doesn't work across WSL boundary.

**Solution**: Browserwright uses WebSocket instead of native messaging. Make sure:
1. Chrome is running on Windows
2. Extension is loaded in Windows Chrome
3. Connect via `localhost:19988` (works across WSL)

### Timeout Errors

**Problem**: Operations timing out.

**Solutions**:
```js
// Increase timeout for slow operations
await page.click('button', { timeout: 10000 });

// Wait for network to settle
await page.waitForLoadState('networkidle', { timeout: 30000 });

// Check if element exists first
if (await page.locator('.slow-element').isVisible()) {
  await page.click('.slow-element');
}
```

### Memory Issues with Long Sessions

**Problem**: Browser slows down after many operations.

**Solutions**:
1. Clear state periodically: `state = {}`
2. Close unused pages: `await unusedPage.close()`
3. Remove listeners: `page.removeAllListeners()`
4. Restart the browser session periodically

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BROWSERWRIGHT_PORT` | Relay server port | `19988` |
| `BROWSERWRIGHT_HOST` | Relay server host | `127.0.0.1` |
| `BROWSERWRIGHT_TOKEN` | Authentication token (for remote) | none |
| `BROWSERWRIGHT_AUTO_ENABLE` | Auto-create tab on connect | `false` |
| `BROWSERWRIGHT_LOG_FILE_PATH` | Custom log file location | `/tmp/browserwright/relay-server.log` |

---

## Quick Reference

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` / `Cmd+Shift+P` | Attach current tab |
| `Ctrl+Shift+D` / `Cmd+Shift+D` | Detach current tab |

### Extension Icon States

| Color | Meaning |
|-------|---------|
| Gray | Not connected |
| Green | Connected and ready |
| Orange (...) | Connecting |
| Red (!) | Error |

### Common Locator Patterns

```js
// By aria-ref (from snapshot)
page.locator('aria-ref=e15')

// By role
page.getByRole('button', { name: 'Submit' })

// By text
page.getByText('Click me')

// By label
page.getByLabel('Email')

// By placeholder
page.getByPlaceholder('Enter your email')

// Combined
page.locator('tr').filter({ hasText: 'John' }).locator('button')
```

---

## Getting Help

- **Logs**: Check `/tmp/browserwright/relay-server.log`
- **GitHub**: [github.com/bryanm1529/browserwright](https://github.com/bryanm1529/browserwright)
- **MCP Docs**: [modelcontextprotocol.io](https://modelcontextprotocol.io)
- **Playwright Docs**: [playwright.dev](https://playwright.dev)
