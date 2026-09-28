/**
 * IR normalization (plan/03): PipelineDef -> deterministic ordered execution graph.
 *
 * Frozen rules (HANDOFF 口径 1 / plan/04 真值语义):
 * - explicit `dependsOn` overrides implicit linear chaining (implicit = previous
 *   node in definition order, first node has none);
 * - template references `{{var}}` also create dependency edges;
 * - unknown template variables are rejected at compile time;
 * - referencing a skip-policy node's output is a semantic error (M2: a skipped
 *   node's output is null — consuming it is a value error, not an empty string);
 * - topological order via Kahn's algorithm with definition-order tie-break
 *   (same input -> same IR, always).
 *
 * M2 feature gates (plan/06): per-node tools routing and reasoningEffort remain
 * rejected here with IR_UNSUPPORTED_FEATURE — the 0.1.5-rc.1 workflow engine has
 * no agent() toolFilter path (SUPPORTED_AGENT_OPTIONS = label/phase/schema/
 * provider/model) and rejects effort outright. Failure policies, retry attempts,
 * options.defaultFailurePolicy and per-node skills ARE unsealed in M2 (skills
 * resolve at run time in the runner; policies compile into the script).
 */
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { ErrorCode, PipelineError } from './errors.js'
import { t } from './messages.js'
import type { PipelineDef, PipelineNode } from './schema.js'

/** Reserved template variable: the run input. */
export const INPUT_VARIABLE = 'input'
/** Within-node variable: the previous prompt's output. */
export const PREV_VARIABLE = 'prev'

export type TemplateRef =
  | { kind: 'input' }
  | { kind: 'prev' }
  | { kind: 'node'; id: string }

export interface IRPrompt {
  template: string
  refs: TemplateRef[]
}

export interface IRNode {
  id: string
  label: string | undefined
  /** phase() title and agent() label stem: the label when present, else the id. */
  phaseTitle: string
  prompts: IRPrompt[]
  agentOptions: { provider?: string; model?: string }
  outputSchema: Record<string, unknown> | undefined
  /** Declared skill names, in definition order; undefined = no skills routing. */
  skills: string[] | undefined
  /** Resolved failure policy: node.failurePolicy ?? options.defaultFailurePolicy ?? 'abort'. */
  failurePolicy: 'abort' | 'skip'
  /** Resolved retry count (whole-node reruns after the first attempt). */
  retry: number
  needsAgentOptions: boolean
  needsOutputSchema: boolean
  needsSkills: boolean
}

export interface PipelineIR {
  name: string
  description: string
  /** Topologically ordered nodes (definition order tie-break). */
  nodes: IRNode[]
  /** Exact upper bound of agent() calls the compiled script can make:
   *  sum over nodes of prompts.length * (1 + retry). */
  totalAgentCalls: number
}

/** A template reference occurrence with its source location, for error messages. */
interface ParsedPrompt {
  template: string
  refs: TemplateRef[]
  /** Where the refs came from, e.g. `nodes[1].prompts[2]` (definition order). */
  location: string
}

const TEMPLATE_RE = /\{\{\s*([A-Za-z0-9_][A-Za-z0-9_-]*)\s*\}\}/g

/** One piece of a prompt template: static text or a variable reference. */
export type TemplateSegment =
  | { kind: 'static'; text: string }
  | { kind: 'ref'; ref: TemplateRef }

/**
 * Split a prompt template into static segments and references, in order.
 * Any `{{` that does not form a complete variable expression is a malformed
 * template and throws (fail loud, never silently literal).
 */
export function segmentTemplate(template: string, location: string): TemplateSegment[] {
  const segments: TemplateSegment[] = []
  let cursor = 0
  while (cursor < template.length) {
    const open = template.indexOf('{{', cursor)
    if (open === -1) break
    TEMPLATE_RE.lastIndex = open
    const match = TEMPLATE_RE.exec(template)
    if (match === null || match.index !== open) {
      throw new PipelineError(
        ErrorCode.unknownVariable,
        t('ir.malformedTemplate', { location, offset: open }),
      )
    }
    if (open > cursor) segments.push({ kind: 'static', text: template.slice(cursor, open) })
    segments.push({ kind: 'ref', ref: refFor(match[1]) })
    cursor = open + match[0].length
  }
  if (cursor < template.length) segments.push({ kind: 'static', text: template.slice(cursor) })
  return segments
}

function parseTemplate(template: string, location: string): TemplateRef[] {
  return segmentTemplate(template, location)
    .filter((segment): segment is { kind: 'ref'; ref: TemplateRef } => segment.kind === 'ref')
    .map((segment) => segment.ref)
}

function refFor(name: string): TemplateRef {
  if (name === INPUT_VARIABLE) return { kind: 'input' }
  if (name === PREV_VARIABLE) return { kind: 'prev' }
  return { kind: 'node', id: name }
  // Whether `name` resolves to a real node id is checked in buildIR, which
  // knows the full node set (parseTemplate alone cannot).
}

export function buildIR(def: PipelineDef): PipelineIR {
  assertM2FeatureGates(def)

  const byId = new Map<string, { node: PipelineNode; index: number }>()
  for (const [index, node] of def.nodes.entries()) {
    if (byId.has(node.id)) {
      throw new PipelineError(ErrorCode.duplicateId, t('ir.duplicateId', { id: node.id }))
    }
    if (node.id === INPUT_VARIABLE || node.id === PREV_VARIABLE) {
      throw new PipelineError(
        ErrorCode.reservedId,
        t('ir.reservedId', { id: node.id }),
      )
    }
    byId.set(node.id, { node, index })
  }

  // Failure policies resolve node-locally, so they are known before any
  // reference is checked (the skip-reference rule needs the target's policy).
  const skipPolicyIds = new Set<string>()
  for (const node of def.nodes) {
    const policy = node.failurePolicy ?? def.options?.defaultFailurePolicy ?? 'abort'
    if (policy === 'skip') skipPolicyIds.add(node.id)
  }

  // Dependency edges: explicit dependsOn, implicit chaining, template refs.
  const deps = new Map<string, Set<string>>()
  const addEdge = (from: string, to: string, why: string): void => {
    if (from === to) {
      throw new PipelineError(ErrorCode.selfDependency, t('ir.selfDependency', { id: from, why }))
    }
    const set = deps.get(from) ?? new Set<string>()
    set.add(to)
    deps.set(from, set)
  }

  const prompts: ParsedPrompt[][] = []
  for (const [index, node] of def.nodes.entries()) {
    const id = node.id
    const parsed: ParsedPrompt[] = []
    node.prompts.forEach((template, promptIndex) => {
      const location = `nodes[${index}].prompts[${promptIndex}] (node "${id}")`
      const refs = parseTemplate(template, location)
      for (const ref of refs) {
        if (ref.kind === 'prev' && promptIndex === 0) {
          throw new PipelineError(
            ErrorCode.unknownVariable,
            t('ir.prevFirstPrompt', { location }),
          )
        }
        if (ref.kind === 'node') {
          if (ref.id === id) {
            throw new PipelineError(
              ErrorCode.selfReference,
              t('ir.selfReference', { location, id }),
            )
          }
          if (!byId.has(ref.id)) {
            throw new PipelineError(
              ErrorCode.unknownVariable,
              t('ir.unknownVariable', { location, variable: ref.id, available: [...byId.keys()].map((k) => `"${k}"`).join(', ') }),
            )
          }
          if (skipPolicyIds.has(ref.id)) {
            throw new PipelineError(
              ErrorCode.skipReference,
              t('ir.skipReference', { location, variable: ref.id }),
            )
          }
        }
      }
      parsed.push({ template, refs, location })
    })
    prompts.push(parsed)

    const existing = node.dependsOn
    if (existing !== undefined) {
      for (const dep of existing) {
        if (!byId.has(dep)) {
          throw new PipelineError(
            ErrorCode.unknownDependency,
            t('ir.unknownDependency', { id, dep, available: [...byId.keys()].map((k) => `"${k}"`).join(', ') }),
          )
        }
        addEdge(id, dep, 'dependsOn')
      }
    } else if (index > 0) {
      addEdge(id, def.nodes[index - 1].id, 'implicit linear chaining')
    }

    for (const { refs, location } of parsed) {
      for (const ref of refs) {
        if (ref.kind === 'node') addEdge(id, ref.id, `template reference in ${location}`)
      }
    }
  }

  const order = topologicalOrder(def, deps)
  const irNodes = order.map((index): IRNode => {
    const node = def.nodes[index]
    const agentOptions: { provider?: string; model?: string } = {}
    if (node.model?.provider !== undefined) agentOptions.provider = node.model.provider
    if (node.model?.model !== undefined) agentOptions.model = node.model.model
    let outputSchema: Record<string, unknown> | undefined
    if (node.outputSchema !== undefined) {
      try {
        assertObjectJsonSchema(node.outputSchema)
        outputSchema = node.outputSchema
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        throw new PipelineError(
          ErrorCode.outputSchema,
          t('ir.outputSchemaSubset', { id: node.id, detail }),
        )
      }
    }
    const failurePolicy = node.failurePolicy ?? def.options?.defaultFailurePolicy ?? 'abort'
    const retry = node.retry ?? 0
    return {
      id: node.id,
      label: node.label,
      phaseTitle: node.label ?? node.id,
      prompts: prompts[index].map(({ template, refs }) => ({ template, refs })),
      agentOptions,
      outputSchema,
      skills: node.skills,
      failurePolicy,
      retry,
      needsAgentOptions: agentOptions.provider !== undefined || agentOptions.model !== undefined,
      needsOutputSchema: outputSchema !== undefined,
      needsSkills: node.skills !== undefined,
    }
  })

  return {
    name: def.name,
    description: def.description,
    nodes: irNodes,
    totalAgentCalls: irNodes.reduce((sum, node) => sum + node.prompts.length * (1 + node.retry), 0),
  }
}

function topologicalOrder(def: PipelineDef, deps: Map<string, Set<string>>): number[] {
  const indexOf = new Map<string, number>()
  def.nodes.forEach((node, index) => indexOf.set(node.id, index))

  const remaining = new Map<string, Set<string>>()
  for (const node of def.nodes) {
    remaining.set(node.id, new Set(deps.get(node.id) ?? []))
  }
  const dependents = new Map<string, Set<string>>()
  for (const [id, set] of remaining) {
    for (const dep of set) {
      const back = dependents.get(dep) ?? new Set<string>()
      back.add(id)
      dependents.set(dep, back)
    }
  }

  const order: number[] = []
  const emitted = new Set<string>()
  while (order.length < def.nodes.length) {
    // Deterministic tie-break: the lowest definition index among ready nodes.
    let next = -1
    for (const [index, node] of def.nodes.entries()) {
      if (!emitted.has(node.id) && (remaining.get(node.id)?.size ?? 0) === 0) {
        next = index
        break
      }
    }
    if (next === -1) {
      const stuck = def.nodes.filter((n) => !emitted.has(n.id)).map((n) => `"${n.id}"`)
      throw new PipelineError(
        ErrorCode.dependencyCycle,
        t('ir.dependencyCycle', { stuck: stuck.join(' -> ') }),
      )
    }
    const id = def.nodes[next].id
    emitted.add(id)
    order.push(next)
    for (const dependent of dependents.get(id) ?? []) {
      remaining.get(dependent)?.delete(id)
    }
  }
  return order
}

/**
 * M2 feature gates (plan/06): only the routings the 0.1.5-rc.1 engine cannot
 * honor stay rejected. Failure policies, retry, options.defaultFailurePolicy
 * and per-node skills are unsealed (skills resolve in the runner at run time;
 * policies compile into the script). maxAgentsPerNode remains gated — the
 * engine ceiling is engine-owned, per-node limits have no seam.
 */
function assertM2FeatureGates(def: PipelineDef): void {
  const gate = (key: string, params: Record<string, string>): PipelineError =>
    new PipelineError(ErrorCode.unsupportedFeature, t(key, params))

  if (def.options !== undefined && def.options.maxAgentsPerNode !== undefined) {
    throw gate('ir.gateMaxAgentsPerNode', { where: `pipeline "${def.name}"` })
  }

  for (const [index, node] of def.nodes.entries()) {
    const where = `nodes[${index}] (node "${node.id}")`
    if (node.tools !== undefined) throw gate('ir.gateTools', { where })
    if (node.model?.reasoningEffort !== undefined) throw gate('ir.gateReasoningEffort', { where })
  }
}
