/**
 * Offline benchmark suites B1-B4 (plan/04) — zero API dependency, fully
 * reproducible. `pnpm bench` (scripts/bench.js) prints the metrics table;
 * test/bench.test.js asserts the same results in CI, so a green test run IS
 * a green benchmark run. The judged objects follow plan/04 真值语义: B1 =
 * compiled script text vs frozen snapshots (byte-exact), B2 = validate ->
 * normalize -> compile accept/reject with expected error codes, B3 = agent()
 * call parameter sequence + event sequence against the mock engine (口径 3),
 * B4 = the failure-policy matrix (FR-9): skip / retry / default policy /
 * cancel-during-retry outcomes and event orders.
 *
 * Snapshot freezing needs deterministic skill content: fixtures declaring
 * `skills` compile against CANNED_SKILLS below (the runner instead resolves
 * ctx.skills at run time). The same canned map drives B1 and B4.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { validateDef } from './schema.js'
import { buildIR } from './ir.js'
import type { PipelineIR } from './ir.js'
import { compileScript } from './compiler.js'
import type { ResolvedSkills } from './compiler.js'
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

/**
 * Offline stand-in for host skills (plan/04 真值语义: fixtures + canned
 * content = deterministic snapshots). Keys are the skill names fixtures
 * declare; shapes mirror dsh-skill's validated definitions so the same
 * renderSkillContent path as the real runner produces the blocks.
 */
export const CANNED_SKILLS: Record<string, { name: string; description: string; source: string; provider: string; content: string }> = {
  office: {
    name: 'office',
    description: 'Office document workflow guidance for briefs and reports.',
    source: 'canned:bench',
    provider: 'dsh-pipeline-bench',
    content: 'Office skill (canned): draft the brief as .docx via the document tool, then verify with the structure checker.',
  },
}

/** Render every skill a fixture node declares against CANNED_SKILLS. */
export function cannedSkillBlocks(ir: PipelineIR): ResolvedSkills | undefined {
  const blocks: ResolvedSkills = new Map()
  let any = false
  for (const node of ir.nodes) {
    for (const name of node.skills ?? []) {
      const canned = CANNED_SKILLS[name]
      if (canned === undefined) {
        throw new Error(`no canned skill "${name}" for fixture compilation (add it to CANNED_SKILLS)`)
      }
      const list = blocks.get(node.id) ?? []
      list.push(renderSkillContent(canned))
      blocks.set(node.id, list)
      any = true
    }
  }
  return any ? blocks : undefined
}

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

export interface B4Result {
  scenarios: number
  failures: string[]
}

export interface BenchReport {
  b1: B1Result
  b2: B2Result
  b3: B3Result
  b4: B4Result
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

/**
 * B4 — failure-policy matrix (FR-9, plan/04): inject child failures at exact
 * agent() call numbers and judge each policy's outcome, node outputs, call
 * accounting and event order. All scenarios run the `retry-skip` fixture
 * (fetch=skip:2, enrich=skip, report=abort, verify=abort:1) or inline defs
 * derived from it.
 */
export async function runB4(): Promise<B4Result> {
  const failures: string[] = []
  const def = loadDefFixture('retry-skip.json')
  const check = (scenario: string, ok: boolean, detail: string): void => {
    if (!ok) failures.push(`${scenario}: ${detail}`)
  }
  const nodesOf = (outcome: RunOutcome): Record<string, unknown> =>
    (outcome.value as { nodes?: Record<string, unknown> } | null)?.nodes ?? {}

  // Scenario 1 — skip policy: a failed child assigns null and the run completes.
  // Call order: fetch#1, enrich#1, report#1, verify#1 — fail enrich (#2).
  {
    const engine = new MockWorkflowEngine({ behavior: { failAtCalls: [2] } })
    const outcome = await runPipeline(makeDeps(engine), def, 'b4-skip')
    check('skip outcome', outcome.stopReason === 'completed' && outcome.agentsStarted === 4, `outcome ${JSON.stringify(outcome)}`)
    const nodes = nodesOf(outcome)
    check('skip null output', nodes['enrich'] === null, `enrich ${JSON.stringify(nodes['enrich'])}`)
    check('skip downstream runs', typeof nodes['report'] === 'string' && typeof nodes['verify'] === 'string', `nodes ${JSON.stringify(nodes)}`)
    check('skip events', engine.events.includes('agent-end:2:Enrich:failed') && engine.events[engine.events.length - 1] === 'workflow:end:completed', `events ${JSON.stringify(engine.events)}`)
  }

  // Scenario 2 — retry recovers: fetch fails once, its second attempt succeeds.
  // Calls: fetch#1(fail) fetch#2 enrich report verify = 5 agents started.
  {
    const engine = new MockWorkflowEngine({ behavior: { failAtCalls: [1] } })
    const outcome = await runPipeline(makeDeps(engine), def, 'b4-retry')
    check('retry outcome', outcome.stopReason === 'completed' && outcome.agentsStarted === 5, `outcome ${JSON.stringify(outcome)}`)
    check('retry reruns the node', typeof nodesOf(outcome)['fetch'] === 'string', `fetch ${JSON.stringify(nodesOf(outcome)['fetch'])}`)
    check('retry call bound', engine.lastRequest?.maxTotalAgents === 7, `maxTotalAgents ${engine.lastRequest?.maxTotalAgents}`)
    check('retry events', engine.events.includes('agent-end:1:Fetch:failed') && engine.events.includes('agent-start:2:Fetch'), `events ${JSON.stringify(engine.events)}`)
  }

  // Scenario 3 — retry exhausted under abort: run errors naming attempts.
  // fetch is overridden to abort (the fixture ships it as skip): 3 failed
  // attempts -> "failed at prompt 1 after 3 attempt(s)".
  {
    const aborting = { ...def, nodes: def.nodes.map((node) => (node.id === 'fetch' ? { ...node, failurePolicy: 'abort' as const } : node)) }
    const engine = new MockWorkflowEngine({ behavior: { failAtCalls: [1, 2, 3] } })
    const outcome = await runPipeline(makeDeps(engine), aborting, 'b4-retry-abort')
    check('retry-abort outcome', outcome.stopReason === 'error' && outcome.agentsStarted === 3, `outcome ${JSON.stringify(outcome)}`)
    check('retry-abort message', outcome.error?.includes('node "fetch" failed at prompt 1 after 3 attempt(s)') === true, `error ${JSON.stringify(outcome.error)}`)
    check('retry-abort events', engine.events[engine.events.length - 1] === 'workflow:end:error', `events ${JSON.stringify(engine.events)}`)
  }

  // Scenario 4 — retry exhausted under skip: null output, run continues.
  // Calls: fetch ×3 all fail -> null, then enrich, report, verify succeed.
  {
    const exhausted = { ...def, nodes: def.nodes.map((node) => (node.id === 'fetch' ? { ...node, failurePolicy: 'skip' as const } : node)) }
    const engine = new MockWorkflowEngine({ behavior: { failAtCalls: [1, 2, 3] } })
    const outcome = await runPipeline(makeDeps(engine), exhausted, 'b4-retry-skip')
    check('retry-skip outcome', outcome.stopReason === 'completed' && outcome.agentsStarted === 6, `outcome ${JSON.stringify(outcome)}`)
    check('retry-skip null', nodesOf(outcome)['fetch'] === null, `fetch ${JSON.stringify(nodesOf(outcome)['fetch'])}`)
    check('retry-skip continues', typeof nodesOf(outcome)['report'] === 'string', `nodes ${JSON.stringify(nodesOf(outcome))}`)
  }

  // Scenario 5 — options.defaultFailurePolicy applies to nodes without one.
  {
    const defaulted = {
      name: 'default-policy',
      description: 'pipeline-wide skip default',
      options: { defaultFailurePolicy: 'skip' as const },
      nodes: [
        { id: 'solo', label: 'Solo', prompts: ['only prompt'] },
      ],
    }
    const engine = new MockWorkflowEngine({ behavior: { failAtCalls: [1] } })
    const outcome = await runPipeline(makeDeps(engine), defaulted as typeof def, 'b4-default')
    check('default-policy outcome', outcome.stopReason === 'completed' && outcome.agentsStarted === 1, `outcome ${JSON.stringify(outcome)}`)
    check('default-policy null', nodesOf(outcome)['solo'] === null, `solo ${JSON.stringify(nodesOf(outcome)['solo'])}`)
  }

  // Scenario 6 — cancellation unwinds a retry loop (no runaway reruns).
  {
    const engine = new MockWorkflowEngine({ behavior: { cancelAfterCalls: 1 } })
    const outcome = await runPipeline(makeDeps(engine), def, 'b4-cancel')
    check('cancel-during-retry outcome', outcome.stopReason === 'cancelled' && outcome.agentsStarted === 1, `outcome ${JSON.stringify(outcome)}`)
    check('cancel-during-retry events', engine.events[engine.events.length - 1] === 'workflow:end:cancelled', `events ${JSON.stringify(engine.events)}`)
  }

  return { scenarios: 6, failures }
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
    const ir = buildIR(checked.def)
    return compileScript(ir, cannedSkillBlocks(ir))
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
