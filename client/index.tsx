/**
 * Client half entry (M3/M4): the browser bundle lib/client.js. Registered by
 * the dsh client-modules system through the package.json `dsh.client`
 * declaration; `inject` names the browser services this plugin waits for
 * (the shell's slot registry, the shared locale service, and — since M4 —
 * the conversation event registry that folds session events into nodes).
 *
 * Three seats:
 * - `settings.section` "pipeline": the list/form editor (store RPC).
 * - `conversation.session.header.actions` "pipeline-run": the run entry,
 *   targeting the current session via the seat's `sessionId` prop.
 * - `conversation.chat.node` "pipeline-run" (M4): the keyed run card, fed by
 *   the pipeline-run Conversation Definition over the session event stream.
 */
import type { Context } from '@deepseek-ai/cordis'
import { PipelinesSection } from './PipelinesSection.js'
import { RunAction } from './RunAction.js'
import { PipelineRunCard } from './PipelineRunCard.js'
import { pipelineRunDefinition } from './run-card.js'
import { NS, en, zh } from './i18n.js'

export const name = 'dsh-pipeline'
/** Browser-side cordis services required before apply runs. */
export const inject = ['slots', 'locale', 'uiConversation']

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

  // M4 run card: the definition folds `pipeline-run/*` session events (the
  // same durable transport the official workflow-run card consumes) and the
  // keyed renderer renders the node chain + cost badges. Registration order
  // mirrors the official plugin: definition first, then the slot renderer.
  ctx.uiConversation.events.register(pipelineRunDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'pipeline-run',
    inject: () => ({ t }),
  }, PipelineRunCard))
}
