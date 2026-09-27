import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIR, segmentTemplate, INPUT_VARIABLE, PREV_VARIABLE } from '../lib/ir.js'
import { compileScript } from '../lib/compiler.js'
import { fixture, invalidFixture } from './helpers.js'

function irOf(name) {
  return buildIR(fixture(name))
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
    ['m2-skip-policy.json', 'IR_UNSUPPORTED_FEATURE'],
    ['m2-retry.json', 'IR_UNSUPPORTED_FEATURE'],
    ['m2-skills.json', 'IR_UNSUPPORTED_FEATURE'],
    ['m2-tools.json', 'IR_UNSUPPORTED_FEATURE'],
    ['m2-reasoning-effort.json', 'IR_UNSUPPORTED_FEATURE'],
    ['m2-default-policy.json', 'IR_UNSUPPORTED_FEATURE'],
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

test('compileScript output is syntactically valid JS (compile-only check, no execution)', () => {
  for (const name of ['single-node.json', 'three-node-two-models.json', 'multi-prompt-node.json', 'depends-explicit.json', 'output-schema.json']) {
    const script = compileScript(irOf(name))
    new Function('agent', 'phase', 'log', 'args', '"use strict";\nreturn (async () => {\n' + script + '\n})()')
  }
})
