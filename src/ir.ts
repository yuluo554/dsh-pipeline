/**
 * IR normalization (plan/03): PipelineDef -> deterministic ordered execution graph.
 *
 * Frozen rules (HANDOFF 口径 1 / plan/04 真值语义):
 * - explicit `dependsOn` overrides implicit linear chaining (implicit = previous
 *   node in definition order, first node has none);
 * - template references `{{var}}` also create dependency edges;
 * - unknown template variables are rejected at compile time;
 * - referencing a failed-skip upstream node's output is a semantic error (the
 *   gate activates in M2 when `failurePolicy: "skip"` lands; M1 rejects skip
 *   outright as an unsupported feature);
 * - topological order via Kahn's algorithm with definition-order tie-break
 *   (same input -> same IR, always).
 *
 * M1 feature gates (plan/06): per-node skills/tools routing, failure policies
 * other than abort, retry attempts, options overrides and reasoningEffort are
 * parsed by schema.ts (they are part of the def format) but rejected here with
 * IR_UNSUPPORTED_FEATURE — their routing lands in M2, and the 0.1.5-rc.1
 * workflow engine has no agent() toolFilter/effort path to honor them.
 */
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { ErrorCode, PipelineError } from './errors.js'
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
  needsAgentOptions: boolean
  needsOutputSchema: boolean
}

export interface PipelineIR {
  name: string
  description: string
  /** Topologically ordered nodes (definition order tie-break). */
  nodes: IRNode[]
  /** Exact upper bound of agent() calls the compiled script can make. */
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
        `${location}: malformed template expression at offset ${open} — expected "{{variable}}"; ` +
          `variables are "${INPUT_VARIABLE}", "${PREV_VARIABLE}", or a node id`,
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
  assertM1FeatureGates(def)

  const byId = new Map<string, { node: PipelineNode; index: number }>()
  for (const [index, node] of def.nodes.entries()) {
    if (byId.has(node.id)) {
      throw new PipelineError(ErrorCode.duplicateId, `duplicate node id "${node.id}" (definitions must be unique)`)
    }
    if (node.id === INPUT_VARIABLE || node.id === PREV_VARIABLE) {
      throw new PipelineError(
        ErrorCode.reservedId,
        `node id "${node.id}" is reserved (used as a template variable); pick another id`,
      )
    }
    byId.set(node.id, { node, index })
  }

  // Dependency edges: explicit dependsOn, implicit chaining, template refs.
  const deps = new Map<string, Set<string>>()
  const addEdge = (from: string, to: string, why: string): void => {
    if (from === to) {
      throw new PipelineError(ErrorCode.selfDependency, `node "${from}" depends on itself (${why})`)
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
            `${location}: {{${PREV_VARIABLE}}} has no previous output — it is the node's first prompt`,
          )
        }
        if (ref.kind === 'node') {
          if (ref.id === id) {
            throw new PipelineError(
              ErrorCode.selfReference,
              `${location}: node "${id}" references its own final output; use {{${PREV_VARIABLE}}} ` +
                `for an earlier prompt's output within the same node`,
            )
          }
          if (!byId.has(ref.id)) {
            throw new PipelineError(
              ErrorCode.unknownVariable,
              `${location}: template variable "{{${ref.id}}}" does not match any node id` +
                ` (available: ${[...byId.keys()].map((k) => `"${k}"`).join(', ')}, "${INPUT_VARIABLE}", "${PREV_VARIABLE}")`,
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
            `node "${id}" depends on "${dep}", which is not a node in this pipeline` +
              ` (available: ${[...byId.keys()].map((k) => `"${k}"`).join(', ')})`,
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
          `node "${node.id}": outputSchema is outside the engine's supported object-rooted subset — ${detail}`,
        )
      }
    }
    return {
      id: node.id,
      label: node.label,
      phaseTitle: node.label ?? node.id,
      prompts: prompts[index].map(({ template, refs }) => ({ template, refs })),
      agentOptions,
      outputSchema,
      needsAgentOptions: agentOptions.provider !== undefined || agentOptions.model !== undefined,
      needsOutputSchema: outputSchema !== undefined,
    }
  })

  return {
    name: def.name,
    description: def.description,
    nodes: irNodes,
    totalAgentCalls: irNodes.reduce((sum, node) => sum + node.prompts.length, 0),
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
        `dependency cycle among nodes: ${stuck.join(' -> ')} (cycles cannot be executed)`,
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

function assertM1FeatureGates(def: PipelineDef): void {
  const gate = (detail: string, where: string): PipelineError =>
    new PipelineError(
      ErrorCode.unsupportedFeature,
      `${where}: ${detail} lands in M2 (plan/05) — remove it to run on M1`,
    )

  if (def.options !== undefined) {
    if (def.options.maxAgentsPerNode !== undefined) {
      throw gate('"options.maxAgentsPerNode"', `pipeline "${def.name}"`)
    }
    if (def.options.defaultFailurePolicy !== undefined && def.options.defaultFailurePolicy !== 'abort') {
      throw gate(`"options.defaultFailurePolicy: ${def.options.defaultFailurePolicy}"`, `pipeline "${def.name}"`)
    }
  }

  for (const [index, node] of def.nodes.entries()) {
    const where = `nodes[${index}] (node "${node.id}")`
    if (node.skills !== undefined) throw gate('per-node "skills" routing', where)
    if (node.tools !== undefined) throw gate('per-node "tools" routing', where)
    if (node.failurePolicy !== undefined && node.failurePolicy !== 'abort') {
      throw gate(`"failurePolicy: ${node.failurePolicy}"`, where)
    }
    if (node.retry !== undefined && node.retry > 0) throw gate('"retry" attempts', where)
    if (node.model?.reasoningEffort !== undefined) {
      throw gate(
        '"model.reasoningEffort" routing (the 0.1.5-rc.1 engine forwards only provider/model and rejects effort)',
        where,
      )
    }
  }
}
