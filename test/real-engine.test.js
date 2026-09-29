/**
 * Real-engine tests (M2, plan/05 串行③; adapted 0.2.0-rc.1): the compiled
 * script + runner driven through the ACTUAL dsh workflow engine
 * (@deepseek-ai/dsh-workflow-ptc 0.2.0-rc.1 — since 0.2.0 the official
 * engine, replacing dsh-workflow-worker-thread) with a stub subagent
 * provider — no model API involved, still fully offline.
 *
 * The PTC engine offloads script execution to a sandboxed Node process via
 * `ctx.ptcRuntime`. The stub runtime here executes the REAL guest in-process:
 * the program string the engine passes to runtime.run embeds the guest as a
 * data: URL module (`await import("data:text/javascript,…")` followed by
 * `runWorkflowGuest(workflowHost)`), so the stub imports that same module and
 * calls runWorkflowGuest with the engine's own host bindings. Everything
 * above the process boundary — meta validation, body parse, caps, run
 * lifecycle, child RPC, cancellation — is the real engine.
 *
 * What this covers beyond the mock engine (B3):
 * - the frozen script format is valid in the real guest realm (vm, JSON
 *   materialization across the realm boundary);
 * - FR-8 cancellation end to end: the engine-level run.cancel() and the
 *   runner's input AbortSignal (which the runner maps to run.cancel) both
 *   reach the real engine, which aborts the shared signal passed to every
 *   managed child and settles the run `cancelled`;
 * - failure policies run on the real vm (child failure -> agent() null ->
 *   skip/retry handling in the compiled loop).
 *
 * Environment note (M2 实测, still true for PTC): the engine service is
 * normally constructed by Cordis (zod fills config defaults); constructing
 * it manually requires the FULL config — the PTC config schema is
 * {provider, maxConcurrentAgents, maxTotalAgents, maxItemsPerCall,
 * syncTimeoutMs} (disposeGraceMs was a worker-thread-only key).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Engine from '@deepseek-ai/dsh-workflow-ptc'
import { runPipeline } from '../lib/runner.js'
import { buildIR } from '../lib/ir.js'
import { compileScript } from '../lib/compiler.js'
import { validateDef, fixture, FULL_CAPS } from './helpers.js'

/**
 * Stub subagent provider standing in for the dsh host's subagents service.
 * Children settle fast unless the scenario hangs/fails them; hung children
 * resolve only when the engine's shared child signal aborts (which is exactly
 * how a real spawned child behaves when its process is killed).
 */
function makeStubSubagents({ failCalls = [], hangFromCall = Infinity } = {}) {
  const started = []
  let call = 0
  return {
    started,
    getProvider(name) {
      return name === 'stub' ? { capabilities: { agentOptions: true, outputSchema: true } } : undefined
    },
    async start(_provider, req) {
      call += 1
      const nth = call
      // 0.2.0 PTC guest carries run.id into workflow/agent-start payloads
      // (childId); a real subagent run always has its session id.
      const run = { disposeCount: 0, id: `stub-child-${nth}` }
      if (nth >= hangFromCall) {
        // Model a long-running child: settles only when aborted.
        run.result = new Promise((resolve) => {
          if (req.signal) req.signal.addEventListener('abort', () => resolve({ output: [], stopReason: 'cancelled' }), { once: true })
        })
      } else {
        const failed = failCalls.includes(nth)
        run.result = new Promise((resolve) => {
          const t = setTimeout(
            () => resolve(
              failed
                ? { output: [], stopReason: 'error', error: 'stub injected failure' }
                : { output: [{ type: 'text', text: `stub reply ${nth}` }], stopReason: 'completed' },
            ),
            failed ? 10 : 20,
          )
          if (req.signal) req.signal.addEventListener('abort', () => { clearTimeout(t); resolve({ output: [], stopReason: 'cancelled' }) }, { once: true })
        })
      }
      run.dispose = async () => { run.disposeCount += 1 }
      started.push({ nth, signal: req.signal, prompt: req.prompt?.[0]?.text, run })
      return run
    },
  }
}

/**
 * Stub PTC runtime: runs the engine's REAL guest module in-process instead of
 * a sandboxed child. The guest is embedded in the program as a data: URL
 * import; extract it, import it, and drive it with the engine's own host
 * bindings. Cancellation mirrors the process-kill semantics: an aborted run
 * signal rejects the program promise (the engine's drive() then settles the
 * run from its own cancelReason).
 */
function makeStubPtcRuntime() {
  return {
    language: 'typescript',
    resolve: (spec) => spec,
    async run(spec) {
      const match = /await import\((".*")\)/.exec(spec.program)
      assert.ok(match, 'engine program must embed the guest as a string import')
      const guest = await import(JSON.parse(match[1]))
      const host = spec.bindings.find((b) => b.global === 'workflowHost').functions
      const program = guest.runWorkflowGuest(host)
      // The losing guest promise must never become an unhandled rejection.
      program.catch(() => {})
      return Promise.race([
        program.then((value) => ({ value })),
        new Promise((_resolve, reject) => {
          spec.signal?.addEventListener('abort', () => reject(spec.signal.reason), { once: true })
        }),
      ])
    },
  }
}

function makeStubSandboxPolicy() {
  const policy = { workspaceRoot: process.cwd() }
  return { resolve: () => policy }
}

/** Real PtcWorkflowEngine on a bare Cordis context with stub services. */
function makeEngine(stub) {
  const ctx = new Context()
  ctx.subagents = stub
  ctx.ptcRuntime = makeStubPtcRuntime()
  ctx.sandboxPolicy = makeStubSandboxPolicy()
  ctx.logger = { warn: () => {} }
  // Full config: zod defaults only apply through the Cordis plugin flow.
  return new Engine(ctx, {
    provider: 'stub',
    maxConcurrentAgents: 0,
    maxTotalAgents: 1000,
    maxItemsPerCall: 4096,
    syncTimeoutMs: 5000,
  })
}

function deps(engine, overrides = {}) {
  return {
    engine,
    caps: FULL_CAPS,
    parent: { session: { id: 'stub-parent' } },
    providerName: 'stub',
    ...(overrides.signal !== undefined ? { signal: overrides.signal } : {}),
  }
}

/** Wait until the stub has started `count` children (deadline-bounded). */
async function untilChildrenStarted(stub, count, deadlineMs = 10_000) {
  const deadline = Date.now() + deadlineMs
  while (stub.started.length < count) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${count} children (started: ${stub.started.length})`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('real engine runs the compiled script to completion (frozen format is engine-valid)', { timeout: 20_000 }, async () => {
  const stub = makeStubSubagents()
  const outcome = await runPipeline(deps(makeEngine(stub)), fixture('single-node.json'), 'real-engine')
  assert.equal(outcome.stopReason, 'completed')
  assert.equal(outcome.agentsStarted, 1)
  assert.deepEqual(outcome.value, { nodes: { echo: 'stub reply 1' } })
  assert.equal(stub.started.length, 1)
  assert.equal(stub.started[0].run.disposeCount, 1)
})

test('engine-level run.cancel aborts the managed child mid-flight and settles cancelled', { timeout: 20_000 }, async () => {
  const stub = makeStubSubagents({ hangFromCall: 2 })
  const engine = makeEngine(stub)
  const ir = buildIR(validateDef(fixture('retry-skip.json')).def ?? fixture('retry-skip.json'))
  const run = engine.start({
    script: compileScript(ir),
    meta: { name: 'cancel-demo', description: 'real engine cancel', phases: ir.nodes.map((n) => ({ title: n.phaseTitle })) },
    args: 'cancel-demo',
    subagentProvider: 'stub',
    maxTotalAgents: ir.totalAgentCalls,
    parent: {},
  })
  // fetch (call 1) settles fast; enrich (call 2) hangs -> cancel while it runs
  await untilChildrenStarted(stub, 2)
  const childTwo = stub.started[1]
  assert.ok(childTwo.signal, 'engine must pass a shared signal to every child')
  run.cancel('test: cancel mid-child')
  const result = await run.result
  await run.dispose()
  assert.equal(result.stopReason, 'cancelled')
  assert.match(result.error, /cancel mid-child/)
  assert.equal(result.agentsStarted, 2)
  assert.equal(stub.started.length, 2, 'no children may start after cancellation')
  assert.equal(childTwo.signal.aborted, true, 'the engine aborts the hung child via the shared signal')
  assert.equal(childTwo.run.disposeCount, 1, 'the cancelled child is disposed exactly once')
})

test('runner maps an input AbortSignal to real engine cancellation (FR-8 end to end)', { timeout: 20_000 }, async () => {
  const stub = makeStubSubagents({ hangFromCall: 1 })
  const controller = new AbortController()
  const runPromise = runPipeline(deps(makeEngine(stub), { signal: controller.signal }), fixture('retry-skip.json'), 'signal-demo')
  await untilChildrenStarted(stub, 1)
  controller.abort(new Error('caller aborted'))
  const outcome = await runPromise
  assert.equal(outcome.stopReason, 'cancelled')
  assert.equal(stub.started.length, 1, 'no children may start after cancellation')
  assert.equal(stub.started[0].signal.aborted, true, 'managed child must observe the abort')
  assert.equal(stub.started[0].run.disposeCount, 1, 'child must be disposed exactly once')
})

test('failure policies run on the real vm: skip settles null, retry recovers', { timeout: 20_000 }, async () => {
  // skip: the only child fails (stopReason error -> agent() null) -> out null, run completes
  const skipDef = validateDef({
    name: 'real-skip',
    description: 'single skip node',
    nodes: [{ id: 'solo', label: 'Solo', prompts: ['flaky prompt'], failurePolicy: 'skip' }],
  })
  const skipOutcome = await runPipeline(deps(makeEngine(makeStubSubagents({ failCalls: [1] }))), skipDef.def, 'x')
  assert.equal(skipOutcome.stopReason, 'completed')
  assert.deepEqual(skipOutcome.value, { nodes: { solo: null } })

  // retry: first attempt fails, second succeeds -> completed with 2 agents started
  const retryDef = validateDef({
    name: 'real-retry',
    description: 'single retrying node',
    nodes: [{ id: 'solo', label: 'Solo', prompts: ['flaky prompt'], failurePolicy: 'abort', retry: 1 }],
  })
  const retryOutcome = await runPipeline(deps(makeEngine(makeStubSubagents({ failCalls: [1] }))), retryDef.def, 'x')
  assert.equal(retryOutcome.stopReason, 'completed')
  assert.deepEqual(retryOutcome.value, { nodes: { solo: 'stub reply 2' } })
  assert.equal(retryOutcome.agentsStarted, 2)
})
