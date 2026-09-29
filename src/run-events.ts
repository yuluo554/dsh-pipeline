/**
 * Pipeline-run event vocabulary + fold (M4, plan/05).
 *
 * The web-initiated run records its lifecycle into the PARENT session's
 * durable event log (`session.append`) — the same transport the official
 * dsh-tool-workflow uses for `tool-workflow/*` (verified against 0.1.5-rc.1:
 * the recorder listens to `workflow/agent-start|end` host events and appends
 * paired session events; the browser Conversation engine replays the session
 * log, so the run card survives disconnect/reconnect without dirty state).
 * `workflow/*` itself is NOT on dsh-api-remotes' API_REMOTE_FORWARDED_EVENTS
 * allowlist — the session log is the forwarding path, not the remote bus.
 *
 * This module is the single source of truth for the four event shapes and
 * the fold/projection the browser card renders from: the host recorder
 * (run-recorder.ts) produces, the client definition (client/run-card.tsx)
 * consumes, and the offline Node tests (test/run-events.test.js) exercise —
 * no second copy to drift. Event data is JSON-only (`Session.append`
 * validates with isJsonValue).
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** How one run settled (mirrors WorkflowStopReason — JSON duplicate by design). */
export type PipelineRunStopReason = 'completed' | 'cancelled' | 'error'

/** How one agent() call settled (mirrors WorkflowAgentOutcome). */
export type PipelineRunAgentOutcome = 'completed' | 'failed' | 'cancelled'

/** Card-visible status of a run or one node. */
export type PipelineRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

/** Token accounting summed from child-session `assistant/message` usage. */
export interface PipelineRunUsageTotals {
  inputTokens: number
  outputTokens: number
  /** Present only when at least one summed event reported the bucket. */
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** One planned node of the run (from the definition IR), recorded at run start. */
export interface PipelineRunNodePlan {
  readonly id: string
  /** The phase title every agent() call of this node carries (compiler 口径). */
  readonly label: string
  readonly provider?: string
  readonly model?: string
}

// ---------------------------------------------------------------------------
// Durable event data (the SessionEventMap extension)
// ---------------------------------------------------------------------------

/** `pipeline-run/run-start`: opens one run record on the parent session. */
export interface PipelineRunStartData {
  readonly runId: string
  readonly name: string
  /** Planned node chain in IR (topological) order — pending rows before any agent starts. */
  readonly nodes: readonly PipelineRunNodePlan[]
  /** Host-clock receipt time (ms) of engine.start acceptance. */
  readonly startedAt: number
}

/** `pipeline-run/agent-start`: one agent() call accepted by the engine. */
export interface PipelineRunAgentStartData {
  readonly runId: string
  /** 1-based engine-side sequence of the call within the run. */
  readonly seq: number
  readonly label: string
  /** The phase() title the call ran under (absent when the engine sent none). */
  readonly phase?: string
  readonly childId: SessionId
  /** Node-declared routing (definition intent), absent when the node follows the session default. */
  readonly provider?: string
  readonly model?: string
  /** Host-clock receipt time (ms) — the duration baseline for agent-end. */
  readonly startedAt: number
}

/** `pipeline-run/agent-end`: one agent() call settled. */
export interface PipelineRunAgentEndData {
  readonly runId: string
  /** Pairs with the agent-start of the same seq. */
  readonly seq: number
  readonly outcome: PipelineRunAgentOutcome
  /** Host-clock wall time from agent-start receipt to agent-end receipt (ms). */
  readonly durationMs: number
  /** Child-session token totals; absent when the adapter reported no usage. */
  readonly usage?: PipelineRunUsageTotals
}

/** `pipeline-run/run-end`: closes the run record. */
export interface PipelineRunEndData {
  readonly runId: string
  readonly stopReason: PipelineRunStopReason
  /** Host-clock wall time from run-start receipt to run-end receipt (ms). */
  readonly durationMs: number
  /** Failure detail for stopReason 'error' (already localized by the runner). */
  readonly error?: string
}

/** Structural event slice the fold consumes (SessionEvent narrows into it). */
export type PipelineRunEvent =
  | { readonly type: 'pipeline-run/run-start'; readonly data: PipelineRunStartData }
  | { readonly type: 'pipeline-run/agent-start'; readonly data: PipelineRunAgentStartData }
  | { readonly type: 'pipeline-run/agent-end'; readonly data: PipelineRunAgentEndData }
  | { readonly type: 'pipeline-run/run-end'; readonly data: PipelineRunEndData }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** dsh-pipeline: opens one web-initiated pipeline run record. */
    'pipeline-run/run-start': PipelineRunStartData
    /** dsh-pipeline: records one accepted pipeline agent call. */
    'pipeline-run/agent-start': PipelineRunAgentStartData
    /** dsh-pipeline: records one settled pipeline agent call. */
    'pipeline-run/agent-end': PipelineRunAgentEndData
    /** dsh-pipeline: closes the pipeline run record. */
    'pipeline-run/run-end': PipelineRunEndData
  }
}

// ---------------------------------------------------------------------------
// Fold state (pure; the client definition adopts it as ConversationNodeDefinition State)
// ---------------------------------------------------------------------------

/** One started agent() call as the fold tracks it. */
export interface PipelineRunMemberState {
  readonly seq: number
  readonly label: string
  readonly phase?: string
  readonly childId: SessionId
  readonly provider?: string
  readonly model?: string
  readonly startedAt: number
  readonly outcome?: PipelineRunAgentOutcome
  readonly durationMs?: number
  readonly usage?: PipelineRunUsageTotals
}

/** Fold state: the run-start facts plus the members accrued from updates. */
export interface PipelineRunState {
  readonly name: string
  readonly nodes: readonly PipelineRunNodePlan[]
  readonly stopReason?: PipelineRunStopReason
  readonly error?: string
  readonly durationMs?: number
  readonly members: readonly PipelineRunMemberState[]
}

/** Create the state for one run-start event. */
export function foldStart(data: PipelineRunStartData): PipelineRunState {
  return {
    name: data.name,
    nodes: data.nodes,
    members: [],
  }
}

/**
 * Apply one post-start event. Unknown types (e.g. a replayed run-start)
 * return the same state reference — the unchanged-reference contract the
 * Conversation engine relies on to skip work.
 */
export function foldUpdate(state: PipelineRunState, event: PipelineRunEvent): PipelineRunState {
  if (event.type === 'pipeline-run/agent-start') {
    const data = event.data
    const member: PipelineRunMemberState = {
      seq: data.seq,
      label: data.label,
      childId: data.childId,
      startedAt: data.startedAt,
      ...(data.phase !== undefined ? { phase: data.phase } : {}),
      ...(data.provider !== undefined ? { provider: data.provider } : {}),
      ...(data.model !== undefined ? { model: data.model } : {}),
    }
    return { ...state, members: [...state.members, member] }
  }
  if (event.type === 'pipeline-run/agent-end') {
    const data = event.data
    return {
      ...state,
      members: state.members.map((member) => member.seq === data.seq
        ? {
            ...member,
            outcome: data.outcome,
            durationMs: data.durationMs,
            ...(data.usage !== undefined ? { usage: data.usage } : {}),
          }
        : member),
    }
  }
  if (event.type === 'pipeline-run/run-end') {
    const data = event.data
    return {
      ...state,
      stopReason: data.stopReason,
      durationMs: data.durationMs,
      ...(data.error !== undefined ? { error: data.error } : {}),
    }
  }
  return state
}

// ---------------------------------------------------------------------------
// Projection (the keyed card's read-only data)
// ---------------------------------------------------------------------------

/** Projected node row: planned facts + the aggregate over its agent calls. */
export interface PipelineRunNodeView {
  readonly id: string
  readonly label: string
  readonly provider?: string
  readonly model?: string
  readonly status: PipelineRunStatus
  /** Agent calls started for this node (retry reruns inflate it). */
  readonly attempts: number
  /** Summed member wall time (failed/retried attempts included — real cost). */
  readonly durationMs: number
  /** Summed member tokens; absent when no member reported usage. */
  readonly usage?: PipelineRunUsageTotals
}

/** Projected per-model total: the cost-comparison badge row. */
export interface PipelineRunModelTotal {
  /** Declared model id; null = the session default route. */
  readonly model: string | null
  readonly provider?: string
  readonly calls: number
  readonly durationMs: number
  readonly usage?: PipelineRunUsageTotals
}

/** Final keyed Chat payload for one pipeline run. */
export interface PipelineRunChatData {
  readonly name: string
  readonly status: PipelineRunStatus
  readonly stopReason?: PipelineRunStopReason
  readonly error?: string
  /** Whole-run wall time; present once run-end folded. */
  readonly durationMs?: number
  readonly nodes: readonly PipelineRunNodeView[]
  readonly models: readonly PipelineRunModelTotal[]
}

function memberStatus(state: PipelineRunState, member: PipelineRunMemberState, interrupted: boolean): PipelineRunStatus {
  if (member.outcome === undefined) return interrupted ? 'interrupted' : 'running'
  if (member.outcome === 'completed') return 'completed'
  return member.outcome // 'failed' | 'cancelled' map 1:1
}

/**
 * Node status from its members: running beats everything while the run is
 * live; after interruption unfinished members are interrupted; otherwise the
 * LAST member by seq decides — a retry that recovered ends completed, a
 * failed last attempt (abort/skip/exhausted-retry) ends failed.
 */
function nodeStatus(members: readonly PipelineRunMemberState[], state: PipelineRunState, interrupted: boolean): PipelineRunStatus {
  if (members.length === 0) return 'pending'
  const statuses = members.map((member) => memberStatus(state, member, interrupted))
  if (statuses.includes('running')) return 'running'
  if (statuses.includes('interrupted')) return 'interrupted'
  const last = members.reduce((a, b) => (b.seq >= a.seq ? b : a))
  return memberStatus(state, last, interrupted)
}

/** Sum token buckets across usages; a bucket absent everywhere stays absent. */
export function sumUsage(usages: readonly PipelineRunUsageTotals[]): PipelineRunUsageTotals | undefined {
  if (usages.length === 0) return undefined
  const totals: PipelineRunUsageTotals = { inputTokens: 0, outputTokens: 0 }
  let sawTotal = false
  let sawCacheRead = false
  let sawCacheWrite = false
  let sawReasoning = false
  for (const usage of usages) {
    totals.inputTokens += usage.inputTokens
    totals.outputTokens += usage.outputTokens
    if (usage.totalTokens !== undefined) {
      totals.totalTokens = (totals.totalTokens ?? 0) + usage.totalTokens
      sawTotal = true
    }
    if (usage.cacheReadTokens !== undefined) {
      totals.cacheReadTokens = (totals.cacheReadTokens ?? 0) + usage.cacheReadTokens
      sawCacheRead = true
    }
    if (usage.cacheWriteTokens !== undefined) {
      totals.cacheWriteTokens = (totals.cacheWriteTokens ?? 0) + usage.cacheWriteTokens
      sawCacheWrite = true
    }
    if (usage.reasoningTokens !== undefined) {
      totals.reasoningTokens = (totals.reasoningTokens ?? 0) + usage.reasoningTokens
      sawReasoning = true
    }
  }
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    ...(sawTotal ? { totalTokens: totals.totalTokens } : {}),
    ...(sawCacheRead ? { cacheReadTokens: totals.cacheReadTokens } : {}),
    ...(sawCacheWrite ? { cacheWriteTokens: totals.cacheWriteTokens } : {}),
    ...(sawReasoning ? { reasoningTokens: totals.reasoningTokens } : {}),
  }
}

/**
 * Project the fold state into the card payload. `interrupted` marks a run
 * that never folded run-end while its session location already closed
 * (disconnect/reconnect or host death) — members without outcome render
 * interrupted instead of running forever.
 */
export function projectPipelineRun(state: PipelineRunState, options: { interrupted?: boolean } = {}): PipelineRunChatData {
  const interrupted = options.interrupted === true
  const membersByPhase = new Map<string, PipelineRunMemberState[]>()
  for (const member of state.members) {
    const key = member.phase ?? member.label
    const group = membersByPhase.get(key)
    if (group === undefined) membersByPhase.set(key, [member])
    else group.push(member)
  }
  const plannedLabels = new Set(state.nodes.map((node) => node.label))
  const views: PipelineRunNodeView[] = []
  for (const plan of state.nodes) {
    const members = membersByPhase.get(plan.label) ?? []
    const usage = sumUsage(members.map((member) => member.usage).filter((u) => u !== undefined))
    views.push({
      id: plan.id,
      label: plan.label,
      status: nodeStatus(members, state, interrupted),
      attempts: members.length,
      durationMs: members.reduce((sum, member) => sum + (member.durationMs ?? 0), 0),
      ...(plan.provider !== undefined ? { provider: plan.provider } : {}),
      ...(plan.model !== undefined ? { model: plan.model } : {}),
      ...(usage !== undefined ? { usage } : {}),
    })
  }
  // Members whose phase matches no planned node (defensive: foreign or
  // drifted phase titles) surface as their own rows instead of vanishing.
  for (const [phase, members] of membersByPhase) {
    if (plannedLabels.has(phase)) continue
    const usage = sumUsage(members.map((member) => member.usage).filter((u) => u !== undefined))
    views.push({
      id: phase,
      label: phase,
      status: nodeStatus(members, state, interrupted),
      attempts: members.length,
      durationMs: members.reduce((sum, member) => sum + (member.durationMs ?? 0), 0),
      ...(usage !== undefined ? { usage } : {}),
    })
  }
  // Cost comparison: group members by declared route (provider|model; null
  // model = session default), summing real spend incl. failed attempts.
  const byRoute = new Map<string, { provider?: string; model: string | null; members: PipelineRunMemberState[] }>()
  for (const member of state.members) {
    const key = `${member.provider ?? ''}|${member.model ?? ''}`
    let route = byRoute.get(key)
    if (route === undefined) {
      route = { ...(member.provider !== undefined ? { provider: member.provider } : {}), model: member.model ?? null, members: [] }
      byRoute.set(key, route)
    }
    route.members.push(member)
  }
  const models: PipelineRunModelTotal[] = [...byRoute.values()].map((route) => {
    const usage = sumUsage(route.members.map((member) => member.usage).filter((u) => u !== undefined))
    return {
      model: route.model,
      ...(route.provider !== undefined ? { provider: route.provider } : {}),
      calls: route.members.length,
      durationMs: route.members.reduce((sum, member) => sum + (member.durationMs ?? 0), 0),
      ...(usage !== undefined ? { usage } : {}),
    }
  })
  const runStatus = state.stopReason === undefined
    ? (interrupted ? 'interrupted' : 'running')
    : state.stopReason === 'error' ? 'failed' : state.stopReason // completed | cancelled
  return {
    name: state.name,
    status: runStatus,
    nodes: views,
    models,
    ...(state.stopReason !== undefined ? { stopReason: state.stopReason } : {}),
    ...(state.error !== undefined ? { error: state.error } : {}),
    ...(state.durationMs !== undefined ? { durationMs: state.durationMs } : {}),
  }
}
