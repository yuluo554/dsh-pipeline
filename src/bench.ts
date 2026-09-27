/**
 * Offline benchmark suites B1-B3 (plan/04) — zero API dependency, fully
 * reproducible. `pnpm bench` (scripts/bench.js) prints the metrics table;
 * test/bench.test.js asserts the same results in CI, so a green test run IS
 * a green benchmark run. The judged objects follow plan/04 真值语义: B1 =
 * compiled script text vs frozen snapshots (byte-exact), B2 = validate ->
 * normalize -> compile accept/reject with expected error codes, B3 = agent()
 * call parameter sequence + event sequence against the mock engine (口径 3).
 *
 * B4 (failure-policy matrix) lands in M2 together with the policy compiler.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateDef } from './schema.js'
import { buildIR } from './ir.js'
import { compileScript } from './compiler.js'
import { runPipeline } from './runner.js'
import type { RunOutcome } from './runner.js'
import { MockWorkflowEngine } from './mock-engine.js'
import { ErrorCode } from './errors.js'
import type { PipelineDef } from './schema.js'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** All capabilities on — mirrors the in-process spawn/fork providers. */
export const FULL_CAPS = Object.freeze({
  agentOptions: true,
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
})

export interface B1Result {
  files: string[]
  /** Fixture files whose compiled output differs from the frozen snapshot. */
  diffs: string[]
}

export interface B2Result {
  cases: number
  /** `fixture -> { expected, actual }` mismatches; empty = 100%. */
  failures: Map<string, { expected: string; actual: string }>
}

export interface B3Result {
  scenarios: number
  failures: string[]
}

export interface BenchReport {
  b1: B1Result
  b2: B2Result
  b3: B3Result
}

/** B1 — compile every valid fixture, byte-compare with data/snapshots/. */
export function runB1(): B1Result {
  const files = readdirSync(join(DATA_DIR, 'pipelines')).filter((f) => f.endsWith('.json')).sort()
  const diffs: string[] = []
  for (const file of files) {
    const expected = readFileSync(join(DATA_DIR, 'snapshots', file.replace(/\.json$/, '.js')), 'utf8')
    const actual = compileFixture(join(DATA_DIR, 'pipelines', file))
    if (actual !== expected) diffs.push(file)
  }
  return { files, diffs }
}

/** B2 — the full validation matrix: invalid fixtures must reject with their frozen error code. */
export function runB2(): B2Result {
  const manifest = JSON.parse(readFileSync(join(DATA_DIR, 'invalid', 'index.json'), 'utf8')) as Record<string, string>
  const failures = new Map<string, { expected: string; actual: string }>()
  let cases = 0
  const entries = Object.entries(manifest).filter(([file]) => file.endsWith('.json'))
  for (const [file, expected] of entries) {
    cases += 1
    const actual = expectError(join(DATA_DIR, 'invalid', file))
    if (actual !== expected) failures.set(file, { expected, actual })
  }
  // The valid set must stay accepted end-to-end.
  for (const file of readdirSync(join(DATA_DIR, 'pipelines')).filter((f) => f.endsWith('.json'))) {
    cases += 1
    const actual = compileFixture(join(DATA_DIR, 'pipelines', file)) === null ? 'REJECTED' : 'ACCEPTED'
    if (actual !== 'ACCEPTED') failures.set(file, { expected: 'ACCEPTED', actual })
  }
  return { cases, failures }
}

/**
 * B3 — mock-engine e2e: the runner drives the compiled script through the
 * mock engine; assert call sequence, event sequence, upstream-output
 * injection, structured-output interpolation, cancellation (no residual
 * calls), and the default abort path on failure.
 */
export async function runB3(): Promise<B3Result> {
  const failures: string[] = []
  const demoDef = loadDefFixture('three-node-two-models.json')
  const check = (scenario: string, ok: boolean, detail: string): void => {
    if (!ok) failures.push(`${scenario}: ${detail}`)
  }

  // Scenario 1 — happy path: call order, routing opts, upstream injection.
  {
    const engine = new MockWorkflowEngine({
      behavior: {
        responses: {
          Outline: 'OUTLINE-TEXT',
          Review: 'REVIEW-NOTES',
          Write: 'ARTICLE-TEXT',
        },
      },
    })
    const outcome = await runPipeline(makeDeps(engine), demoDef, 'dsh-pipeline')
    check('happy-path calls', engine.calls.length === 3, `expected 3 calls, got ${engine.calls.length}`)
    check('happy-path labels', engine.calls.map((c) => c.label).join(',') === 'Outline,Review,Write', `labels ${engine.calls.map((c) => c.label).join(',')}`)
    check('outline routing', JSON.stringify(engine.calls[0]?.opts) === JSON.stringify({ label: 'Outline', provider: 'deepseek', model: 'deepseek-chat' }), `opts ${JSON.stringify(engine.calls[0]?.opts)}`)
    check('write routing', JSON.stringify(engine.calls[2]?.opts) === JSON.stringify({ label: 'Write', provider: 'deepseek', model: 'deepseek-reasoner' }), `opts ${JSON.stringify(engine.calls[2]?.opts)}`)
    check('upstream injection', engine.calls[1]?.prompt.includes('OUTLINE-TEXT') === true, `review prompt ${JSON.stringify(engine.calls[1]?.prompt)}`)
    check('final injection', engine.calls[2]?.prompt.includes('REVIEW-NOTES') === true, `write prompt ${JSON.stringify(engine.calls[2]?.prompt)}`)
    check('input injection', engine.calls[0]?.prompt.includes('dsh-pipeline') === true, `outline prompt ${JSON.stringify(engine.calls[0]?.prompt)}`)
    check('happy-path events', eventsEqual(engine.events, [
      'workflow:start',
      'phase:Outline', 'agent-start:1:Outline', 'agent-end:1:Outline:completed',
      'phase:Review', 'agent-start:2:Review', 'agent-end:2:Review:completed',
      'phase:Write', 'agent-start:3:Write', 'agent-end:3:Write:completed',
      'workflow:end:completed',
    ]), `events ${JSON.stringify(engine.events)}`)
    check('request construction', JSON.stringify(pick(engine.lastRequest, ['args', 'subagentProvider', 'maxTotalAgents', 'meta'])) === JSON.stringify({
      args: 'dsh-pipeline',
      subagentProvider: 'spawn',
      maxTotalAgents: 3,
      meta: { name: 'three-node-two-models', description: demoDef.description, phases: [{ title: 'Outline' }, { title: 'Review' }, { title: 'Write' }] },
    }), `request ${JSON.stringify(pick(engine.lastRequest, ['args', 'subagentProvider', 'maxTotalAgents', 'meta']))}`)
    check('happy-path outcome', outcome.stopReason === 'completed' && outcome.agentsStarted === 3 && JSON.stringify(outcome.value) === JSON.stringify({ nodes: { outline: 'OUTLINE-TEXT', review: 'REVIEW-NOTES', write: 'ARTICLE-TEXT' } }), `outcome ${JSON.stringify(outcome)}`)
  }

  // Scenario 2 — structured output flows downstream as JSON.
  {
    const engine = new MockWorkflowEngine({
      behavior: { responses: { Keywords: '{"keywords":["alpha","beta","gamma"]}' } },
    })
    const outcome = await runPipeline(makeDeps(engine), loadDefFixture('output-schema.json'), 'topic-x')
    check('structured value', JSON.stringify(outcome.value) === JSON.stringify({ nodes: { keywords: { keywords: ['alpha', 'beta', 'gamma'] }, tagline: 'mock output 2' } }), `outcome ${JSON.stringify(outcome.value)}`)
    check('structured interpolation', engine.calls[1]?.prompt.includes('{"keywords":["alpha","beta","gamma"]}') === true, `tagline prompt ${JSON.stringify(engine.calls[1]?.prompt)}`)
    check('schema forwarded', engine.calls[0]?.opts.schema !== undefined, 'keywords call missing schema opt')
  }

  // Scenario 3 — cancellation: injected after 1 call; no residual calls.
  {
    const engine = new MockWorkflowEngine({ behavior: { cancelAfterCalls: 1 } })
    const outcome = await runPipeline(makeDeps(engine), demoDef, 'topic-y')
    check('cancel residual calls', engine.calls.length === 1, `expected 1 call after cancel, got ${engine.calls.length}`)
    check('cancel outcome', outcome.stopReason === 'cancelled' && outcome.agentsStarted === 1 && outcome.value === null, `outcome ${JSON.stringify(outcome)}`)
    check('cancel events', engine.events[engine.events.length - 1] === 'workflow:end:cancelled', `last event ${engine.events[engine.events.length - 1]}`)
  }

  // Scenario 4 — default abort policy: a failed child (null) kills the run.
  {
    const engine = new MockWorkflowEngine({ behavior: { failAtCalls: [2] } })
    const outcome = await runPipeline(makeDeps(engine), loadDefFixture('multi-prompt-node.json'), 'topic-z')
    check('abort outcome', outcome.stopReason === 'error' && outcome.agentsStarted === 2, `outcome ${JSON.stringify(outcome)}`)
    check('abort message', outcome.error?.includes('node "planner" failed at prompt 2') === true, `error ${JSON.stringify(outcome.error)}`)
    check('abort events', engine.events.includes('agent-end:2:Planner #2:failed') && engine.events[engine.events.length - 1] === 'workflow:end:error', `events ${JSON.stringify(engine.events)}`)
  }

  return { scenarios: 4, failures }
}

function makeDeps(engine: MockWorkflowEngine): Parameters<typeof runPipeline>[0] {
  // The mock stands in for the engine; parent/caps mirror the real spawn route.
  return {
    engine: engine as unknown as Parameters<typeof runPipeline>[0]['engine'],
    caps: FULL_CAPS,
    parent: { session: { id: 'mock-parent' } } as unknown as Parameters<typeof runPipeline>[0]['parent'],
    providerName: 'spawn',
  }
}

function loadDefFixture(file: string): PipelineDef {
  const parsed: unknown = JSON.parse(readFileSync(join(DATA_DIR, 'pipelines', file), 'utf8'))
  const checked = validateDef(parsed)
  if (!checked.ok) throw new Error(`fixture ${file} failed validation: ${JSON.stringify(checked.errors)}`)
  return checked.def
}

function compileFixture(path: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const checked = validateDef(parsed)
    if (!checked.ok) return null
    return compileScript(buildIR(checked.def))
  } catch {
    return null
  }
}

/** Full validate -> normalize -> compile path; returns the PipelineError code or 'ACCEPTED'. */
function expectError(path: string): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const checked = validateDef(parsed)
    if (!checked.ok) {
      // Shape violations are all reported under the schema code (B2 manifest).
      return ErrorCode.schema
    }
    compileScript(buildIR(checked.def))
    return 'ACCEPTED'
  } catch (err) {
    return err instanceof Error && 'code' in err ? String((err as { code: unknown }).code) : 'UNEXPECTED_THROW'
  }
}

function eventsEqual(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((event, index) => event === expected[index])
}

function pick(obj: unknown, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) out[key] = (obj as Record<string, unknown>)[key]
  return out
}

export type { RunOutcome }
