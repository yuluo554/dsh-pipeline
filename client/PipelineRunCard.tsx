/**
 * Run card renderer (M4, plan/05): the keyed `conversation.chat.node` panel
 * for kind 'pipeline-run'. Pure projection renderer — every fact comes from
 * node.data (folded durable events), so a reconnect replay rebuilds it
 * identically and nothing can go stale. Presentation follows the M3 seats'
 * inline-style convention; the status dot and per-model usage rows answer the
 * milestone demo (live node-chain status + dual-model cost comparison).
 */
import type { CSSProperties } from 'react'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { DshTranslate as Translate } from './ambient.js'
import type { PipelineRunStatus, PipelineRunUsageTotals } from '../src/run-events.js'

const root: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, padding: '6px 0' }
const runHeader: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 13, fontWeight: 600 }
const runName: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const runMeta: CSSProperties = { fontSize: 11, fontWeight: 400, opacity: 0.65, whiteSpace: 'nowrap' }
const nodeList: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 14 }
const nodeRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minHeight: 22, fontSize: 12, minWidth: 0 }
const nodeLabel: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const nodeMeta: CSSProperties = { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, opacity: 0.7, fontSize: 11, whiteSpace: 'nowrap' }
const modelBadge: CSSProperties = { padding: '1px 7px', borderRadius: 9, border: '1px solid rgba(127,127,127,0.35)', background: 'rgba(127,127,127,0.10)', fontSize: 10.5, whiteSpace: 'nowrap' }
const costBox: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4, padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.3)', background: 'rgba(127,127,127,0.06)' }
const costTitle: CSSProperties = { fontSize: 11, fontWeight: 600, opacity: 0.75 }
const costRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, minWidth: 0, flexWrap: 'wrap' }
const errorLine: CSSProperties = { fontSize: 11.5, color: '#e07a7a', overflowWrap: 'anywhere', marginTop: 2 }

const STATUS_COLOR: Record<PipelineRunStatus, string> = {
  pending: 'rgba(127,127,127,0.45)',
  running: '#5b8def',
  completed: '#4caf7d',
  failed: '#e06c6c',
  cancelled: '#e0a24c',
  interrupted: '#e0a24c',
}

function statusDot(status: PipelineRunStatus): CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flex: 'none',
    background: STATUS_COLOR[status],
    ...(status === 'pending' ? { border: '1px solid rgba(127,127,127,0.45)', background: 'transparent' } : {}),
  }
}

/** Compact wall clock: 830ms / 12.4s / 2m 05s. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(Math.round(seconds - minutes * 60)).padStart(2, '0')}s`
}

/** Compact token count: 840 / 12.4k / 3k. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 100000) return `${(count / 1000).toFixed(1)}k`
  return `${Math.round(count / 1000)}k`
}

function UsageSpan({ usage, t }: { usage: PipelineRunUsageTotals; t: Translate }) {
  return (
    <span>
      {t('card.tokensIn')} {formatTokens(usage.inputTokens)} · {t('card.tokensOut')} {formatTokens(usage.outputTokens)}
    </span>
  )
}

export function PipelineRunCard({ node, t }: { node: ChatNode<'pipeline-run'>; t: Translate }) {
  const data = node.data
  const statusText = t(`card.${data.status}`)
  return (
    <section style={root} data-pipeline-run data-run-status={data.status}>
      <div style={runHeader}>
        <span style={statusDot(data.status)} />
        <span style={runName}>{data.name}</span>
        <span style={runMeta} data-run-status-text>{statusText}</span>
        {data.durationMs !== undefined && <span style={runMeta}>{formatDuration(data.durationMs)}</span>}
      </div>
      <div style={nodeList}>
        {data.nodes.map((nodeView) => (
          <div key={nodeView.id} style={nodeRow} data-node-status={nodeView.status}>
            <span style={statusDot(nodeView.status)} />
            <span style={nodeLabel}>{nodeView.label}</span>
            <span style={nodeMeta}>
              <span style={modelBadge}>{nodeView.model ?? t('card.modelDefault')}</span>
              {nodeView.attempts > 1 && <span>{t('card.attempts', { count: nodeView.attempts })}</span>}
              {nodeView.durationMs > 0 && <span>{formatDuration(nodeView.durationMs)}</span>}
              {nodeView.usage !== undefined && <UsageSpan usage={nodeView.usage} t={t} />}
            </span>
          </div>
        ))}
      </div>
      {data.models.length > 1 && (
        <div style={costBox} data-cost-compare>
          <span style={costTitle}>{t('card.costTitle')}</span>
          {data.models.map((route) => (
            <div key={`${route.provider ?? ''}|${route.model ?? ''}`} style={costRow}>
              <span style={modelBadge}>{route.model ?? t('card.modelDefault')}</span>
              <span>{t('card.attempts', { count: route.calls })}</span>
              {route.durationMs > 0 && <span>{formatDuration(route.durationMs)}</span>}
              {route.usage !== undefined && <UsageSpan usage={route.usage} t={t} />}
            </div>
          ))}
        </div>
      )}
      {data.error !== undefined && <div style={errorLine}>{t('card.error')}: {data.error}</div>}
    </section>
  )
}
