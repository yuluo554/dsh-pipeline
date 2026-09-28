/**
 * Pipeline definition format (FR-1) and shape validation.
 *
 * Shape-level only: semantic rules (duplicate ids, dependency resolution,
 * template variables, M2 feature gates) live in ir.ts. This module never
 * throws — it collects every violation so an editor can show them all at once.
 *
 * The type vocabulary and id grammar live in def-types.ts (browser-safe:
 * the client editor imports the same declarations); they are re-exported
 * here so the host half keeps a single import site.
 */

import { t } from './messages.js'

export type {
  PipelineDef,
  PipelineOptions,
  PipelineNode,
  NodeModel,
  DefError,
} from './def-types.js'
export { ID_RE, isValidDefName } from './def-types.js'
import { ID_RE, isValidDefName } from './def-types.js'
import type { PipelineDef, PipelineOptions, PipelineNode, NodeModel, DefError } from './def-types.js'

export type ValidateResult =
  | { ok: true; def: PipelineDef }
  | { ok: false; errors: DefError[] }

export function validateDef(raw: unknown): ValidateResult {
  const errors: DefError[] = []
  const push = (path: string, message: string): void => {
    errors.push({ path, message })
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [{ path: '', message: t('schema.mustBeObject') }] }
  }
  const rec = raw as Record<string, unknown>

  for (const key of Object.keys(rec)) {
    if (!['name', 'description', 'nodes', 'options'].includes(key)) {
      push(key, t('schema.unknownField', { key }))
    }
  }

  let name: string | undefined
  if (typeof rec.name !== 'string' || rec.name.length === 0) {
    push('name', t('schema.nameNonEmpty'))
  } else if (!isValidDefName(rec.name)) {
    push('name', t('schema.namePattern', { pattern: ID_RE.source }))
  } else {
    name = rec.name
  }

  let description: string | undefined
  if (typeof rec.description !== 'string' || rec.description.trim().length === 0) {
    push('description', t('schema.descriptionNonEmpty'))
  } else {
    description = rec.description
  }

  let nodes: PipelineNode[] | undefined
  if (!Array.isArray(rec.nodes) || rec.nodes.length === 0) {
    push('nodes', t('schema.nodesNonEmpty'))
  } else {
    nodes = []
    rec.nodes.forEach((entry, index) => {
      const node = validateNode(entry, `nodes[${index}]`, push)
      if (node !== undefined) nodes!.push(node)
    })
  }

  let options: PipelineOptions | undefined
  if (rec.options !== undefined) {
    const checked = validateOptions(rec.options, 'options', push)
    if (checked !== undefined) options = checked
  }

  if (errors.length > 0 || name === undefined || description === undefined || nodes === undefined) {
    return { ok: false, errors }
  }
  return { ok: true, def: { name, description, nodes, ...(options !== undefined ? { options } : {}) } }
}

function validateOptions(
  raw: unknown,
  path: string,
  push: (path: string, message: string) => void,
): PipelineOptions | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    push(path, t('schema.optionsMustBeObject'))
    return undefined
  }
  const rec = raw as Record<string, unknown>
  const out: PipelineOptions = {}
  let ok = true
  if (rec.maxAgentsPerNode !== undefined) {
    if (typeof rec.maxAgentsPerNode !== 'number' || !Number.isSafeInteger(rec.maxAgentsPerNode) || rec.maxAgentsPerNode < 1) {
      push(`${path}.maxAgentsPerNode`, t('schema.maxAgentsPerNodeInvalid'))
      ok = false
    } else {
      out.maxAgentsPerNode = rec.maxAgentsPerNode
    }
  }
  if (rec.defaultFailurePolicy !== undefined) {
    if (rec.defaultFailurePolicy !== 'abort' && rec.defaultFailurePolicy !== 'skip') {
      push(`${path}.defaultFailurePolicy`, t('schema.defaultPolicyInvalid'))
      ok = false
    } else {
      out.defaultFailurePolicy = rec.defaultFailurePolicy
    }
  }
  for (const key of Object.keys(rec)) {
    if (key !== 'maxAgentsPerNode' && key !== 'defaultFailurePolicy') {
      push(`${path}.${key}`, t('schema.unknownOption', { key }))
      ok = false
    }
  }
  return ok ? out : undefined
}

function validateNode(
  raw: unknown,
  path: string,
  push: (path: string, message: string) => void,
): PipelineNode | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    push(path, t('schema.nodeMustBeObject'))
    return undefined
  }
  const rec = raw as Record<string, unknown>
  // Assembled in the documented field order (id, label, prompts, model,
  // skills, tools, dependsOn, outputSchema, failurePolicy, retry) so
  // store.saveDef's canonical bytes match the shipped fixture layout.
  // Field order is expressed with spreads: property insertion follows source
  // order, so post-hoc `node.x = ...` assignments would reshuffle the bytes.
  const known = new Set(['id', 'label', 'prompts', 'model', 'skills', 'tools', 'dependsOn', 'outputSchema', 'failurePolicy', 'retry'])
  for (const key of Object.keys(rec)) {
    if (!known.has(key)) push(`${path}.${key}`, t('schema.unknownNodeField', { key }))
  }
  const idOk = typeof rec.id === 'string' && ID_RE.test(rec.id)
  if (Array.isArray(rec.prompts)) {
    rec.prompts.forEach((prompt, index) => {
      if (typeof prompt !== 'string' || prompt.length === 0) push(`${path}.prompts[${index}]`, t('schema.promptNonEmpty'))
    })
  }
  const promptsOk = Array.isArray(rec.prompts) && rec.prompts.length > 0 && rec.prompts.every((prompt) => typeof prompt === 'string' && prompt.length > 0)
  let label: string | undefined
  if (rec.label !== undefined) {
    if (typeof rec.label !== 'string' || rec.label.trim().length === 0) {
      push(`${path}.label`, t('schema.labelNonEmpty'))
    } else {
      label = rec.label
    }
  }
  let model: NodeModel | undefined
  if (rec.model !== undefined) {
    model = validateModel(rec.model, `${path}.model`, push)
  }
  let skills: string[] | undefined
  if (rec.skills !== undefined) {
    if (!Array.isArray(rec.skills) || rec.skills.length === 0 || !rec.skills.every((s) => typeof s === 'string' && s.length > 0)) {
      push(`${path}.skills`, t('schema.skillsInvalid'))
    } else {
      skills = rec.skills as string[]
    }
  }
  let tools: { allow?: string[]; deny?: string[] } | undefined
  if (rec.tools !== undefined) {
    tools = validateTools(rec.tools, `${path}.tools`, push)
  }
  let dependsOn: string[] | undefined
  if (rec.dependsOn !== undefined) {
    if (!Array.isArray(rec.dependsOn) || !rec.dependsOn.every((d) => typeof d === 'string' && ID_RE.test(d))) {
      push(`${path}.dependsOn`, t('schema.dependsOnInvalid'))
    } else {
      const deps = rec.dependsOn as string[]
      const seen = new Set<string>()
      deps.forEach((dep, index) => {
        if (seen.has(dep)) {
          push(`${path}.dependsOn[${index}]`, t('schema.duplicateDependency', { dep }))
        }
        seen.add(dep)
      })
      dependsOn = deps
    }
  }
  let outputSchema: Record<string, unknown> | undefined
  if (rec.outputSchema !== undefined) {
    if (typeof rec.outputSchema !== 'object' || rec.outputSchema === null || Array.isArray(rec.outputSchema)) {
      push(`${path}.outputSchema`, t('schema.outputSchemaObject'))
    } else {
      outputSchema = rec.outputSchema as Record<string, unknown>
    }
  }
  let failurePolicy: 'abort' | 'skip' | undefined
  if (rec.failurePolicy !== undefined) {
    if (rec.failurePolicy !== 'abort' && rec.failurePolicy !== 'skip') {
      push(`${path}.failurePolicy`, t('schema.failurePolicyInvalid'))
    } else {
      failurePolicy = rec.failurePolicy
    }
  }
  let retry: number | undefined
  if (rec.retry !== undefined) {
    if (typeof rec.retry !== 'number' || !Number.isSafeInteger(rec.retry) || rec.retry < 0) {
      push(`${path}.retry`, t('schema.retryInvalid'))
    } else {
      retry = rec.retry
    }
  }

  if (!idOk || !promptsOk) {
    if (!idOk) push(`${path}.id`, t('schema.nodeIdPattern', { pattern: ID_RE.source }))
    if (!promptsOk) push(`${path}.prompts`, t('schema.promptsNonEmpty'))
    return undefined
  }
  return {
    id: rec.id as string,
    ...(label !== undefined ? { label } : {}),
    prompts: rec.prompts as string[],
    ...(model !== undefined ? { model } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(dependsOn !== undefined ? { dependsOn } : {}),
    ...(outputSchema !== undefined ? { outputSchema } : {}),
    ...(failurePolicy !== undefined ? { failurePolicy } : {}),
    ...(retry !== undefined ? { retry } : {}),
  }
}

function validateModel(
  raw: unknown,
  path: string,
  push: (path: string, message: string) => void,
): NodeModel | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    push(path, t('schema.modelMustBeObject'))
    return undefined
  }
  const rec = raw as Record<string, unknown>
  const out: NodeModel = {}
  let ok = true
  for (const field of ['provider', 'model', 'reasoningEffort'] as const) {
    const value = rec[field]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.trim().length === 0) {
      push(`${path}.${field}`, t('schema.modelFieldNonEmpty', { field }))
      ok = false
    } else {
      out[field] = value
    }
  }
  for (const key of Object.keys(rec)) {
    if (!['provider', 'model', 'reasoningEffort'].includes(key)) {
      push(`${path}.${key}`, t('schema.unknownModelField', { key }))
      ok = false
    }
  }
  return ok ? out : undefined
}

function validateTools(
  raw: unknown,
  path: string,
  push: (path: string, message: string) => void,
): { allow?: string[]; deny?: string[] } | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    push(path, t('schema.toolsMustBeObject'))
    return undefined
  }
  const rec = raw as Record<string, unknown>
  const out: { allow?: string[]; deny?: string[] } = {}
  let ok = true
  for (const field of ['allow', 'deny'] as const) {
    const value = rec[field]
    if (value === undefined) continue
    if (!Array.isArray(value) || value.length === 0 || !value.every((t) => typeof t === 'string' && t.length > 0)) {
      push(`${path}.${field}`, t('schema.toolsFieldInvalid', { field }))
      ok = false
    } else {
      out[field] = value as string[]
    }
  }
  for (const key of Object.keys(rec)) {
    if (key !== 'allow' && key !== 'deny') {
      push(`${path}.${key}`, t('schema.unknownToolsField', { key }))
      ok = false
    }
  }
  if (out.allow === undefined && out.deny === undefined) {
    push(path, t('schema.toolsAllowOrDeny'))
    ok = false
  }
  return ok ? out : undefined
}
