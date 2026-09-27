import test from 'node:test'
import assert from 'node:assert/strict'
import { runPipeline } from '../lib/runner.js'
import { MockWorkflowEngine } from '../lib/mock-engine.js'
import { fixture, FULL_CAPS, NO_CAPS, FAKE_AGENT } from './helpers.js'

function deps(overrides = {}) {
  const engine = overrides.engine ?? new MockWorkflowEngine({ behavior: { defaultResponse: 'out' } })
  return {
    engine,
    caps: overrides.caps ?? FULL_CAPS,
    parent: FAKE_AGENT,
    providerName: overrides.providerName ?? 'spawn',
    ...(overrides.signal !== undefined ? { signal: overrides.signal } : {}),
  }
}

test('runner pins the run to the probed provider and the exact agent-call bound', async () => {
  const engine = new MockWorkflowEngine({ behavior: { defaultResponse: 'ok' } })
  await runPipeline(deps({ engine }), fixture('three-node-two-models.json'), 'the topic')
  assert.equal(engine.lastRequest.subagentProvider, 'spawn')
  assert.equal(engine.lastRequest.maxTotalAgents, 3)
  assert.equal(engine.lastRequest.args, 'the topic')
  assert.equal(engine.lastRequest.meta.name, 'three-node-two-models')
  assert.deepEqual(engine.lastRequest.meta.phases.map((p) => p.title), ['Outline', 'Review', 'Write'])
  assert.equal(typeof engine.lastRequest.script, 'string')
})

test('capability precheck fails loud naming nodes when agentOptions is missing (口径 4)', async () => {
  const engine = new MockWorkflowEngine()
  await assert.rejects(
    runPipeline(deps({ engine, caps: NO_CAPS }), fixture('three-node-two-models.json'), 'x'),
    (err) => {
      assert.equal(err.code, 'CAPABILITY_MISSING')
      assert.match(err.message, /"spawn" does not support agentOptions/)
      assert.match(err.message, /"outline", "write"/)
      // 预检先行：引擎不得收到请求
      assert.equal(engine.lastRequest, undefined)
      return true
    },
  )
})

test('capability precheck fails loud for outputSchema when missing', async () => {
  const engine = new MockWorkflowEngine()
  await assert.rejects(
    runPipeline(deps({ engine, caps: NO_CAPS }), fixture('output-schema.json'), 'x'),
    (err) => {
      assert.equal(err.code, 'CAPABILITY_MISSING')
      assert.match(err.message, /does not support outputSchema/)
      assert.match(err.message, /"keywords"/)
      return true
    },
  )
})

test('no-capability provider still runs pipelines without those features', async () => {
  const engine = new MockWorkflowEngine({ behavior: { defaultResponse: 'ok' } })
  const outcome = await runPipeline(deps({ engine, caps: NO_CAPS }), fixture('single-node.json'), 'x')
  assert.equal(outcome.stopReason, 'completed')
})

test('engine synchronous rejection is wrapped with the pipeline name', async () => {
  const boom = { start: () => { throw new Error('invalid meta: meta.name must be a non-empty string') } }
  await assert.rejects(
    runPipeline(deps({ engine: boom }), fixture('single-node.json'), 'x'),
    (err) => {
      assert.equal(err.code, 'ENGINE_ERROR')
      assert.match(err.message, /workflow engine rejected the run of pipeline "single-node"/)
      return true
    },
  )
})

test('runner maps a non-completed result without throwing (seam contract)', async () => {
  const engine = new MockWorkflowEngine({ behavior: { failAtCalls: [1] } })
  const outcome = await runPipeline(deps({ engine }), fixture('single-node.json'), 'x')
  assert.equal(outcome.stopReason, 'error')
  assert.match(outcome.error, /node "echo" failed at prompt 1/)
  assert.equal(outcome.agentsStarted, 1)
})

test('runner forwards an abort signal as run.cancel (official tool pattern)', async () => {
  const engine = new MockWorkflowEngine({
    behavior: { cancelAfterCalls: 1 },
  })
  const controller = new AbortController()
  const outcome = await runPipeline(deps({ engine, signal: controller.signal }), fixture('single-node.json'), 'x')
  assert.equal(outcome.stopReason, 'cancelled')
  // dispose path settled the run cleanly
  assert.equal(engine.events[engine.events.length - 1], 'workflow:end:cancelled')
})
