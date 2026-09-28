import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIR, segmentTemplate, INPUT_VARIABLE, PREV_VARIABLE } from '../lib/ir.js'
import { compileScript } from '../lib/compiler.js'
import { cannedSkillBlocks } from '../lib/bench.js'
import { fixture, invalidFixture, validateDef } from './helpers.js'

function irOf(name) {
  return buildIR(fixture(name))
}

/** Validate an inline test def, failing the test on shape errors. */
function validate(def) {
  const checked = validateDef(def)
  if (!checked.ok) throw new Error(`test def invalid: ${JSON.stringify(checked.errors)}`)
  return checked.def
}

test('topological order is deterministic (Kahn, definition-order tie-break)', () => {
  const first = irOf('depends-explicit.json')
  for (let i = 0; i < 5; i += 1) {
    const again = irOf('depends-explicit.json')
    assert.deepEqual(again, first)
  }
  assert.deepEqual(first.nodes.map((n) => n.id), ['facts', 'quotes', 'brief'])
})

test('explicit dependsOn overrides implicit chaining (口径 1)', () => {
  const ir = irOf('depends-explicit.json')
  // quotes has dependsOn: [] — it must NOT be chained onto facts; the join
  // node brief declares both. Topo order facts, quotes, brief proves facts
  // and quotes are parallel roots.
  assert.deepEqual(ir.nodes.map((n) => n.id), ['facts', 'quotes', 'brief'])
})

test('implicit chaining applies when dependsOn is absent', () => {
  const ir = irOf('three-node-two-models.json')
  assert.deepEqual(ir.nodes.map((n) => n.id), ['outline', 'review', 'write'])
})

test('error codes for the semantic matrix match the frozen manifest', () => {
  const cases = [
    ['ir-duplicate-id.json', 'IR_DUPLICATE_ID'],
    ['ir-reserved-id.json', 'IR_RESERVED_ID'],
    ['ir-unknown-dependency.json', 'IR_UNKNOWN_DEPENDENCY'],
    ['ir-self-dependency.json', 'IR_SELF_DEPENDENCY'],
    ['ir-dependency-cycle.json', 'IR_DEPENDENCY_CYCLE'],
    ['ir-unknown-variable.json', 'IR_UNKNOWN_VARIABLE'],
    ['ir-malformed-variable.json', 'IR_UNKNOWN_VARIABLE'],
    ['ir-prev-first-prompt.json', 'IR_UNKNOWN_VARIABLE'],
    ['ir-output-schema-subset.json', 'IR_OUTPUT_SCHEMA'],
    // M2: only the routings the 0.1.5-rc.1 engine cannot honor stay gated;
    // failure policies, retry, default policy and skills are unsealed.
    ['m2-tools.json', 'IR_UNSUPPORTED_FEATURE'],
    ['m2-reasoning-effort.json', 'IR_UNSUPPORTED_FEATURE'],
    ['ir-skip-reference.json', 'IR_SKIP_REFERENCE'],
  ]
  for (const [file, expected] of cases) {
    try {
      buildIR(invalidFixture(file))
      assert.fail(`${file} compiled but must reject`)
    } catch (err) {
      assert.equal(err.code, expected, `${file}: ${err.message}`)
    }
  }
})

test('error messages name the node and fix', () => {
  try {
    buildIR(invalidFixture('ir-unknown-variable.json'))
    assert.fail('must reject')
  } catch (err) {
    assert.match(err.message, /nodes\[0\]\.prompts\[0\] \(node "a"\)/)
    assert.match(err.message, /\{\{ghost\}\}/)
  }
})

test('template segmentation round-trips and errors on malformed expressions', () => {
  const segments = segmentTemplate('a {{input}} b {{outline}} c', 'loc')
  assert.deepEqual(
    segments.map((s) => (s.kind === 'static' ? s.text : `{{${s.ref.id ?? s.ref.kind}}}`)),
    ['a ', '{{input}}', ' b ', '{{outline}}', ' c'],
  )
  assert.throws(() => segmentTemplate('oops {{a b}}', 'loc'), /malformed template expression/)
  assert.throws(() => segmentTemplate('dangling {{', 'loc'), /malformed template expression/)
  assert.equal(INPUT_VARIABLE, 'input')
  assert.equal(PREV_VARIABLE, 'prev')
})

test('IR carries routing flags for the capability precheck', () => {
  const ir = irOf('three-node-two-models.json')
  assert.deepEqual(ir.nodes.map((n) => n.needsAgentOptions), [true, false, true])
  const structured = irOf('output-schema.json')
  assert.deepEqual(structured.nodes.map((n) => n.needsOutputSchema), [true, false])
  assert.equal(ir.totalAgentCalls, 3)
})

test('phaseTitle prefers the label and falls back to the id', () => {
  const ir = irOf('three-node-two-models.json')
  assert.deepEqual(ir.nodes.map((n) => n.phaseTitle), ['Outline', 'Review', 'Write'])
})

test('failure policies resolve per node and inherit options.defaultFailurePolicy', () => {
  const ir = irOf('retry-skip.json')
  assert.deepEqual(ir.nodes.map((n) => `${n.id}:${n.failurePolicy}:${n.retry}`), [
    'fetch:skip:2',
    'enrich:skip:0',
    'report:abort:0',
    'verify:abort:1',
  ])
  const raw = fixture('retry-skip.json')
  const inherited = buildIR(validate({ ...raw, options: { defaultFailurePolicy: 'skip' }, nodes: raw.nodes.map((n) => ({ ...n, failurePolicy: undefined, retry: undefined })) }))
  // explicit node policy still wins over the pipeline default
  assert.deepEqual(inherited.nodes.map((n) => `${n.id}:${n.failurePolicy}`), [
    'fetch:skip',
    'enrich:skip',
    'report:skip',
    'verify:skip',
  ])
})

test('skip-policy nodes carry skills routing in the IR (skills unsealed in M2)', () => {
  const ir = irOf('skills-and-tools.json')
  assert.deepEqual(ir.nodes.map((n) => n.needsSkills), [true, false])
  assert.deepEqual(ir.nodes[0].skills, ['office'])
})

test('totalAgentCalls is the retry-aware upper bound: sum(prompts x (1 + retry))', () => {
  // fetch 1x3 + enrich 1x1 + report 1x1 + verify 1x2 = 7
  assert.equal(irOf('retry-skip.json').totalAgentCalls, 7)
  assert.equal(irOf('three-node-two-models.json').totalAgentCalls, 3)
})

test('skip-reference rejection names the variable and the fix (口径: 引用 skip 输出 = 拒绝)', () => {
  try {
    buildIR(invalidFixture('ir-skip-reference.json'))
    assert.fail('must reject')
  } catch (err) {
    assert.equal(err.code, 'IR_SKIP_REFERENCE')
    assert.match(err.message, /\{\{a\}\}/)
    assert.match(err.message, /failure policy "skip"/)
    assert.match(err.message, /Use dependsOn for ordering only/)
  }
})

test('dependsOn onto a skip node stays legal (ordering without consuming the output)', () => {
  const def = validate({
    name: 'order-only',
    description: 'ordering on a skip node is legal',
    nodes: [
      { id: 'a', prompts: ['flaky'], failurePolicy: 'skip' },
      { id: 'b', prompts: ['standalone'], dependsOn: ['a'] },
    ],
  })
  const ir = buildIR(def)
  assert.deepEqual(ir.nodes.map((n) => n.id), ['a', 'b'])
})

test('compileScript output is syntactically valid JS (compile-only check, no execution)', () => {
  for (const name of ['single-node.json', 'three-node-two-models.json', 'multi-prompt-node.json', 'depends-explicit.json', 'output-schema.json', 'retry-skip.json']) {
    const script = compileScript(irOf(name))
    new Function('agent', 'phase', 'log', 'args', '"use strict";\nreturn (async () => {\n' + script + '\n})()')
  }
  // the skills fixture compiles only against resolved blocks (canned, same as the freeze path)
  const ir = irOf('skills-and-tools.json')
  const script = compileScript(ir, cannedSkillBlocks(ir))
  new Function('agent', 'phase', 'log', 'args', '"use strict";\nreturn (async () => {\n' + script + '\n})()')
})
