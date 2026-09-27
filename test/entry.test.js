import test from 'node:test'
import assert from 'node:assert/strict'
import { registerPipeline } from '../lib/entry.js'
import { MockWorkflowEngine } from '../lib/mock-engine.js'
import { fixture, makeStubFs, FULL_CAPS, FAKE_AGENT } from './helpers.js'
import { PIPELINES_DIR } from '../lib/store.js'

function makeCtx({ files = [], engine } = {}) {
  const registered = { commands: [], tools: [] }
  const fs = makeStubFs(new Map(files))
  const ctx = {
    fs,
    workflowEngine: engine,
    subagents: {
      getProvider: (name) => (name === 'spawn' ? { capabilities: FULL_CAPS } : undefined),
      list: () => ['spawn', 'fork'],
    },
    commands: { register: (def) => registered.commands.push(def) },
    tools: { register: (def) => registered.tools.push(def) },
  }
  registerPipeline(ctx)
  return { ctx, ...registered }
}

function command(commandDefs, rawInput) {
  return commandDefs[0].handler({
    commandId: 'test-cmd',
    agent: FAKE_AGENT,
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  })
}

const DEMO = [`${PIPELINES_DIR}/three-node-two-models.json`, JSON.stringify(fixture('three-node-two-models.json'))]

test('/pipeline help and empty input return usage', async () => {
  const { commands } = makeCtx()
  for (const raw of ['', 'help']) {
    const result = await command(commands, raw)
    assert.equal(result.kind, 'success')
    assert.match(result.text, /\/pipeline run <name> \[input\]/)
  }
})

test('/pipeline list shows saved pipelines and the empty-state message', async () => {
  const empty = makeCtx()
  const none = await command(empty.commands, 'list')
  assert.match(none.text, /no pipelines saved/)

  const populated = makeCtx({ files: [DEMO] })
  const result = await command(populated.commands, 'list')
  assert.equal(result.text, '  three-node-two-models')
})

test('/pipeline show prints the raw definition plus validation status', async () => {
  const { commands } = makeCtx({ files: [DEMO] })
  const result = await command(commands, 'show three-node-two-models')
  assert.match(result.text, /"three-node-two-models"/)
  assert.match(result.text, /\/\/ valid - 3 node\(s\)/)

  const missing = await command(commands, 'show ghost')
  assert.equal(missing.kind, 'error')
  assert.match(missing.text, /no pipeline named "ghost"/)
})

test('/pipeline run executes the pipeline and formats per-node outputs', async () => {
  const engine = new MockWorkflowEngine({
    behavior: { responses: { Outline: 'OUT', Review: 'REV', Write: 'FINAL' } },
  })
  const { commands } = makeCtx({ files: [DEMO], engine })
  const result = await command(commands, 'run three-node-two-models coffee article')
  assert.equal(result.kind, 'success')
  assert.match(result.text, /pipeline "three-node-two-models" completed: 3 nodes, 3 agents\./)
  assert.match(result.text, /outline: OUT/)
  assert.match(result.text, /review: REV/)
  assert.match(result.text, /write: FINAL/)
  assert.equal(engine.lastRequest.args, 'coffee article')
})

test('/pipeline run reports engine-side failures as error results', async () => {
  const engine = new MockWorkflowEngine({ behavior: { failAtCalls: [1] } })
  const { commands } = makeCtx({ files: [DEMO], engine })
  const result = await command(commands, 'run three-node-two-models x')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /stopped \(error\): node "outline" failed at prompt 1/)
})

test('/pipeline run surfaces compile/caps problems without throwing', async () => {
  const bad = [`${PIPELINES_DIR}/bad.json`, JSON.stringify({ name: 'bad', description: 'x', nodes: [{ id: 'a', prompts: ['{{ghost}}'] }] })]
  const { commands } = makeCtx({ files: [bad] })
  const result = await command(commands, 'run bad x')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /IR_UNKNOWN_VARIABLE|does not match any node id/)
})

test('/pipeline unknown subcommand gets usage in the error', async () => {
  const { commands } = makeCtx()
  const result = await command(commands, 'frobnicate')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /unknown subcommand "frobnicate"/)
  assert.match(result.text, /Usage:/)
})

test('pipeline tool registers with routing-oriented description and required params', () => {
  const { tools } = makeCtx()
  const tool = tools.find((def) => def.name === 'pipeline')
  assert.ok(tool, 'pipeline tool not registered')
  assert.match(tool.description, /fixed, repeatable/)
  assert.match(tool.description, /\/pipeline list/)
  assert.deepEqual(Object.keys(tool.parameters.properties), ['name', 'input'])
  assert.deepEqual(tool.parameters.required, ['name', 'input'])
})

test('pipeline tool runs through the same path and returns formatted text', async () => {
  const engine = new MockWorkflowEngine({ behavior: { responses: { Echo: 'SUMMARY' } } })
  const { tools } = makeCtx({
    files: [[`${PIPELINES_DIR}/single-node.json`, JSON.stringify(fixture('single-node.json'))]],
    engine,
  })
  const tool = tools.find((def) => def.name === 'pipeline')
  const value = await tool.execute({ name: 'single-node', input: 'the input' }, { agent: FAKE_AGENT, signal: new AbortController().signal })
  assert.match(value, /pipeline "single-node" completed: 1 node, 1 agent\./)
  assert.match(value, /echo: SUMMARY/)
})

test('pipeline tool refuses to run without a calling agent', async () => {
  const { tools } = makeCtx()
  const tool = tools.find((def) => def.name === 'pipeline')
  await assert.rejects(
    tool.execute({ name: 'x', input: 'y' }, { signal: new AbortController().signal }),
    /requires a calling agent/,
  )
})

test('unknown provider name fails with the available list (readable, not silent)', async () => {
  const engine = new MockWorkflowEngine()
  const files = [[`${PIPELINES_DIR}/single-node.json`, JSON.stringify(fixture('single-node.json'))]]
  const registered = { commands: [], tools: [] }
  const ctx = {
    fs: makeStubFs(new Map(files)),
    workflowEngine: engine,
    subagents: {
      getProvider: (name) => (name === 'acp' ? { capabilities: FULL_CAPS } : undefined),
      list: () => ['spawn', 'fork'],
    },
    commands: { register: (def) => registered.commands.push(def) },
    tools: { register: (def) => registered.tools.push(def) },
  }
  registerPipeline(ctx, { provider: 'ghost-provider' })
  const tool = registered.tools.find((def) => def.name === 'pipeline')
  await assert.rejects(
    tool.execute({ name: 'single-node', input: 'x' }, { agent: FAKE_AGENT, signal: new AbortController().signal }),
    (err) => {
      assert.match(err.message, /no subagent provider registered as "ghost-provider"/)
      assert.match(err.message, /available: spawn, fork/)
      return true
    },
  )
})
