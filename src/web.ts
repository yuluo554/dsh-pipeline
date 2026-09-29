/**
 * Host web half (M3, plan/05): authenticated `/api/dsh-pipeline/*` fetch
 * routes consumed by the browser bundle. This is the store RPC seam of
 * plan/03's `client/store.ts` row — the client calls plain `fetch()` (same
 * origin, cookie-authenticated by the Connection carrier, exactly like the
 * official deliverables routes) and the handlers delegate to the same
 * store/validate/runner modules the `/pipeline` command uses, so the editor
 * can never write a definition the command layer would reject.
 *
 * Activated as a sub-plugin with its own inject list: profiles without the
 * web stack (connection/sessionController) keep the core plugin active and
 * simply never mount these routes.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
// Type-only imports whose module augmentations put `sessionController` on
// the cordis Context (and carry the Session/Agent identity types).
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { runPipeline } from './runner.js'
import type { RunOutcome, SkillResolver } from './runner.js'
import { createPipelineRunRecorder } from './run-recorder.js'
import type { RecorderHost, RecorderSession } from './run-recorder.js'
import { listDefs, loadDef, readRawDef, saveDef } from './store.js'
import { validateDef } from './schema.js'
import { isValidDefName } from './def-types.js'
import { buildIR } from './ir.js'
import { PipelineError } from './errors.js'
import { setLocale } from './messages.js'
import { formatSuccess, formatFailure } from './format.js'
import type { PipelineDef } from './schema.js'

/** Plugin name of the web sub-plugin (cordis fiber identity). */
export const WEB_PLUGIN_NAME = 'dsh-pipeline-web'

/** Route prefix; every endpoint lives directly below it. */
export const WEB_ROUTE_PREFIX = '/api/dsh-pipeline'

export interface WebHalfConfig {
  /** Same knob as the entry half; children are pinned to this provider. */
  provider?: string
  locale?: 'en' | 'zh'
}

/**
 * Mount the web half. Called from index.ts with the ROOT context: the
 * sub-plugin waits for `connection` + `sessionController` before applying,
 * so CLI-only profiles never see a missing-service failure.
 */
export function mountWebHalf(ctx: Context, config: WebHalfConfig): void {
  ctx.plugin({
    name: WEB_PLUGIN_NAME,
    inject: ['connection', 'sessionController'],
    apply: (webCtx: Context) => registerWebRoutes(webCtx, config),
  })
}

/** Register every route as one Cordis effect (uninstall revokes all). */
export function registerWebRoutes(ctx: Context, config: WebHalfConfig): void {
  const providerName = config.provider ?? 'spawn'
  if (config.locale !== undefined) setLocale(config.locale)

  const disposers: Array<() => Promise<void>> = []
  const route = (
    path: string,
    methods: readonly ('GET' | 'POST')[],
    fetch: (request: Request) => Promise<Response>,
  ): void => {
    const registration: ConnectionFetchRoute = { path: `${WEB_ROUTE_PREFIX}${path}`, methods, requestBody: 'buffered', fetch }
    disposers.push(ctx.connection.fetch.register(registration))
  }
  ctx.effect(() => async () => {
    for (const dispose of disposers) await dispose()
  }, 'dsh-pipeline: web routes')

  route('/inventory', ['GET'], () => respond(async () => ({
    pipelines: await listDefs(ctx),
    skills: await listSkills(ctx),
    tools: listTools(ctx),
    provider: providerName,
  })))

  route('/def', ['GET'], (request) => respond(async () => {
    const name = new URL(request.url).searchParams.get('name') ?? ''
    return { name, raw: await readRawDef(ctx, name) }
  }))

  route('/validate', ['POST'], (request) => respond(async () => validatePayload(await readBody(request))))

  route('/save', ['POST'], (request) => respond(async () => {
    const payload = await readBody(request)
    const checked = validatePayload(payload)
    if (!checked.ok) return checked
    const def = checked.def
    await saveDef(ctx, def)
    // Canonical bytes the editor displays: the exact text store.saveDef wrote.
    return { ok: true as const, json: JSON.stringify(def, null, 2) + '\n' }
  }))

  route('/catalog', ['GET'], () => respond(async () => ctx.sessionController.modelCatalog()))

  route('/run', ['POST'], (request) => respond(async () => runFromWeb(ctx, providerName, await readBody(request), request.signal)))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Business shape of every POST body: a raw definition candidate. */
async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw badRequest('request body must be JSON')
  }
}

async function respond(produce: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await produce())
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status })
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function badRequest(message: string): HttpError {
  return new HttpError(400, message)
}

/**
 * Shape validation + IR preflight for a candidate definition. Both gates run
 * host-side so the editor shows exactly what `/pipeline run` would refuse:
 * validateDef collects every shape violation; buildIR rejects cycles, unknown
 * template variables, and the M2 feature gates with the localized messages.
 */
function validatePayload(payload: unknown): { ok: true; def: PipelineDef } | { ok: false; errors: Array<{ path: string; message: string }> } {
  const checked = validateDef(payload)
  if (!checked.ok) return checked
  try {
    buildIR(checked.def)
    return checked
  } catch (err) {
    const message = err instanceof PipelineError ? err.message : err instanceof Error ? err.message : String(err)
    return { ok: false, errors: [{ path: '', message }] }
  }
}

/** Host skills catalog summary for the editor's multi-select. */
async function listSkills(ctx: Context): Promise<Array<{ name: string; description: string }>> {
  const registry = skillsOf(ctx) as { list(): Promise<SkillSummary[]> } | undefined
  if (registry === undefined) return []
  const summaries = await registry.list()
  return summaries.map((skill) => ({ name: skill.name, description: skill.description }))
}

/** Global tool registry names/descriptions; the editor shows them read-only (口径: toolFilter 未解封). */
function listTools(ctx: Context): Array<{ name: string; description: string }> {
  try {
    const schemas = (ctx as { tools?: { schemas?: () => ToolSchema[] } }).tools?.schemas?.()
    return (schemas ?? []).map((schema) => ({ name: schema.name, description: schema.description }))
  } catch {
    return []
  }
}

/** Lazy `ctx.skills` read (same convention as entry.ts): missing service = no catalog. */
function skillsOf(ctx: Context): SkillResolver | undefined {
  try {
    return (ctx as { skills?: SkillResolver }).skills
  } catch {
    return undefined
  }
}

/**
 * Web-initiated run: same load -> run -> format path as the command/tool,
 * with the parent agent resolved from the browser's current session.
 * `request.signal` (browser fetch abort) propagates into the engine run.
 */
async function runFromWeb(
  ctx: Context,
  providerName: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (typeof payload !== 'object' || payload === null) throw badRequest('body must be an object')
  const { name, input, sessionId } = payload as Record<string, unknown>
  if (typeof name !== 'string' || !isValidDefName(name)) throw badRequest(`invalid pipeline name: ${JSON.stringify(name)}`)
  if (typeof input !== 'string') throw badRequest('input must be a string')
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw badRequest('sessionId must be a non-empty string')

  const resolved = await ctx.sessionController.resolveAgent(brandString<SessionId>(sessionId))
  if ('error' in resolved) {
    const detail = resolved.error.message || resolved.error.code
    return { ok: false, error: `session has no runnable agent: ${detail}` }
  }
  const parent: Agent = resolved.agent

  const provider = ctx.subagents.getProvider(providerName)
  if (provider === undefined) {
    return { ok: false, error: `no subagent provider registered as "${providerName}" (available: ${ctx.subagents.list().join(', ')})` }
  }

  const def = await loadDef(ctx, name)
  // M4 run card: project the run into the parent session's event log. The
  // recorder subscribes its own listeners and never lets a recording failure
  // touch the run outcome (guarded appends, dispose in finally).
  const recorder = createPipelineRunRecorder(ctx as unknown as RecorderHost)
  const nodePlans = buildIR(def).nodes.map((node) => ({
    id: node.id,
    label: node.phaseTitle,
    ...(node.agentOptions.provider !== undefined ? { provider: node.agentOptions.provider } : {}),
    ...(node.agentOptions.model !== undefined ? { model: node.agentOptions.model } : {}),
  }))
  let runId: string | undefined
  try {
    const outcome: RunOutcome = await runPipeline(
      {
        engine: ctx.workflowEngine,
        caps: provider.capabilities,
        parent,
        providerName,
        signal,
        ...(skillsOf(ctx) !== undefined ? { skills: skillsOf(ctx) } : {}),
        onRunStart: (run) => {
          runId = run.id
          recorder.start(parent.session as RecorderSession, run, def.name, nodePlans)
        },
      },
      def,
      input,
    )
    recorder.finish(runId ?? '', outcome.stopReason, outcome.error)
    if (outcome.stopReason !== 'completed') {
      return { ok: false, error: formatFailure(def, outcome).message }
    }
    return { ok: true, text: formatSuccess(def, outcome) }
  } catch (err) {
    // runPipeline threw after the engine accepted: the card must not hang
    // running. Before acceptance runId is undefined and nothing was recorded.
    if (runId !== undefined) recorder.finish(runId, 'error', err instanceof Error ? err.message : String(err))
    throw err
  } finally {
    recorder.dispose()
  }
}
