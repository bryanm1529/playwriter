# Editor API - Browserwright

> View and live-edit JavaScript and CSS in your actual Chrome browser at runtime.

## Quick Start

```js
const cdp = await getCDPSession({ page });
const editor = createEditor({ cdp });
await editor.enable();

// Find a script
const scripts = await editor.list({ pattern: /app/ });
console.log(scripts);

// Read it
const { content } = await editor.read({ url: scripts[0] });
console.log(content);

// Edit it (changes apply immediately)
await editor.edit({
  url: scripts[0],
  oldString: 'const DEBUG = false',
  newString: 'const DEBUG = true'
});
```

## When to Use This

- Toggle debug flags without rebuilding
- Test a quick fix before committing
- Find where a function or variable is defined
- Remove console.log statements temporarily
- Live-edit CSS to test styling changes
- Search across all page scripts for patterns

## Core Concepts

**In-Memory Edits**: Changes modify the running V8 instance. They persist until page reload but are never saved to disk or server. This is safe for experimentation.

**Scripts & Stylesheets**: The editor tracks both JavaScript files and CSS stylesheets. Use `list()` to see all available resources.

**Inline Scripts**: Scripts without a URL (inline `<script>` tags) get synthetic URLs like `inline://123`. You can read and edit them the same way.

**Exact String Matching**: The `edit()` method requires your `oldString` to match exactly once. This prevents accidental edits to the wrong location.

---

## API Reference

### Setup

#### `createEditor({ cdp })`

Create an editor instance from a CDP session.

```js
const cdp = await getCDPSession({ page });
const editor = createEditor({ cdp });
await editor.enable();
```

#### `enable()`

Initialize the editor. Must be called before other methods. Scripts and stylesheets are discovered as they load.

**Tip**: Reload the page after enabling to capture all resources:

```js
await editor.enable();
await page.reload();
```

---

### Discovering Resources

#### `list({ pattern? })`

Get all available script and stylesheet URLs.

| Param | Type | Description |
|-------|------|-------------|
| `pattern` | `RegExp?` | Filter URLs by regex |

```js
// All resources
const all = await editor.list();

// Just JavaScript
const jsFiles = await editor.list({ pattern: /\.js/ });

// Just CSS
const cssFiles = await editor.list({ pattern: /\.css/ });

// Find specific files
const appScripts = await editor.list({ pattern: /app|main|index/ });
```

---

### Reading Code

#### `read({ url, offset?, limit? })`

Read a script or stylesheet with line numbers.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` | - | URL from `list()` or `grep()` |
| `offset` | `number` | `0` | Start line (0-based) |
| `limit` | `number` | `2000` | Max lines to return |

Returns:
```ts
{
  content: string;    // Line-numbered content
  totalLines: number; // Total lines in file
  startLine: number;  // First line returned (1-based)
  endLine: number;    // Last line returned
}
```

```js
// Read entire file
const { content, totalLines } = await editor.read({
  url: 'https://example.com/app.js'
});
console.log(`${totalLines} lines total`);
console.log(content);
// "    1| import React from 'react';
//     2| import { useState } from 'react';
//     3| ..."

// Read lines 100-200
const { content: partial } = await editor.read({
  url: 'https://example.com/app.js',
  offset: 99,  // 0-based, so 99 = line 100
  limit: 100
});
```

---

### Editing Code

#### `edit({ url, oldString, newString, dryRun? })`

Replace a string in a script or stylesheet. Changes apply immediately.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` | - | URL to edit |
| `oldString` | `string` | - | Exact string to find (must match once) |
| `newString` | `string` | - | Replacement string |
| `dryRun` | `boolean` | `false` | Validate without applying |

Returns:
```ts
{
  success: boolean;
  stackChanged?: boolean; // For JS: did the call stack change?
}
```

```js
// Toggle a debug flag
await editor.edit({
  url: 'https://example.com/app.js',
  oldString: 'const DEBUG = false',
  newString: 'const DEBUG = true'
});

// Edit CSS
await editor.edit({
  url: 'https://example.com/styles.css',
  oldString: 'background-color: red',
  newString: 'background-color: blue'
});

// Validate first
const result = await editor.edit({
  url: 'https://example.com/app.js',
  oldString: 'function broken(',
  newString: 'function fixed(',
  dryRun: true
});
if (result.success) {
  // Now do it for real
  await editor.edit({ /* same params without dryRun */ });
}
```

**Throws**:
- `"oldString not found"` - The string doesn't exist in the file
- `"oldString found N times"` - Ambiguous match; add more context to make it unique

---

#### `write({ url, content, dryRun? })`

Replace entire file contents. Use with caution - prefer `edit()` for targeted changes.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` | - | URL to write |
| `content` | `string` | - | New complete content |
| `dryRun` | `boolean` | `false` | Validate without applying (JS only) |

```js
// Read, transform, write
const { content } = await editor.read({ url: 'https://example.com/app.js' });
const newContent = content
  .split('\n')
  .map(line => line.replace(/^\s*\d+\| /, '')) // Remove line numbers
  .join('\n')
  .replace(/console\.log/g, 'console.debug');

await editor.write({
  url: 'https://example.com/app.js',
  content: newContent
});
```

---

### Searching Code

#### `grep({ regex, pattern? })`

Search for a pattern across all scripts and stylesheets.

| Param | Type | Description |
|-------|------|-------------|
| `regex` | `RegExp` | Pattern to search for in content |
| `pattern` | `RegExp?` | Filter which URLs to search |

Returns:
```ts
Array<{
  url: string;        // File URL
  lineNumber: number; // Line number (1-based)
  lineContent: string; // Matching line (trimmed, max 200 chars)
}>
```

```js
// Find all console.log calls
const logs = await editor.grep({ regex: /console\.log/ });
for (const match of logs) {
  console.log(`${match.url}:${match.lineNumber}`);
  console.log(`  ${match.lineContent}`);
}

// Search only JavaScript files
const todos = await editor.grep({
  regex: /TODO|FIXME|HACK/i,
  pattern: /\.js/
});

// Search only CSS
const colorRules = await editor.grep({
  regex: /color:\s*#[0-9a-f]{6}/i,
  pattern: /\.css/
});

// Find a function definition
const funcDef = await editor.grep({
  regex: /function\s+handleSubmit|handleSubmit\s*=/
});
```

---

## Common Patterns

### Toggle a Feature Flag

```js
const cdp = await getCDPSession({ page });
const editor = createEditor({ cdp });
await editor.enable();

// Find the config file
const configs = await editor.list({ pattern: /config/ });

// Enable a feature
await editor.edit({
  url: configs[0],
  oldString: "FEATURE_X_ENABLED: false",
  newString: "FEATURE_X_ENABLED: true"
});

// Reload to pick up the change
await page.reload();
```

### Find and Fix a Bug

```js
const cdp = await getCDPSession({ page });
const editor = createEditor({ cdp });
await editor.enable();

// Search for the problematic code
const matches = await editor.grep({ regex: /\.toFixed\(2\)/ });
console.log('Found potential precision issues:', matches);

// Read context around the first match
const { content } = await editor.read({
  url: matches[0].url,
  offset: matches[0].lineNumber - 5,
  limit: 10
});
console.log(content);

// Fix it
await editor.edit({
  url: matches[0].url,
  oldString: 'amount.toFixed(2)',
  newString: 'Math.round(amount * 100) / 100'
});
```

### Remove All Console Statements

```js
const cdp = await getCDPSession({ page });
const editor = createEditor({ cdp });
await editor.enable();

const logs = await editor.grep({
  regex: /console\.(log|debug|info)\([^)]*\);?/,
  pattern: /\.js/
});

for (const match of logs) {
  try {
    // Extract just the console statement
    const consoleMatch = match.lineContent.match(/console\.(log|debug|info)\([^)]*\);?/);
    if (consoleMatch) {
      await editor.edit({
        url: match.url,
        oldString: consoleMatch[0],
        newString: '/* removed */'
      });
    }
  } catch (e) {
    console.log(`Skipped ${match.url}:${match.lineNumber} - ${e.message}`);
  }
}
```

### Live CSS Editing

```js
const cdp = await getCDPSession({ page });
const editor = createEditor({ cdp });
await editor.enable();

// Find all stylesheets
const css = await editor.list({ pattern: /\.css/ });
console.log('Stylesheets:', css);

// Read a stylesheet
const { content } = await editor.read({ url: css[0] });
console.log(content);

// Change a color scheme
await editor.edit({
  url: css[0],
  oldString: '--primary-color: #007bff',
  newString: '--primary-color: #6f42c1'
});

// Changes apply immediately - no reload needed for CSS!
```

### Edit an Inline Script

```js
const cdp = await getCDPSession({ page });
const editor = createEditor({ cdp });
await editor.enable();

// Inline scripts have URLs like "inline://123"
const inlineScripts = await editor.list({ pattern: /^inline:/ });

// Or find by searching for content
const matches = await editor.grep({ regex: /myInlineFunction/ });
const inlineUrl = matches[0].url;

// Edit it like any other script
await editor.edit({
  url: inlineUrl,
  oldString: 'return false',
  newString: 'return true'
});
```

---

## Troubleshooting

### "Resource not found"

The URL doesn't match any known script or stylesheet.

**Fixes**:
1. Check available resources: `await editor.list()`
2. Use the exact URL from `list()` or `grep()`
3. Reload the page after `enable()` to capture all scripts

### "oldString not found"

The exact string doesn't exist in the file.

**Fixes**:
1. Read the file first to see actual content: `await editor.read({ url })`
2. Watch for whitespace differences (tabs vs spaces, line endings)
3. The content may have already been edited

### "oldString found N times"

The string appears multiple times. The editor won't guess which one to replace.

**Fix**: Include more surrounding context to make it unique:

```js
// Too ambiguous
await editor.edit({
  oldString: 'return true',
  newString: 'return false'
});

// Add context
await editor.edit({
  oldString: 'function validate() {\n  return true',
  newString: 'function validate() {\n  return false'
});
```

### Changes don't persist after reload

This is expected behavior. Edits are in-memory only.

**Options**:
1. Make the change in your source code and rebuild
2. Re-apply the edit after each reload
3. Use a browser extension for persistent overrides

### Scripts list is empty after enable()

Scripts are discovered as they're parsed. If you enable before the page loads, you may miss scripts.

**Fix**:
```js
await editor.enable();
await page.reload();  // Now all scripts will be captured
await page.waitForLoadState('domcontentloaded');
const scripts = await editor.list();
```

### CSS changes apply but JS changes don't

For JavaScript, changes apply to newly executed code. If a function already ran, the old version ran. You may need to trigger the code path again.

For CSS, changes apply immediately because the browser re-renders with new styles.
