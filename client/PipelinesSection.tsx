/**
 * Pipelines settings section (M3, plan/05): the zero-handwritten-JSON editor.
 * Left: saved pipeline list + create. Right: form editor whose model dropdown
 * reads the host catalog, skill multi-select reads ctx.skills (via inventory),
 * and tool filter / reasoningEffort / maxAgentsPerNode render read-only —
 * those routings are gated (口径 5/6) and the compiler rejects them, so the
 * editor never mints them.
 *
 * All writes go through formToDef (shared face) -> POST /save, which
 * re-validates host-side (validateDef + IR preflight) before touching disk.
 * The canonical on-disk JSON comes back for display, making the
 * bidirectional-consistency DoD visible in the UI itself.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { DshTranslate as Translate } from './ambient.js'
import { defToForm } from '../src/form-model.js'
import type { DefForm, NodeForm } from '../src/form-model.js'
import { fetchCatalog, fetchDefRaw, fetchInventory, saveForm, validateForm } from './api.js'
import type { Catalog, Inventory } from './api.js'

const section: CSSProperties = { display: 'flex', gap: 16, height: '100%', minHeight: 420, fontFamily: 'inherit', color: 'var(--dsh-text, #ddd)' }
const listPane: CSSProperties = { width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }
const listItem: CSSProperties = { textAlign: 'left', padding: '6px 10px', borderRadius: 8, border: '1px solid transparent', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, overflowWrap: 'anywhere' }
const listItemActive: CSSProperties = { ...listItem, background: 'rgba(127,127,127,0.18)', borderColor: 'rgba(127,127,127,0.35)' }
const editorPane: CSSProperties = { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingRight: 4 }
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }
const label: CSSProperties = { fontWeight: 600, opacity: 0.85 }
const hint: CSSProperties = { opacity: 0.55, fontSize: 12 }
const input: CSSProperties = { padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.4)', background: 'rgba(127,127,127,0.08)', color: 'inherit', font: 'inherit' }
const textarea: CSSProperties = { ...input, minHeight: 64, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12 }
const readOnly: CSSProperties = { ...input, opacity: 0.55 }
const nodeCard: CSSProperties = { border: '1px solid rgba(127,127,127,0.3)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }
const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }
const button: CSSProperties = { padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.4)', background: 'rgba(127,127,127,0.12)', color: 'inherit', cursor: 'pointer', fontSize: 13 }
const primaryButton: CSSProperties = { ...button, background: 'rgba(80,140,255,0.35)', borderColor: 'rgba(80,140,255,0.6)' }
const chip: CSSProperties = { display: 'inline-flex', gap: 4, alignItems: 'center', padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(127,127,127,0.4)', fontSize: 12, cursor: 'pointer' }
const chipOn: CSSProperties = { ...chip, background: 'rgba(80,140,255,0.3)', borderColor: 'rgba(80,140,255,0.6)' }
const noticeOk: CSSProperties = { padding: '6px 10px', borderRadius: 8, fontSize: 13, background: 'rgba(60,160,80,0.2)', border: '1px solid rgba(60,160,80,0.45)', overflowWrap: 'anywhere' }
const noticeError: CSSProperties = { padding: '6px 10px', borderRadius: 8, fontSize: 13, background: 'rgba(200,60,60,0.18)', border: '1px solid rgba(200,60,60,0.5)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
const checkbox: CSSProperties = { accentColor: '#5a8dff' }

export function PipelinesSection({ t, close }: { t: Translate; close?: () => void }) {
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [form, setForm] = useState<DefForm | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [canonical, setCanonical] = useState<string | null>(null)

  const refresh = useCallback(async (keepSelection: string | null) => {
    try {
      const [nextInventory, nextCatalog] = await Promise.all([fetchInventory(), fetchCatalog()])
      setInventory(nextInventory)
      setCatalog(nextCatalog)
      setSelected((current) => {
        const target = keepSelection ?? current
        if (target !== null && nextInventory.pipelines.includes(target)) return target
        return null
      })
    } catch (err) {
      setNotice({ kind: 'error', text: String(err instanceof Error ? err.message : err) })
    }
  }, [])

  useEffect(() => {
    void refresh(null)
  }, [refresh])

  // Load the definition whenever the selected name changes.
  useEffect(() => {
    setCanonical(null)
    setNotice(null)
    if (selected === null) {
      setForm(null)
      setDirty(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const { raw } = await fetchDefRaw(selected)
        if (cancelled) return
        const parsed: unknown = JSON.parse(raw)
        setForm(defToForm(parsed as never))
        setDirty(false)
      } catch (err) {
        if (cancelled) return
        setForm(null)
        setNotice({ kind: 'error', text: String(err instanceof Error ? err.message : err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selected])

  const patch = useCallback((mutate: (draft: DefForm) => void) => {
    setForm((current) => {
      if (current === null) return current
      const draft = structuredClone(current)
      mutate(draft)
      return draft
    })
    setDirty(true)
    setNotice(null)
    setCanonical(null)
  }, [])

  const patchNode = useCallback((index: number, mutate: (node: NodeForm) => void) => {
    patch((draft) => {
      const node = draft.nodes[index]
      if (node !== undefined) mutate(node)
    })
  }, [patch])

  async function onSave() {
    if (form === null || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const saved = await saveForm(form)
      setCanonical(saved.json)
      setNotice({ kind: 'ok', text: t('editor.saved') })
      setDirty(false)
      await refresh(form.name)
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  async function onValidate() {
    if (form === null || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await validateForm(form)
      if (result.ok) setNotice({ kind: 'ok', text: t('editor.validationOk') })
      else setNotice({ kind: 'error', text: result.errors.map((e) => `${e.path || '(root)'}: ${e.message}`).join('\n') })
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  function newPipeline() {
    setSelected(null)
    setCanonical(null)
    setNotice(null)
    setForm({
      name: '',
      description: '',
      nodes: [blankNode(0)],
      defaultFailurePolicy: '',
      maxAgentsPerNode: '',
    })
    setDirty(true)
  }

  const otherIds = useMemo(
    () => (form?.nodes ?? []).map((node) => node.id.trim()).filter((id) => id.length > 0),
    [form],
  )

  return (
    <div style={section}>
      <div style={listPane}>
        <div style={row}>
          <button style={button} onClick={newPipeline}>{t('editor.new')}</button>
          {dirty && <span style={hint}>{t('editor.dirty')}</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
          {(inventory?.pipelines ?? []).map((name) => (
            <button
              key={name}
              style={selected === name ? listItemActive : listItem}
              onClick={() => {
                if (dirty && !window.confirm(t('editor.reload'))) return
                setSelected(name)
              }}
            >
              {name}
            </button>
          ))}
          {inventory !== null && inventory.pipelines.length === 0 && (
            <div style={hint}>{t('run.pipelineNone')}</div>
          )}
        </div>
      </div>

      <div style={editorPane}>
        {form === null ? (
          <div style={hint}>{t('run.pipelineNone')}</div>
        ) : (
          <>
            <div style={row}>
              <strong>{t('nav')}</strong>
              <span style={{ flex: 1 }} />
              {busy && <span style={hint}>{t('editor.busy')}</span>}
              <button style={button} disabled={busy} onClick={onValidate}>{t('editor.validate')}</button>
              <button style={primaryButton} disabled={busy || form.name.trim() === ''} onClick={onSave}>{t('editor.save')}</button>
              {close !== undefined && <button style={button} onClick={close}>{t('run.close')}</button>}
            </div>

            <div style={row}>
              <label style={{ ...field, flex: 1, minWidth: 160 }}>
                <span style={label}>{t('editor.name')}</span>
                <input style={input} value={form.name} placeholder={t('editor.namePlaceholder')} onChange={(e) => patch((d) => { d.name = e.target.value.trim() })} />
              </label>
              <label style={{ ...field, flex: 2, minWidth: 240 }}>
                <span style={label}>{t('editor.description')}</span>
                <input style={input} value={form.description} placeholder={t('editor.descriptionPlaceholder')} onChange={(e) => patch((d) => { d.description = e.target.value })} />
              </label>
            </div>

            <div style={field}>
              <span style={label}>{t('editor.options')}</span>
              <div style={row}>
                <label style={row}>
                  <span style={hint}>{t('editor.defaultFailurePolicy')}</span>
                  <select style={input} value={form.defaultFailurePolicy} onChange={(e) => patch((d) => { d.defaultFailurePolicy = e.target.value })}>
                    <option value="">{t('editor.policyDefault')}</option>
                    <option value="abort">{t('editor.policyAbort')}</option>
                    <option value="skip">{t('editor.policySkip')}</option>
                  </select>
                </label>
                {form.maxAgentsPerNode !== '' && (
                  <label style={row}>
                    <span style={hint}>{t('editor.maxAgentsPerNode')}</span>
                    <input style={{ ...readOnly, width: 64 }} value={form.maxAgentsPerNode} readOnly />
                    <span style={hint}>{t('editor.maxAgentsPerNodeGated')}</span>
                  </label>
                )}
              </div>
            </div>

            <div style={field}>
              <span style={label}>{`${t('editor.nodes')} (${form.nodes.length})`}</span>
              <button style={{ ...button, alignSelf: 'flex-start' }} onClick={() => patch((d) => { d.nodes.push(blankNode(d.nodes.length)) })}>
                + {t('editor.addNode')}
              </button>
              {form.nodes.map((node, index) => (
                <NodeCard
                  key={index}
                  index={index}
                  count={form.nodes.length}
                  node={node}
                  otherIds={otherIds.filter((_id, i) => i !== index)}
                  uniqueIds={new Set(otherIds)}
                  catalog={catalog}
                  skills={inventory?.skills ?? []}
                  t={t}
                  onChange={(mutate) => patchNode(index, mutate)}
                  onRemove={() => patch((d) => { d.nodes.splice(index, 1) })}
                  onMove={(delta) => patch((d) => {
                    const target = index + delta
                    if (target < 0 || target >= d.nodes.length) return
                    const [moved] = d.nodes.splice(index, 1)
                    d.nodes.splice(target, 0, moved)
                  })}
                />
              ))}
            </div>

            {notice !== null && (
              <div style={notice.kind === 'ok' ? noticeOk : noticeError}>{notice.text}</div>
            )}
            {canonical !== null && (
              <details>
                <summary style={{ ...hint, cursor: 'pointer' }}>{t('editor.rawJson')}</summary>
                <pre style={{ ...textarea, minHeight: 0, maxHeight: 240, overflow: 'auto', margin: '4px 0 0' }}>{canonical}</pre>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function blankNode(index: number): NodeForm {
  return {
    id: `step-${index + 1}`,
    label: '',
    prompts: [''],
    provider: '',
    model: '',
    reasoningEffort: '',
    skills: [],
    toolsAllow: [],
    toolsDeny: [],
    hasExplicitDeps: false,
    dependsOn: [],
    outputSchemaRaw: '',
    failurePolicy: '',
    retry: '',
  }
}

interface NodeCardProps {
  index: number
  count: number
  node: NodeForm
  otherIds: string[]
  uniqueIds: Set<string>
  catalog: Catalog | null
  skills: Array<{ name: string; description: string }>
  t: Translate
  onChange: (mutate: (node: NodeForm) => void) => void
  onRemove: () => void
  onMove: (delta: number) => void
}

function NodeCard({ index, count, node, otherIds, uniqueIds, catalog, skills, t, onChange, onRemove, onMove }: NodeCardProps) {
  const groups = catalog?.groups ?? []
  const modelOptions = groups.find((group) => group.id === node.provider)?.models ?? []
  const id = node.id.trim()

  return (
    <div style={nodeCard}>
      <div style={row}>
        <strong>{`#${index + 1}`}</strong>
        <span style={{ flex: 1 }} />
        <button style={button} disabled={index === 0} onClick={() => onMove(-1)} title={t('editor.moveUp')}>↑</button>
        <button style={button} disabled={index === count - 1} onClick={() => onMove(1)} title={t('editor.moveDown')}>↓</button>
        <button style={button} onClick={onRemove} title={t('editor.deleteNode')}>✕</button>
      </div>

      <div style={row}>
        <label style={{ ...field, flex: 1, minWidth: 140 }}>
          <span style={label}>{t('editor.nodeId')}</span>
          <input style={input} value={node.id} onChange={(e) => onChange((n) => { n.id = e.target.value.trim() })} />
        </label>
        <label style={{ ...field, flex: 1, minWidth: 140 }}>
          <span style={label}>{t('editor.nodeLabel')}</span>
          <input style={input} value={node.label} onChange={(e) => onChange((n) => { n.label = e.target.value })} />
        </label>
      </div>

      <div style={field}>
        <span style={label}>{t('editor.prompts')}</span>
        {node.prompts.map((prompt, promptIndex) => (
          <div key={promptIndex} style={row}>
            <textarea
              style={{ ...textarea, flex: 1 }}
              value={prompt}
              placeholder={t('editor.promptPlaceholder')}
              onChange={(e) => onChange((n) => { n.prompts[promptIndex] = e.target.value })}
            />
            <button style={button} disabled={node.prompts.length === 1} onClick={() => onChange((n) => { n.prompts.splice(promptIndex, 1) })}>✕</button>
          </div>
        ))}
        <button style={{ ...button, alignSelf: 'flex-start' }} onClick={() => onChange((n) => { n.prompts.push('') })}>
          + {t('editor.addPrompt')}
        </button>
        {id.length > 0 && uniqueIds.has(id) && (
          <span style={hint}>{`${t('editor.templateVars')}: {{input}}, {{prev}}, ${otherIds.map((other) => `{{${other}}}`).join(', ')}`}</span>
        )}
      </div>

      <div style={field}>
        <span style={label}>{t('editor.modelRouting')}</span>
        <div style={row}>
          <label style={row}>
            <span style={hint}>{t('editor.provider')}</span>
            <input
              style={{ ...input, width: 140 }}
              list="dsh-pipeline-providers"
              value={node.provider}
              placeholder={t('editor.modelAny')}
              onChange={(e) => onChange((n) => { n.provider = e.target.value.trim(); n.model = '' })}
            />
          </label>
          <label style={row}>
            <span style={hint}>{t('editor.model')}</span>
            <input
              style={{ ...input, width: 220 }}
              list="dsh-pipeline-models"
              value={node.model}
              disabled={node.provider === ''}
              onChange={(e) => onChange((n) => { n.model = e.target.value.trim() })}
            />
          </label>
          {node.reasoningEffort !== '' && <span style={hint}>{`${node.reasoningEffort} — ${t('editor.reasoningEffortGated')}`}</span>}
        </div>
        <datalist id="dsh-pipeline-providers">
          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </datalist>
        <datalist id="dsh-pipeline-models">
          {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </datalist>
      </div>

      <div style={field}>
        <span style={label}>{t('editor.skills')}</span>
        {skills.length === 0 && <span style={hint}>{t('editor.skillsNone')}</span>}
        <div style={row}>
          {skills.map((skill) => {
            const on = node.skills.includes(skill.name)
            return (
              <span
                key={skill.name}
                style={on ? chipOn : chip}
                title={skill.description}
                onClick={() => onChange((n) => {
                  const at = n.skills.indexOf(skill.name)
                  if (at >= 0) n.skills.splice(at, 1)
                  else n.skills.push(skill.name)
                })}
              >
                <span>{on ? '☑' : '☐'}</span>
                <span>{skill.name}</span>
              </span>
            )
          })}
          {node.skills.filter((name) => !skills.some((skill) => skill.name === name)).map((name) => (
            <span key={name} style={chipOn} onClick={() => onChange((n) => { n.skills = n.skills.filter((s) => s !== name) })}>
              <span>☑</span>
              <span>{name}</span>
            </span>
          ))}
        </div>
      </div>

      {(node.toolsAllow.length > 0 || node.toolsDeny.length > 0) && (
        <div style={field}>
          <span style={label}>{t('editor.tools')}</span>
          <span style={hint}>
            {node.toolsAllow.length > 0 ? `allow: ${node.toolsAllow.join(', ')}; ` : ''}
            {node.toolsDeny.length > 0 ? `deny: ${node.toolsDeny.join(', ')}` : ''}
          </span>
          <span style={hint}>{t('editor.toolsGated')}</span>
        </div>
      )}

      <div style={row}>
        <label style={row}>
          <input
            type="checkbox"
            style={checkbox}
            checked={node.hasExplicitDeps}
            onChange={(e) => onChange((n) => { n.hasExplicitDeps = e.target.checked })}
          />
          <span style={label}>{t('editor.dependsOn')}</span>
        </label>
        {node.hasExplicitDeps && (
          <span style={row}>
            {otherIds.length === 0 && <span style={hint}>{t('editor.noOtherNodes')}</span>}
            {otherIds.map((other) => {
              const on = node.dependsOn.includes(other)
              return (
                <span
                  key={other}
                  style={on ? chipOn : chip}
                  onClick={() => onChange((n) => {
                    const at = n.dependsOn.indexOf(other)
                    if (at >= 0) n.dependsOn.splice(at, 1)
                    else n.dependsOn.push(other)
                  })}
                >
                  <span>{on ? '☑' : '☐'}</span>
                  <span>{other}</span>
                </span>
              )
            })}
          </span>
        )}
      </div>
      <span style={hint}>{t('editor.dependsOnHint')}</span>

      <div style={row}>
        <label style={row}>
          <span style={hint}>{t('editor.failurePolicy')}</span>
          <select style={input} value={node.failurePolicy} onChange={(e) => onChange((n) => { n.failurePolicy = e.target.value })}>
            <option value="">{t('editor.policyDefault')}</option>
            <option value="abort">{t('editor.policyAbort')}</option>
            <option value="skip">{t('editor.policySkip')}</option>
          </select>
        </label>
        <label style={row}>
          <span style={hint}>{t('editor.retry')}</span>
          <input style={{ ...input, width: 56 }} value={node.retry} onChange={(e) => onChange((n) => { n.retry = e.target.value.replace(/[^\d]/g, '') })} />
        </label>
      </div>

      <label style={field}>
        <span style={label}>{t('editor.outputSchema')}</span>
        <textarea
          style={{ ...textarea, minHeight: 48 }}
          value={node.outputSchemaRaw}
          onChange={(e) => onChange((n) => { n.outputSchemaRaw = e.target.value })}
        />
      </label>
    </div>
  )
}
