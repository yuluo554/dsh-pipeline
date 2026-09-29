/**
 * M4 fold/projection unit tests (plan/05 运行视图): the pure state machine
 * shared by the host recorder and the browser run card. Covers the member
 * lifecycle fold, the last-member node status rule (retry recovery vs abort
 * mid-node), the interrupted projection, and the per-model cost totals the
 * comparison badge renders.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { foldStart, foldUpdate, projectPipelineRun, sumUsage } from '../lib/run-events.js'

const PLAN = [
  { id: 'outline', label: '大纲' },
  { id: 'review', label: '复查', model: 'deepseek-reasoner' },
  { id: 'write', label: '成文', model: 'deepseek-chat' },
]

function runStartEvent(nodes = PLAN, startedAt = 1000) {
  return { type: 'pipeline-run/run-start', data: { runId: 'run-1', name: 'three-node-two-models', nodes, startedAt } }
}

function agentStart(seq, label, { phase = label, childId = `child-${seq}`, model, startedAt = 2000 + seq } = {}) {
  return {
    type: 'pipeline-run/agent-start',
    data: { runId: 'run-1', seq, label, phase, childId, startedAt, ...(model !== undefined ? { model } : {}) },
  }
}

function agentEnd(seq, outcome, { durationMs = 100, usage } = {}) {
  return { type: 'pipeline-run/agent-end', data: { runId: 'run-1', seq, outcome, durationMs, ...(usage !== undefined ? { usage } : {}) } }
}

function runEnd(stopReason, durationMs = 5000, error) {
  return { type: 'pipeline-run/run-end', data: { runId: 'run-1', stopReason, durationMs, ...(error !== undefined ? { error } : {}) } }
}

function fold(...events) {
  let state = foldStart(runStartEvent().data)
  for (const event of events) state = foldUpdate(state, event)
  return state
}

test('fold: agent-start appends a member; agent-end patches the same seq', () => {
  const started = foldStart(runStartEvent().data)
  assert.equal(started.members.length, 0)
  assert.deepEqual(started.nodes.map((node) => node.id), ['outline', 'review', 'write'])

  const withMember = foldUpdate(started, agentStart(1, '大纲'))
  assert.equal(withMember.members.length, 1)
  assert.equal(withMember.members[0].outcome, undefined)
  assert.equal(withMember.members[0].childId, 'child-1')

  const settled = foldUpdate(withMember, agentEnd(1, 'completed', { durationMs: 1200, usage: { inputTokens: 100, outputTokens: 50 } }))
  assert.equal(settled.members[0].outcome, 'completed')
  assert.equal(settled.members[0].durationMs, 1200)
  assert.deepEqual(settled.members[0].usage, { inputTokens: 100, outputTokens: 50 })
  // Unchanged reference contract: unrelated updates return the same state.
  assert.equal(foldUpdate(settled, runStartEvent()), settled)
})

test('projection: planned nodes render pending before any agent call', () => {
  const data = projectPipelineRun(fold(runEnd('completed')))
  assert.equal(data.status, 'completed')
  assert.deepEqual(data.nodes.map((node) => node.status), ['pending', 'pending', 'pending'])
  assert.equal(data.durationMs, 5000)
  assert.deepEqual(data.models, [])
})

test('projection: node status follows the LAST member (retry recovery, abort mid-node)', () => {
  // Retry that recovered: failed attempt then a completed rerun -> completed.
  const recovered = projectPipelineRun(fold(
    agentStart(1, '大纲'),
    agentEnd(1, 'failed', { durationMs: 300 }),
    agentStart(2, '大纲'),
    agentEnd(2, 'completed', { durationMs: 700, usage: { inputTokens: 10, outputTokens: 5 } }),
  ))
  const outline = recovered.nodes.find((node) => node.id === 'outline')
  assert.equal(outline.status, 'completed')
  assert.equal(outline.attempts, 2)
  assert.equal(outline.durationMs, 1000) // real cost: the failed attempt's time counts

  // Multi-prompt abort: p1 completed, p2 failed -> the node failed.
  const aborted = projectPipelineRun(fold(
    agentStart(1, '大纲', { phase: '大纲' }),
    agentEnd(1, 'completed'),
    agentStart(2, '大纲 #2', { phase: '大纲' }),
    agentEnd(2, 'failed'),
  ))
  assert.equal(aborted.nodes.find((node) => node.id === 'outline').status, 'failed')

  // Skip: one failed attempt and the node settled null -> failed.
  const skipped = projectPipelineRun(fold(agentStart(1, '大纲'), agentEnd(1, 'failed')))
  assert.equal(skipped.nodes.find((node) => node.id === 'outline').status, 'failed')
})

test('projection: live run shows running; run-end maps stopReason to card status', () => {
  const live = projectPipelineRun(fold(agentStart(1, '大纲')))
  assert.equal(live.status, 'running')
  assert.equal(live.nodes.find((node) => node.id === 'outline').status, 'running')
  assert.equal(live.durationMs, undefined)

  assert.equal(projectPipelineRun(fold(agentStart(1, '大纲'), agentEnd(1, 'cancelled'), runEnd('cancelled'))).status, 'cancelled')
  assert.equal(projectPipelineRun(fold(agentStart(1, '大纲'), agentEnd(1, 'failed'), runEnd('error', 10))).status, 'failed')
  const errored = projectPipelineRun(fold(runEnd('error', 10, 'boom')))
  assert.equal(errored.error, 'boom')
})

test('projection: interrupted when the record never closed in a closed location', () => {
  const state = fold(agentStart(1, '大纲'), agentStart(2, '复查', { model: 'deepseek-reasoner' }))
  const interrupted = projectPipelineRun(state, { interrupted: true })
  assert.equal(interrupted.status, 'interrupted')
  assert.equal(interrupted.nodes.find((node) => node.id === 'outline').status, 'interrupted')
  assert.equal(interrupted.nodes.find((node) => node.id === 'write').status, 'pending')
  // The same state without closure stays running (web-initiated runs live
  // outside any turn, so only transports with step-hosted records use this).
  assert.equal(projectPipelineRun(state).status, 'running')
})

test('projection: per-model totals group by declared route incl. failed attempts', () => {
  const data = projectPipelineRun(fold(
    agentStart(1, '大纲'), // no model -> session default
    agentEnd(1, 'completed', { durationMs: 1000, usage: { inputTokens: 100, outputTokens: 40 } }),
    agentStart(2, '复查', { model: 'deepseek-reasoner' }),
    agentEnd(2, 'failed', { durationMs: 500, usage: { inputTokens: 200, outputTokens: 10 } }),
    agentStart(3, '复查', { model: 'deepseek-reasoner' }),
    agentEnd(3, 'completed', { durationMs: 900, usage: { inputTokens: 250, outputTokens: 60, cacheReadTokens: 30 } }),
    agentStart(4, '成文', { model: 'deepseek-chat' }),
    agentEnd(4, 'completed', { durationMs: 800, usage: { inputTokens: 50, outputTokens: 300 } }),
    runEnd('completed'),
  ))
  assert.equal(data.models.length, 3)
  const byModel = new Map(data.models.map((route) => [route.model, route]))
  const defaults = byModel.get(null)
  assert.equal(defaults.calls, 1)
  assert.deepEqual(defaults.usage, { inputTokens: 100, outputTokens: 40 })
  const reasoner = byModel.get('deepseek-reasoner')
  assert.equal(reasoner.calls, 2)
  assert.equal(reasoner.durationMs, 1400) // failed + successful attempt
  assert.deepEqual(reasoner.usage, { inputTokens: 450, outputTokens: 70, cacheReadTokens: 30 })
  const chat = byModel.get('deepseek-chat')
  assert.deepEqual(chat.usage, { inputTokens: 50, outputTokens: 300 })
  // Node rows carry their plan model and summed member usage.
  const review = data.nodes.find((node) => node.id === 'review')
  assert.equal(review.model, 'deepseek-reasoner')
  assert.equal(review.attempts, 2)
})

test('projection: members with a phase matching no planned node surface anyway', () => {
  const data = projectPipelineRun(fold(
    agentStart(1, '外来阶段', { phase: '外来阶段' }),
    agentEnd(1, 'completed', { durationMs: 100 }),
  ))
  assert.equal(data.nodes.length, 4)
  assert.equal(data.nodes.find((node) => node.id === '外来阶段').status, 'completed')
})

test('sumUsage: absent buckets stay absent; empty list is undefined', () => {
  assert.equal(sumUsage([]), undefined)
  assert.deepEqual(
    sumUsage([{ inputTokens: 1, outputTokens: 2 }, { inputTokens: 3, outputTokens: 4, totalTokens: 7 }]),
    { inputTokens: 4, outputTokens: 6, totalTokens: 7 },
  )
  assert.deepEqual(
    sumUsage([{ inputTokens: 1, outputTokens: 2, cacheReadTokens: 5 }, { inputTokens: 1, outputTokens: 1 }]),
    { inputTokens: 2, outputTokens: 3, cacheReadTokens: 5 },
  )
})
