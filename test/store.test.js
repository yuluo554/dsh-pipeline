import test from 'node:test'
import assert from 'node:assert/strict'
import { listDefs, loadDef, readRawDef, saveDef, PIPELINES_DIR } from '../lib/store.js'
import { fixture, makeStubFs } from './helpers.js'

function ctxWith(files) {
  return { fs: makeStubFs(files) }
}

test('listDefs returns sorted names and empty when nothing saved', async () => {
  const ctx = ctxWith(new Map())
  assert.deepEqual(await listDefs(ctx), [])
  const files = new Map([
    [`${PIPELINES_DIR}/zeta.json`, '{}'],
    [`${PIPELINES_DIR}/alpha.json`, '{}'],
    [`${PIPELINES_DIR}/notes.txt`, 'ignored'],
  ])
  assert.deepEqual(await listDefs(ctxWith(files)), ['alpha', 'zeta'])
})

test('saveDef persists pretty JSON and loadDef round-trips it', async () => {
  const ctx = ctxWith(new Map())
  await saveDef(ctx, fixture('single-node.json'))
  const saved = ctx.fs.files.get(`${PIPELINES_DIR}/single-node.json`)
  assert.match(saved, /\n  "name": "single-node"/)
  assert.match(saved, /\n$/)
  const loaded = await loadDef(ctx, 'single-node')
  assert.equal(loaded.name, 'single-node')
  assert.equal(loaded.nodes.length, 1)
})

test('saveDef refuses invalid definitions', async () => {
  const ctx = ctxWith(new Map())
  await assert.rejects(saveDef(ctx, { name: 'bad name!', description: 'x', nodes: [] }), (err) => {
    assert.equal(err.code, 'SCHEMA_INVALID')
    return true
  })
  assert.equal(ctx.fs.files.size, 0)
})

test('loadDef reports missing pipelines with a readable hint', async () => {
  await assert.rejects(loadDef(ctxWith(new Map()), 'ghost'), (err) => {
    assert.equal(err.code, 'STORE_ERROR')
    assert.match(err.message, /no pipeline named "ghost"/)
    return true
  })
})

test('loadDef surfaces JSON parse errors and validation problems', async () => {
  const broken = ctxWith(new Map([[`${PIPELINES_DIR}/broken.json`, '{ not json']]))
  await assert.rejects(loadDef(broken, 'broken'), (err) => {
    assert.equal(err.code, 'STORE_ERROR')
    assert.match(err.message, /not valid JSON/)
    return true
  })
  const invalid = ctxWith(new Map([[`${PIPELINES_DIR}/invalid.json`, JSON.stringify({ name: 'x' })]]))
  await assert.rejects(loadDef(invalid, 'invalid'), (err) => {
    assert.equal(err.code, 'SCHEMA_INVALID')
    assert.match(err.message, /definition problem/)
    return true
  })
})

test('names are validated before touching the filesystem (no traversal)', async () => {
  for (const bad of ['../escape', 'a/b', '.hidden', '']) {
    await assert.rejects(readRawDef(ctxWith(new Map()), bad), (err) => {
      assert.equal(err.code, 'STORE_ERROR')
      assert.match(err.message, /not a valid pipeline name/)
      return true
    })
  }
})
