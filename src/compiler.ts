/**
 * Compiler (FR-2, plan/03): PipelineIR -> plain-JS workflow-engine script.
 *
 * The emitted script is the project's core asset and its serialization is a
 * FROZEN format (HANDOFF 口径 2): 2-space indentation, agent() option field
 * order = label, provider, model, schema, node statements in IR (topological)
 * order. Any change to the layout is a口径变更: re-review + re-freeze the
 * data/snapshots/ truths and rerun B1-B4 before merging.
 *
 * Safety rules:
 * - no eval/Function in this module — output is a plain string for the engine
 *   to run in its own worker realm;
 * - template interpolation is JSON-safe: static segments are emitted as
 *   JSON-escaped JS string literals, and references to outputSchema nodes are
 *   wrapped in JSON.stringify so objects never render as "[object Object]".
 */
import { segmentTemplate } from './ir.js'
import type { PipelineIR, IRNode, TemplateRef } from './ir.js'
import { PIPELINE_VERSION } from './version.js'

const IND = '  '

export function compileScript(ir: PipelineIR): string {
  const lines: string[] = []
  lines.push(`// dsh-pipeline ${PIPELINE_VERSION} — compiled pipeline "${ir.name}".`)
  const nodeNoun = ir.nodes.length === 1 ? 'node' : 'nodes'
  const callNoun = ir.totalAgentCalls === 1 ? 'agent call' : 'agent calls'
  lines.push(`// ${ir.nodes.length} ${nodeNoun}, ${ir.totalAgentCalls} ${callNoun}; failure policy: abort (M1).`)
  lines.push(`const out = {};`)
  for (const node of ir.nodes) {
    emitNode(ir, lines, node)
  }
  lines.push(`return { nodes: out };`)
  return lines.join('\n') + '\n'
}

function emitNode(ir: PipelineIR, lines: string[], node: IRNode): void {
  lines.push(`phase(${JSON.stringify(node.phaseTitle)});`)
  lines.push(`{`)
  const stem = node.phaseTitle
  node.prompts.forEach((_prompt, index) => {
    const k = index + 1
    const label = node.prompts.length > 1 ? `${stem} #${k}` : stem
    const opts = emitAgentOptions(node, label)
    lines.push(`${IND}const __p${k} = await agent(${promptExpression(ir, node, index)}, ${opts});`)
    lines.push(
      `${IND}if (__p${k} === null) throw new Error(${JSON.stringify(`node "${node.id}" failed at prompt ${k}`)});`,
    )
  })
  lines.push(`${IND}out[${JSON.stringify(node.id)}] = __p${node.prompts.length};`)
  lines.push(`}`)
}

/** Option field order is frozen: label, provider, model, schema. */
function emitAgentOptions(node: IRNode, label: string): string {
  const fields: string[] = []
  fields.push(`${IND}${IND}label: ${JSON.stringify(label)},`)
  if (node.agentOptions.provider !== undefined) {
    fields.push(`${IND}${IND}provider: ${JSON.stringify(node.agentOptions.provider)},`)
  }
  if (node.agentOptions.model !== undefined) {
    fields.push(`${IND}${IND}model: ${JSON.stringify(node.agentOptions.model)},`)
  }
  if (node.outputSchema !== undefined) {
    const schemaJson = JSON.stringify(node.outputSchema, null, 2)
      .split('\n')
      .map((line, index) => (index === 0 ? line : IND + IND + line))
      .join('\n')
    fields.push(`${IND}${IND}schema: ${schemaJson},`)
  }
  return `{\n${fields.join('\n')}\n${IND}}`
}

function promptExpression(ir: PipelineIR, node: IRNode, promptIndex: number): string {
  const location = `node "${node.id}" prompt ${promptIndex + 1}`
  const segments = segmentTemplate(node.prompts[promptIndex].template, location)
  const parts: string[] = []
  for (const segment of segments) {
    if (segment.kind === 'static') {
      if (segment.text.length > 0) parts.push(JSON.stringify(segment.text))
      continue
    }
    parts.push(variableExpression(ir, segment.ref, promptIndex))
  }
  if (parts.length === 0) parts.push('""')
  return parts.join(' + ')
}

function variableExpression(ir: PipelineIR, ref: TemplateRef, promptIndex: number): string {
  if (ref.kind === 'input') return 'args'
  if (ref.kind === 'prev') return `__p${promptIndex}`
  // References to an outputSchema node interpolate the structured value as
  // JSON (JSON-safe concatenation, plan/03); string outputs interpolate raw.
  const target = ir.nodes.find((n) => n.id === ref.id)
  if (target?.needsOutputSchema === true) return `JSON.stringify(out[${JSON.stringify(ref.id)}])`
  return `out[${JSON.stringify(ref.id)}]`
}
