import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Clean-environment regression (M5 release gate, plan/RELEASE-M5.md): B1
// compares compiled output against frozen snapshots byte-exact, and a Windows
// clone with core.autocrlf=true used to rewrite the frozen fixtures to CRLF
// on checkout — all of B1 then failed while the dev tree stayed green.
// .gitattributes now forces LF on checkout; this test turns any regression
// back into a loud, self-explaining failure instead of 7 opaque B1 diffs.
test('frozen fixtures are LF-clean (byte-exact B1 contract survives Windows clones)', () => {
  const offenders = []
  for (const dir of ['data/snapshots', 'data/pipelines', 'data/invalid']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!f.endsWith('.js') && !f.endsWith('.json')) continue
      const rel = join(dir, f)
      if (readFileSync(join(ROOT, rel), 'utf8').includes('\r')) offenders.push(rel)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `CRLF bytes found in: ${offenders.join(', ')} — checkout rewrote line endings; ` +
      '.gitattributes must keep LF everywhere (see plan/RELEASE-M5.md finding #1)',
  )
})
