import test from 'node:test'
import assert from 'node:assert/strict'
import { validateDef } from '../lib/schema.js'
import { fixture, invalidFixture } from './helpers.js'

test('every shipped valid fixture passes validateDef', () => {
  for (const name of ['single-node.json', 'three-node-two-models.json', 'multi-prompt-node.json', 'depends-explicit.json', 'output-schema.json']) {
    const result = validateDef(fixture(name))
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.ok ? [] : result.errors)}`)
  }
})

test('non-object input rejected with one clear error', () => {
  for (const raw of [null, 42, 'x', [], true]) {
    const result = validateDef(raw)
    assert.equal(result.ok, false)
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0].message, /must be a JSON object/)
  }
})

test('shape errors are collected, not fail-fast', () => {
  const result = validateDef({ name: 'bad name!', description: '', nodes: [] })
  assert.equal(result.ok, false)
  const paths = result.errors.map((e) => e.path)
  assert.ok(paths.includes('name'), `missing name error: ${paths}`)
  assert.ok(paths.includes('description'), `missing description error: ${paths}`)
  assert.ok(paths.includes('nodes'), `missing nodes error: ${paths}`)
})

test('unknown fields are rejected (vocabulary is closed)', () => {
  const def = fixture('single-node.json')
  def.unknownTopLevel = true
  def.nodes[0].unknownNodeField = true
  const result = validateDef(def)
  assert.equal(result.ok, false)
  const messages = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
  assert.match(messages, /unknownTopLevel/)
  assert.match(messages, /unknownNodeField/)
})

test('node id grammar is enforced and "input" is a legal shape (IR reserves it)', () => {
  const bad = fixture('single-node.json')
  bad.nodes[0].id = 'my node!'
  assert.equal(validateDef(bad).ok, false)

  const reserved = invalidFixture('ir-reserved-id.json')
  // Shape-legal: the reserved-word rejection is a semantic (IR) decision.
  assert.equal(validateDef(reserved).ok, true)
})

test('model fields: shape-legal with reasoningEffort; empty strings rejected', () => {
  const def = fixture('three-node-two-models.json')
  def.nodes[0].model.reasoningEffort = 'high'
  assert.equal(validateDef(def).ok, true, 'reasoningEffort is part of the def format (IR gates it)')

  const bad = fixture('three-node-two-models.json')
  bad.nodes[0].model.model = ''
  assert.equal(validateDef(bad).ok, false)
})

test('dependsOn rejects duplicates at shape level', () => {
  const def = fixture('depends-explicit.json')
  def.nodes[2].dependsOn = ['facts', 'facts']
  const result = validateDef(def)
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /duplicate dependency/)
})

test('tools must declare at least one of allow/deny', () => {
  const def = fixture('single-node.json')
  def.nodes[0].tools = {}
  const result = validateDef(def)
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /at least one of allow\/deny/)
})
