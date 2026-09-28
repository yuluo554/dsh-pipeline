/**
 * Centralized user-facing message catalog (M2: 先集中再翻译, plan/05).
 *
 * Every PipelineError / DefError text is built through `t()`; the templates
 * live in locale/en.json and locale/zh.json (shipped with the package under
 * the `errors` key, alongside dsh's `meta` display convention). The active
 * locale is a plugin config knob (entry `locale`, default 'en') — dsh's own
 * locale preference is a browser-side setting that is not readable host-side
 * (plan/06 decision).
 *
 * NOT localized: compiled-script diagnostics embedded at freeze time (they
 * are frozen snapshot data, not rendered text — determinism beats locale),
 * the /pipeline USAGE syntax reference, and model-facing tool descriptions.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Locale = 'en' | 'zh'

let current: Locale = 'en'
const cache = new Map<Locale, Record<string, string>>()

function catalog(locale: Locale): Record<string, string> {
  let table = cache.get(locale)
  if (table === undefined) {
    try {
      const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'locale', `${locale}.json`)
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      const errors = (parsed as { errors?: unknown } | null)?.errors
      table = errors !== null && typeof errors === 'object' && !Array.isArray(errors)
        ? (errors as Record<string, string>)
        : {}
    } catch {
      // A broken/missing locale file must never mask the error being reported.
      table = {}
    }
    cache.set(locale, table)
  }
  return table
}

/** Select the active locale; unknown ids keep the previous one. */
export function setLocale(locale: string): void {
  if (locale === 'zh' || locale === 'en') current = locale
}

export function getLocale(): Locale {
  return current
}

/**
 * Render the message `key` with `%param%` interpolation. Lookup order:
 * active locale -> en -> the raw key (visible, debuggable fallback).
 *
 * The placeholder syntax is deliberately `%name%`, not `{name}`: message
 * templates quote the pipeline's own `{{variable}}` template vocabulary
 * literally, and brace interpolation would collide with it.
 */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const template = catalog(current)[key] ?? catalog('en')[key] ?? key
  return template.replace(/%(\w+)%/g, (match, name: string) => (name in params ? String(params[name]) : match))
}
