# Styles API - Browserwright

> Inspect CSS styles applied to elements, like the browser DevTools "Styles" panel.

## Quick Start

```js
const cdp = await getCDPSession({ page });
const styles = await getStylesForLocator({
  locator: page.locator('.my-button'),
  cdp
});
console.log(formatStylesAsText(styles));
```

Output:
```
Element: button.my-button.primary

Inline styles:
  margin-top: 10px

Matched rules:
  .primary {
    /* stylesheet:abc123:15:0 */
    background-color: blue;
    color: white;
  }
  .my-button {
    /* stylesheet:abc123:10:0 */
    padding: 8px 16px;
    border-radius: 4px;
  }

Inherited from ancestor[1]:
  body {
    /* stylesheet:abc123:1:0 */
    font-family: sans-serif;
  }
```

## When to Use This

- Debug why a style isn't being applied
- Find which CSS rule is setting a property
- Understand style inheritance from parent elements
- Compare styles between two similar elements
- Find the source file and line number for a CSS rule

## Core Concepts

**Matched Rules**: CSS rules that directly match the element's selector. Listed in order of specificity (most specific first).

**Inherited Styles**: Rules from parent elements that apply to the element through CSS inheritance (font-family, color, etc.).

**Inline Styles**: Styles set directly via the `style` attribute on the element.

**Source Location**: For rules from stylesheets, you get the file URL, line number, and column where the rule is defined.

**User-Agent Styles**: Browser default styles. Hidden by default since you usually care about your own CSS.

---

## API Reference

### `getStylesForLocator({ locator, cdp, includeUserAgentStyles? })`

Get all CSS styles applied to an element.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `locator` | `Locator` | - | Playwright locator for the element |
| `cdp` | `CDPSession` | - | CDP session from `getCDPSession()` |
| `includeUserAgentStyles` | `boolean` | `false` | Include browser default styles |

Returns:
```ts
{
  element: string;                    // Element description (e.g., "div.card#main")
  inlineStyle: Record<string, string> | null; // Inline style declarations
  rules: StyleRule[];                 // Matched CSS rules
}
```

Each `StyleRule`:
```ts
{
  selector: string;           // CSS selector (e.g., ".btn-primary")
  source: {                   // Where this rule is defined
    url: string;              // Stylesheet URL
    line: number;             // Line number
    column: number;           // Column number
  } | null;
  origin: 'regular' | 'user-agent' | 'injected' | 'inspector';
  declarations: Record<string, string>; // Property-value pairs
  inheritedFrom: string | null;         // e.g., "ancestor[1]" if inherited
}
```

```js
const cdp = await getCDPSession({ page });

// Basic usage
const styles = await getStylesForLocator({
  locator: page.locator('.card'),
  cdp
});

// Include browser defaults
const withDefaults = await getStylesForLocator({
  locator: page.locator('input'),
  cdp,
  includeUserAgentStyles: true
});
```

---

### `formatStylesAsText(styles)`

Format a `StylesResult` as readable text. Great for logging or displaying results.

```js
const styles = await getStylesForLocator({
  locator: page.locator('.header'),
  cdp
});
console.log(formatStylesAsText(styles));
```

---

## Common Patterns

### Debug Why a Style Isn't Working

```js
const cdp = await getCDPSession({ page });

// Get styles for the element you're debugging
const styles = await getStylesForLocator({
  locator: page.locator('.my-element'),
  cdp
});

// Find all rules that set the property you're investigating
const backgroundRules = styles.rules.filter(r =>
  'background-color' in r.declarations
);

console.log('Rules setting background-color:');
for (const rule of backgroundRules) {
  console.log(`  ${rule.selector}: ${rule.declarations['background-color']}`);
  if (rule.source) {
    console.log(`    at ${rule.source.url}:${rule.source.line}`);
  }
  if (rule.inheritedFrom) {
    console.log(`    (inherited from ${rule.inheritedFrom})`);
  }
}
```

### Find Where a Property is Defined

```js
const cdp = await getCDPSession({ page });
const styles = await getStylesForLocator({
  locator: page.locator('.broken-layout'),
  cdp
});

// Find the rule that sets 'display'
const displayRule = styles.rules.find(r => 'display' in r.declarations);

if (displayRule) {
  console.log(`'display' is set by: ${displayRule.selector}`);
  if (displayRule.source) {
    console.log(`  File: ${displayRule.source.url}`);
    console.log(`  Line: ${displayRule.source.line}`);
  }
} else {
  console.log("'display' not explicitly set - using browser default");
}
```

### Check Inherited vs Direct Styles

```js
const cdp = await getCDPSession({ page });
const styles = await getStylesForLocator({
  locator: page.locator('.nested-text'),
  cdp
});

// Direct rules (applied to this element)
const directRules = styles.rules.filter(r => !r.inheritedFrom);
console.log('Direct rules:', directRules.length);
for (const rule of directRules) {
  console.log(`  ${rule.selector}`);
}

// Inherited rules (from parent elements)
const inheritedRules = styles.rules.filter(r => r.inheritedFrom);
console.log('\nInherited rules:', inheritedRules.length);
for (const rule of inheritedRules) {
  console.log(`  ${rule.selector} (from ${rule.inheritedFrom})`);
  console.log(`    Properties: ${Object.keys(rule.declarations).join(', ')}`);
}
```

### Compare Two Elements

```js
const cdp = await getCDPSession({ page });

const primary = await getStylesForLocator({
  locator: page.locator('.btn-primary'),
  cdp
});

const secondary = await getStylesForLocator({
  locator: page.locator('.btn-secondary'),
  cdp
});

// Find differences
const primaryProps = new Set(
  primary.rules.flatMap(r => Object.keys(r.declarations))
);
const secondaryProps = new Set(
  secondary.rules.flatMap(r => Object.keys(r.declarations))
);

console.log('Properties only in primary:',
  [...primaryProps].filter(p => !secondaryProps.has(p)));
console.log('Properties only in secondary:',
  [...secondaryProps].filter(p => !primaryProps.has(p)));
```

### Check Inline Styles

```js
const cdp = await getCDPSession({ page });
const styles = await getStylesForLocator({
  locator: page.locator('#dynamically-styled'),
  cdp
});

if (styles.inlineStyle) {
  console.log('Inline styles found:');
  for (const [prop, value] of Object.entries(styles.inlineStyle)) {
    console.log(`  ${prop}: ${value}`);
  }
  console.log('\nNote: Inline styles have highest specificity');
} else {
  console.log('No inline styles');
}
```

### Debug with User-Agent Styles

Sometimes the browser default is overriding your style. Include UA styles to see the full picture:

```js
const cdp = await getCDPSession({ page });
const styles = await getStylesForLocator({
  locator: page.locator('button'),
  cdp,
  includeUserAgentStyles: true
});

// Filter to just user-agent rules
const uaRules = styles.rules.filter(r => r.origin === 'user-agent');
console.log('Browser default styles:');
for (const rule of uaRules) {
  console.log(`  ${rule.selector}:`, rule.declarations);
}
```

### Get All Style Rules for Debugging

```js
const cdp = await getCDPSession({ page });
const styles = await getStylesForLocator({
  locator: page.locator('.problem-element'),
  cdp
});

// Full inspection
console.log('=== Element:', styles.element, '===\n');

if (styles.inlineStyle) {
  console.log('INLINE STYLES');
  for (const [prop, value] of Object.entries(styles.inlineStyle)) {
    console.log(`  ${prop}: ${value}`);
  }
  console.log();
}

console.log('MATCHED RULES (in specificity order):');
for (const rule of styles.rules.filter(r => !r.inheritedFrom)) {
  console.log(`\n  ${rule.selector} {`);
  if (rule.source) {
    console.log(`    /* ${rule.source.url}:${rule.source.line} */`);
  }
  for (const [prop, value] of Object.entries(rule.declarations)) {
    console.log(`    ${prop}: ${value};`);
  }
  console.log('  }');
}
```

---

## Troubleshooting

### "Could not get element handle from locator"

The locator doesn't match any element, or the element isn't in the DOM.

**Fixes**:
1. Verify the element exists: `await locator.count()` should return > 0
2. Wait for the element: `await locator.waitFor()`
3. Check your selector: `await page.locator('.my-class').first().isVisible()`

### "Element has no bounding box"

The element exists but has no visual representation (display: none, zero size, or off-screen).

**Fix**: Ensure the element is visible:
```js
await locator.scrollIntoViewIfNeeded();
const styles = await getStylesForLocator({ locator, cdp });
```

### Rules array is empty

The element may only have inherited styles or user-agent styles.

**Fix**: Enable user-agent styles and check inherited:
```js
const styles = await getStylesForLocator({
  locator,
  cdp,
  includeUserAgentStyles: true
});
console.log('All rules including UA:', styles.rules.length);
```

### Source is null for a rule

The rule may be:
- Injected dynamically via JavaScript
- From an inline `<style>` tag without source mapping
- A browser-generated rule

This is normal for some rules. The declarations are still accurate.

### Properties seem to be missing

Some CSS properties are filtered out:
- Properties with `initial` values
- Webkit-prefixed properties (`-webkit-*`)
- Properties without values

This keeps the output focused on meaningful styles.
