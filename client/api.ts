/**
 * Store RPC client (M3, plan/03 client/store.ts row): thin fetch wrappers
 * over the host half's `/api/dsh-pipeline/*` routes. Same-origin + cookie
 * auth by the Connection carrier; non-2xx responses carry `{ error }`.
 */
import type { DefForm } from '../src/form-model.js'
import { formToDef } from '../src/form-model.js'

export interface Inventory {
  pipelines: string[]
  skills: Array<{ name: string; description: string }>
  tools: Array<{ name: string; description: string }>
  provider: string
}

export interface CatalogModel {
  id: string
  name: string
  description?: string
}

export interface CatalogGroup {
  id: string
  name: string
  models: CatalogModel[]
}

/** Structural slice of the host ModelCatalog. */
export interface Catalog {
  default: { provider: string; model: string; reasoningEffort?: string }
  routableProviders: string[]
  groups: CatalogGroup[]
  failures: Array<{ id: string; name: string; message: string }>
}

export interface DefErrors {
  ok: false
  errors: Array<{ path: string; message: string }>
}

export type ValidateResult = { ok: true } | DefErrors

export type RunResult = { ok: true; text: string } | { ok: false; error: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/dsh-pipeline${path}`, init)
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON error page: fall through to the status-based message.
  }
  if (!response.ok) {
    const detail = body !== null && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${response.status}`
    throw new Error(detail)
  }
  return body as T
}

export function fetchInventory(signal?: AbortSignal): Promise<Inventory> {
  return request<Inventory>('/inventory', { signal })
}

export function fetchDefRaw(name: string, signal?: AbortSignal): Promise<{ name: string; raw: string }> {
  return request<{ name: string; raw: string }>(`/def?name=${encodeURIComponent(name)}`, { signal })
}

export function fetchCatalog(signal?: AbortSignal): Promise<Catalog> {
  return request<Catalog>('/catalog', { signal })
}

export function validateForm(form: DefForm, signal?: AbortSignal): Promise<ValidateResult> {
  return postDef('/validate', form, signal)
}

export function saveForm(form: DefForm, signal?: AbortSignal): Promise<{ ok: true; json: string }> {
  return postDef('/save', form, signal)
}

export function runPipelineRemote(
  args: { name: string; input: string; sessionId: string },
  signal?: AbortSignal,
): Promise<RunResult> {
  return request<RunResult>('/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
    signal,
  })
}

/** POST a form: the form is assembled through the shared formToDef first. */
function postDef<T>(path: string, form: DefForm, signal?: AbortSignal): Promise<T> {
  const assembled = formToDef(form)
  if (!assembled.ok) return Promise.resolve({ ok: false, errors: assembled.errors } as T)
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(assembled.def),
    signal,
  })
}
