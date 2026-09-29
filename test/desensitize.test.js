import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Release gate (plan/05, plan/RELEASE-M5.md): the desensitization audit runs
// with the normal suite, so a secret, a personal path, or a dirty history
// fails the build before any push can expose it. scripts/release-audit.mjs
// exits non-zero and prints DESSENSITIZE_AUDIT_FAIL on any unallowlisted hit;
// an all-pass run prints DESSENSITIZE_AUDIT_OK.
test('desensitization audit passes (working tree + full history)', () => {
  let out
  try {
    out = execFileSync(process.execPath, ['scripts/release-audit.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    assert.fail(`release audit failed:\n${err.stdout || ''}${err.stderr || ''}`)
  }
  assert.match(out, /DESSENSITIZE_AUDIT_OK/)
})
