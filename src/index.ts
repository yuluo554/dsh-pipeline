import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { registerPipeline } from './entry.js'
import { mountWebHalf } from './web.js'
import { PIPELINE_VERSION } from './version.js'

export const name = 'dsh-pipeline'
export const inject = ['tools', 'workflowEngine', 'subagents', 'commands', 'fs']

export function apply(ctx: Context) {
  // M0 smoke tool (HANDOFF 口径 7): kept so the install self-check keeps
  // proving the bundle loads and its tools register.
  ctx.tools.register(defineTool({
    name: 'pipeline_hello',
    description:
      'M0 smoke tool of the dsh-pipeline plugin. Greets the named person; '
      + 'proves the bundle loads and its tools register.',
    parameters: {
      name: { type: 'string', required: true, description: 'Who to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}! (dsh-pipeline)`
    },
  }))
  console.log(`[dsh-pipeline] tool registered: pipeline_hello`)

  registerPipeline(ctx)
  console.log(`[dsh-pipeline] ${PIPELINE_VERSION} entry registered: /pipeline command + pipeline tool`)

  // M3 web half: /api/dsh-pipeline/* routes + the browser editor/run UI
  // (lib/client.js via the package.json dsh.client declaration). Mounted as
  // a sub-plugin that waits for connection/sessionController, so profiles
  // without the web stack keep the core entry active.
  mountWebHalf(ctx, {})

  // M0 self-check (official tutorial ch.07 pattern): drive one call through
  // the real tool pipeline in place of the model — no API key involved.
  void (async () => {
    try {
      const result = await ctx.tools.execute({
        callId: brandString<ToolCallId>('dsh-pipeline-selftest-1'),
        name: 'pipeline_hello',
        arguments: { name: 'dsh-pipeline' },
        signal: new AbortController().signal,
      })
      console.log('[dsh-pipeline] self-test replied:', JSON.stringify(result.content))
    } catch (err) {
      console.error('[dsh-pipeline] self-test failed:', err)
    }
  })()
}
