/**
 * Pipeline definition format (FR-1) and shape validation.
 *
 * Shape-level only: semantic rules (duplicate ids, dependency resolution,
 * template variables, M1 feature gates) live in ir.ts. This module never
 * throws — it collects every violation so an editor can show them all at once.
 */

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
    return { ok: false, errors: [{ path: '', message: 'definition must be a JSON object' }] }
  }
  const rec = raw as Record<string, unknown>

  for (const key of Object.keys(rec)) {
    if (!['name', 'description', 'nodes', 'options'].includes(key)) {
      push(key, `unknown field "${key}" (name/description/nodes/options)`)
    }
  }

  let name: string | undefined
  if (typeof rec.name !== 'string' || rec.name.length === 0) {
    push('name', '"name" must be a non-empty string')
  } else if (!isValidDefName(rec.name)) {
    push('name', `"name" must match ${ID_RE.source} (filename-safe, template-safe)`)
  } else {
    name = rec.name
  }

  let description: string | undefined
  if (typeof rec.description !== 'string' || rec.description.trim().length === 0) {
    push('description', '"description" must be a non-empty string')
  } else {
    description = rec.description
  }

  let nodes: PipelineNode[] | undefined
  if (!Array.isArray(rec.nodes) || rec.nodes.length === 0) {
    push('nodes', '"nodes" must be a non-empty array')
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
    push(path, '"options" must be an object')
    return undefined
  }
  const rec = raw as Record<string, unknown>
  const out: PipelineOptions = {}
  let ok = true
  if (rec.maxAgentsPerNode !== undefined) {
    if (typeof rec.maxAgentsPerNode !== 'number' || !Number.isSafeInteger(rec.maxAgentsPerNode) || rec.maxAgentsPerNode < 1) {
      push(`${path}.maxAgentsPerNode`, '"options.maxAgentsPerNode" must be a positive integer')
      ok = false
    } else {
      out.maxAgentsPerNode = rec.maxAgentsPerNode
    }
  }
  if (rec.defaultFailurePolicy !== undefined) {
    if (rec.defaultFailurePolicy !== 'abort' && rec.defaultFailurePolicy !== 'skip') {
      push(`${path}.defaultFailurePolicy`, '"options.defaultFailurePolicy" must be "abort" or "skip"')
      ok = false
    } else {
      out.defaultFailurePolicy = rec.defaultFailurePolicy
    }
  }
  for (const key of Object.keys(rec)) {
    if (key !== 'maxAgentsPerNode' && key !== 'defaultFailurePolicy') {
      push(`${path}.${key}`, `unknown option "${key}" (maxAgentsPerNode/defaultFailurePolicy)`)
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
    push(path, 'node must be an object')
    return undefined
  }
  const rec = raw as Record<string, unknown>
  const node: PipelineNode = { id: '', prompts: [] }
  let ok = true

  const known = new Set(['id', 'label', 'prompts', 'model', 'skills', 'tools', 'dependsOn', 'outputSchema', 'failurePolicy', 'retry'])
  for (const key of Object.keys(rec)) {
    if (!known.has(key)) {
      push(`${path}.${key}`, `unknown node field "${key}"`)
      ok = false
    }
  }

  if (typeof rec.id !== 'string' || !ID_RE.test(rec.id)) {
    push(`${path}.id`, `node "id" must match ${ID_RE.source}`)
    ok = false
  } else {
    node.id = rec.id
  }

  if (rec.label !== undefined) {
    if (typeof rec.label !== 'string' || rec.label.trim().length === 0) {
      push(`${path}.label`, 'node "label" must be a non-empty string')
      ok = false
    } else {
      node.label = rec.label
    }
  }

  if (!Array.isArray(rec.prompts) || rec.prompts.length === 0) {
    push(`${path}.prompts`, 'node "prompts" must be a non-empty array of strings')
    ok = false
  } else {
    rec.prompts.forEach((prompt, index) => {
      if (typeof prompt !== 'string' || prompt.length === 0) {
        push(`${path}.prompts[${index}]`, 'prompt must be a non-empty string')
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
      push(`${path}.skills`, 'node "skills" must be a non-empty array of non-empty strings')
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
      push(`${path}.dependsOn`, 'node "dependsOn" must be an array of node-id strings')
      ok = false
    } else {
      const deps = rec.dependsOn as string[]
      const seen = new Set<string>()
      deps.forEach((dep, index) => {
        if (seen.has(dep)) {
          push(`${path}.dependsOn[${index}]`, `duplicate dependency "${dep}"`)
          ok = false
        }
        seen.add(dep)
      })
      if (ok) node.dependsOn = deps
    }
  }

  if (rec.outputSchema !== undefined) {
    if (typeof rec.outputSchema !== 'object' || rec.outputSchema === null || Array.isArray(rec.outputSchema)) {
      push(`${path}.outputSchema`, 'node "outputSchema" must be an object-rooted JSON schema')
      ok = false
    } else {
      node.outputSchema = rec.outputSchema as Record<string, unknown>
    }
  }

  if (rec.failurePolicy !== undefined) {
    if (rec.failurePolicy !== 'abort' && rec.failurePolicy !== 'skip') {
      push(`${path}.failurePolicy`, 'node "failurePolicy" must be "abort" or "skip"')
      ok = false
    } else {
      node.failurePolicy = rec.failurePolicy
    }
  }

  if (rec.retry !== undefined) {
    if (typeof rec.retry !== 'number' || !Number.isSafeInteger(rec.retry) || rec.retry < 0) {
      push(`${path}.retry`, 'node "retry" must be a non-negative integer')
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
    push(path, 'node "model" must be an object')
    return undefined
  }
  const rec = raw as Record<string, unknown>
  const out: NodeModel = {}
  let ok = true
  for (const field of ['provider', 'model', 'reasoningEffort'] as const) {
    const value = rec[field]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.trim().length === 0) {
      push(`${path}.${field}`, `node "model.${field}" must be a non-empty string`)
      ok = false
    } else {
      out[field] = value
    }
  }
  for (const key of Object.keys(rec)) {
    if (!['provider', 'model', 'reasoningEffort'].includes(key)) {
      push(`${path}.${key}`, `unknown model field "${key}" (provider/model/reasoningEffort)`)
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
    push(path, 'node "tools" must be an object with allow/deny arrays')
    return undefined
  }
  const rec = raw as Record<string, unknown>
  const out: { allow?: string[]; deny?: string[] } = {}
  let ok = true
  for (const field of ['allow', 'deny'] as const) {
    const value = rec[field]
    if (value === undefined) continue
    if (!Array.isArray(value) || value.length === 0 || !value.every((t) => typeof t === 'string' && t.length > 0)) {
      push(`${path}.${field}`, `node "tools.${field}" must be a non-empty array of non-empty strings`)
      ok = false
    } else {
      out[field] = value as string[]
    }
  }
  for (const key of Object.keys(rec)) {
    if (key !== 'allow' && key !== 'deny') {
      push(`${path}.${key}`, `unknown tools field "${key}" (allow/deny)`)
      ok = false
    }
  }
  if (out.allow === undefined && out.deny === undefined) {
    push(path, 'node "tools" must declare at least one of allow/deny')
    ok = false
  }
  return ok ? out : undefined
}
