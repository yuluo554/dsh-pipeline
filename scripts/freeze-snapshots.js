#!/usr/bin/env node
/**
 * One-shot snapshot generator for data/snapshots/ (plan/04 B1 truths).
 *
 * Usage: pnpm build && node scripts/freeze-snapshots.js
 *
 * This REGENERATES snapshots from the current compiler. Generation alone is
 * not freezing: each generated file must be human-reviewed against the
 * engine's agent() semantics (see data/README.md) before it counts as truth.
 * Regenerating without a口径变更 decision (plan/06) is a review failure.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = (name) => import(new URL(`../lib/${name}.js`, import.meta.url))

const { validateDef } = await lib('schema')
const { buildIR } = await lib('ir')
const { compileScript } = await lib('compiler')
const { cannedSkillBlocks } = await lib('bench')

const dir = join(root, 'data', 'pipelines')
const outDir = join(root, 'data', 'snapshots')
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const def = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  const checked = validateDef(def)
  if (!checked.ok) {
    console.error(`✗ ${file}: ${checked.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`)
    process.exitCode = 1
    continue
  }
  const ir = buildIR(checked.def)
  const script = compileScript(ir, cannedSkillBlocks(ir))
  const target = join(outDir, file.replace(/\.json$/, '.js'))
  writeFileSync(target, script, 'utf8')
  console.log(`✓ ${file} -> data/snapshots/${file.replace(/\.json$/, '.js')} (${script.length} bytes)`)
}
