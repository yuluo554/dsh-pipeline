/**
 * Client half entry (M3): the browser bundle lib/client.js. Registered by the
 * dsh client-modules system through the package.json `dsh.client`
 * declaration; `inject` names the browser services this plugin waits for
 * (the shell's slot registry and the shared locale service from
 * dsh-client-locale, declared in `dsh.client.external`).
 *
 * Two seats:
 * - `settings.section` "pipeline": the list/form editor (store RPC).
 * - `conversation.session.header.actions` "pipeline-run": the run entry,
 *   targeting the current session via the seat's `sessionId` prop.
 */
import type { Context } from '@deepseek-ai/cordis'
import { PipelinesSection } from './PipelinesSection.js'
import { RunAction } from './RunAction.js'
import { NS, en, zh } from './i18n.js'

export const name = 'dsh-pipeline'
/** Browser-side cordis services required before apply runs. */
export const inject = ['slots', 'locale']

export function apply(ctx: Context) {
  // Single-locale register form: the officially sanctioned path for
  // namespaces outside the shared LocaleNamespaceMap merge table.
  ctx.effect(() => {
    const disposeZh = ctx.locale.register(NS, 'zh', zh)
    const disposeEn = ctx.locale.register(NS, 'en', en)
    return () => {
      disposeZh()
      disposeEn()
    }
  }, 'dsh-pipeline: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'pipeline',
    order: 60,
    label: () => t('nav'),
    inject: () => ({ t }),
  }, PipelinesSection))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'pipeline-run',
    order: 30,
    inject: () => ({ t }),
  }, RunAction))
}
