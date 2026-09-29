/**
 * Runner (FR-3/6/8/10/12, plan/03) — the plugin's ONLY official workflow/
 * subagent/skills API touchpoint. Offline modules (schema/ir/compiler/store)
 * never import engine types; everything engine-facing is assembled and awaited
 * here.
 *
 * Capability precheck (HANDOFF 口径 4): the provider's SubagentCapabilities are
 * probed BEFORE engine.start; a pipeline needing agentOptions (per-node model
 * routing) or outputSchema that the provider lacks fails LOUD with a readable
 * error naming the affected nodes — no silent degradation. The probed provider
 * is also the one the run is pinned to via `subagentProvider`, so the probe
 * can never drift from the actual child route.
 *
 * Skills routing (FR-10, M2): nodes declaring `skills` resolve BEFORE
 * compilation through the host registry (`ctx.skills.get`), each rendered
 * block is injected into every prompt of the node (each agent() call is a
 * fresh child session), and a missing skill fails loud with the node and
 * skill named. The registry is only consulted when the pipeline actually
 * declares skills.
 */
import type { WorkflowEngine, WorkflowResult, WorkflowRun } from '@deepseek-ai/dsh-workflow'
import type { SubagentCapabilities } from '@deepseek-ai/dsh-subagent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { buildIR } from './ir.js'
import type { PipelineIR } from './ir.js'
import { compileScript } from './compiler.js'
import type { ResolvedSkills } from './compiler.js'
import { ErrorCode, PipelineError } from './errors.js'
import { t } from './messages.js'
import type { PipelineDef } from './schema.js'

/**
 * Structural slice of the host skills registry (`ctx.skills`) the runner
 * needs. dsh-skill's SkillRegistry satisfies it; tests stub it.
 */
export interface SkillResolver {
  get(name: string, options?: { signal?: AbortSignal }): Promise<unknown>
}

export interface RunDeps {
  engine: WorkflowEngine
  caps: SubagentCapabilities
  parent: Agent
  /** Subagent provider the run is pinned to (must be the one `caps` came from). */
  providerName: string
  signal?: AbortSignal
  /** Host skills registry; required only when the pipeline declares skills. */
  skills?: SkillResolver
  /**
   * Called synchronously with the accepted run handle right after
   * engine.start (M4 run-recorder hook). The run has not started executing,
   * so an observer that appends here races nothing.
   */
  onRunStart?: (run: WorkflowRun) => void
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
  const skillBlocks = await resolveSkillBlocks(deps, ir)
  const script = compileScript(ir, skillBlocks)
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
      // Exact upper bound: one agent() call per prompt per attempt (retry
      // reruns a node's prompts), nothing else in the script.
      maxTotalAgents: ir.totalAgentCalls,
      parent: deps.parent,
      ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new PipelineError(ErrorCode.engine, t('runner.engineRejected', { name: ir.name, detail }))
  }
  deps.onRunStart?.(run)

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

/**
 * Resolve every declared skill to its rendered content block, grouped by node
 * id in definition order. Returns undefined when no node declares skills (the
 * registry is never consulted). Fail loud: missing registry, missing skill,
 * or a malformed resolution all name the node and skill.
 */
async function resolveSkillBlocks(deps: RunDeps, ir: PipelineIR): Promise<ResolvedSkills | undefined> {
  const skillNodes = ir.nodes.filter((node) => node.needsSkills)
  if (skillNodes.length === 0) return undefined
  if (deps.skills === undefined) {
    const named = skillNodes.map((node) => `"${node.id}"`).join(', ')
    throw new PipelineError(
      ErrorCode.capability,
      t('runner.skillsRegistryMissing', { nodes: named }),
    )
  }
  const blocks: ResolvedSkills = new Map()
  for (const node of skillNodes) {
    for (const name of node.skills ?? []) {
      let resolved: unknown
      try {
        resolved = await deps.skills.get(name, deps.signal !== undefined ? { signal: deps.signal } : undefined)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        throw new PipelineError(
          ErrorCode.skill,
          t('runner.skillResolveFailed', { node: node.id, skill: name, detail }),
        )
      }
      if (resolved === undefined) {
        throw new PipelineError(
          ErrorCode.skill,
          t('runner.skillNotFound', { node: node.id, skill: name }),
        )
      }
      let rendered: string
      try {
        rendered = renderSkillContent(resolved as Parameters<typeof renderSkillContent>[0])
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        throw new PipelineError(
          ErrorCode.skill,
          t('runner.skillMalformed', { node: node.id, skill: name, detail }),
        )
      }
      const list = blocks.get(node.id) ?? []
      list.push(rendered)
      blocks.set(node.id, list)
    }
  }
  return blocks
}

function assertCaps(caps: SubagentCapabilities, providerName: string, ir: PipelineIR): void {
  if (!caps.agentOptions) {
    const nodes = ir.nodes.filter((node) => node.needsAgentOptions).map((node) => `"${node.id}"`)
    if (nodes.length > 0) {
      throw new PipelineError(
        ErrorCode.capability,
        t('runner.capsAgentOptions', { provider: providerName, nodes: nodes.join(', ') }),
      )
    }
  }
  if (!caps.outputSchema) {
    const nodes = ir.nodes.filter((node) => node.needsOutputSchema).map((node) => `"${node.id}"`)
    if (nodes.length > 0) {
      throw new PipelineError(
        ErrorCode.capability,
        t('runner.capsOutputSchema', { provider: providerName, nodes: nodes.join(', ') }),
      )
    }
  }
}
