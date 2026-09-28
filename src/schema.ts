/**
 * Pipeline definition format (FR-1) and shape validation.
 *
 * Shape-level only: semantic rules (duplicate ids, dependency resolution,
 * template variables, M2 feature gates) live in ir.ts. This module never
 * throws — it collects every violation so an editor can show them all at once.
 */

import { t } from './messages.js'

export interface PipelineDef {
  name: string
  description: string
  nodes: PipelineNode[]
  options?: PipelineOptions
}

export interface PipelineOptions {
  maxAgentsPerNode?: number
  defaultFailurePolicy?: 'abort' | 'skip'
}

export interface PipelineNode {
  id: string
  label?: string
  /** >= 1 prompt, delivered in order within the node. */
  prompts: string[]
  model?: NodeModel
  skills?: string[]
  tools?: { allow?: string[]; deny?: string[] }
  /** Absent = implicit linear chaining onto the previous node; present (even empty) overrides it. */
  dependsOn?: string[]
  outputSchema?: Record<string, unknown>
  failurePolicy?: 'abort' | 'skip'
  retry?: number
}

export interface NodeModel {
  provider?: string
  model?: string
  reasoningEffort?: string
}

export interface DefError {
  /** JSON-pointer-ish location, e.g. `nodes[2].prompts[0]`. */
  path: string
  message: string
}

/** Pipeline name / node id grammar: filename-safe and template-reference safe. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export function isValidDefName(name: string): boolean {
  return ID_RE.test(name)
}

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
  const node: PipelineNode = { id: '', prompts: [] }
  let ok = true

  const known = new Set(['id', 'label', 'prompts', 'model', 'skills', 'tools', 'dependsOn', 'outputSchema', 'failurePolicy', 'retry'])
  for (const key of Object.keys(rec)) {
    if (!known.has(key)) {
      push(`${path}.${key}`, t('schema.unknownNodeField', { key }))
      ok = false
    }
  }

  if (typeof rec.id !== 'string' || !ID_RE.test(rec.id)) {
    push(`${path}.id`, t('schema.nodeIdPattern', { pattern: ID_RE.source }))
    ok = false
  } else {
    node.id = rec.id
  }

  if (rec.label !== undefined) {
    if (typeof rec.label !== 'string' || rec.label.trim().length === 0) {
      push(`${path}.label`, t('schema.labelNonEmpty'))
      ok = false
    } else {
      node.label = rec.label
    }
  }

  if (!Array.isArray(rec.prompts) || rec.prompts.length === 0) {
    push(`${path}.prompts`, t('schema.promptsNonEmpty'))
    ok = false
  } else {
    rec.prompts.forEach((prompt, index) => {
      if (typeof prompt !== 'string' || prompt.length === 0) {
        push(`${path}.prompts[${index}]`, t('schema.promptNonEmpty'))
        ok = false
      }
    })
    if (ok) node.prompts = rec.prompts as string[]
  }

  if (rec.model !== undefined) {
    const model = validateModel(rec.model, `${path}.model`, push)
    if (model !== undefined) node.model = model
  }

  if (rec.skills !== undefined) {
    if (!Array.isArray(rec.skills) || rec.skills.length === 0 || !rec.skills.every((s) => typeof s === 'string' && s.length > 0)) {
      push(`${path}.skills`, t('schema.skillsInvalid'))
      ok = false
    } else {
      node.skills = rec.skills as string[]
    }
  }

  if (rec.tools !== undefined) {
    const tools = validateTools(rec.tools, `${path}.tools`, push)
    if (tools !== undefined) node.tools = tools
  }

  if (rec.dependsOn !== undefined) {
    if (!Array.isArray(rec.dependsOn) || !rec.dependsOn.every((d) => typeof d === 'string' && ID_RE.test(d))) {
      push(`${path}.dependsOn`, t('schema.dependsOnInvalid'))
      ok = false
    } else {
      const deps = rec.dependsOn as string[]
      const seen = new Set<string>()
      deps.forEach((dep, index) => {
        if (seen.has(dep)) {
          push(`${path}.dependsOn[${index}]`, t('schema.duplicateDependency', { dep }))
          ok = false
        }
        seen.add(dep)
      })
      if (ok) node.dependsOn = deps
    }
  }

  if (rec.outputSchema !== undefined) {
    if (typeof rec.outputSchema !== 'object' || rec.outputSchema === null || Array.isArray(rec.outputSchema)) {
      push(`${path}.outputSchema`, t('schema.outputSchemaObject'))
      ok = false
    } else {
      node.outputSchema = rec.outputSchema as Record<string, unknown>
    }
  }

  if (rec.failurePolicy !== undefined) {
    if (rec.failurePolicy !== 'abort' && rec.failurePolicy !== 'skip') {
      push(`${path}.failurePolicy`, t('schema.failurePolicyInvalid'))
      ok = false
    } else {
      node.failurePolicy = rec.failurePolicy
    }
  }

  if (rec.retry !== undefined) {
    if (typeof rec.retry !== 'number' || !Number.isSafeInteger(rec.retry) || rec.retry < 0) {
      push(`${path}.retry`, t('schema.retryInvalid'))
      ok = false
    } else {
      node.retry = rec.retry
    }
  }

  return ok ? node : undefined
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
