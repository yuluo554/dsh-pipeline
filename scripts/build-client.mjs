/**
 * Client build preset (M3, plan/05): bundles `client/index.tsx` into the
 * `lib/client.js` browser bundle that dsh's client-modules system serves to
 * the Web GUI.
 *
 * Format contract (verified against official client bundles, e.g.
 * dsh-client-ui-deliverables): a lazy-CJS module registered via
 * `window.__ModuleLoader__.load({ id, factory })`; the factory receives a
 * synchronous `require` that resolves only against the frozen platform seed
 * table (react, react-dom, cordis, dsh-client-ui-primitives, ...) and boot
 * graph rows of packages we declare in `dsh.client.external` /
 * `dsh.client.inject` (here: the locale service). Anything else fails at
 * runtime with "require(...) missed the module table", so the post-build
 * scan below re-checks every emitted require against the allowlist — the
 * runtime mirror of the official build-time bundle purity gate.
 *
 * The host serves `./client` (exports map) as the package's client half; a
 * missing bundle makes web-profile activation fail loudly, hence this build
 * is chained into `pnpm build` right after tsc.
 */
import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'lib', 'client.js')
const PACKAGE_ID = 'dsh-pipeline'

/**
 * Module specifiers the bundle may `require` at runtime: exactly the frozen
 * platform seed table (extracted from the built web frontend's
 * `staticModules`) plus the packages listed in package.json
 * `dsh.client.external` (loaded before us via `dsh.client.inject`).
 */
const SEED_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
  // dsh.client.external: locale service package (boot graph row, not seed)
  '@deepseek-ai/dsh-client-locale',
]

await build({
  entryPoints: [join(ROOT, 'client', 'index.tsx')],
  outfile: OUT,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  external: SEED_MODULES,
  legalComments: 'none',
  banner: {
    js: [
      `window.__ModuleLoader__.load({`,
      `\tid: ${JSON.stringify(PACKAGE_ID)},`,
      `\tfactory: (require) => {`,
      `\t\tvar module = { exports: {} };`,
    ].join('\n'),
  },
  footer: {
    js: ['\t\treturn module.exports;', '\t}', '});'].join('\n'),
  },
})

// Bundle purity check: every require(...) emitted into the bundle must name
// an allowlisted specifier. esbuild keeps external requires verbatim; any
// accidental Node builtin or unlisted package would only explode in the
// browser, so fail the build here instead.
const js = await readFile(OUT, 'utf8')
const required = [...js.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])
const unknown = [...new Set(required)].filter((spec) => !SEED_MODULES.includes(spec))
if (unknown.length > 0) {
  await writeFile(OUT, js) // keep the artifact for inspection
  throw new Error(
    `build-client: bundle requires non-seed modules ${JSON.stringify(unknown)} — `
    + 'add them to package.json dsh.client.external (+ dsh.client.inject when a '
    + 'service must exist before apply) and to SEED_MODULES here, or remove the import.',
  )
}
console.log(`[dsh-pipeline] client bundle built: lib/client.js (${required.length} require sites, ${new Set(required).size} externals)`)
