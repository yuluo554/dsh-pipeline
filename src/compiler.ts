/**
 * Compiler (FR-2, plan/03): PipelineIR -> plain-JS workflow-engine script.
 *
 * The emitted script is the project's core asset and its serialization is a
 * FROZEN format (HANDOFF 口径 2): 2-space indentation, agent() option field
 * order = label, provider, model, schema, node statements in IR (topological)
 * order, and a two-line header (version / node+call counts / per-node
 * policies). Any change to the layout is a口径变更: re-review + re-freeze the
 * data/snapshots/ truths and rerun B1-B4 before merging.
 *
 * Failure policies (FR-9, M2) compile into the script; the runner stays a
 * dumb assembler:
 * - abort (default), retry 0: the M1 shape — `if (null) throw` per prompt;
 * - skip: the node's first failed prompt ends the node; `out[id] = null` and
 *   the run continues. Referencing that output is rejected in ir.ts;
 * - retry > 0: a whole-node rerun loop (`1 + retry` attempts); when attempts
 *   are exhausted the node settles per its policy (abort throws naming the
 *   last failing prompt, skip assigns null).
 * Cancellation is never policy-managed: the engine surfaces it by THROWING
 * from the next hook, which unwinds the loop — policies only govern the
 * child-failed (`null`) semantics.
 *
 * Skills (FR-10, M2) inject at compile time: the runner resolves each node's
 * declared skills against the host registry BEFORE compiling and passes the
 * rendered blocks in via `skills`. Every prompt of a skill node is prefixed
 * with the blocks (each agent() call is a fresh child session, so the skill
 * text must accompany every prompt).
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
import { ErrorCode, PipelineError } from './errors.js'
import { PIPELINE_VERSION } from './version.js'

const IND = '  '

/** Rendered skill blocks per node id (nodeId -> blocks in declared skill order). */
export type ResolvedSkills = Map<string, string[]>

export function compileScript(ir: PipelineIR, skills?: ResolvedSkills): string {
  const lines: string[] = []
  lines.push(`// dsh-pipeline ${PIPELINE_VERSION} — compiled pipeline "${ir.name}".`)
  lines.push(`// ${headerStats(ir)}`)
  lines.push(`const out = {};`)
  for (const node of ir.nodes) {
    emitNode(ir, lines, node, skills)
  }
  lines.push(`return { nodes: out };`)
  return lines.join('\n') + '\n'
}

/**
 * Header line 2 (frozen format): node count, the exact agent-call UPPER BOUND
 * (prompts × (1 + retry) — retry reruns count), and every node's resolved
 * policy in topological order; `:<retry>` is appended when the node retries.
 */
function headerStats(ir: PipelineIR): string {
  const nodeNoun = ir.nodes.length === 1 ? 'node' : 'nodes'
  const callNoun = ir.totalAgentCalls === 1 ? 'agent call' : 'agent calls'
  const policies = ir.nodes
    .map((node) => (node.retry > 0 ? `${node.id}=${node.failurePolicy}:${node.retry}` : `${node.id}=${node.failurePolicy}`))
    .join(', ')
  return `${ir.nodes.length} ${nodeNoun}, ${ir.totalAgentCalls} ${callNoun} max; policies: ${policies}.`
}

function emitNode(ir: PipelineIR, lines: string[], node: IRNode, skills: ResolvedSkills | undefined): void {
  lines.push(`phase(${JSON.stringify(node.phaseTitle)});`)
  if (node.failurePolicy === 'abort' && node.retry === 0) {
    emitAbortNode(ir, lines, node, skills)
  } else {
    emitPolicyNode(ir, lines, node, skills)
  }
}

/** M1 shape: bare block, throw naming the failing prompt. */
function emitAbortNode(ir: PipelineIR, lines: string[], node: IRNode, skills: ResolvedSkills | undefined): void {
  lines.push(`{`)
  node.prompts.forEach((_prompt, index) => {
    const k = index + 1
    const label = promptLabel(node, k)
    lines.push(`${IND}const __p${k} = await agent(${promptExpression(ir, node, index, skills)}, ${emitAgentOptions(node, label, 1)});`)
    lines.push(
      `${IND}if (__p${k} === null) throw new Error(${JSON.stringify(`node "${node.id}" failed at prompt ${k}`)});`,
    )
  })
  lines.push(`${IND}out[${JSON.stringify(node.id)}] = __p${node.prompts.length};`)
  lines.push(`}`)
}

/**
 * Skip / retry shape: a whole-node attempt loop. A failed prompt breaks out of
 * the labeled attempt block; the loop re-enters while attempts remain. After
 * the loop a not-done node settles per policy (skip -> null, abort -> throw).
 */
function emitPolicyNode(ir: PipelineIR, lines: string[], node: IRNode, skills: ResolvedSkills | undefined): void {
  const attempts = 1 + node.retry
  const id = JSON.stringify(node.id)
  lines.push(`{`)
  lines.push(`${IND}let __${node.id}_attempt = 0;`)
  lines.push(`${IND}let __${node.id}_done = false;`)
  if (node.failurePolicy === 'abort') lines.push(`${IND}let __${node.id}_failedAt = 0;`)
  lines.push(`${IND}while (!__${node.id}_done && __${node.id}_attempt < ${attempts}) {`)
  lines.push(`${IND}${IND}__${node.id}_attempt += 1;`)
  lines.push(`${IND}${IND}__try_${node.id}: {`)
  node.prompts.forEach((_prompt, index) => {
    const k = index + 1
    const label = promptLabel(node, k)
    lines.push(`${IND}${IND}${IND}const __p${k} = await agent(${promptExpression(ir, node, index, skills)}, ${emitAgentOptions(node, label, 3)});`)
    if (node.failurePolicy === 'abort') {
      lines.push(`${IND}${IND}${IND}if (__p${k} === null) {`)
      lines.push(`${IND}${IND}${IND}${IND}__${node.id}_failedAt = ${k};`)
      lines.push(`${IND}${IND}${IND}${IND}break __try_${node.id};`)
      lines.push(`${IND}${IND}${IND}}`)
    } else {
      lines.push(`${IND}${IND}${IND}if (__p${k} === null) break __try_${node.id};`)
    }
  })
  lines.push(`${IND}${IND}${IND}out[${id}] = __p${node.prompts.length};`)
  lines.push(`${IND}${IND}${IND}__${node.id}_done = true;`)
  lines.push(`${IND}${IND}}`)
  lines.push(`${IND}}`)
  if (node.failurePolicy === 'skip') {
    lines.push(`${IND}if (!__${node.id}_done) out[${id}] = null;`)
  } else {
    lines.push(
      `${IND}if (!__${node.id}_done) throw new Error("node \\"${node.id}\\" failed at prompt " + __${node.id}_failedAt + " after ${attempts} attempt(s)");`,
    )
  }
  lines.push(`}`)
}

/** Multi-prompt nodes append ` #k` to the label (frozen 口径 2). */
function promptLabel(node: IRNode, k: number): string {
  return node.prompts.length > 1 ? `${node.phaseTitle} #${k}` : node.phaseTitle
}

/**
 * Option field order is frozen: label, provider, model, schema. `callUnits`
 * is the indentation depth (in IND units) of the `agent(` call so option
 * fields align one unit deeper and the closing brace aligns with the call.
 */
function emitAgentOptions(node: IRNode, label: string, callUnits: number): string {
  const fields: string[] = []
  fields.push(`${IND.repeat(callUnits + 1)}label: ${JSON.stringify(label)},`)
  if (node.agentOptions.provider !== undefined) {
    fields.push(`${IND.repeat(callUnits + 1)}provider: ${JSON.stringify(node.agentOptions.provider)},`)
  }
  if (node.agentOptions.model !== undefined) {
    fields.push(`${IND.repeat(callUnits + 1)}model: ${JSON.stringify(node.agentOptions.model)},`)
  }
  if (node.outputSchema !== undefined) {
    const schemaJson = JSON.stringify(node.outputSchema, null, 2)
      .split('\n')
      .map((line, index) => (index === 0 ? line : IND.repeat(callUnits + 1) + line))
      .join('\n')
    fields.push(`${IND.repeat(callUnits + 1)}schema: ${schemaJson},`)
  }
  return `{\n${fields.join('\n')}\n${IND.repeat(callUnits)}}`
}

function promptExpression(ir: PipelineIR, node: IRNode, promptIndex: number, skills: ResolvedSkills | undefined): string {
  const parts: string[] = []
  if (node.needsSkills) {
    for (const block of resolvedSkillBlocks(skills, node)) {
      parts.push(JSON.stringify(`${block}\n\n`))
    }
  }
  const location = `node "${node.id}" prompt ${promptIndex + 1}`
  const segments = segmentTemplate(node.prompts[promptIndex].template, location)
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

function resolvedSkillBlocks(skills: ResolvedSkills | undefined, node: IRNode): string[] {
  const blocks = skills?.get(node.id)
  if (blocks === undefined || blocks.length === 0) {
    throw new PipelineError(
      ErrorCode.skill,
      `node "${node.id}" declares skills (${(node.skills ?? []).map((s) => `"${s}"`).join(', ')}) but no rendered ` +
        `skill blocks were provided — compileScript needs a ResolvedSkills map; the runner resolves ` +
        `ctx.skills before compiling`,
    )
  }
  return blocks
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
