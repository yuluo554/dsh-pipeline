/**
 * Session integration (M4): the recorder driven against the REAL
 * @deepseek-ai/dsh-session (the exact package the dsh host bundles, same
 * pattern as real-engine.test.js). Proves the two things stubs cannot:
 * - the real Session.append accepts the four `pipeline-run/*` events
 *   (JSON validation, envelope freeze, surface eligibility); and
 * - a FRESH reader reconstructs the session from the log without refusing
 *   the unknown (out-of-catalog) event types — the uninstall-compatibility
 *   guarantee the `ignorable`/log-only vocabulary rules demand.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from '@deepseek-ai/dsh-session'
import { createPipelineRunRecorder } from '../lib/run-recorder.js'

function captureHost() {
  const handlers = new Map()
  return {
    handlers,
    on(event, handler) {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
  }
}

test('real Session accepts pipeline-run events and reconstructs from the log', () => {
  const session = Session.create('integration-run-card')
  const host = captureHost()
  const recorder = createPipelineRunRecorder(host)
  try {
    recorder.start(
      session,
      { id: 'live-run-1' },
      'three-node-two-models',
      [
        { id: 'outline', label: 'Outline', provider: 'deepseek', model: 'deepseek-chat' },
        { id: 'review', label: 'Review' },
      ],
    )
    host.handlers.get('workflow/agent-start')({ id: 'live-run-1' }, { seq: 1, label: 'Outline', phase: 'Outline', childId: 'child-1' })
    host.handlers.get('session/event')({ id: 'child-1' }, { type: 'assistant/message', data: { usage: { inputTokens: 120, outputTokens: 45, totalTokens: 165 } } })
    host.handlers.get('workflow/agent-end')({ id: 'live-run-1' }, { seq: 1, outcome: 'completed', childId: 'child-1' })
    host.handlers.get('workflow/agent-start')({ id: 'live-run-1' }, { seq: 2, label: 'Review', phase: 'Review', childId: 'child-2' })
    host.handlers.get('workflow/agent-end')({ id: 'live-run-1' }, { seq: 2, outcome: 'cancelled', childId: 'child-2' })
    recorder.finish('live-run-1', 'cancelled')

    const types = session.snapshotEvents().map((event) => event.type)
    assert.deepEqual(types, [
      'pipeline-run/run-start',
      'pipeline-run/agent-start',
      'pipeline-run/agent-end',
      'pipeline-run/agent-start',
      'pipeline-run/agent-end',
      'pipeline-run/run-end',
    ])
    const events = session.snapshotEvents()
    assert.equal(events[0].data.name, 'three-node-two-models')
    assert.deepEqual(events[0].data.nodes[0], { id: 'outline', label: 'Outline', provider: 'deepseek', model: 'deepseek-chat' })
    assert.equal(events[1].data.startedAt > 0, true)
    assert.deepEqual(events[2].data.usage, { inputTokens: 120, outputTokens: 45, totalTokens: 165 })
    assert.equal(events.at(-1).data.stopReason, 'cancelled')
    // Deep-frozen envelope: the durable log is immutable.
    assert.equal(Object.isFrozen(events[0]), true)
  } finally {
    recorder.dispose()
  }

  // A fresh reader (e.g. after plugin uninstall, or the next process) must
  // reconstruct the session from the log: unknown log-only event types are
  // tolerated, sequence continuity and surface validation hold. Restoring by
  // seed replays/forks, so the restored log carries one extra
  // `session/end-seed` cut marker behind the inherited prefix.
  const restored = Session.create('integration-run-card', session.snapshotEvents())
  assert.equal(restored.seq, session.seq + 1)
  const restoredTypes = restored.snapshotEvents().map((event) => event.type)
  assert.deepEqual(restoredTypes.slice(0, -1), session.snapshotEvents().map((event) => event.type))
  assert.equal(restoredTypes.at(-1), 'session/end-seed')
  assert.deepEqual(restored.snapshotEvents().at(-1).data, {})
  // The restored log keeps accepting appends (the session is alive).
  restored.append('turn/start', { turn: 1 })
  assert.equal(restored.snapshotEvents().at(-1).type, 'turn/start')
})
