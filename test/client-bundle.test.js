/**
 * Client bundle execution smoke (M3): the browser half runs in a real browser
 * only, but its lazy-CJS factory is plain JavaScript — execute the BUILT
 * lib/client.js under a `window.__ModuleLoader__` shim with a require map
 * over the frozen platform seed table, then drive `apply()` against stub
 * services and assert both seat registrations. This catches factory-time
 * crashes, wrong export shapes, and broken apply wiring without a browser.
 *
 * GUI-level verification (settings modal renders, popover layout) stays a
 * manual/online-smoke item — see HANDOFF-M4.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Load the built bundle and capture its ModuleLoader registration. */
function loadClientBundle() {
  const code = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  let registered
  globalThis.window = {
    __ModuleLoader__: {
      load(record) {
        registered = record
      },
    },
  }
  try {
    // The bundle is strict-mode-safe CJS-in-a-closure; run it as a script.
    new Function('window', code)(globalThis.window)
  } finally {
    delete globalThis.window
  }
  assert.ok(registered, 'bundle never called window.__ModuleLoader__.load')
  assert.equal(registered.id, 'dsh-pipeline')
  assert.equal(typeof registered.factory, 'function')
  return registered
}

/** Node-side require shim over the platform seed table (react only; every other import in the bundle is type-only and erased). */
function seedRequire() {
  const nodeRequire = createRequire(import.meta.url)
  const react = nodeRequire('react')
  return (spec) => {
    if (spec === 'react') return react
    if (spec === 'react/jsx-runtime') {
      return { jsx: react.jsx, jsxs: react.jsxs, Fragment: react.Fragment }
    }
    throw new Error(`client bundle required "${spec}" at execution time — this test's seed map only covers react`)
  }
}

test('built client bundle registers a factory whose apply wires all three seats', () => {
  const bundle = loadClientBundle()
  const exports = bundle.factory(seedRequire())
  assert.equal(exports.name, 'dsh-pipeline')
  assert.deepEqual(exports.inject, ['slots', 'locale', 'uiConversation'])
  assert.equal(typeof exports.apply, 'function')

  const dictionaries = []
  const slotsInjected = []
  const slotsRegistered = []
  const definitions = []
  const effects = []
  const ctx = {
    locale: {
      register(ns, locale, dict) {
        dictionaries.push({ ns, locale, keys: Object.keys(dict).length })
        return () => {}
      },
      bind(ns) {
        return (key) => `${ns}:${key}`
      },
    },
    slots: {
      inject(slot, factory) {
        slotsInjected.push(slot)
        factory()
      },
      register(options, component) {
        slotsRegistered.push({ options, component })
        return () => {}
      },
    },
    uiConversation: {
      events: {
        register(definition) {
          definitions.push(definition)
          return () => {}
        },
      },
    },
    effect(fn, label) {
      effects.push(label)
      fn()
    },
  }
  exports.apply(ctx)

  assert.deepEqual(slotsInjected, ['settings.section', 'conversation.session.header.actions', 'conversation.chat.node'])
  const editor = slotsRegistered.find((entry) => entry.options.id === 'pipeline')
  const runAction = slotsRegistered.find((entry) => entry.options.id === 'pipeline-run')
  const runCard = slotsRegistered.find((entry) => entry.options.key === 'pipeline-run')
  assert.ok(editor, 'editor seat not registered into settings.section')
  assert.ok(runAction, 'run seat not registered into conversation.session.header.actions')
  assert.ok(runCard, 'run card not registered into conversation.chat.node')
  assert.equal(editor.options.label(), 'dsh-pipeline:nav', 'editor label must resolve through the bound translate')
  assert.equal(typeof editor.component, 'function')
  assert.equal(typeof runAction.component, 'function')
  assert.equal(typeof runCard.component, 'function')

  // The run-card definition folds the four durable pipeline-run events into
  // one keyed chat node (mirrors the official workflow-run definition shape).
  assert.equal(definitions.length, 1, 'exactly one conversation definition must register')
  const definition = definitions[0]
  assert.equal(definition.kind, 'pipeline-run')
  assert.equal(definition.target, 'chat')
  assert.deepEqual(definition.match({ type: 'pipeline-run/run-start', data: { runId: 'r1' } }), { id: 'r1', role: 'start' })
  assert.deepEqual(definition.match({ type: 'pipeline-run/agent-end', data: { runId: 'r1' } }), { id: 'r1', role: 'update' })
  assert.equal(definition.match({ type: 'turn/start', data: {} }), null, 'unrelated events stay unmatched')
  const state = definition.start({}, { event: { type: 'pipeline-run/run-start', seq: 5, data: { runId: 'r1', name: 'demo', nodes: [{ id: 'a', label: 'A' }] } } })
  assert.deepEqual(state, { name: 'demo', nodes: [{ id: 'a', label: 'A' }], members: [] })
  const node = definition.buildViewNode({
    key: 'k1',
    id: 'r1',
    start: { event: { seq: 5 }, location: { kind: 'unresolved' } },
    state,
  })
  assert.equal(node.kind, 'pipeline-run')
  assert.equal(node.data.name, 'demo')
  assert.equal(node.data.status, 'running')
  assert.deepEqual(node.data.nodes.map((row) => row.status), ['pending'])

  assert.deepEqual(dictionaries.map((entry) => entry.locale).sort(), ['en', 'zh'])
  assert.ok(dictionaries[0].keys > 40, 'dictionaries must carry the full editor/run/card key set')
})
