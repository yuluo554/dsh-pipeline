/** Shared offline test helpers: fixture loading + minimal seam stubs. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FsError } from '@deepseek-ai/dsh-fs'
import { validateDef } from '../lib/schema.js'

export { validateDef }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export function fixture(name) {
  return JSON.parse(readFileSync(join(ROOT, 'data', 'pipelines', name), 'utf8'))
}

export function invalidFixture(name) {
  return JSON.parse(readFileSync(join(ROOT, 'data', 'invalid', name), 'utf8'))
}

/** All capabilities on — mirrors the in-process spawn/fork providers. */
export const FULL_CAPS = Object.freeze({
  agentOptions: true,
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
})

export const NO_CAPS = Object.freeze({
  agentOptions: false,
  outputSchema: false,
  depthLimit: false,
  toolFilter: false,
  persona: false,
})

export const FAKE_AGENT = { session: { id: 'stub-session' } }

/**
 * Minimal FileSystem stub: `files` is a Map of workspace-relative POSIX-ish
 * paths to content. Implements only what store.ts uses (resolve/readText/
 * writeText/listDir); missing paths throw real FsError(FS_NOT_FOUND) and a
 * missing directory lists as empty, mirroring the local backend.
 */
export function makeStubFs(files = new Map()) {
  const normalize = (p) => p.replaceAll('\\', '/').replace(/^\.\//, '')
  return {
    files,
    async resolve(path) {
      return { targetKey: normalize(path), displayPath: normalize(path) }
    },
    async readText(target) {
      const content = files.get(target.targetKey)
      if (content === undefined) throw new FsError(`cannot read "${target.displayPath}"`, 'FS_NOT_FOUND')
      return content
    },
    async writeText(target, content) {
      files.set(target.targetKey, content)
      return { operation: 'create' }
    },
    async listDir(target) {
      const prefix = target.targetKey.endsWith('/') ? target.targetKey : `${target.targetKey}/`
      const names = new Set()
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length)
          if (!rest.includes('/')) names.add(rest)
        }
      }
      return [...names].map((name) => ({ name, type: 'file', target: { targetKey: prefix + name } }))
    },
  }
}
