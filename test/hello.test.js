import test from 'node:test'
import assert from 'node:assert/strict'
import { name, inject, apply } from '../lib/index.js'

function makeStubCtx(registered) {
  return {
    tools: {
      register: (def) => registered.push(def),
      // apply() 的自检会走 ctx.tools.execute；stub 返回规范结果保持日志干净
      execute: async () => ({ content: [{ type: 'text', text: 'stub' }] }),
    },
    commands: { register: () => {} },
    workflowEngine: {},
    subagents: { getProvider: () => undefined, list: () => [] },
    fs: {},
    // M3: mountWebHalf spawns the web sub-plugin; record its contract here.
    plugins: [],
    plugin(runtime, config) {
      this.plugins.push({ name: runtime.name, inject: runtime.inject, apply: runtime.apply, config })
    },
  }
}

test('plugin module satisfies the cordis plugin contract', () => {
  assert.equal(name, 'dsh-pipeline')
  assert.deepEqual(inject, ['tools', 'workflowEngine', 'subagents', 'commands', 'fs'])
  assert.equal(typeof apply, 'function')
})

test('apply registers the pipeline_hello tool with a valid definition', () => {
  const registered = []
  apply(makeStubCtx(registered))
  const hello = registered.find((def) => def.name === 'pipeline_hello')
  assert.ok(hello, 'pipeline_hello not registered')
  assert.equal(typeof hello.execute, 'function')
  assert.equal(typeof hello.description, 'string')
  assert.ok(hello.description.length > 0)
})

test('apply registers the pipeline tool and the /pipeline command', () => {
  const tools = []
  const commands = []
  const ctx = makeStubCtx(tools)
  ctx.commands = { register: (def) => commands.push(def) }
  apply(ctx)
  assert.ok(tools.some((def) => def.name === 'pipeline'), 'pipeline tool not registered')
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'pipeline')
  assert.equal(typeof commands[0].handler, 'function')
})

test('apply mounts the web half as a sub-plugin waiting on connection/sessionController', () => {
  const registered = []
  const ctx = makeStubCtx(registered)
  apply(ctx)
  const web = ctx.plugins.find((entry) => entry.name === 'dsh-pipeline-web')
  assert.ok(web, 'web half not mounted')
  assert.deepEqual(web.inject, ['connection', 'sessionController'])
  assert.equal(typeof web.apply, 'function')
})

test('pipeline_hello executes and greets', async () => {
  const registered = []
  apply(makeStubCtx(registered))
  const hello = registered.find((def) => def.name === 'pipeline_hello')
  const value = await hello.execute({ name: 'M0' }, {})
  assert.equal(value, 'Hello, M0! (dsh-pipeline)')
})
