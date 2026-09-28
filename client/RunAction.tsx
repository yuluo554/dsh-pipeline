/**
 * Run entry (M3, plan/05): a session-header action seat (`conversation.session
 * .header.actions`) that opens a centered dialog — pick a saved pipeline,
 * type the {{input}}, run. Target = the current session: the seat prop
 * `sessionId` rides to POST /run, where the host resolves the session's live
 * agent as the pipeline parent (same run path as /pipeline run).
 *
 * The run POST is aborted through the fetch signal when the user cancels; the
 * host's Connection bridge maps the aborted request onto the engine run's
 * AbortSignal (the M2 cancellation path).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { DshTranslate as Translate } from './ambient.js'
import { fetchInventory, runPipelineRemote } from './api.js'

const actionButton: CSSProperties = { padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.4)', background: 'rgba(127,127,127,0.12)', color: 'inherit', cursor: 'pointer', fontSize: 12 }
const backdrop: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
const dialog: CSSProperties = { width: 520, maxWidth: '92vw', maxHeight: '80vh', overflowY: 'auto', borderRadius: 14, border: '1px solid rgba(127,127,127,0.4)', background: 'var(--dsh-bg, #1c1c20)', color: 'var(--dsh-text, #ddd)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: 'inherit' }
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }
const label: CSSProperties = { fontWeight: 600, opacity: 0.85 }
const hint: CSSProperties = { opacity: 0.55, fontSize: 12 }
const inputStyle: CSSProperties = { padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.4)', background: 'rgba(127,127,127,0.08)', color: 'inherit', font: 'inherit' }
const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' }
const button: CSSProperties = { ...actionButton, fontSize: 13 }
const primaryButton: CSSProperties = { ...button, background: 'rgba(80,140,255,0.35)', borderColor: 'rgba(80,140,255,0.6)' }
const result: CSSProperties = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'ui-monospace, monospace', fontSize: 12, background: 'rgba(127,127,127,0.08)', border: '1px solid rgba(127,127,127,0.3)', borderRadius: 8, padding: 8, maxHeight: 260, overflowY: 'auto' }
const errorBox: CSSProperties = { ...result, background: 'rgba(200,60,60,0.15)', borderColor: 'rgba(200,60,60,0.5)' }

export function RunAction({ sessionId, t }: { sessionId: string; t: Translate }) {
  const [open, setOpen] = useState(false)
  const [pipelines, setPipelines] = useState<string[]>([])
  const [name, setName] = useState('')
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const rootRef = useRef<HTMLSpanElement | null>(null)

  // Fresh inventory every time the dialog opens; keep the last selection if
  // it still exists.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const inventory = await fetchInventory()
        if (cancelled) return
        setPipelines(inventory.pipelines)
        setName((current) => (inventory.pipelines.includes(current) ? current : inventory.pipelines[0] ?? ''))
      } catch (err) {
        if (!cancelled) setOutcome({ ok: false, text: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Abort an in-flight run when the dialog closes (dialog is also closed on
  // cancellation below, so this only fires for backdrop/Escape closes).
  useEffect(() => () => abortRef.current?.abort(), [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setRunning(false)
    setOutcome((current) => current ?? { ok: false, text: 'cancelled' })
  }, [])

  async function run() {
    if (running || name === '') return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setOutcome(null)
    try {
      const outcome = await runPipelineRemote({ name, input, sessionId }, controller.signal)
      setOutcome(outcome.ok ? { ok: true, text: outcome.text } : { ok: false, text: outcome.error })
    } catch (err) {
      if (!controller.signal.aborted) {
        setOutcome({ ok: false, text: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRunning(false)
    }
  }

  return (
    <span ref={rootRef}>
      <button style={actionButton} onClick={() => setOpen(true)}>{t('run.action')}</button>
      {open && (
        <div
          style={backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget && !running) setOpen(false)
          }}
        >
          <div style={dialog}>
            <div style={row}>
              <strong>{t('run.title')}</strong>
              <span style={{ flex: 1 }} />
              <button style={button} disabled={running} onClick={() => setOpen(false)}>{t('run.close')}</button>
            </div>

            {pipelines.length === 0 ? (
              <div style={hint}>{t('run.pipelineNone')}</div>
            ) : (
              <>
                <label style={field}>
                  <span style={label}>{t('run.pipeline')}</span>
                  <select style={inputStyle} value={name} onChange={(e) => setName(e.target.value)}>
                    {pipelines.map((pipeline) => <option key={pipeline} value={pipeline}>{pipeline}</option>)}
                  </select>
                </label>
                <label style={field}>
                  <span style={label}>{t('run.input')}</span>
                  <textarea
                    style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }}
                    value={input}
                    placeholder={t('run.inputPlaceholder')}
                    onChange={(e) => setInput(e.target.value)}
                  />
                </label>
                <div style={row}>
                  <button style={primaryButton} disabled={running || name === ''} onClick={() => { void run() }}>
                    {running ? t('run.running') : t('run.start')}
                  </button>
                  {running && <button style={button} onClick={cancel}>{t('run.cancel')}</button>}
                  <span style={{ flex: 1 }} />
                  <span style={hint}>{sessionId}</span>
                </div>
              </>
            )}

            {outcome !== null && (
              <div>
                <div style={{ ...label, marginBottom: 4 }}>{t('run.result')}</div>
                <pre style={outcome.ok ? result : errorBox}>{outcome.text}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  )
}
