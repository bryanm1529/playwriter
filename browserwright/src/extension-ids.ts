/**
 * Extension IDs - Single Source of Truth
 *
 * All extension ID references should use this module.
 * To add a new dev extension ID, update /extension-ids.json at the repo root.
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load from the single source of truth at repo root
const configPath = path.resolve(__dirname, '../../..', 'extension-ids.json')

interface ExtensionIdsConfig {
  production: string
  development: string[]
}

let config: ExtensionIdsConfig

try {
  config = require(configPath)
} catch {
  // Fallback if config not found (e.g., in production build)
  config = {
    production: 'jfeammnjpkecdekppnclgkkffahnhfhe',
    development: []
  }
}

/**
 * All known extension IDs (production + all development)
 */
export const EXTENSION_IDS: string[] = [
  config.production,
  ...config.development
]

/**
 * Production extension ID (Chrome Web Store)
 */
export const PRODUCTION_EXTENSION_ID = config.production

/**
 * Development extension IDs (loaded unpacked)
 */
export const DEV_EXTENSION_IDS = config.development

/**
 * Check if an extension ID is one of ours
 */
export function isOurExtension(extensionId: string): boolean {
  return EXTENSION_IDS.includes(extensionId)
}
