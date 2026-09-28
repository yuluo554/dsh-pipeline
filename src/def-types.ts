/**
 * Pure definition vocabulary (FR-1) shared by both faces: the host half
 * (schema/ir/store) and the client half (form editor, bundled by esbuild).
 * This module must stay free of Node-only imports so the client TypeScript
 * program (DOM lib, no node types) can typecheck its consumers.
 *
 * Shape-level validation that needs the message catalog lives in schema.ts;
 * this module only carries types and the id grammar.
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
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export function isValidDefName(name: string): boolean {
  return ID_RE.test(name)
}
