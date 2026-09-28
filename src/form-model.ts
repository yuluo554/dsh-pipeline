/**
 * Editor form model (M3, plan/05): bidirectional conversion between
 * `PipelineDef` and the flat form state the Web editor edits.
 *
 * This is the shared face behind the M3 DoD "编辑产物 validateDef 全过;与
 * 手写 JSON 双向一致": the client bundle and the Node tests run the exact
 * same code, and `formToDef` output goes through `validateDef` before any
 * write (client-side preview + host save endpoint both gate).
 *
 * Normalization decisions (plan/06):
 * - `model: {}` and `options: {}` (degenerate empty objects, schema-legal)
 *   normalize to absent. Every non-degenerate field survives round-trips.
 * - `dependsOn` absent (implicit linear chaining) and present (explicit
 *   override, `[]` legal) are semantically different (IR rule 1); the form
 *   carries `hasExplicitDeps` to preserve the distinction.
 * - Round-trip parity is defined on parsed JSON (deep equality); canonical
 *   bytes come from the serializer (saveDef pretty-print).
 *
 * Gated features (口径 5/6): `tools` and `model.reasoningEffort` stay inside
 * the form so a loaded definition round-trips losslessly, but the editor
 * renders them read-only — the 0.1.5-rc.1 engine has no toolFilter/effort
 * routing, and the compiler rejects them (IR_UNSUPPORTED_FEATURE).
 */

import type { PipelineDef, PipelineNode } from './def-types.js'

/** Editor form state for one whole definition. */
export interface DefForm {
  name: string
  description: string
  nodes: NodeForm[]
  /** `''` = absent; otherwise `abort` | `skip`. */
  defaultFailurePolicy: string
  /** `''` = absent; otherwise decimal string (gated read-only in the editor). */
  maxAgentsPerNode: string
}

/** Editor form state for one node. */
export interface NodeForm {
  id: string
  /** `''` = absent. */
  label: string
  prompts: string[]
  /** `''` = absent. */
  provider: string
  /** `''` = absent. */
  model: string
  /** Preserved verbatim; gated read-only in the editor. */
  reasoningEffort: string
  skills: string[]
  /** Preserved verbatim; gated read-only in the editor. */
  toolsAllow: string[]
  toolsDeny: string[]
  /** False = omit `dependsOn` (implicit linear chaining). */
  hasExplicitDeps: boolean
  dependsOn: string[]
  /** `''` = absent; otherwise raw JSON text. */
  outputSchemaRaw: string
  /** `''` = absent; otherwise `abort` | `skip`. */
  failurePolicy: string
  /** `''` = absent; otherwise decimal string (`'0'` is meaningful). */
  retry: string
}

export interface FormError {
  path: string
  message: string
}

/** Definition -> editable form. Total: accepts any validated definition. */
export function defToForm(def: PipelineDef): DefForm {
  return {
    name: def.name,
    description: def.description,
    nodes: def.nodes.map(nodeToForm),
    defaultFailurePolicy: def.options?.defaultFailurePolicy ?? '',
    maxAgentsPerNode: def.options?.maxAgentsPerNode !== undefined ? String(def.options.maxAgentsPerNode) : '',
  }
}

function nodeToForm(node: PipelineNode): NodeForm {
  return {
    id: node.id,
    label: node.label ?? '',
    prompts: [...node.prompts],
    provider: node.model?.provider ?? '',
    model: node.model?.model ?? '',
    reasoningEffort: node.model?.reasoningEffort ?? '',
    skills: node.skills !== undefined ? [...node.skills] : [],
    toolsAllow: node.tools?.allow !== undefined ? [...node.tools.allow] : [],
    toolsDeny: node.tools?.deny !== undefined ? [...node.tools.deny] : [],
    hasExplicitDeps: node.dependsOn !== undefined,
    dependsOn: node.dependsOn !== undefined ? [...node.dependsOn] : [],
    outputSchemaRaw: node.outputSchema !== undefined ? JSON.stringify(node.outputSchema, null, 2) : '',
    failurePolicy: node.failurePolicy ?? '',
    retry: node.retry !== undefined ? String(node.retry) : '',
  }
}

export type FormToDefResult =
  | { ok: true; def: PipelineDef }
  | { ok: false; errors: FormError[] }

/**
 * Editable form -> definition. Structural assembly only: callers run
 * `validateDef` (shape) and the IR preflight (semantics) on the result.
 * Field order of the assembled objects is fixed (documented serializer
 * order), which makes byte-level output deterministic across edits.
 */
export function formToDef(form: DefForm): FormToDefResult {
  const errors: FormError[] = []
  const nodes: PipelineNode[] = []
  form.nodes.forEach((node, index) => {
    const assembled = nodeFromForm(node, `nodes[${index}]`, errors)
    if (assembled !== undefined) nodes.push(assembled)
  })

  const options: PipelineDef['options'] = {}
  let optionsPresent = false
  if (form.defaultFailurePolicy !== '') {
    if (form.defaultFailurePolicy !== 'abort' && form.defaultFailurePolicy !== 'skip') {
      errors.push({ path: 'options.defaultFailurePolicy', message: `unexpected value ${JSON.stringify(form.defaultFailurePolicy)}` })
    } else {
      options.defaultFailurePolicy = form.defaultFailurePolicy
      optionsPresent = true
    }
  }
  if (form.maxAgentsPerNode !== '') {
    const parsed = Number(form.maxAgentsPerNode)
    if (form.maxAgentsPerNode.trim() === '' || !Number.isSafeInteger(parsed) || parsed < 1) {
      errors.push({ path: 'options.maxAgentsPerNode', message: `not a positive integer: ${JSON.stringify(form.maxAgentsPerNode)}` })
    } else {
      options.maxAgentsPerNode = parsed
      optionsPresent = true
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    def: {
      name: form.name,
      description: form.description,
      nodes,
      ...(optionsPresent ? { options } : {}),
    },
  }
}

function nodeFromForm(form: NodeForm, path: string, errors: FormError[]): PipelineNode | undefined {
  // Assemble in the schema's documented field order (id, label, prompts,
  // model, skills, tools, dependsOn, outputSchema, failurePolicy, retry) so
  // the canonical serialization matches the shipped fixtures byte-for-byte.
  // Field order is expressed with spreads: property insertion follows source
  // order, so later `node.x = ...` assignments would reshuffle the bytes.
  const model: PipelineNode['model'] = {}
  if (form.provider !== '') model.provider = form.provider
  if (form.model !== '') model.model = form.model
  if (form.reasoningEffort !== '') model.reasoningEffort = form.reasoningEffort
  const modelPresent = model.provider !== undefined || model.model !== undefined || model.reasoningEffort !== undefined

  const tools: PipelineNode['tools'] = {}
  let toolsPresent = false
  if (form.toolsAllow.length > 0) {
    tools.allow = [...form.toolsAllow]
    toolsPresent = true
  }
  if (form.toolsDeny.length > 0) {
    tools.deny = [...form.toolsDeny]
    toolsPresent = true
  }

  let outputSchema: Record<string, unknown> | undefined
  if (form.outputSchemaRaw.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(form.outputSchemaRaw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        errors.push({ path: `${path}.outputSchema`, message: 'outputSchema must be a JSON object' })
        return undefined
      }
      outputSchema = parsed as Record<string, unknown>
    } catch (err) {
      errors.push({ path: `${path}.outputSchema`, message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` })
      return undefined
    }
  }

  if (form.failurePolicy !== '' && form.failurePolicy !== 'abort' && form.failurePolicy !== 'skip') {
    errors.push({ path: `${path}.failurePolicy`, message: `unexpected value ${JSON.stringify(form.failurePolicy)}` })
    return undefined
  }
  let retry: number | undefined
  if (form.retry !== '') {
    const parsed = Number(form.retry)
    if (form.retry.trim() === '' || !Number.isSafeInteger(parsed) || parsed < 0) {
      errors.push({ path: `${path}.retry`, message: `not a non-negative integer: ${JSON.stringify(form.retry)}` })
      return undefined
    }
    retry = parsed
  }

  return {
    id: form.id,
    ...(form.label.trim() !== '' ? { label: form.label } : {}),
    prompts: [...form.prompts],
    ...(modelPresent ? { model } : {}),
    ...(form.skills.length > 0 ? { skills: [...form.skills] } : {}),
    ...(toolsPresent ? { tools } : {}),
    ...(form.hasExplicitDeps ? { dependsOn: [...form.dependsOn] } : {}),
    ...(outputSchema !== undefined ? { outputSchema } : {}),
    ...(form.failurePolicy !== '' ? { failurePolicy: form.failurePolicy } : {}),
    ...(retry !== undefined ? { retry } : {}),
  }
}

/** Canonical pretty serialization (the same shape saveDef writes). */
export function serializeDef(def: PipelineDef): string {
  return JSON.stringify(def, null, 2) + '\n'
}
