/**
 * M4 run-recorder tests: the host-side projection of one web-initiated run
 * into the parent session's event log. Drives the recorder with captured
 * host-event handlers (workflow/agent-start|end + session/event firehose) and
 * a collecting stub session, asserting the appended event sequence, the
 * duration/token aggregation, the recording-failure guard (a failed append
 * disables the run's recording without throwing), and listener disposal.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPipelineRunRecorder } from '../lib/run-recorder.js'

/** Stub host context capturing event subscriptions by name. */
function stubHost() {
  const handlers = new Map()
  const warnings = []
  return {
    handlers,
    warnings,
    on(event, handler) {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
    logger: { warn: (message) => warnings.push(message) },
  }
}

function stubSession() {
  const log = []
  return {
    log,
    append(type, data) {
      log.push({ type, data })
    },
  }
}

const NODES = [
  { id: 'outline', label: '大纲' },
  { id: 'review', label: '复查', model: 'deepseek-reasoner' },
]

test('recorder appends run-start -> agent events -> run-end with aggregated facts', () => {
  const host = stubHost()
  const session = stubSession()
  const recorder = createPipelineRunRecorder(host)
  try {
    recorder.start(session, { id: 'run-1' }, 'three-node-two-models', NODES)
    assert.equal(session.log.length, 1)
    assert.equal(session.log[0].type, 'pipeline-run/run-start')
    assert.deepEqual(
      { name: session.log[0].data.name, runId: session.log[0].data.runId, nodes: session.log[0].data.nodes },
      { name: 'three-node-two-models', runId: 'run-1', nodes: NODES },
    )
    assert.equal(typeof session.log[0].data.startedAt, 'number')

    host.handlers.get('workflow/agent-start')({ id: 'run-1' }, { seq: 1, label: '大纲', phase: '大纲', childId: 'child-1' })
    // Child usage arrives on the session/event firehose as assistant/message
    // usage events keyed by the child session id.
    host.handlers.get('session/event')({ id: 'child-1' }, { type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 } } })
    host.handlers.get('session/event')({ id: 'child-1' }, { type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 5 } } })
    // Unrelated sessions/events must not leak into the totals.
    host.handlers.get('session/event')({ id: 'other-session' }, { type: 'assistant/message', data: { usage: { inputTokens: 999, outputTokens: 999 } } })
    host.handlers.get('session/event')({ id: 'child-1' }, { type: 'step/end', data: {} })

    host.handlers.get('workflow/agent-end')({ id: 'run-1' }, { seq: 1, outcome: 'completed', childId: 'child-1' })
    host.handlers.get('workflow/agent-start')({ id: 'run-1' }, { seq: 2, label: '复查', phase: '复查', childId: 'child-2' })
    host.handlers.get('workflow/agent-end')({ id: 'run-1' }, { seq: 2, outcome: 'cancelled', childId: 'child-2' })
    recorder.finish('run-1', 'cancelled')

    const types = session.log.map((entry) => entry.type)
    assert.deepEqual(types, [
      'pipeline-run/run-start',
      'pipeline-run/agent-start',
      'pipeline-run/agent-end',
      'pipeline-run/agent-start',
      'pipeline-run/agent-end',
      'pipeline-run/run-end',
    ])
    const [firstStart, secondStart] = session.log.filter((entry) => entry.type === 'pipeline-run/agent-start').map((entry) => entry.data)
    assert.deepEqual({ seq: firstStart.seq, phase: firstStart.phase, model: firstStart.model ?? null }, { seq: 1, phase: '大纲', model: null })
    assert.equal(firstStart.childId, 'child-1')
    assert.deepEqual({ seq: secondStart.seq, model: secondStart.model }, { seq: 2, model: 'deepseek-reasoner' })

    const [firstEnd, secondEnd] = session.log.filter((entry) => entry.type === 'pipeline-run/agent-end').map((entry) => entry.data)
    assert.equal(firstEnd.outcome, 'completed')
    assert.equal(firstEnd.durationMs >= 0, true)
    assert.deepEqual(firstEnd.usage, { inputTokens: 110, outputTokens: 45, totalTokens: 140 })
    assert.equal(secondEnd.usage, undefined)

    const end = session.log.at(-1).data
    assert.equal(end.stopReason, 'cancelled')
    assert.equal(end.runId, 'run-1')
    assert.equal(end.durationMs >= 0, true)
  } finally {
    recorder.dispose()
  }
})

test('recorder: phase fallback uses the bare label when the engine sends no phase', () => {
  const host = stubHost()
  const session = stubSession()
  const recorder = createPipelineRunRecorder(host)
  try {
    recorder.start(session, { id: 'run-1' }, 'n', NODES)
    host.handlers.get('workflow/agent-start')({ id: 'run-1' }, { seq: 1, label: '复查', childId: 'child-1' })
    const start = session.log.at(-1).data
    assert.equal(start.model, 'deepseek-reasoner')
    assert.equal(start.phase, undefined)
  } finally {
    recorder.dispose()
  }
})

test('recorder: multi-prompt label matches by phase, not the " #k" suffixed label', () => {
  const host = stubHost()
  const session = stubSession()
  const recorder = createPipelineRunRecorder(host)
  try {
    recorder.start(session, { id: 'run-1' }, 'n', [{ id: 'draft', label: '成文', model: 'deepseek-chat' }])
    host.handlers.get('workflow/agent-start')({ id: 'run-1' }, { seq: 1, label: '成文 #2', phase: '成文', childId: 'child-1' })
    assert.equal(session.log.at(-1).data.model, 'deepseek-chat')
  } finally {
    recorder.dispose()
  }
})

test('recorder: a failed append disables that run recording without throwing', () => {
  const host = stubHost()
  const session = stubSession()
  session.append = () => {
    throw new Error('log closed')
  }
  const recorder = createPipelineRunRecorder(host)
  try {
    recorder.start(session, { id: 'run-1' }, 'n', NODES)
    // start's own append failed -> the run is disabled; further events no-op.
    host.handlers.get('workflow/agent-start')({ id: 'run-1' }, { seq: 1, label: '大纲', phase: '大纲', childId: 'child-1' })
    recorder.finish('run-1', 'completed')
    assert.deepEqual(session.log, [])
    assert.match(host.warnings[0], /disabled run recording after pipeline-run\/run-start append failed: log closed/)
  } finally {
    recorder.dispose()
  }
})

test('recorder: a mid-run append failure stops that run but later runs still record', () => {
  const host = stubHost()
  const session = stubSession()
  let failNext = false
  const failures = session.append.bind(session)
  session.append = (type, data) => {
    if (failNext) {
      failNext = false
      throw new Error('disk full')
    }
    failures(type, data)
  }
  const recorder = createPipelineRunRecorder(host)
  try {
    recorder.start(session, { id: 'run-1' }, 'n', NODES)
    failNext = true
    host.handlers.get('workflow/agent-start')({ id: 'run-1' }, { seq: 1, label: '大纲', phase: '大纲', childId: 'child-1' })
    host.handlers.get('workflow/agent-end')({ id: 'run-1' }, { seq: 1, outcome: 'completed', childId: 'child-1' })
    recorder.finish('run-1', 'completed')
    assert.deepEqual(session.log.map((entry) => entry.type), ['pipeline-run/run-start'])

    recorder.start(session, { id: 'run-2' }, 'n', NODES)
    host.handlers.get('workflow/agent-start')({ id: 'run-2' }, { seq: 1, label: '大纲', phase: '大纲', childId: 'child-9' })
    recorder.finish('run-2', 'completed')
    assert.deepEqual(session.log.map((entry) => entry.type), ['pipeline-run/run-start', 'pipeline-run/run-start', 'pipeline-run/agent-start', 'pipeline-run/run-end'])
  } finally {
    recorder.dispose()
  }
})

test('recorder: events of foreign runs and post-dispose life are ignored; dispose detaches', () => {
  const host = stubHost()
  const session = stubSession()
  const recorder = createPipelineRunRecorder(host)
  recorder.start(session, { id: 'run-1' }, 'n', NODES)
  host.handlers.get('workflow/agent-start')({ id: 'other-run' }, { seq: 1, label: 'x', childId: 'c' })
  assert.equal(session.log.length, 1)

  recorder.dispose()
  assert.equal(host.handlers.size, 0, 'dispose must detach every listener')
  host.handlers.get('workflow/agent-start')?.({ id: 'run-1' }, { seq: 1, label: 'x', childId: 'c' })
  recorder.start(session, { id: 'run-9' }, 'n', NODES)
  assert.equal(session.log.length, 1, 'a disposed recorder records nothing')
  recorder.dispose() // idempotent
})
