/**
 * Pipeline-run recorder (M4, plan/05) — projects one web-initiated run into
 * the parent session's durable event log so the browser renders the run card
 * from the session stream. Structure mirrors the verified dsh-tool-workflow
 * recorder (0.1.5-rc.1): listen to the `workflow/agent-start|agent-end` host
 * events, append paired `pipeline-run/*` session events, and NEVER let a
 * recording failure touch the run (the first failed append disables the run's
 * recording, like the official one). Two additions over the official shape:
 * per-call wall time (host-clock diff across the paired events) and per-call
 * token totals (summed from the child session's `assistant/message` usage
 * events observed on the `session/event` firehose while the run is active).
 *
 * Cross-seam discipline (HANDOFF 坑 2): no instanceof anywhere — structural
 * slices for ctx/session and try/catch around every host callback. Listeners
 * subscribe at recorder creation and dispose exactly once from dispose().
 */
import type {
  PipelineRunAgentEndData,
  PipelineRunAgentStartData,
  PipelineRunEndData,
  PipelineRunNodePlan,
  PipelineRunStartData,
  PipelineRunStopReason,
  PipelineRunUsageTotals,
} from './run-events.js'

/** Structural slice of the host context the recorder needs (tests stub it). */
export interface RecorderHost {
  /** Cordis event subscription; returns the disposer. */
  on(event: string, handler: (...args: never[]) => void): unknown
  /** Optional: the recorder warns once when an append fails. */
  logger?: { warn(message: string): void }
}

/** Structural slice of the parent Session the recorder appends to. */
export interface RecorderSession {
  append(type: string, data: unknown): unknown
}

/** The engine-side run handle the recorder keys everything by. */
export interface RecorderRun {
  readonly id: string
}

/** One recording event handler signature as the host events deliver it. */
type WorkflowAgentHandler = (info: { id: string }, agent: { seq: number; label: string; phase?: string; childId: string; outcome?: string }) => void
type SessionEventHandler = (session: { id?: unknown }, event: { type?: unknown; data?: unknown }) => void

interface ActiveRun {
  readonly session: RecorderSession
  readonly nodes: ReadonlyMap<string, PipelineRunNodePlan>
  /** Child-session usage accumulation, keyed by childId, alive until agent-end. */
  readonly usage: Map<string, PipelineRunUsageTotals>
  /** Host-clock receipt time per `seq` agent-start (duration baseline). */
  readonly startedAt: Map<number, number>
  /** Host-clock receipt time of run-start (run duration baseline). */
  readonly runStartedAt: number
}

export interface PipelineRunRecorder {
  /**
   * Append `pipeline-run/run-start` and begin recording. Called synchronously
   * with the accepted run handle; `name` is the display name (the engine
   * handle carries only the id) and `nodes` is the planned chain in IR order.
   * A session without a working append disables this run's recording.
   */
  start(session: RecorderSession, run: RecorderRun, name: string, nodes: readonly PipelineRunNodePlan[]): void
  /** Append `pipeline-run/run-end` and stop recording the run. */
  finish(runId: string, stopReason: PipelineRunStopReason, error?: string): void
  /** Detach every listener (idempotent); pending runs stop recording. */
  dispose(): void
}

/** Create one recorder per web run: its listeners live exactly for the run. */
export function createPipelineRunRecorder(ctx: RecorderHost): PipelineRunRecorder {
  const active = new Map<string, ActiveRun>()
  const disposers: Array<unknown> = []
  let disposed = false

  /** One guarded append: failure disables the run's recording (official rule). */
  function append(runId: string, session: RecorderSession, type: string, data: unknown): boolean {
    try {
      session.append(type, data)
      return true
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      ctx.logger?.warn(`dsh-pipeline: disabled run recording after ${type} append failed: ${detail}`)
      active.delete(runId)
      return false
    }
  }

  const onAgentStart: WorkflowAgentHandler = (info, agent) => {
    const entry = active.get(info.id)
    if (entry === undefined) return
    const startedAt = Date.now()
    entry.startedAt.set(agent.seq, startedAt)
    // Route facts follow the planned node the call runs under (the compiler
    // emits phase(node.phaseTitle) before every call; the bare label alone
    // may carry the multi-prompt " #k" suffix).
    const plan = entry.nodes.get(agent.phase ?? agent.label)
    entry.usage.set(String(agent.childId), { inputTokens: 0, outputTokens: 0 })
    const data: PipelineRunAgentStartData = {
      runId: info.id,
      seq: agent.seq,
      label: agent.label,
      childId: agent.childId as never,
      startedAt,
      ...(agent.phase !== undefined ? { phase: agent.phase } : {}),
      ...(plan?.provider !== undefined ? { provider: plan.provider } : {}),
      ...(plan?.model !== undefined ? { model: plan.model } : {}),
    }
    append(info.id, entry.session, 'pipeline-run/agent-start', data)
  }

  const onAgentEnd: WorkflowAgentHandler = (info, agent) => {
    const entry = active.get(info.id)
    if (entry === undefined) return
    if (agent.outcome !== 'completed' && agent.outcome !== 'failed' && agent.outcome !== 'cancelled') return
    const startedAt = entry.startedAt.get(agent.seq)
    entry.startedAt.delete(agent.seq)
    const childKey = String(agent.childId)
    const accumulated = entry.usage.get(childKey)
    entry.usage.delete(childKey)
    // Usage carries only when the firehose actually reported some: an empty
    // accumulator means the adapter recorded no token accounting.
    const sawUsage = accumulated !== undefined
      && (accumulated.inputTokens > 0 || accumulated.outputTokens > 0
        || accumulated.totalTokens !== undefined || accumulated.cacheReadTokens !== undefined
        || accumulated.cacheWriteTokens !== undefined || accumulated.reasoningTokens !== undefined)
    const data: PipelineRunAgentEndData = {
      runId: info.id,
      seq: agent.seq,
      outcome: agent.outcome,
      durationMs: startedAt === undefined ? 0 : Math.max(0, Date.now() - startedAt),
      ...(sawUsage ? { usage: accumulated } : {}),
    }
    append(info.id, entry.session, 'pipeline-run/agent-end', data)
  }

  const onSessionEvent: SessionEventHandler = (session, event) => {
    if (event.type !== 'assistant/message') return
    const usage = (event.data as { usage?: PipelineRunUsageTotals } | undefined)?.usage
    if (usage === undefined) return
    const childKey = String(session.id)
    for (const entry of active.values()) {
      const totals = entry.usage.get(childKey)
      if (totals !== undefined) {
        totals.inputTokens += usage.inputTokens
        totals.outputTokens += usage.outputTokens
        if (usage.totalTokens !== undefined) totals.totalTokens = (totals.totalTokens ?? 0) + usage.totalTokens
        if (usage.cacheReadTokens !== undefined) totals.cacheReadTokens = (totals.cacheReadTokens ?? 0) + usage.cacheReadTokens
        if (usage.cacheWriteTokens !== undefined) totals.cacheWriteTokens = (totals.cacheWriteTokens ?? 0) + usage.cacheWriteTokens
        if (usage.reasoningTokens !== undefined) totals.reasoningTokens = (totals.reasoningTokens ?? 0) + usage.reasoningTokens
        break
      }
    }
  }

  disposers.push(ctx.on('workflow/agent-start', onAgentStart as never))
  disposers.push(ctx.on('workflow/agent-end', onAgentEnd as never))
  disposers.push(ctx.on('session/event', onSessionEvent as never))

  return {
    start(session, run, name, nodes) {
      if (disposed) return
      const entry: ActiveRun = {
        session,
        nodes: new Map(nodes.map((node) => [node.label, node])),
        usage: new Map(),
        startedAt: new Map(),
        runStartedAt: Date.now(),
      }
      active.set(run.id, entry)
      const data: PipelineRunStartData = {
        runId: run.id,
        name,
        nodes,
        startedAt: entry.runStartedAt,
      }
      append(run.id, session, 'pipeline-run/run-start', data)
    },
    finish(runId, stopReason, error) {
      const entry = active.get(runId)
      if (entry === undefined) return
      active.delete(runId)
      const data: PipelineRunEndData = {
        runId,
        stopReason,
        durationMs: Math.max(0, Date.now() - entry.runStartedAt),
        ...(error !== undefined ? { error } : {}),
      }
      append(runId, entry.session, 'pipeline-run/run-end', data)
    },
    dispose() {
      disposed = true
      active.clear()
      for (const disposer of disposers.splice(0)) {
        try {
          (disposer as () => void)()
        } catch {
          // A dead listener disposer must not mask the run outcome.
        }
      }
    },
  }
}
