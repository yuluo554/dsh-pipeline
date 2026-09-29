/**
 * Pipeline-run Conversation Definition (M4, plan/05) — the browser half of
 * the run card. One keyed Chat node folds the four `pipeline-run/*` session
 * events of a run; the fold and projection are the shared pure functions from
 * src/run-events.ts (single source of truth, exercised offline in Node).
 *
 * Pattern verified against the official dsh-client-ui-workflow-run 0.1.5-rc.1
 * bundle: match -> start/update -> buildViewNode with anchorSeq/location from
 * the start event. Durability (the DoD "no dirty render after
 * disconnect/reconnect"): every render fact re-derives from the replayed
 * durable events — no transport-lived state anywhere; a run that lost its
 * run-end (host death) projects 'interrupted' instead of a stale 'running'.
 */
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationLocation, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { foldStart, foldUpdate, projectPipelineRun } from '../src/run-events.js'
import type { PipelineRunChatData, PipelineRunState } from '../src/run-events.js'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** dsh-pipeline: one web-initiated pipeline run with node-chain status and cost badges. */
    'pipeline-run': PipelineRunChatData
  }
}

/**
 * Whether the definition's start Location already closed (turn/step ended).
 * Mirrors the official workflow-run heuristic: a run whose record never
 * folded run-end inside a closed location did not survive to report — it
 * renders interrupted, not running.
 */
function locationClosed(location: ConversationLocation): boolean {
  if (location.kind === 'step') return location.step.status === 'closed' || location.turn.status === 'closed'
  return location.kind === 'turn' && location.turn.status === 'closed'
}

/** Durable pipeline-run event family folded into one keyed Chat node. */
export const pipelineRunDefinition: ConversationNodeDefinition<PipelineRunState> = {
  kind: 'pipeline-run',
  target: 'chat',
  match: (event) => {
    if (event.type === 'pipeline-run/run-start') return { id: String(event.data.runId), role: 'start' }
    if (event.type === 'pipeline-run/agent-start' || event.type === 'pipeline-run/agent-end' || event.type === 'pipeline-run/run-end') {
      return { id: String(event.data.runId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'pipeline-run/run-start') throw new Error('pipeline-run start requires pipeline-run/run-start')
    return foldStart(match.event.data)
  },
  update: (context, match) => {
    const event = match.event
    if (event.type === 'pipeline-run/agent-start' || event.type === 'pipeline-run/agent-end' || event.type === 'pipeline-run/run-end') {
      return foldUpdate(context.state, event)
    }
    return context.state
  },
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined || context.state === undefined) return null
    const interrupted = context.state.stopReason === undefined && locationClosed(context.start.location)
    const data = projectPipelineRun(context.state, { interrupted })
    return {
      key: context.key,
      kind: 'pipeline-run',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data,
    }
  },
}
