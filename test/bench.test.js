import test from 'node:test'
import assert from 'node:assert/strict'
import { runB1, runB2, runB3, runB4 } from '../lib/bench.js'

// CI 门 = 基准门（plan/04：测试全绿 <=> B1-B4 指标达标）。
// 详细指标表用 `pnpm bench` 输出；这里断言同一结果。

test('B1: compiled fixtures match frozen snapshots byte-for-byte (0 diff)', () => {
  const b1 = runB1()
  assert.deepEqual(b1.diffs, [], `snapshot diffs in: ${b1.diffs.join(', ')}`)
})

test('B2: validation matrix is 100% (every fixture rejects/accepts as frozen)', () => {
  const b2 = runB2()
  assert.equal(b2.failures.size, 0, [...b2.failures.entries()].map(([f, { expected, actual }]) => `${f}: expected ${expected}, got ${actual}`).join('; '))
  assert.ok(b2.cases >= 22, `expected at least 22 matrix cases, got ${b2.cases}`)
})

test('B3: mock-engine e2e scenarios match exactly', async () => {
  const b3 = await runB3()
  assert.deepEqual(b3.failures, [])
  assert.equal(b3.scenarios, 4)
})

test('B4: failure-policy matrix matches exactly (skip/retry/default/cancel)', async () => {
  const b4 = await runB4()
  assert.deepEqual(b4.failures, [])
  assert.equal(b4.scenarios, 6)
})
