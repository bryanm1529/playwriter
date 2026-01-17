/**
 * RefRegistry - Manages short reference aliases (@e1, @e2) for aria-refs
 *
 * This provides a cleaner syntax for element references:
 * - Instead of: page.locator('aria-ref=e16')
 * - Use: page.locator('@e16')
 *
 * The registry maintains a bidirectional mapping and can transform code
 * containing @eN patterns into their aria-ref equivalents.
 */

export class RefRegistry {
  /**
   * Transform code containing @eN patterns to aria-ref=eN patterns
   *
   * @example
   * // Input:  "await page.locator('@e5').click()"
   * // Output: "await page.locator('aria-ref=e5').click()"
   */
  static resolveShortRefs(code: string): string {
    return code.replace(
      /(['"`])@(e\d+)\1/g,
      (_, quote, ref) => `${quote}aria-ref=${ref}${quote}`
    )
  }
}

/**
 * Transform snapshot output to use @eN format for easier reference
 *
 * @example
 * // Input:  "- link \"Home\" [ref=e5] [cursor=pointer]:"
 * // Output: "- link \"Home\" [ref=@e5] [cursor=pointer]:"
 */
export function addShortRefPrefix(snapshot: string): string {
  return snapshot.replace(/\[ref=(e\d+)\]/g, '[ref=@$1]')
}
