# Debugger API - Browserwright

> Set breakpoints, step through code, and inspect variables in your actual Chrome browser.

## Quick Start

```js
const cdp = await getCDPSession({ page });
const dbg = createDebugger({ cdp });
await dbg.enable();

// Find and set a breakpoint
const scripts = await dbg.listScripts({ search: 'app' });
await dbg.setBreakpoint({ file: scripts[0].url, line: 42 });

// When paused, inspect state
if (dbg.isPaused()) {
  const vars = await dbg.inspectLocalVariables();
  console.log(vars);
  await dbg.resume();
}
```

## When to Use This

- Debug why a function returns unexpected values
- Understand code flow in an unfamiliar codebase
- Catch where an exception is thrown
- Inspect state at specific points in execution
- Step through complex logic line by line

## Core Concepts

**Breakpoints**: Pause execution at specific lines. The page freezes until you resume.

**Paused State**: When paused, you can inspect variables, evaluate expressions, and step through code. Most methods require being paused to work.

**Blackboxing**: Skip library code (React, lodash) when stepping. Focus on your application code.

**Scripts**: JavaScript files loaded by the page. Use `listScripts()` to find URLs for setting breakpoints.

## API Reference

### Setup

#### `createDebugger({ cdp })`

Create a debugger instance from a CDP session.

```js
const cdp = await getCDPSession({ page });
const dbg = createDebugger({ cdp });
await dbg.enable();
```

#### `enable()`

Initialize the debugger. Called automatically by most methods, but call it explicitly to ensure scripts are discovered before listing them.

---

### Breakpoints

#### `setBreakpoint({ file, line, condition? })`

Set a breakpoint at a specific line. Returns a breakpoint ID for later removal.

| Param | Type | Description |
|-------|------|-------------|
| `file` | `string` | Script URL from `listScripts()` |
| `line` | `number` | Line number (1-based) |
| `condition` | `string?` | JS expression - only pause when true |

```js
// Basic breakpoint
const bpId = await dbg.setBreakpoint({
  file: 'https://example.com/app.js',
  line: 42
});

// Conditional - only pause when userId is 123
await dbg.setBreakpoint({
  file: 'https://example.com/app.js',
  line: 42,
  condition: 'userId === 123'
});
```

#### `deleteBreakpoint({ breakpointId })`

Remove a breakpoint by its ID.

```js
await dbg.deleteBreakpoint({ breakpointId: bpId });
```

#### `listBreakpoints()`

Get all active breakpoints set by this debugger instance.

```js
const breakpoints = dbg.listBreakpoints();
// [{ id: 'bp-123', file: 'https://example.com/app.js', line: 42 }]
```

---

### Inspection (Requires Paused State)

#### `inspectLocalVariables()`

Get all local variables in the current stack frame. String values over 1000 chars are truncated.

```js
const vars = await dbg.inspectLocalVariables();
// { userId: 123, userName: 'Alice', config: '[object]' }
```

**Throws**: Error if not paused.

#### `evaluate({ expression })`

Evaluate any JavaScript expression in the current scope. Use this for full values (no truncation) or computed expressions.

```js
// Get a large string that would be truncated
const { value } = await dbg.evaluate({ expression: 'largeJsonString' });

// Compute something
const { value: len } = await dbg.evaluate({ expression: 'users.length' });

// Access nested properties
const { value: name } = await dbg.evaluate({ expression: 'response.data.user.name' });
```

When not paused, evaluates in global scope.

#### `getLocation()`

Get current execution position with surrounding source code.

```js
const loc = await dbg.getLocation();
console.log(loc.url);           // 'https://example.com/app.js'
console.log(loc.lineNumber);    // 42
console.log(loc.sourceContext);
// '  40: function handleRequest(req) {
//    41:   const data = req.body
//  > 42:   processData(data)
//    43: }'
console.log(loc.callstack);
// [{ functionName: 'handleRequest', url: '...', lineNumber: 42 }, ...]
```

**Throws**: Error if not paused.

#### `inspectGlobalVariables()`

Get names of global lexical scope variables (top-level `let`, `const`).

```js
const globals = await dbg.inspectGlobalVariables();
// ['CONFIG', 'apiClient', 'store']
```

---

### Stepping (Requires Paused State)

#### `stepOver()`

Execute the current line and pause at the next line. Does not enter function calls.

```js
await dbg.stepOver();
const newLoc = await dbg.getLocation();
```

#### `stepInto()`

Step into the function call on the current line.

```js
await dbg.stepInto();
// Now inside the called function
```

#### `stepOut()`

Run until the current function returns, then pause in the caller.

```js
await dbg.stepOut();
// Back in the calling function
```

#### `resume()`

Continue execution until the next breakpoint or completion.

```js
await dbg.resume();
```

All stepping methods **throw** if not paused.

---

### State

#### `isPaused()`

Check if the debugger is currently paused at a breakpoint.

```js
if (dbg.isPaused()) {
  const vars = await dbg.inspectLocalVariables();
}
```

---

### Exceptions

#### `setPauseOnExceptions({ state })`

Configure when to pause on exceptions.

| State | Behavior |
|-------|----------|
| `'none'` | Never pause on exceptions |
| `'uncaught'` | Pause only on uncaught exceptions |
| `'all'` | Pause on all exceptions (caught and uncaught) |

```js
// Catch that elusive error
await dbg.setPauseOnExceptions({ state: 'all' });

// Only care about crashes
await dbg.setPauseOnExceptions({ state: 'uncaught' });
```

---

### Scripts

#### `listScripts({ search? })`

Get available scripts where breakpoints can be set. Returns up to 20 results.

| Param | Type | Description |
|-------|------|-------------|
| `search` | `string?` | Filter URLs (case-insensitive) |

```js
// All scripts
const all = await dbg.listScripts();

// Find specific files
const handlers = await dbg.listScripts({ search: 'handler' });
// [{ scriptId: '5', url: 'https://example.com/handlers.js' }]
```

---

### Blackboxing

Skip library code when stepping. Blackboxed scripts are hidden from the call stack.

#### `setBlackboxPatterns({ patterns })`

Set regex patterns for scripts to skip. Replaces existing patterns.

```js
// Skip common frameworks
await dbg.setBlackboxPatterns({
  patterns: [
    'node_modules/react',
    'node_modules/react-dom',
    'node_modules/lodash',
    'webpack://'
  ]
});

// Clear all patterns
await dbg.setBlackboxPatterns({ patterns: [] });
```

#### `addBlackboxPattern({ pattern })`

Add a single pattern without clearing existing ones.

```js
await dbg.addBlackboxPattern({ pattern: 'node_modules/axios' });
```

#### `removeBlackboxPattern({ pattern })`

Remove a specific pattern.

```js
await dbg.removeBlackboxPattern({ pattern: 'node_modules/lodash' });
```

#### `listBlackboxPatterns()`

Get current blackbox patterns.

```js
const patterns = dbg.listBlackboxPatterns();
```

---

### XHR Breakpoints

Pause when a fetch/XHR request matches a URL pattern.

#### `setXHRBreakpoint({ url })`

```js
await dbg.setXHRBreakpoint({ url: '/api/users' });
```

#### `removeXHRBreakpoint({ url })`

```js
await dbg.removeXHRBreakpoint({ url: '/api/users' });
```

#### `listXHRBreakpoints()`

```js
const urls = dbg.listXHRBreakpoints();
```

---

## Common Patterns

### Debug a Specific Function

```js
const cdp = await getCDPSession({ page });
const dbg = createDebugger({ cdp });
await dbg.enable();

// Find the file
const scripts = await dbg.listScripts({ search: 'checkout' });
console.log(scripts);

// Set breakpoint (you need to know the line number)
await dbg.setBreakpoint({ file: scripts[0].url, line: 156 });

// Trigger the action on the page, then check if paused
// (In practice, you'd wait or poll)
if (dbg.isPaused()) {
  const loc = await dbg.getLocation();
  console.log('Paused at:', loc.sourceContext);

  const vars = await dbg.inspectLocalVariables();
  console.log('Variables:', vars);

  await dbg.resume();
}
```

### Catch All Errors

```js
const cdp = await getCDPSession({ page });
const dbg = createDebugger({ cdp });
await dbg.enable();

// Pause on any exception
await dbg.setPauseOnExceptions({ state: 'all' });

// Skip framework internals
await dbg.setBlackboxPatterns({
  patterns: ['node_modules', 'webpack://']
});

// When an error happens and we pause:
if (dbg.isPaused()) {
  const loc = await dbg.getLocation();
  console.log('Error at:', loc.url, 'line', loc.lineNumber);
  console.log(loc.sourceContext);

  const vars = await dbg.inspectLocalVariables();
  console.log('State when error occurred:', vars);
}
```

### Step Through a Flow

```js
const cdp = await getCDPSession({ page });
const dbg = createDebugger({ cdp });
await dbg.enable();

await dbg.setBreakpoint({ file: 'https://myapp.com/auth.js', line: 10 });

// After triggering and hitting the breakpoint:
while (dbg.isPaused()) {
  const loc = await dbg.getLocation();
  console.log(`Line ${loc.lineNumber}:`, loc.sourceContext.split('\n').find(l => l.startsWith('>')));

  const vars = await dbg.inspectLocalVariables();
  console.log('  vars:', Object.keys(vars).join(', '));

  await dbg.stepOver();
  // Small delay to let the step complete
  await new Promise(r => setTimeout(r, 100));
}
```

### Debug API Calls

```js
const cdp = await getCDPSession({ page });
const dbg = createDebugger({ cdp });
await dbg.enable();

// Break when any /api/ call is made
await dbg.setXHRBreakpoint({ url: '/api/' });

// When paused on XHR:
if (dbg.isPaused()) {
  const loc = await dbg.getLocation();
  console.log('API call from:', loc.callstack.map(f => f.functionName).join(' -> '));
}
```

---

## Troubleshooting

### "Debugger is not paused at a breakpoint"

You called a method that requires paused state (`inspectLocalVariables`, `stepOver`, etc.) but the debugger is not paused.

**Fix**: Check `dbg.isPaused()` before calling these methods. Make sure your breakpoint was actually hit.

### Breakpoint not being hit

1. Verify the URL is correct: `await dbg.listScripts({ search: 'yourfile' })`
2. Check the line number - source maps can shift lines
3. Make sure the code path is actually executed

### Scripts list is empty

Scripts are discovered as they're parsed. If you call `listScripts()` immediately after `enable()`, some scripts may not be loaded yet.

**Fix**: Either wait for the page to fully load, or reload the page after enabling the debugger.

```js
await dbg.enable();
await page.reload();
const scripts = await dbg.listScripts();
```

### Variables showing as "[object]"

`inspectLocalVariables()` shows simplified representations for objects. Use `evaluate()` to get full details:

```js
// Instead of vars.user showing "[object]"
const { value } = await dbg.evaluate({ expression: 'JSON.stringify(user, null, 2)' });
console.log(value);
```

### Page is frozen

The debugger pauses all JavaScript execution. Call `await dbg.resume()` to continue. If you lose the debugger reference, you may need to reload the page.
