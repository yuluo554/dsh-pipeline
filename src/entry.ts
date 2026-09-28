/**
 * Entry points (FR-4/5, plan/03): the `/pipeline` user command (no model
 * turn) and the model-facing `pipeline` tool. Both share the load -> run ->
 * format path; every registration is a Cordis effect so plugin uninstall
 * revokes them. Result formatting caps each node output so a pipeline's
 * transcript cannot flood the conversation (token-amplification guard,
 * plan/02 #4).
 *
 * The skills registry (`ctx.skills`) is read lazily per run: accessing it
 * eagerly would make the plugin's activation wait on the skills service
 * (the M1 workflowEngine-pending lesson), and pipelines without skills must
 * run on profiles that never register one.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentCapabilities } from '@deepseek-ai/dsh-subagent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { runPipeline } from './runner.js'
import type { SkillResolver } from './runner.js'
import { listDefs, loadDef, readRawDef } from './store.js'
import { PipelineError } from './errors.js'
import { setLocale, t } from './messages.js'
import { formatSuccess, formatFailure } from './format.js'
import type { PipelineDef } from './schema.js'

export const COMMAND_NAME = 'pipeline'
export const TOOL_NAME = 'pipeline'

export { NODE_OUTPUT_LIMIT } from './format.js'

export interface PipelineEntryConfig {
  /**
   * Subagent provider children are pinned to (and whose capabilities the
   * runner prechecks). Defaults to the engine default "spawn".
   */
  provider?: string
  /**
   * Locale for user-facing error/diagnostic messages ('en' | 'zh', default
   * 'en'). dsh's own locale preference is browser-side and not readable
   * host-side (plan/06), so it is an explicit plugin knob.
   */
  locale?: 'en' | 'zh'
}

const USAGE = [
  'Usage:',
  '  /pipeline list                - list saved pipelines (.dsh/pipelines/*.json)',
  '  /pipeline show <name>         - print a definition and its validation status',
  '  /pipeline run <name> [input]  - run a pipeline in this session',
  '  /pipeline help                - this text',
].join('\n')

export function registerPipeline(ctx: Context, config: PipelineEntryConfig = {}): void {
  const providerName = config.provider ?? 'spawn'
  if (config.locale !== undefined) setLocale(config.locale)

  const runForCaller = async (
    parent: Agent,
    signal: AbortSignal | undefined,
    name: string,
    input: string,
  ): Promise<string> => {
    const def = await loadDef(ctx, name)
    const outcome = await runPipeline(
      {
        engine: ctx.workflowEngine,
        caps: capsOf(ctx, providerName),
        parent,
        providerName,
        ...(signal !== undefined ? { signal } : {}),
        ...(skillsOf(ctx) !== undefined ? { skills: skillsOf(ctx) } : {}),
      },
      def,
      input,
    )
    if (outcome.stopReason !== 'completed') throw formatFailure(def, outcome)
    return formatSuccess(def, outcome)
  }

  ctx.commands.register({
    name: COMMAND_NAME,
    description: 'Run saved multi-node agent pipelines (dsh-pipeline plugin)',
    input: { hint: 'list | show <name> | run <name> [input...]' },
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      const raw = invocation.rawInput.trim()
      if (raw === '' || raw === 'help') return { kind: 'success', text: USAGE }
      const spaceAt = raw.indexOf(' ')
      const sub = spaceAt === -1 ? raw : raw.slice(0, spaceAt)
      const rest = spaceAt === -1 ? '' : raw.slice(spaceAt + 1).trim()
      try {
        switch (sub) {
          case 'list': {
            const names = await listDefs(ctx)
            if (names.length === 0) return { kind: 'success', text: t('entry.noPipelines') }
            return { kind: 'success', text: names.map((name) => `  ${name}`).join('\n') }
          }
          case 'show': {
            if (rest === '') return { kind: 'error', text: t('entry.usageShow') }
            const rawDef = await readRawDef(ctx, rest)
            let status: string
            try {
              const def = await loadDef(ctx, rest)
              status = t('entry.validStatus', { count: def.nodes.length })
            } catch (err) {
              status = t('entry.invalidStatus', { detail: render(err) })
            }
            return { kind: 'success', text: `${rawDef.trimEnd()}\n\n// ${status}` }
          }
          case 'run': {
            const nameSpaceAt = rest.indexOf(' ')
            const name = nameSpaceAt === -1 ? rest : rest.slice(0, nameSpaceAt)
            const input = nameSpaceAt === -1 ? '' : rest.slice(nameSpaceAt + 1).trim()
            if (name === '') return { kind: 'error', text: t('entry.usageRun') }
            const text = await runForCaller(invocation.agent, invocation.signal, name, input)
            return { kind: 'success', text }
          }
          default:
            return { kind: 'error', text: t('entry.unknownSubcommand', { sub, usage: USAGE }) }
        }
      } catch (err) {
        return { kind: 'error', text: render(err) }
      }
    },
  })

  ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description:
      'Run a saved multi-node agent pipeline (dsh-pipeline plugin). Pipelines are fixed, repeatable '
      + 'workflows defined as JSON in the workspace (.dsh/pipelines/*.json) - outline/review/write chains, '
      + 'multi-step document drafting, any task the user repeats with the same node sequence. Each node can '
      + 'route its own provider/model. Use /pipeline list to see available names; do not use this tool for '
      + 'one-off ad-hoc delegations.',
    parameters: {
      name: { type: 'string', required: true, description: 'pipeline name from /pipeline list' },
      input: { type: 'string', required: true, description: 'initial input handed to the first node (referenced as {{input}})' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (exec?.agent === undefined) {
        throw new Error(t('entry.toolRequiresAgent'))
      }
      return runForCaller(exec.agent, exec.signal, args.name, args.input)
    },
  }))
}

function capsOf(ctx: Context, providerName: string): SubagentCapabilities {
  const provider = ctx.subagents.getProvider(providerName)
  if (provider === undefined) {
    const available = ctx.subagents.list().join(', ')
    throw new PipelineError(
      'CAPABILITY_MISSING',
      t('entry.noProvider', { provider: providerName, available: available.length > 0 ? ` (available: ${available})` : '' }),
    )
  }
  return provider.capabilities
}

/** Lazy `ctx.skills` read: undefined when no skills service is registered. */
function skillsOf(ctx: Context): SkillResolver | undefined {
  try {
    return (ctx as { skills?: SkillResolver }).skills
  } catch {
    return undefined
  }
}

function render(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
