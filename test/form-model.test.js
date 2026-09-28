/**
 * M3 DoD tests: the editor form model must round-trip every shipped fixture
 * definition bidirectionally, and every form-assembled definition must pass
 * validateDef (the gate /pipeline run applies before compiling).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defToForm, formToDef, serializeDef } from '../lib/form-model.js'
import { validateDef } from '../lib/schema.js'
import { fixture } from './helpers.js'

const FIXTURE_DIR = join(import.meta.dirname, '..', 'data', 'pipelines')
const FIXTURES = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json'))

test('every shipped fixture survives def -> form -> def with deep equality', () => {
  assert.ok(FIXTURES.length >= 6, `expected the full fixture set, found ${FIXTURES.length}`)
  for (const file of FIXTURES) {
    const original = fixture(file)
    const roundTripped = formToDef(defToForm(original))
    assert.ok(roundTripped.ok, `${file}: formToDef rejected its own defToForm output: ${JSON.stringify(roundTripped.errors)}`)
    assert.deepEqual(roundTripped.def, original, `${file}: round-trip is not lossless`)
  }
})

test('every fixture re-serializes to the canonical bytes of its own file', () => {
  // The fixtures are already pretty-printed 2-space + trailing newline (the
  // saveDef shape), so canonical serialization must reproduce them verbatim.
  for (const file of FIXTURES) {
    const original = fixture(file)
    assert.equal(serializeDef(roundTrip(original)), serializeDef(original), `${file}: canonical bytes drifted`)
  }
})

function roundTrip(def) {
  const result = formToDef(defToForm(def))
  assert.ok(result.ok)
  return result.def
}

test('form-assembled definitions pass validateDef (DoD: 编辑产物 validateDef 全过)', () => {
  for (const file of FIXTURES) {
    const original = fixture(file)
    const result = formToDef(defToForm(original))
    assert.ok(result.ok)
    const checked = validateDef(result.def)
    assert.deepEqual(checked, { ok: true, def: result.def }, `${file}: validateDef rejected the assembled definition`)
  }
})

test('loading a handwritten JSON and saving it back keeps validateDef green and content identical', () => {
  // DoD: 与手写 JSON 双向一致 — parse -> edit nothing -> form -> def -> bytes.
  const handwritten = fixture('three-node-two-models.json')
  const form = defToForm(handwritten)
  const saved = formToDef(form)
  assert.ok(saved.ok)
  assert.deepEqual(JSON.parse(serializeDef(saved.def)), handwritten)
})

test('an edited form round-trips the edit and still validates', () => {
  const original = fixture('single-node.json')
  const form = defToForm(original)
  form.description = 'edited by the M3 test'
  form.nodes[0].label = 'Echo label'
  form.nodes[0].prompts.push('Second prompt: {{prev}}')
  form.nodes[0].skills = ['docx']
  form.nodes[0].failurePolicy = 'skip'
  form.nodes[0].retry = '2'
  const result = formToDef(form)
  assert.ok(result.ok)
  const checked = validateDef(result.def)
  assert.deepEqual(checked, { ok: true, def: result.def })
  assert.equal(result.def.description, 'edited by the M3 test')
  assert.equal(result.def.nodes[0].label, 'Echo label')
  assert.equal(result.def.nodes[0].prompts.length, 2)
  assert.deepEqual(result.def.nodes[0].skills, ['docx'])
  assert.equal(result.def.nodes[0].failurePolicy, 'skip')
  assert.equal(result.def.nodes[0].retry, 2)
})

test('formToDef preserves the absent/explicit dependsOn distinction (IR rule 1)', () => {
  const implicit = formToDef(defToForm(fixture('three-node-two-models.json')))
  assert.ok(implicit.ok)
  assert.ok(implicit.def.nodes.every((node) => node.dependsOn === undefined), 'implicit linear chaining must stay absent')

  const withExplicit = formToDef(defToForm(fixture('depends-explicit.json')))
  assert.ok(withExplicit.ok)
  assert.ok(withExplicit.def.nodes.some((node) => node.dependsOn !== undefined), 'explicit dependsOn must survive')

  // Explicit empty array = deliberate root-in-multi-root graph; must not
  // collapse to "absent".
  const form = defToForm({ name: 'x', description: 'x', nodes: [{ id: 'a', prompts: ['p'], dependsOn: [] }] })
  const result = formToDef(form)
  assert.ok(result.ok)
  assert.deepEqual(result.def.nodes[0].dependsOn, [])
})

test('formToDef reports structural problems instead of throwing', () => {
  const form = defToForm(fixture('single-node.json'))
  form.nodes[0].outputSchemaRaw = '{not json'
  const result = formToDef(form)
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /invalid JSON/)

  const badRetry = defToForm(fixture('single-node.json'))
  badRetry.nodes[0].retry = 'x'
  assert.equal(formToDef(badRetry).ok, false)
})

test('gated fields ride the form losslessly (tools / reasoningEffort / maxAgentsPerNode)', () => {
  const original = fixture('skills-and-tools.json')
  const result = formToDef(defToForm(original))
  assert.ok(result.ok)
  assert.deepEqual(result.def, original, 'gated fields must survive the round trip untouched')

  const effort = formToDef(defToForm({ name: 'x', description: 'x', nodes: [{ id: 'a', prompts: ['p'], model: { reasoningEffort: 'high' } }], options: { maxAgentsPerNode: 3 } }))
  assert.ok(effort.ok)
  assert.deepEqual(effort.def.nodes[0].model, { reasoningEffort: 'high' })
  assert.equal(effort.def.options.maxAgentsPerNode, 3)
})

test('degenerate empty model/options objects normalize to absent (documented decision)', () => {
  const result = formToDef(defToForm({ name: 'x', description: 'x', nodes: [{ id: 'a', prompts: ['p'], model: {} }], options: {} }))
  assert.ok(result.ok)
  assert.equal(result.def.nodes[0].model, undefined)
  assert.equal(result.def.options, undefined)
})
