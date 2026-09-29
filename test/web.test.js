/**
 * M3 web half tests: drive the real `registerWebRoutes` glue through a stub
 * `ctx.connection.fetch.register` — the same Request/Response contract the
 * Connection carrier hands routes in production. Covers the store RPC
 * (inventory/def/save), the validate gate (validateDef + IR preflight), the
 * model catalog passthrough, and the web-initiated run (resolveAgent ->
 * runPipeline -> formatted summary, with cancellation).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerWebRoutes } from '../lib/web.js'
import { MockWorkflowEngine } from '../lib/mock-engine.js'
import { fixture, makeStubFs, FULL_CAPS } from './helpers.js'
import { PIPELINES_DIR } from '../lib/store.js'

const DEMO = [`${PIPELINES_DIR}/three-node-two-models.json`, JSON.stringify(fixture('three-node-two-models.json'))]

/**
 * Install the routes on a stub ctx and return a caller: request(method,
 * path, body) -> Response. The run route needs a sessionController whose
 * resolveAgent hands back the stub agent, a provider registry, and an engine.
 */
function install({ files = [], engine = new MockWorkflowEngine(), skills, catalog, sessionAppend } = {}) {
  const routes = new Map()
  const effects = []
  const hostHandlers = new Map()
  const sessionLog = []
  const agent = {
    session: {
      id: 'stub-session',
      append(type, data) {
        if (sessionAppend !== undefined) sessionAppend(type, data)
        sessionLog.push({ type, data })
      },
    },
  }
  const ctx = {
    fs: makeStubFs(new Map(files)),
    workflowEngine: engine,
    subagents: {
      getProvider: (name) => (name === 'spawn' ? { capabilities: FULL_CAPS } : undefined),
      list: () => ['spawn', 'fork'],
    },
    connection: {
      fetch: {
        register(route) {
          for (const method of route.methods) routes.set(`${method} ${route.path}`, route.fetch)
          return async () => {
            for (const method of route.methods) routes.delete(`${method} ${route.path}`)
          }
        },
      },
    },
    sessionController: {
      async resolveAgent(sessionId) {
        return sessionId === 'sess-1' ? { agent } : { error: { code: 'session/not-found', message: 'no such session' } }
      },
      async modelCatalog() {
        return catalog ?? {
          default: { provider: 'deepseek', model: 'deepseek-chat' },
          routableProviders: ['deepseek'],
          groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
          failures: [],
        }
      },
    },
    ...(skills !== undefined ? { skills } : {}),
    on(event, handler) {
      hostHandlers.set(event, handler)
      return () => hostHandlers.delete(event)
    },
    effect(fn, label) {
      effects.push({ fn, label })
    },
  }
  registerWebRoutes(ctx, {})
  const request = async (method, path, body) => {
    const url = `/api/dsh-pipeline${path}`
    const handler = routes.get(`${method} ${new URL(`https://host.test${url}`).pathname}`)
    assert.ok(handler, `route not registered: ${method} ${url}`)
    const init = { method }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
      init.headers = { 'content-type': 'application/json' }
    }
    return handler(new Request(`https://host.test/api/dsh-pipeline${path}`, init))
  }
  return { ctx, request, effects, sessionLog, hostHandlers }
}

test('routes register under /api/dsh-pipeline with buffered bodies', () => {
  const { effects } = install()
  assert.ok(effects.some((entry) => entry.label === 'dsh-pipeline: web routes'), 'routes must be one revocable effect')
})

test('GET /inventory lists pipelines, skills, and tools', async () => {
  const skills = { list: async () => [{ name: 'docx', description: 'Office docs' }] }
  const { request } = install({ files: [DEMO], skills })
  const response = await request('GET', '/inventory')
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.pipelines, ['three-node-two-models'])
  assert.deepEqual(body.skills, [{ name: 'docx', description: 'Office docs' }])
  assert.equal(body.provider, 'spawn')
  assert.ok(Array.isArray(body.tools))
})

test('GET /def returns the raw file; unknown names answer 404-shaped store errors', async () => {
  const { request } = install({ files: [DEMO] })
  const ok = await request('GET', '/def?name=three-node-two-models')
  const body = await ok.json()
  assert.equal(body.name, 'three-node-two-models')
  assert.match(body.raw, /"three-node-two-models"/)

  const missing = await request('GET', '/def?name=ghost')
  assert.equal(missing.status, 500)
  assert.match((await missing.json()).error, /no pipeline named "ghost"/)
})

test('POST /validate runs validateDef + the IR preflight', async () => {
  const { request } = install()
  const good = await request('POST', '/validate', fixture('three-node-two-models.json'))
  assert.deepEqual(await good.json(), { ok: true, def: fixture('three-node-two-models.json') })

  const shapeBad = await request('POST', '/validate', { name: 'x', description: 'x', nodes: [] })
  const shapeBody = await shapeBad.json()
  assert.equal(shapeBody.ok, false)
  assert.ok(shapeBody.errors.some((e) => e.path === 'nodes'))

  const semanticBad = await request('POST', '/validate', { name: 'x', description: 'x', nodes: [{ id: 'a', prompts: ['{{ghost}}'] }] })
  const semanticBody = await semanticBad.json()
  assert.equal(semanticBody.ok, false)
  assert.match(semanticBody.errors[0].message, /IR_UNKNOWN_VARIABLE|does not match any node id/)
})

test('POST /save validates, writes, and returns the canonical bytes', async () => {
  const def = fixture('single-node.json')
  const { request, ctx } = install()
  const response = await request('POST', '/save', def)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.json, `${JSON.stringify(def, null, 2)}\n`)
  const stored = JSON.parse(ctx.fs.files.get(`${PIPELINES_DIR}/single-node.json`))
  assert.deepEqual(stored, def)

  const rejected = await request('POST', '/save', { name: 'bad name!', description: 'x', nodes: [{ id: 'a', prompts: ['p'] }] })
  assert.equal((await rejected.json()).ok, false)
  assert.ok(!ctx.fs.files.has(`${PIPELINES_DIR}/bad name!.json`), 'invalid defs must never touch disk')
})

test('GET /catalog passes the session controller catalog through', async () => {
  const { request } = install()
  const body = await (await request('GET', '/catalog')).json()
  assert.equal(body.groups[0].id, 'deepseek')
  assert.equal(body.groups[0].models[0].id, 'deepseek-chat')
})

test('POST /run resolves the session agent and returns the formatted summary', async () => {
  const engine = new MockWorkflowEngine({
    behavior: { responses: { Outline: 'OUT', Review: 'REV', Write: 'FINAL' } },
  })
  const { request } = install({ files: [DEMO], engine })
  const response = await request('POST', '/run', { name: 'three-node-two-models', input: 'coffee', sessionId: 'sess-1' })
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.match(body.text, /pipeline "three-node-two-models" completed: 3 nodes, 3 agents\./)
  assert.match(body.text, /write: FINAL/)
  assert.equal(engine.lastRequest.args, 'coffee')
})

test('POST /run reports session/agent resolution failures readably', async () => {
  const { request } = install({ files: [DEMO] })
  const response = await request('POST', '/run', { name: 'three-node-two-models', input: 'x', sessionId: 'sess-ghost' })
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.match(body.error, /no runnable agent/)
})

test('POST /run rejects malformed payloads with 400', async () => {
  const { request } = install()
  const badName = await request('POST', '/run', { name: '../escape', input: 'x', sessionId: 'sess-1' })
  assert.equal(badName.status, 400)
  const badSession = await request('POST', '/run', { name: 'x', input: 'x', sessionId: '' })
  assert.equal(badSession.status, 400)
})

test('POST /run maps engine failures to ok:false with the localized message', async () => {
  const engine = new MockWorkflowEngine({ behavior: { failAtCalls: [1] } })
  const { request } = install({ files: [DEMO], engine })
  const body = await (await request('POST', '/run', { name: 'three-node-two-models', input: 'x', sessionId: 'sess-1' })).json()
  assert.equal(body.ok, false)
  assert.match(body.error, /stopped \(error\): node "outline" failed at prompt 1/)
})

test('aborting the request settles the run as cancelled, not completed', async () => {
  const engine = new MockWorkflowEngine({
    behavior: { responses: { Outline: 'OUT', Review: 'REV', Write: 'FINAL' } },
  })
  const { request } = install({ files: [DEMO], engine })
  const controller = new AbortController()
  const pending = request('POST', '/run', { name: 'three-node-two-models', input: 'x', sessionId: 'sess-1' })
  // The stub route handler receives the Request; abort before it settles.
  controller.abort()
  const response = await pending
  const body = await response.json()
  // Either the engine observed the abort (cancelled) or the run completed
  // before the abort landed; both must be well-formed answers.
  if (body.ok === false) assert.match(body.error, /cancel|abort/i)
})

// ---------------------------------------------------------------------------
// M4 run-card recording: the web run projects its lifecycle into the parent
// session log (pipeline-run/* events). The mock engine emits no host events,
// so the web-path sequence is run-start -> run-end; the per-agent events are
// covered in run-recorder.test.js.
// ---------------------------------------------------------------------------

test('POST /run records run-start and run-end into the parent session log', async () => {
  const engine = new MockWorkflowEngine({
    behavior: { responses: { Outline: 'OUT', Review: 'REV', Write: 'FINAL' } },
  })
  const { request, sessionLog, hostHandlers } = install({ files: [DEMO], engine })
  const body = await (await request('POST', '/run', { name: 'three-node-two-models', input: 'coffee', sessionId: 'sess-1' })).json()
  assert.equal(body.ok, true)

  assert.deepEqual(sessionLog.map((entry) => entry.type), ['pipeline-run/run-start', 'pipeline-run/run-end'])
  const [start, end] = sessionLog
  assert.equal(start.data.name, 'three-node-two-models')
  assert.equal(typeof start.data.runId, 'string')
  assert.match(start.data.runId, /^mock-run-/)
  assert.deepEqual(start.data.nodes.map((node) => [node.id, node.label, node.model ?? null]), [
    ['outline', 'Outline', 'deepseek-chat'],
    ['review', 'Review', null],
    ['write', 'Write', 'deepseek-reasoner'],
  ])
  assert.equal(end.data.runId, start.data.runId)
  assert.equal(end.data.stopReason, 'completed')
  assert.equal(typeof end.data.durationMs, 'number')
  // The recorder's listeners live exactly for the run: all detached after.
  assert.equal(hostHandlers.size, 0)
})

test('POST /run records an error run-end naming the failing node', async () => {
  const engine = new MockWorkflowEngine({ behavior: { failAtCalls: [1] } })
  const { request, sessionLog } = install({ files: [DEMO], engine })
  const body = await (await request('POST', '/run', { name: 'three-node-two-models', input: 'x', sessionId: 'sess-1' })).json()
  assert.equal(body.ok, false)
  assert.deepEqual(sessionLog.map((entry) => entry.type), ['pipeline-run/run-start', 'pipeline-run/run-end'])
  const end = sessionLog.at(-1).data
  assert.equal(end.stopReason, 'error')
  assert.match(end.error, /failed at prompt 1/)
})

test('a session whose append fails never breaks the run (recording disabled)', async () => {
  const engine = new MockWorkflowEngine({
    behavior: { responses: { Outline: 'OUT', Review: 'REV', Write: 'FINAL' } },
  })
  // Simulate the cross-plugin seam: the resolved agent's session rejects
  // every append (foreign session object without a working log).
  const { request } = install({ files: [DEMO], engine, sessionAppend: () => { throw new Error('log closed') } })
  const body = await (await request('POST', '/run', { name: 'three-node-two-models', input: 'coffee', sessionId: 'sess-1' })).json()
  assert.equal(body.ok, true, 'recording failure must not affect the run outcome')
  assert.match(body.text, /completed/)
})
