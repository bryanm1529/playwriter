<div align='center'>
    <br/>
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="banner-dark.png" />
        <source media="(prefers-color-scheme: light)" srcset="banner.png" />
    <img src="banner.png" alt="Browserwright - For browser automation MCP" width="400" height="278" />
    </picture>
    <br/>
    <br/>
    <p>Browser automation that just works. Auto-launches Chrome when needed, or uses existing tabs via extension. Full Playwright API, 80% less context bloat.</p>
    <br/>
</div>

## Installation

Add to your MCP client config (e.g., Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "browserwright": {
      "command": "npx",
      "args": ["browserwright@latest"]
    }
  }
}
```

**That's it.** Browserwright auto-launches Chrome with a persistent profile when you start using it. Your logins persist between sessions.

### Optional: Extension Mode

For controlling tabs you're already using (with your logged-in sessions), install the [Chrome Extension](https://chromewebstore.google.com/detail/browserwright/jfeammnjpkecdekppnclgkkffahnhfhe):

1. Install from Chrome Web Store
2. Click the extension icon on any tab to attach it
3. Icon turns **green** when connected

Browserwright automatically uses extension tabs if available, otherwise launches a new browser.

## Usage

### Using the MCP

Your AI assistant uses a single `execute` tool that runs Playwright code. Just ask it to do browser tasks:

- "Go to github.com and check my notifications"
- "Fill out the contact form on this page"
- "Scrape the product prices from this website"

**What your AI can do:**

- Navigate to any URL
- Click, type, scroll, and interact with elements
- Take screenshots and accessibility snapshots
- Intercept network requests (great for API reverse-engineering)
- Debug with breakpoints and inspect variables
- Live-edit page scripts and CSS
- Create new tabs programmatically

### Using with Playwright

You can use browserwright programmatically with playwright-core:

```typescript
import { chromium } from 'playwright-core'
import { startBrowserwrightCDPRelayServer, getCdpUrl } from 'browserwright'

const server = await startBrowserwrightCDPRelayServer()

const browser = await chromium.connectOverCDP(getCdpUrl())

const context = browser.contexts()[0]
const page = context.pages()[0]

await page.goto('https://example.com')
await page.screenshot({ path: 'screenshot.png' })

// Don't call browser.close() - it would close the user's Chrome
server.close()
```

### Standard CDP Connection

Start the relay server, then connect with just the HTTP URL:

```bash
npx -y browserwright serve --host 127.0.0.1
```

Or programmatically:

```typescript
import { startBrowserwrightCDPRelayServer } from 'browserwright'

await startBrowserwrightCDPRelayServer()
const browser = await chromium.connectOverCDP('http://127.0.0.1:19988')
```

This works with any CDP-compatible tool - no special configuration needed.

### Visual Aria Ref Labels

Browserwright includes Vimium-style visual labels that overlay interactive elements, making it easy for AI agents to identify and click elements from screenshots. The `screenshotWithAccessibilityLabels` function is available in the MCP context.

```javascript
// Take a screenshot with labels overlaid on interactive elements
// Labels are shown, screenshot is captured, then labels are removed
await screenshotWithAccessibilityLabels({ page })
// Image and accessibility snapshot are automatically included in MCP response

// Use the snapshot from the response to find elements, then interact using aria-ref selector
await page.locator('aria-ref=e5').click()

// Can take multiple screenshots in one execution
await screenshotWithAccessibilityLabels({ page })
await page.click('button')
await screenshotWithAccessibilityLabels({ page })
// Both images are included in the response
```

The function automatically shows labels, takes a screenshot, hides labels, and includes both the image and accessibility snapshot in the MCP response. Screenshots are saved to `./tmp/` with unique filenames.

**Features:**

- **Role filtering** - Only shows labels for interactive elements (buttons, links, inputs, etc.)
- **Visibility detection** - Skips elements covered by modals or overlays
- **Overlap prevention** - Skips labels that would overlap with already-placed ones
- **Color-coded by type** - Warm color scheme helps distinguish element types
- **Auto-hide** - Labels disappear after 30 seconds to prevent stale overlays

**Color legend:**

| Color  | Element Types                              |
| ------ | ------------------------------------------ |
| Yellow | Links                                      |
| Orange | Buttons                                    |
| Coral  | Text inputs (textbox, combobox, searchbox) |
| Pink   | Checkboxes, radios, switches               |
| Peach  | Sliders                                    |
| Salmon | Menu items                                 |
| Amber  | Tabs, options                              |

### CLI Options

```bash
browserwright                    # Default: auto-launches Chrome if no extension tabs
browserwright --launch           # Force launch mode (spawn new browser)
browserwright --headless         # Run in headless mode
browserwright --isolated         # Use temp profile (clean session each time)
browserwright --cdp <endpoint>   # Connect to existing browser via CDP
browserwright --channel chrome-beta  # Use Chrome Beta/Dev/Edge
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `BROWSERWRIGHT_PORT` | Relay server port (default: `19988`) |
| `BROWSERWRIGHT_HOST` | Remote relay host for devcontainers/VMs |
| `BROWSERWRIGHT_TOKEN` | Auth token for remote connections |

## Comparison

### vs Playwright MCP

Browserwright gives you the best of both worlds:

**Auto-launch mode** (like Playwright MCP):
- Just works - auto-launches Chrome with persistent profile
- Logins persist between sessions
- No extension needed

**Extension mode** (unique to Browserwright):
- Control your existing logged-in sessions
- Work alongside the AI in the same browser
- Bypass automation detection by temporarily disconnecting
- Reuse ad blockers, password managers, and other extensions

### vs BrowserMCP

Browserwright has access to the full playwright API available, it can send any CDP command via the playwright methods. It only uses 1 tool `execute` to send playwright code snippets. This means that the LLM can reuse its knowledge about playwright and less context window is used to expose browser automations tools.

Browserwright is also more capable because it exposes the full playwright API instead of only a few tools.

For comparison here are the tools supported by BrowserMCP:

Navigation:

- `browsermcp_browser_navigate` - Navigate to a URL
- `browsermcp_browser_go_back` - Go back to the previous page
- `browsermcp_browser_go_forward` - Go forward to the next page
  Page Inspection:
- `browsermcp_browser_snapshot` - Capture accessibility snapshot of the current page (use this to get references to elements)
- `browsermcp_browser_screenshot` - Take a screenshot of the current page
- `browsermcp_browser_get_console_logs` - Get console logs from the browser
  Interactions:
- `browsermcp_browser_click` - Click on an element (requires element reference from snapshot)
- `browsermcp_browser_hover` - Hover over an element
- `browsermcp_browser_type` - Type text into an editable element (with optional submit)
- `browsermcp_browser_select_option` - Select an option in a dropdown
- `browsermcp_browser_press_key` - Press a key on the keyboard
  Utilities:
- `browsermcp_browser_wait` - Wait for a specified time in seconds

### vs Antigravity (Jetski)

Antigravity's browser integration suffers from the same fundamental problem as BrowserMCP: it creates a separate tool for every browser action instead of using the Playwright API that LLMs already understand.

**The Context Window Problem:**

Jetski exposes 17+ browser tools (`capture_browser_screenshot`, `browser_click_element`, `browser_input`, `browser_scroll`, `wait_5_seconds`, etc.). Each tool definition consumes context window space with parameter schemas, descriptions, and examples. This bloated schema forces Antigravity to spawn a **subagent every time you want to use the browser**, adding significant latency and indirection to every browser interaction.

**Browserwright's Approach:**

- **1 tool instead of 17+** - Only the `execute` tool is needed
- **No subagent spawning** - Browser operations happen directly without extra layers
- **Lower latency** - No need to spawn/teardown agents for each browser task
- **Leverages existing knowledge** - LLMs already know Playwright's API from their training data
- **More capable** - Full Playwright API access vs a limited set of predefined actions

The irony is that by trying to make browser control "simpler" with dedicated tools, these integrations make it slower, less capable, and waste context window that could be used for actual work.

### vs Claude Code Browser Extension

Claude Code has a built-in Chrome extension ("Claude in Chrome") that uses Native Messaging API with a hybrid approach: screenshots for visual understanding and DOM/JavaScript for interactions.

**Works Everywhere Claude's Extension Doesn't:**

- **Windows WSL support** - Claude's extension doesn't work in WSL because Native Messaging requires Windows-native Chrome. Browserwright uses WebSocket on localhost:19988, so agents running in WSL can control Chrome on your Windows host
- **Any MCP-compatible agent** - Not locked to Claude. Works with GPT, Gemini, local models, or any CLI tool that supports MCP
- **Devcontainers & VMs** - Run your agent in an isolated environment while controlling Chrome on your host machine

**Context Efficiency:**

Claude's extension sends screenshots to the LLM for visual understanding, then uses DOM inspection for interactions. Browserwright uses accessibility snapshots instead - structured text describing interactive elements with their roles, names, and states:

| Approach           | What's sent to LLM      | Typical size         |
| ------------------ | ----------------------- | -------------------- |
| Claude's extension | Screenshots             | 100KB-1MB+ per image |
| Browserwright         | Accessibility snapshots | 5-20KB text          |

**Full Playwright API vs Step-by-Step Navigation:**

Claude's extension navigates pages step-by-step with screenshots. Browserwright exposes the complete Playwright API through a single `execute` tool - LLMs already know Playwright from training data:

```js
// Complex interactions in one call
await page.locator('tr').filter({ hasText: 'John' }).locator('button').click()
const [download] = await Promise.all([page.waitForEvent('download'), page.click('button.export')])
await download.saveAs('/tmp/report.pdf')
```

**Advanced DevTools Features:**

Browserwright provides capabilities Claude's extension doesn't have:

```js
// Set breakpoints and inspect variables at runtime
const dbg = createDebugger({ cdp })
await dbg.setBreakpoint({ file: 'app.js', line: 42 })
// when paused: await dbg.inspectLocalVariables()

// Live-edit page scripts without reload
const editor = createEditor({ cdp })
await editor.edit({ url: 'app.js', oldString: 'DEBUG=false', newString: 'DEBUG=true' })

// Inspect CSS like DevTools Styles panel
const styles = await getStylesForLocator({ locator: page.locator('.btn'), cdp })

// Intercept network requests for API reverse-engineering
page.on('response', async (res) => {
  if (res.url().includes('/api/')) state.responses.push(await res.json())
})

// Find React component source locations
const source = await getReactSource({ locator: page.locator('aria-ref=e5') })
// => { fileName: 'Button.tsx', lineNumber: 42 }
```

**User Collaboration Features:**

- **Right-click → "Copy Browserwright Element Reference"** - Pin any element and reference it as `globalThis.browserwrightPinnedElem1` in your automation code
- **Vimium-style visual labels** - `screenshotWithAccessibilityLabels()` captures screenshots with clickable labels on all interactive elements
- **Tab group organization** - Connected tabs are grouped together with a green "browserwright" label
- **Bypass automation detection** - Disconnect the extension temporarily to pass bot detection (e.g., Google login), then reconnect

**Summary:**

| Feature                 | Claude's Extension | Browserwright                   |
| ----------------------- | ------------------ | ---------------------------- |
| Windows WSL             | No                 | Yes                          |
| Works with any agent    | No (Claude only)   | Yes (any MCP client)         |
| Context method          | Screenshots        | A11y snapshots (90% smaller) |
| Full Playwright API     | No                 | Yes                          |
| Debugger (breakpoints)  | No                 | Yes                          |
| Live code editing       | No                 | Yes                          |
| CSS inspection          | No                 | Yes                          |
| Network interception    | Limited            | Full                         |
| React source finding    | No                 | Yes                          |
| Right-click pin element | No                 | Yes                          |
| Raw CDP access          | No                 | Yes                          |

## Architecture

```
+---------------------+     +-------------------+     +-----------------+
|   BROWSER           |     |   LOCALHOST       |     |   MCP CLIENT    |
|                     |     |                   |     |                 |
|  +---------------+  |     | WebSocket Server  |     |  +-----------+  |
|  |   Extension   |<--------->  :19988         |     |  | AI Agent  |  |
|  |  (bg script)  |  | WS  |                   |     |  | (Claude)  |  |
|  +-------+-------+  |     |  /extension       |     |  +-----------+  |
|          |          |     |       ^           |     |        |        |
|          | chrome   |     |       |           |     |        v        |
|          | .debug   |     |       v           |     |  +-----------+  |
|          v          |     |  /cdp/:id <--------------> |  execute  |  |
|  +---------------+  |     |                   |  WS |  |   tool    |  |
|  | Tab 1 (green) |  |     | Routes:           |     |  +-----------+  |
|  +---------------+  |     |  - CDP commands   |     |        |        |
|  +---------------+  |     |  - CDP events     |     |        v        |
|  | Tab 2 (green) |  |     |  - attach/detach  |     |  +-----------+  |
|  +---------------+  |     |    Target events  |     |  | Playwright|  |
|  +---------------+  |     +-------------------+     |  |    API    |  |
|  | Tab 3 (gray)  |  |                               |  +-----------+  |
|  +---------------+  |     Tab 3 not controlled      +-----------------+
|                     |     (user didn't click icon)
+---------------------+
```

## Remote Agents (Devcontainers, VMs, SSH)

Run agents in isolated environments (devcontainers, VMs, SSH) while controlling Chrome on your host.

**On host (where Chrome runs):**

```bash
npx -y browserwright serve --token <secret>
# or use environment variable:
BROWSERWRIGHT_TOKEN=<secret> npx -y browserwright serve
```

**In container/VM (where agent runs):**

Configure your MCP client with the host and token. You can pass them as CLI arguments:

```json
{
  "mcpServers": {
    "browserwright": {
      "command": "npx",
      "args": ["browserwright@latest", "--host", "host.docker.internal", "--token", "<secret>"]
    }
  }
}
```

Or use environment variables (useful if you want to set them globally in your process or MCP client):

```json
{
  "mcpServers": {
    "browserwright": {
      "command": "npx",
      "args": ["browserwright@latest"],
      "env": {
        "BROWSERWRIGHT_HOST": "host.docker.internal",
        "BROWSERWRIGHT_TOKEN": "<secret>"
      }
    }
  }
}
```

Use `host.docker.internal` for devcontainers, or your host's IP for VMs/SSH.

## Known Issues

- If all pages urls return `about:blank` in every MCP session restart your Chrome browser. This seems to be a Chrome bug that sometimes happen. It is some hidden state in `chrome.debugger` Extensions API. Restarting the extension worker does not fix it.
- When connecting the MCP to a page, the browser may switch to light mode. This happens because Playwright, via CDP, automatically sends an "emulate media" command on start. If you'd like to see this behavior changed, you can upvote the related issue [here](https://github.com/microsoft/playwright/issues/37627).

## Security

Browserwright is designed with security in mind, ensuring that only you can control your browser.

### How It Works

1. **Local WebSocket Server**: When the MCP starts, it launches a singleton WebSocket server on `localhost:19988`
2. **Dual Connection**: Both the Chrome extension and MCP client connect to this local server
3. **User-Controlled Access**: The extension can only control tabs where you explicitly clicked the extension icon (green icon indicates connected tabs)
4. **Origin Validation**: The WebSocket server validates the `Origin` header on all connections. Browsers cannot spoof this header, so malicious websites cannot connect to the local server. Only our specific Chrome extension IDs and local processes (which don't send an Origin header) are allowed
5. **Explicit Consent**: Chrome displays an "automation banner" on controlled tabs, making it obvious when a tab is being automated

### What Can Be Controlled

- **Only enabled tabs**: Tabs you explicitly connected by clicking the extension icon
- **New tabs created by automation**: Tabs created programmatically through Playwright commands
- **Nothing else**: Other browser tabs, your browsing history, or any tabs you haven't explicitly connected remain inaccessible

### What Cannot Happen

- **No remote access**: Malicious websites cannot connect to the WebSocket server - browser-based connections require a valid extension Origin header that browsers cannot spoof
- **No passive monitoring**: The extension cannot read or monitor tabs you haven't connected
- **No automatic spreading**: The debugger won't automatically attach to new tabs you open manually

This architecture ensures that browser automation only happens with your explicit permission on tabs you choose.
