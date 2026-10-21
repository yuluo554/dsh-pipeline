import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

// dsh runtime versions this plugin claims to support, and the ones it must
// refuse. 0.2.1-rc.2 is the runtime installed on the M6 dev machine and the
// one the M5 manifest failed (12/13 unmet peers) — it is the regression case.
const ACCEPTED = ['0.2.0-rc.1', '0.2.0-rc.2', '0.2.0', '0.2.1-rc.2', '0.2.1', '0.2.9']
const REJECTED = ['0.3.0-0', '0.3.0-beta.1', '0.4.0-alpha', '1.0.0']

// ---------------------------------------------------------------------------
// Copied from dsh-app-boot's plugin-compatibility check, NOT imported: the
// host resolves this module through its own private node_modules tree
// (`.../@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`)
// and has no stable public export path. Source of truth (dsh 0.2.1-rc.2):
//
//   function satisfies(runtimeVersion, range) {
//     return range.trim() !== '' && semver.satisfies(runtimeVersion, range, { includePrerelease: true })
//   }
//   function unmetRequirements(fields, runtimeVersion) {
//     const engines = Object.hasOwn(fields, 'engines') ? objectOf1(fields.engines, 'Plugin manifest engines') : {}
//     if (Object.hasOwn(engines, 'dsh')) { ... return satisfies(runtimeVersion, range) ? {} : { 'engines.dsh': range } }
//     if (!Object.hasOwn(fields, 'peerDependencies')) return {}
//     ... if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
//     ... if (!satisfies(...)) unmet[name] = range
//   }
//   -> index.js:276-298 (the JSDoc at :300-305 states the contract: "An own
//      engines.dsh range decides alone and peerDependencies are ignored;
//      otherwise every @deepseek-ai/dsh or @deepseek-ai/dsh-* peer must match.
//      Prereleases participate in ranges.")
//
// NOTE on includePrerelease: the host passes `{ includePrerelease: true }`.
// This makes `>=0.2.0-rc.1` match `0.2.1-rc.2` — the M6 diagnostic report
// claimed the opposite (it tested the default options). The real reason the
// M5 manifest failed on 0.2.1-rc.2 is that its peers pinned the EXACT string
// "0.2.0-rc.1", which is unsatisfiable by any other version. Corrected in
// update/03-更正-兼容性判定.md; the assertion below pins that behaviour.
// ---------------------------------------------------------------------------

/** Verbatim host semantics: prereleases participate in every range. */
function satisfies(runtimeVersion, range) {
  return range.trim() !== '' && semver.satisfies(runtimeVersion, range, { includePrerelease: true })
}

/** Verbatim host semantics for the two fields dsh actually reads. */
function unmetRequirements(fields, runtimeVersion) {
  const engines = Object.hasOwn(fields, 'engines') ? fields.engines : {}
  if (Object.hasOwn(engines, 'dsh')) {
    const range = engines.dsh
    if (typeof range !== 'string') throw new Error('Plugin manifest engines.dsh must be a string')
    return satisfies(runtimeVersion, range) ? {} : { 'engines.dsh': range }
  }
  if (!Object.hasOwn(fields, 'peerDependencies')) return {}
  const unmet = {}
  for (const [name, range] of Object.entries(fields.peerDependencies)) {
    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
    if (!satisfies(runtimeVersion, range)) unmet[name] = range
  }
  return unmet
}

test('manifest declares engines.dsh — the field dsh actually validates', () => {
  assert.equal(
    typeof manifest.engines?.dsh,
    'string',
    'engines.dsh missing: dsh would fall back to the exact-pinned peerDependencies and refuse 0.2.1-rc.2',
  )
  // A bare `>=0.2.0-rc.1` is NOT enough: with includePrerelease the host would
  // then accept dsh 1.0.0, contradicting README's "only the 0.2.x preview line".
  assert.equal(manifest.engines.dsh, '>=0.2.0-rc.1 <0.3.0-0')
})

test('every accepted runtime has zero unmet requirements (incl. the 0.2.1-rc.2 regression)', () => {
  for (const runtime of ACCEPTED) {
    assert.deepEqual(
      unmetRequirements(manifest, runtime),
      {},
      `dsh ${runtime} would be refused: ${JSON.stringify(unmetRequirements(manifest, runtime))}`,
    )
  }
})

test('every out-of-line runtime is refused (0.3+ must not pass silently)', () => {
  for (const runtime of REJECTED) {
    assert.deepEqual(
      unmetRequirements(manifest, runtime),
      { 'engines.dsh': '>=0.2.0-rc.1 <0.3.0-0' },
      `dsh ${runtime} must be reported unmet`,
    )
  }
})

test('engines.dsh wins over peerDependencies — peers are not the deciding field', () => {
  // The host ignores peers whenever engines.dsh exists. Proving it here keeps
  // someone from "fixing" a future failure by widening the 13 peers instead of
  // the one range that is actually read.
  const dshPeers = Object.entries(manifest.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
  assert.equal(dshPeers.length, 12, 'the twelve @deepseek-ai/dsh-* peers drive the dev install')
  assert.ok(
    dshPeers.every(([, range]) => range === '0.2.0-rc.1'),
    'peers still pin the exact dev versions — engines.dsh is what keeps them from deciding',
  )
  assert.deepEqual(unmetRequirements(manifest, '0.2.1-rc.2'), {}, 'engines.dsh must shadow the exact peers')
})

test('dsh.compatibility is documentation-only and stays consistent with engines.dsh', () => {
  // dsh never reads manifest.dsh.compatibility (only engines.dsh and
  // peerDependencies — index.js:279-298). It is kept as human-facing metadata,
  // so it must not contradict the range that is enforced.
  const declared = manifest.dsh?.compatibility?.dsh
  assert.equal(typeof declared, 'string', 'keep the field but make it a string')
  for (const runtime of ACCEPTED) assert.ok(satisfies(runtime, declared), `${runtime} should satisfy ${declared}`)
  for (const runtime of REJECTED) assert.ok(!satisfies(runtime, declared), `${runtime} should not satisfy ${declared}`)
})
