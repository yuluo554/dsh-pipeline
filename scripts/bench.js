#!/usr/bin/env node
/**
 * `pnpm bench` — one command, all offline benchmark metrics (plan/04).
 * B1 compile snapshots, B2 validation matrix, B3 mock-engine e2e, B4
 * failure-policy matrix. Exit 1 on any regression.
 */
import { runB1, runB2, runB3, runB4 } from '../lib/bench.js'

const b1 = runB1()
const b2 = runB2()
const b3 = await runB3()
const b4 = await runB4()

const b1Metric = b1.files.length - b1.diffs.length
const b2Metric = b2.cases - b2.failures.size
const b3Metric = b3.scenarios - b3.failures.length
const b4Metric = b4.scenarios - b4.failures.length

console.log('dsh-pipeline offline benchmarks (plan/04) — zero API dependency')
console.log('================================================================')
console.log(`B1 compile snapshots : ${b1Metric}/${b1.files.length} byte-exact   (threshold: ${b1.files.length}/${b1.files.length}, 0 diff)`)
if (b1.diffs.length > 0) console.log(`  diffed fixtures    : ${b1.diffs.join(', ')}`)
console.log(`B2 validation matrix : ${b2Metric}/${b2.cases} expected outcomes (threshold: 100%)`)
for (const [file, { expected, actual }] of b2.failures) console.log(`  ${file}: expected ${expected}, got ${actual}`)
console.log(`B3 mock engine e2e   : ${b3Metric}/${b3.scenarios} scenarios matched (threshold: exact)`)
for (const failure of b3.failures) console.log(`  ${failure}`)
console.log(`B4 policy matrix     : ${b4Metric}/${b4.scenarios} scenarios matched (threshold: exact)`)
for (const failure of b4.failures) console.log(`  ${failure}`)

const green = b1.diffs.length === 0 && b2.failures.size === 0 && b3.failures.length === 0 && b4.failures.length === 0
console.log('================================================================')
console.log(green ? 'ALL GREEN' : 'REGRESSION DETECTED')
process.exit(green ? 0 : 1)
