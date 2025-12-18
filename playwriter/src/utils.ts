import fs from 'node:fs'
import path from 'node:path'
import { xdgData } from 'xdg-basedir'

export function getCdpUrl({ port = 19988, host = '127.0.0.1' }: { port?: number; host?: string } = {}) {
  const id = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}`
  return `ws://${host}:${port}/cdp/${id}`
}

export function getDataDir(): string {
  return path.join(xdgData!, 'playwriter')
}

export function ensureDataDir(): string {
  const dataDir = getDataDir()
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  return dataDir
}

export function getLogFilePath(): string {
  return process.env.PLAYWRITER_LOG_PATH || path.join(getDataDir(), 'relay-server.log')
}

// export function getDidPromptReviewPath(): string {
//   return path.join(getDataDir(), 'did-prompt-review')
// }

// export function hasReviewedPrompt(): boolean {
//   return fs.existsSync(getDidPromptReviewPath())
// }

// export function markPromptReviewed(): void {
//   ensureDataDir()
//   fs.writeFileSync(getDidPromptReviewPath(), new Date().toISOString())
// }
