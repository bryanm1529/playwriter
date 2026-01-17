/**
 * Snapshot Filter - Token optimization for accessibility snapshots
 *
 * Provides filtering options to dramatically reduce snapshot size:
 * - interactive: Only show clickable/typeable elements (70-80% reduction)
 * - compact: Minimal output format (additional 30% reduction)
 * - maxDepth: Limit nesting depth
 * - maxLength: Truncate output
 */

// Roles that represent interactive elements (clickable, typeable)
// Imported from aria-snapshot.ts to maintain consistency
export const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'combobox',
  'searchbox',
  'checkbox',
  'radio',
  'slider',
  'spinbutton',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'treeitem',
])

export interface SnapshotFilterOptions {
  /** Only show interactive elements (button, link, textbox, etc.) */
  interactive?: boolean
  /** Output in compact format: "@e5 link Home" instead of full YAML */
  compact?: boolean
  /** Maximum indentation depth to include */
  maxDepth?: number
  /** Maximum output length in characters */
  maxLength?: number
}

/**
 * Extract the role from a snapshot line
 *
 * @example
 * // "- link \"Home\" [ref=e5] [cursor=pointer]:" => "link"
 * // "- table [ref=e3]:" => "table"
 */
function extractRole(line: string): string | null {
  // Match role at start of content: "- role" or "- role \"name\""
  const match = line.match(/^\s*-\s+(\w+)/)
  return match ? match[1] : null
}

/**
 * Extract the ref from a snapshot line
 *
 * @example
 * // "- link \"Home\" [ref=e5] [cursor=pointer]:" => "e5"
 */
function extractRef(line: string): string | null {
  const match = line.match(/\[ref=(e\d+)\]/)
  return match ? match[1] : null
}

/**
 * Extract the name/text from a snapshot line
 *
 * @example
 * // "- link \"Home\" [ref=e5]:" => "Home"
 * // "- button \"Submit Form\" [ref=e6]:" => "Submit Form"
 */
function extractName(line: string): string | null {
  const match = line.match(/^\s*-\s+\w+\s+"([^"]*)"/)
  return match ? match[1] : null
}

/**
 * Get indentation level (number of leading spaces / 2)
 */
function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/)
  return match ? Math.floor(match[1].length / 2) : 0
}

/**
 * Convert a full snapshot line to compact format
 *
 * @example
 * // "- link \"Home\" [ref=e5] [cursor=pointer]:" => "@e5 link Home"
 * // "          - button \"Submit\" [ref=e16]:" => "@e16 button Submit"
 */
function toCompactFormat(line: string): string | null {
  const role = extractRole(line)
  const ref = extractRef(line)

  if (!role || !ref) return null

  const name = extractName(line)
  const nameStr = name ? ` ${name}` : ''

  return `@${ref} ${role}${nameStr}`
}

/**
 * Filter and transform a snapshot based on options
 *
 * @returns Filtered and possibly transformed snapshot string
 */
export function filterSnapshot(
  snapshot: string,
  options: SnapshotFilterOptions
): string {
  const { interactive, compact, maxDepth, maxLength } = options

  let lines = snapshot.split('\n')

  // Filter by interactive roles
  if (interactive) {
    lines = lines.filter(line => {
      const role = extractRole(line)
      return role && INTERACTIVE_ROLES.has(role)
    })
  }

  // Filter by max depth
  if (maxDepth !== undefined) {
    lines = lines.filter(line => getIndentLevel(line) <= maxDepth)
  }

  // Transform to compact format
  if (compact) {
    lines = lines
      .map(line => toCompactFormat(line))
      .filter((line): line is string => line !== null)
  }

  let result = lines.join('\n')

  // Truncate if needed
  if (maxLength && result.length > maxLength) {
    result = result.slice(0, maxLength - 3) + '...'
  }

  return result
}
