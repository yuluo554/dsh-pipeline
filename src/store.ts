/**
 * Definition store (FR-1, plan/03): pipelines live as plain JSON files in the
 * workspace under `.dsh/pipelines/<name>.json`, accessed through the fs seam
 * (the host's execution world; relative paths resolve against its default
 * base — the dsh process cwd, i.e. the workspace). Mutations go through
 * `fs.writeText`, whose backend contract is atomic publication (plan/03's
 * "temp+rename" is provided by the seam itself, verified in dsh-fs-local).
 */
import { FsError } from '@deepseek-ai/dsh-fs'
import type { Context } from '@deepseek-ai/cordis'
import { ErrorCode, PipelineError } from './errors.js'
import { isValidDefName, validateDef } from './schema.js'
import type { PipelineDef } from './schema.js'

export const PIPELINES_DIR = '.dsh/pipelines'

function defPath(name: string): string {
  return `${PIPELINES_DIR}/${name}.json`
}

function isMissing(err: unknown): boolean {
  return err instanceof FsError && err.code === 'FS_NOT_FOUND'
}

/** List saved pipeline names (sorted). An absent directory lists as empty. */
export async function listDefs(ctx: Context): Promise<string[]> {
  let entries
  try {
    entries = await ctx.fs.listDir(await ctx.fs.resolve(PIPELINES_DIR))
  } catch (err) {
    if (isMissing(err)) return []
    throw storeError(`cannot list ${PIPELINES_DIR}: ${render(err)}`)
  }
  return entries
    .filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .sort()
}

/** Load and validate one definition. Throws STORE_ERROR / SCHEMA_INVALID. */
export async function loadDef(ctx: Context, name: string): Promise<PipelineDef> {
  const raw = await readRawDef(ctx, name)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw storeError(`pipeline "${name}" is not valid JSON: ${render(err)}`)
  }
  const checked = validateDef(parsed)
  if (!checked.ok) {
    throw new PipelineError(
      ErrorCode.schema,
      `pipeline "${name}" has ${checked.errors.length} definition problem(s):\n` +
        checked.errors.map((e) => `  - ${e.path || '(root)'}: ${e.message}`).join('\n'),
    )
  }
  return checked.def
}

/** Read the raw definition text (for `/pipeline show`). Throws STORE_ERROR when absent. */
export async function readRawDef(ctx: Context, name: string): Promise<string> {
  if (!isValidDefName(name)) {
    throw storeError(`"${name}" is not a valid pipeline name (letters, digits, "_" and "-"; must start alphanumeric)`)
  }
  try {
    return await ctx.fs.readText(await ctx.fs.resolve(defPath(name)))
  } catch (err) {
    if (isMissing(err)) throw storeError(`no pipeline named "${name}" (see /pipeline list)`)
    throw storeError(`cannot read pipeline "${name}": ${render(err)}`)
  }
}

/** Validate and persist a definition (pretty-printed, 2-space, trailing newline). */
export async function saveDef(ctx: Context, def: PipelineDef): Promise<void> {
  const checked = validateDef(def)
  if (!checked.ok) {
    throw new PipelineError(
      ErrorCode.schema,
      `refusing to save an invalid definition:\n` +
        checked.errors.map((e) => `  - ${e.path || '(root)'}: ${e.message}`).join('\n'),
    )
  }
  try {
    await ctx.fs.writeText(await ctx.fs.resolve(defPath(def.name)), JSON.stringify(def, null, 2) + '\n')
  } catch (err) {
    throw storeError(`cannot save pipeline "${def.name}": ${render(err)}`)
  }
}

function storeError(message: string): PipelineError {
  return new PipelineError(ErrorCode.store, message)
}

function render(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
