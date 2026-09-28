/**
 * Run result formatting (FR-5): the human-readable summary shared by the
 * `/pipeline` command, the `pipeline` tool, and the M3 web run route.
 * Per-node output is capped so a pipeline's transcript cannot flood the
 * conversation (token-amplification guard, plan/02 #4).
 */
import { t } from './messages.js'
import type { PipelineDef } from './schema.js'
import type { RunOutcome } from './runner.js'

/** Per-node output cap in the formatted result (chars). */
export const NODE_OUTPUT_LIMIT = 2000

export function formatSuccess(def: PipelineDef, outcome: RunOutcome): string {
  const nodeNoun = def.nodes.length === 1 ? 'node' : 'nodes'
  const agentNoun = outcome.agentsStarted === 1 ? 'agent' : 'agents'
  const lines = [t('entry.pipelineCompleted', { name: def.name, nodes: `${def.nodes.length} ${nodeNoun}`, agents: `${outcome.agentsStarted} ${agentNoun}` })]
  const nodes = (outcome.value as { nodes?: Record<string, unknown> } | null)?.nodes ?? {}
  for (const [id, output] of Object.entries(nodes)) {
    lines.push(`${id}: ${output === null ? t('entry.nodeSkipped') : truncate(renderOutput(output))}`)
  }
  return lines.join('\n')
}

export function formatFailure(def: PipelineDef, outcome: RunOutcome): Error {
  return new Error(
    t('entry.pipelineStopped', { name: def.name, stopReason: outcome.stopReason, detail: outcome.error ?? 'no error detail' }),
  )
}

export function renderOutput(output: unknown): string {
  if (typeof output === 'string') return output
  return JSON.stringify(output)
}

function truncate(text: string): string {
  if (text.length <= NODE_OUTPUT_LIMIT) return text
  return `${text.slice(0, NODE_OUTPUT_LIMIT)}... (+${text.length - NODE_OUTPUT_LIMIT} chars truncated)`
}
