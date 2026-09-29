/**
 * Offline mock WorkflowEngine (plan/04 B3) — a test/bench-only twin of the
 * real dsh workflow engine (dsh-workflow-ptc 0.2.0-rc.1 — since 0.2.0 the
 * official engine, replacing dsh-workflow-worker-thread), mirroring the
 * semantics verified against its source:
 *
 * - script realm globals: agent(prompt, opts?), phase(title), log(message),
 *   args (the engine wraps the body as `(async () => { <body> })()`);
 * - agent() resolves to the child's final text (schema -> structured, same
 *   as the real guest), and to `null` when the child run fails;
 * - cancellation kills the script at its NEXT hook boundary (CANCELLED
 *   thrown from agent/phase/log), and every future hook call keeps throwing;
 * - the run's result never rejects: script failure -> stopReason 'error',
 *   cancellation -> 'cancelled'; agentsStarted counts accepted agent() calls;
 * - event stream: workflow/start, phase/log, agent-start/agent-end pairs
 *   (by seq), workflow/end exactly once as the result settles.
 *
 * Behavior scripting (HANDOFF 口径 3): assertions target the recorded
 * agent() call parameter sequence + event sequence — never model output.
 */
import type { WorkflowStartRequest, WorkflowMeta, WorkflowResult, WorkflowRun, WorkflowStopReason } from '@deepseek-ai/dsh-workflow'

export interface MockAgentCall {
  seq: number
  label: string
  prompt: string
  /** Deep snapshot of the agent() options bag as the script passed it. */
  opts: Record<string, unknown>
  /** phase() title active when the call was made (real-engine vocabulary). */
  phase: string | undefined
}

/** Frozen event string grammar: `workflow:start`, `phase:<title>`, `log:<message>`, `agent-start:<seq>:<label>`, `agent-end:<seq>:<label>:<outcome>`, `workflow:end:<stopReason>`. */
export type MockEvent = string

export interface MockBehavior {
  /** Response text per agent() label; missing labels fall back to `defaultResponse`. */
  responses?: Record<string, string>
  defaultResponse?: string
  /** 1-based agent() call numbers whose child run FAILS (agent() yields null). */
  failAtCalls?: number[]
  /** Cancel the run once this many agent() calls have completed (next hook throws). */
  cancelAfterCalls?: number
}

export interface MockWorkflowEngineOptions {
  behavior?: MockBehavior
  /** Run id minted for started runs (default `mock-run-<n>`). */
  runIdPrefix?: string
}

export class MockWorkflowEngine {
  readonly calls: MockAgentCall[] = []
  readonly events: MockEvent[] = []
  /** The last request passed to start() (for runner-construction assertions). */
  lastRequest: Omit<WorkflowStartRequest, 'parent'> | undefined

  private readonly behavior: MockBehavior
  private readonly runIdPrefix: string
  private runCounter = 0
  private cancelled = false
  private cancelReason: string | undefined
  private currentPhase: string | undefined
  private settled = false

  constructor(options: MockWorkflowEngineOptions = {}) {
    this.behavior = options.behavior ?? {}
    this.runIdPrefix = options.runIdPrefix ?? 'mock-run'
  }

  start(request: WorkflowStartRequest): WorkflowRun {
    if (this.lastRequest !== undefined) {
      throw new Error('MockWorkflowEngine supports a single run per instance — create a fresh one per test')
    }
    const { parent: _parent, ...rest } = request
    this.lastRequest = rest
    this.runCounter += 1
    const id = `${this.runIdPrefix}-${this.runCounter}`
    const result = withResolvers<WorkflowResult>()
    const run: WorkflowRun = {
      id: id as WorkflowRun['id'],
      meta: request.meta,
      result: result.promise,
      cancel: (reason?: string) => this.cancel(reason ?? 'mock cancel()'),
      dispose: async () => {
        // Real engine: cancel if needed, then await script quiescence.
        if (!this.settled) this.cancel('dispose() before settlement')
        await result.promise
      },
    }
    void this.drive(request, result)
    return run
  }

  private cancel(reason: string): void {
    if (this.cancelled) return
    this.cancelled = true
    this.cancelReason = reason
  }

  private cancelledError(): Error {
    const err = new Error(`workflow run cancelled: ${this.cancelReason}`)
    ;(err as Error & { code?: string }).code = 'CANCELLED'
    return err
  }

  private async drive(request: WorkflowStartRequest, result: ReturnType<typeof withResolvers<WorkflowResult>>): Promise<void> {
    this.events.push('workflow:start')
    const agent = async (rawPrompt: unknown, rawOpts: unknown): Promise<unknown> => {
      if (this.cancelled) throw this.cancelledError()
      if (typeof rawPrompt !== 'string' || rawPrompt.length === 0) {
        throw new TypeError('agent() requires a non-empty prompt string')
      }
      const opts = (rawOpts ?? {}) as Record<string, unknown>
      const seq = this.calls.length + 1
      const call: MockAgentCall = {
        seq,
        label: typeof opts.label === 'string' ? opts.label : `call-${seq}`,
        prompt: rawPrompt,
        opts: JSON.parse(JSON.stringify(opts)) as Record<string, unknown>,
        phase: this.currentPhase,
      }
      this.calls.push(call)
      this.events.push(`agent-start:${seq}:${call.label}`)
      let outcome: 'completed' | 'failed' | 'cancelled' = 'completed'
      let value: unknown
      if (this.behavior.failAtCalls?.includes(seq) === true) {
        outcome = 'failed'
        value = null // real engine: child failure -> script sees null
      } else {
        value = this.behavior.responses?.[call.label] ?? this.behavior.defaultResponse ?? `mock output ${seq}`
        // Real engine: with a schema the script receives result.structured
        // (the validated object), not text. Scripted responses are JSON text.
        if (opts.schema !== undefined && typeof value === 'string') {
          value = JSON.parse(value)
        }
      }
      this.events.push(`agent-end:${seq}:${call.label}:${outcome}`)
      if (this.behavior.cancelAfterCalls !== undefined && seq >= this.behavior.cancelAfterCalls) {
        this.cancel(`injected after agent call ${seq}`)
      }
      return value
    }
    const phase = (title: unknown): void => {
      if (this.cancelled) throw this.cancelledError()
      if (typeof title !== 'string' || title.length === 0) throw new TypeError('phase() requires a non-empty title')
      this.currentPhase = title
      this.events.push(`phase:${title}`)
    }
    const log = (message: unknown): void => {
      if (this.cancelled) throw this.cancelledError()
      this.events.push(`log:${String(message)}`)
    }

    let stopReason: WorkflowStopReason
    let error: string | undefined
    let value: unknown = null
    try {
      const fn = new Function(
        'agent', 'phase', 'log', 'args',
        '"use strict";\nreturn (async () => {\n' + request.script + '\n})()',
      )
      const raw = await fn(agent, phase, log, request.args)
      if (this.cancelled) throw this.cancelledError()
      value = raw === undefined ? null : JSON.parse(JSON.stringify(raw))
      stopReason = 'completed'
    } catch (err) {
      if (this.cancelled) {
        stopReason = 'cancelled'
        error = `workflow run cancelled: ${this.cancelReason}`
      } else {
        stopReason = 'error'
        error = err instanceof Error ? err.message : String(err)
      }
    }
    this.settled = true
    result.resolve({
      value: stopReason === 'completed' ? value : null,
      stopReason,
      ...(error !== undefined ? { error } : {}),
      agentsStarted: this.calls.length,
    })
    this.events.push(`workflow:end:${stopReason}`)
  }
}

function withResolvers<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Test helper: the WorkflowMeta a runner should build for an IR (kept near the mock for B3 readability). */
export function expectMeta(name: string, description: string, phaseTitles: string[]): WorkflowMeta {
  return { name, description, phases: phaseTitles.map((title) => ({ title })) }
}
