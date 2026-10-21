import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEST_DIR = join(ROOT, 'test')

// ---------------------------------------------------------------------------
// Self-reported test count guard (M6). README.md stated two different numbers
// for the same suite ("101 例" in the benchmarks section, "99 例" in the dev
// command table) while `node --test` collected 101 — the drift outlived M5
// because nothing compared the claim to the collection. This guard makes the
// next drift loud instead of silent.
//
// Collection rule mirrored here (node 20/22/24, `node --test` with no args:
// every .js file directly under test/ is a test file; a file that registers no
// test() still reports as one file-level pass, which is why test/helpers.js
// shows up as `ok N - test/helpers.js` in the TAP output and inflates the
// suite total by one).
// ---------------------------------------------------------------------------

/** Count test() declarations a file registers; 0-declaration files still count as one file entry. */
function collectedCount() {
  let total = 0
  for (const file of readdirSync(TEST_DIR).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(join(TEST_DIR, file), 'utf8')
    const declared = source.split(/\r?\n/).filter((line) => /^test\(/.test(line)).length
    total += declared === 0 ? 1 : declared
  }
  return total
}

/** Every "<N> 例" / "<N> tests" claim in README, with its line number. */
function claims() {
  const found = []
  const lines = readFileSync(join(ROOT, 'README.md'), 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/(\d+)\s*例/g)) found.push({ n: Number(match[1]), line: index + 1, text: match[0] })
  })
  return found
}

test('README states exactly one test count and it equals what the suite collects', () => {
  const actual = collectedCount()
  const found = claims()
  assert.ok(found.length > 0, 'README must state the suite size somewhere (nothing matched "<N> 例")')
  assert.deepEqual(
    found.map((c) => c.n),
    found.map(() => actual),
    `README claims ${found.map((c) => `"${c.text}" (line ${c.line})`).join(', ')} but the suite collects ${actual} — update every spot, not just one`,
  )
})