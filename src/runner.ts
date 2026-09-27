/**
 * Runner (FR-3/6/8/12, plan/03) — the plugin's ONLY official workflow/subagent
 * API touchpoint. Offline modules (schema/ir/compiler/store) never import
 * engine types; everything engine-facing is assembled and awaited here.
 *
 * Capability precheck (HANDOFF 口径 4): the provider's SubagentCapabilities are
 * probed BEFORE engine.start; a pipeline needing agentOptions (per-node model
 * routing) or outputSchema that the provider lacks fails LOUD with a readable
 * error naming the affected nodes — no silent degradation. The probed provider
 * is also the one the run is pinned to via `subagentProvider`, so the probe
 * can never drift from the actual child route.
 */
import type { WorkflowEngine, WorkflowResult } from '@deepseek-ai/dsh-workflow'
import type { SubagentCapabilities } from '@deepseek-ai/dsh-subagent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { buildIR } from './ir.js'
import type { PipelineIR } from './ir.js'
import { compileScript } from './compiler.js'
import { ErrorCode, PipelineError } from './errors.js'
import type { PipelineDef } from './schema.js'

export interface RunDeps {
  engine: WorkflowEngine
  caps: SubagentCapabilities
  parent: Agent
  /** Subagent provider the run is pinned to (must be the one `caps` came from). */
  providerName: string
  signal?: AbortSignal
}

export interface RunOutcome {
  /** The script's return value `{ nodes: Record<nodeId, output> }` (completed only). */
  value: unknown
  stopReason: 'completed' | 'cancelled' | 'error'
  error?: string
  agentsStarted: number
}

export async function runPipeline(deps: RunDeps, def: PipelineDef, input: string): Promise<RunOutcome> {
  const ir = buildIR(def)
  const script = compileScript(ir)
  assertCaps(deps.caps, deps.providerName, ir)

  const meta = {
    name: ir.name,
    description: ir.description,
    phases: ir.nodes.map((node) => ({ title: node.phaseTitle })),
  }
  let run
  try {
    run = deps.engine.start({
      script,
      meta,
      args: input,
      subagentProvider: deps.providerName,
      // Exact upper bound: one agent() call per prompt, nothing else in the script.
      maxTotalAgents: ir.totalAgentCalls,
      parent: deps.parent,
      ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new PipelineError(ErrorCode.engine, `workflow engine rejected the run of pipeline "${ir.name}": ${detail}`)
  }

  const onAbort = (): void => run.cancel('parent signal aborted')
  deps.signal?.addEventListener('abort', onAbort, { once: true })
  let result: WorkflowResult
  try {
    result = await run.result
  } finally {
    deps.signal?.removeEventListener('abort', onAbort)
    await run.dispose()
  }
  return {
    value: result.value,
    stopReason: result.stopReason,
    ...(result.error !== undefined ? { error: result.error } : {}),
    agentsStarted: result.agentsStarted,
  }
}

function assertCaps(caps: SubagentCapabilities, providerName: string, ir: PipelineIR): void {
  if (!caps.agentOptions) {
    const nodes = ir.nodes.filter((node) => node.needsAgentOptions).map((node) => `"${node.id}"`)
    if (nodes.length > 0) {
      throw new PipelineError(
        ErrorCode.capability,
        `subagent provider "${providerName}" does not support agentOptions, but these nodes route their own ` +
          `provider/model: ${nodes.join(', ')}. Remove their "model" overrides to run on the parent's route, ` +
          `or use an in-process provider (spawn/fork).`,
      )
    }
  }
  if (!caps.outputSchema) {
    const nodes = ir.nodes.filter((node) => node.needsOutputSchema).map((node) => `"${node.id}"`)
    if (nodes.length > 0) {
      throw new PipelineError(
        ErrorCode.capability,
        `subagent provider "${providerName}" does not support outputSchema, but these nodes declare one: ` +
          `${nodes.join(', ')}. Remove their "outputSchema" to run, or use an in-process provider (spawn/fork).`,
      )
    }
  }
}
