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
  }
}

test('plugin module satisfies the cordis plugin contract', () => {
  assert.equal(name, 'dsh-pipeline')
  assert.deepEqual(inject, ['tools'])
  assert.equal(typeof apply, 'function')
})

test('apply registers the pipeline_hello tool with a valid definition', async () => {
  const registered = []
  apply(makeStubCtx(registered))
  assert.equal(registered.length, 1)

  const def = registered[0]
  assert.equal(def.name, 'pipeline_hello')
  assert.equal(typeof def.execute, 'function')
  assert.equal(typeof def.description, 'string')
  assert.ok(def.description.length > 0)
})

test('pipeline_hello executes and greets', async () => {
  const registered = []
  apply(makeStubCtx(registered))
  const value = await registered[0].execute({ name: 'M0' }, {})
  assert.equal(value, 'Hello, M0! (dsh-pipeline M0)')
})
