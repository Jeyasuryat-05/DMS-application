import { useState, useEffect, useRef } from 'react'
import WorkflowInitModal from '../components/WorkflowInitModal'
import FileViewer from '../components/FileViewer'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { documentsAPI, workflowAPI, adminAPI } from '../api'
import { useAuth } from '../hooks/useAuth'
import { fmtDate, fmtDateTime } from '../utils/dates'
import {
  Badge, Btn, Card, Spinner, Tabs, WorkflowBar,
  SectionHead, Empty, Input, Textarea, Select, Modal
} from '../components/ui'

function MetaField({ field, val, setVal, locked }) {
  const baseInp = {
    width: '100%', boxSizing: 'border-box', fontSize: 13,
    padding: '6px 10px', borderRadius: 6,
    border: '1px solid #d1d5db',
    background: locked ? '#f3f4f6' : '#fff',
    color: locked ? '#9ca3af' : '#111',
  }
  if (locked) return (
    <div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3, display: 'flex', justifyContent: 'space-between' }}>
        <span>{field.label}</span>
        <span style={{ fontSize: 10, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 4, padding: '1px 6px', color: '#9ca3af' }}>Restricted</span>
      </div>
      <input value={val} disabled style={baseInp} />
    </div>
  )
  if (field.type === 'dropdown') {
    const opts = field.options || []
    return (
      <div>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>{field.label}{field.required && <span style={{ color: '#A32D2D' }}> *</span>}</div>
        <select value={val} onChange={e => setVal(e.target.value)} style={{ ...baseInp, cursor: 'pointer' }}>
          <option value="">— Select —</option>
          {opts.map(o => {
            const v = typeof o === 'object' ? o.value : o
            const l = typeof o === 'object' ? o.label : o
            return <option key={v} value={v}>{l}</option>
          })}
        </select>
      </div>
    )
  }
  if (field.type === 'date') return (
    <div>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>{field.label}{field.required && <span style={{ color: '#A32D2D' }}> *</span>}</div>
      <input type="date" value={val} onChange={e => setVal(e.target.value)} style={baseInp} />
    </div>
  )
  if (field.type === 'textarea') return (
    <div>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>{field.label}{field.required && <span style={{ color: '#A32D2D' }}> *</span>}</div>
      <textarea value={val} onChange={e => setVal(e.target.value)} rows={3}
        style={{ ...baseInp, resize: 'vertical', fontFamily: 'inherit' }} />
    </div>
  )
  // Char / Numeric — length-constrained input.
  if (field.type === 'char' || field.type === 'numeric') {
    const isNumeric = field.type === 'numeric'
    const fixed = field.length || null
    const maxL  = fixed || field.max_length || null
    const handleChange = (raw) => {
      let v = String(raw)
      if (isNumeric) v = v.replace(/\D/g, '')
      if (maxL) v = v.slice(0, maxL)
      setVal(v)
    }
    let invalid = false
    if (val) {
      if (fixed && val.length !== fixed) invalid = true
      else if (!fixed && field.min_length && val.length < field.min_length) invalid = true
    }
    const hint = fixed ? `Exactly ${fixed} ${isNumeric ? 'digits' : 'chars'}` :
                 (field.min_length || field.max_length) ?
                   `Length ${field.min_length || 0}–${field.max_length || '∞'}` :
                 (isNumeric ? 'Digits only' : 'Letters / digits')
    return (
      <div>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>
          {field.label}{field.required && <span style={{ color: '#A32D2D' }}> *</span>}
          <span style={{ marginLeft: 8, fontSize: 10, color: '#9ca3af' }}>{hint}</span>
        </div>
        <input
          value={val}
          onChange={e => handleChange(e.target.value)}
          inputMode={isNumeric ? 'numeric' : undefined}
          maxLength={maxL || undefined}
          placeholder={fixed ? (isNumeric ? '1'.repeat(fixed) : 'X'.repeat(fixed)) : undefined}
          style={{ ...baseInp, borderColor: invalid ? '#A32D2D' : undefined }}
        />
        {invalid && (
          <div style={{ fontSize: 10, color: '#A32D2D', marginTop: 2 }}>
            {fixed ? `Must be exactly ${fixed} ${isNumeric ? 'digits' : 'characters'}.` :
              `Must be at least ${field.min_length} characters.`}
          </div>
        )}
      </div>
    )
  }
  // Legacy USI fallback when the schema still has type='text' and key='usi'.
  const isUsi = (field.key || '').toLowerCase() === 'usi' ||
                (field.key || '').toLowerCase() === 'usi_kks_code'
  const usiInvalid = isUsi && val && !/^\d{5}$/.test(String(val))
  return (
    <div>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>
        {field.label}{field.required && <span style={{ color: '#A32D2D' }}> *</span>}
        {isUsi && <span style={{ marginLeft: 8, fontSize: 10, color: '#9ca3af' }}>5 digits, numeric only</span>}
      </div>
      <input
        value={val}
        onChange={e => setVal(isUsi ? e.target.value.replace(/\D/g, '').slice(0, 5) : e.target.value)}
        inputMode={isUsi ? 'numeric' : undefined}
        pattern={isUsi ? '\\d{5}' : undefined}
        maxLength={isUsi ? 5 : undefined}
        placeholder={isUsi ? '12345' : undefined}
        style={{ ...baseInp, borderColor: usiInvalid ? '#A32D2D' : undefined }}
      />
      {usiInvalid && (
        <div style={{ fontSize: 10, color: '#A32D2D', marginTop: 2 }}>USI must be exactly 5 digits.</div>
      )}
    </div>
  )
}

/* ─── Admin Workflow Recovery Panel ──────────────────────────────────────── */
function AdminWorkflowRecovery({ docId, wf, users, onDone }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [resetNote, setResetNote] = useState('')
  const [reassignUid, setReassignUid] = useState('')

  async function doReset() {
    if (!window.confirm('Force-reset this workflow? The document will go back to Draft status and the workflow must be re-initiated.')) return
    setBusy(true); setMsg('')
    try {
      const r = await workflowAPI.adminForceReset(docId, resetNote || 'Admin force-reset')
      setMsg('✅ ' + r.data.message)
      setTimeout(() => { setMsg(''); onDone() }, 1500)
    } catch (e) { setMsg('❌ ' + (e.response?.data?.error || 'Failed')) }
    finally { setBusy(false) }
  }

  async function doReassign() {
    if (!reassignUid) { setMsg('❌ Select a user first'); return }
    setBusy(true); setMsg('')
    try {
      const r = await workflowAPI.adminReassign(docId, parseInt(reassignUid))
      setMsg('✅ ' + r.data.message)
      setTimeout(() => { setMsg(''); onDone() }, 1500)
    } catch (e) { setMsg('❌ ' + (e.response?.data?.error || 'Failed')) }
    finally { setBusy(false) }
  }

  async function doFixStatus() {
    setBusy(true); setMsg('')
    try {
      const r = await workflowAPI.adminFixStatus(docId)
      setMsg('✅ ' + r.data.message)
      setTimeout(() => { setMsg(''); onDone() }, 1500)
    } catch (e) { setMsg('❌ ' + (e.response?.data?.error || 'Failed')) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 24, border: '1.5px dashed #fbbf24', borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', padding: '10px 16px', background: '#fffbeb', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}
      >
        <span style={{ fontSize: 15 }}>🔧</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#92400e' }}>Admin: Workflow Recovery Tools</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#b45309' }}>{open ? '▲ Hide' : '▼ Show'}</span>
      </button>

      {open && (
        <div style={{ padding: '16px 20px', background: '#fffbeb', borderTop: '1px solid #fde68a', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {msg && (
            <div style={{ padding: '8px 14px', borderRadius: 7, background: msg.startsWith('✅') ? '#f0fdf4' : '#fef2f2', fontSize: 13, fontWeight: 600, color: msg.startsWith('✅') ? '#166534' : '#991b1b' }}>
              {msg}
            </div>
          )}

          {/* Reassign current step */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#78350f', marginBottom: 6 }}>
              Re-assign Step {wf.current_step}
            </div>
            <div style={{ fontSize: 12, color: '#92400e', marginBottom: 10 }}>
              Replace all pending tasks at the current step with a new assignee. Use when the original assignee is unavailable.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={reassignUid}
                onChange={e => setReassignUid(e.target.value)}
                style={{ flex: 1, padding: '7px 10px', border: '1px solid #fde68a', borderRadius: 7, fontSize: 13, background: '#fff' }}
              >
                <option value="">— Select new assignee —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role || u.email})</option>)}
              </select>
              <button onClick={doReassign} disabled={busy}
                style={{ padding: '7px 18px', background: '#d97706', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}>
                Re-assign
              </button>
            </div>
          </div>

          {/* Fix status */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#78350f', marginBottom: 6 }}>Fix Document Status</div>
            <div style={{ fontSize: 12, color: '#92400e', marginBottom: 10 }}>
              Re-syncs the document status with the current workflow stage. Use when the status label is wrong but the workflow data is intact.
            </div>
            <button onClick={doFixStatus} disabled={busy}
              style={{ padding: '7px 18px', background: '#0c447c', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}>
              Sync Status
            </button>
          </div>

          {/* Force reset */}
          <div style={{ borderTop: '1px solid #fde68a', paddingTop: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#991b1b', marginBottom: 6 }}>⚠ Force Reset Workflow</div>
            <div style={{ fontSize: 12, color: '#7c2d12', marginBottom: 10 }}>
              Nuclear option — deletes the entire workflow and returns the document to Draft status. Use only when nothing else works. A snapshot is saved for audit history.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={resetNote}
                onChange={e => setResetNote(e.target.value)}
                placeholder="Reason for reset (required for audit)"
                style={{ flex: 1, padding: '7px 10px', border: '1px solid #fca5a5', borderRadius: 7, fontSize: 13 }}
              />
              <button onClick={doReset} disabled={busy}
                style={{ padding: '7px 18px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1, whiteSpace: 'nowrap' }}>
                Force Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Admin Reassign Doc Number ──────────────────────────────────────────── */
function AdminReassignDocNumber({ doc, onDone }) {
  const [open, setOpen]       = useState(false)
  const [project, setProject] = useState(doc.project || '')
  const [usi, setUsi]         = useState(doc.usi_kks_code || '')
  const [busy, setBusy]       = useState(false)
  const [msg, setMsg]         = useState('')

  useEffect(() => {
    setProject(doc.project || '')
    setUsi(doc.usi_kks_code || '')
  }, [doc.id])

  async function doReassign() {
    if (!project.trim() || !usi.trim()) { setMsg('❌ Project and USI are required'); return }
    if (!window.confirm(`Reassign document number?\n\nProject: ${project}\nUSI: ${usi}\n\nThis will generate a new doc number and cannot be undone.`)) return
    setBusy(true); setMsg('')
    try {
      const r = await documentsAPI.reassignDocNumber(doc.id, project.trim(), usi.trim())
      setMsg('✅ ' + r.data.message + ' → ' + r.data.doc_number)
      setTimeout(() => { setMsg(''); setOpen(false); onDone() }, 2000)
    } catch(e) { setMsg('❌ ' + (e.response?.data?.error || 'Failed')) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 12, border: '1.5px dashed #7c3aed', borderRadius: 10, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: '100%', padding: '10px 16px', background: '#f5f3ff', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}>
        <span style={{ fontSize: 15 }}>🔢</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#5b21b6' }}>Admin: Reassign Document Number</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#7c3aed' }}>{open ? '▲ Hide' : '▼ Show'}</span>
      </button>
      {open && (
        <div style={{ padding: '16px 20px', background: '#f5f3ff', borderTop: '1px solid #ddd6fe' }}>
          <div style={{ fontSize: 12, color: '#5b21b6', marginBottom: 14 }}>
            Change the <strong>Project</strong> and/or <strong>USI</strong> that form the document number.
            A new doc number will be generated and the old one is logged in Audit.
          </div>
          {msg && (
            <div style={{ padding: '8px 14px', borderRadius: 7, marginBottom: 12,
              background: msg.startsWith('✅') ? '#f0fdf4' : '#fef2f2',
              color: msg.startsWith('✅') ? '#166534' : '#991b1b', fontSize: 13, fontWeight: 600 }}>
              {msg}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>Project Code</div>
              <input value={project} onChange={e => setProject(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: '1px solid #c4b5fd',
                  borderRadius: 7, fontSize: 13 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>USI / KKS Code</div>
              <input value={usi} onChange={e => setUsi(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: '1px solid #c4b5fd',
                  borderRadius: 7, fontSize: 13 }} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#7c3aed', marginBottom: 12 }}>
            New number preview: <strong>{doc.doc_type?.code || 'TYPE'}/{project || '…'}/{usi || '…'}/XXXX</strong>
          </div>
          <button onClick={doReassign} disabled={busy}
            style={{ padding: '7px 20px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7,
              fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Saving…' : 'Reassign Number'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function DocumentDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const location = useLocation()
  const backTo = location.state?.from || '/documents'
  const [searchParams] = useSearchParams()
  const requestedVersion = searchParams.get('v') || null  // null = view current
  const [doc, setDoc] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('metadata')
  const [users, setUsers] = useState([])

  // Action state
  const [feedback, setFeedback]         = useState('')
  const [taggedUser, setTaggedUser]     = useState(null)   // user to request feedback from
  const [tagSearch, setTagSearch]       = useState('')
  const [tagResults, setTagResults]     = useState([])
  const [showTagDrop, setShowTagDrop]   = useState(false)
  const tagInputWrapRef = useRef(null)
  const [tagDropRect, setTagDropRect]   = useState(null)
  const [submitingFb, setSubmittingFb] = useState(false)
  const [wfNote, setWfNote] = useState('')
  const [wfAction, setWfAction] = useState(null)
  const [showVersionModal, setShowVersionModal] = useState(false)
  const [showArchiveModal, setShowArchiveModal] = useState(false)
  const [archiveReason, setArchiveReason]       = useState('')
  const [showEditorsModal, setShowEditorsModal] = useState(false)
  const [pendingAccessRequests, setPendingAccessRequests] = useState([])
  const [showAccessRequestModal, setShowAccessRequestModal] = useState(false)
  const [accessRequestMsg, setAccessRequestMsg] = useState('')
  const [accessRequestBusy, setAccessRequestBusy] = useState(false)
  const [accessRequestSent, setAccessRequestSent] = useState('')
  const [editorsList, setEditorsList]           = useState([])
  const [editorSearch, setEditorSearch]         = useState('')
  const [editorResults, setEditorResults]       = useState([])
  const [savingEditors, setSavingEditors]       = useState(false)
  const [viewingFile, setViewingFile]           = useState(null)   // file object being previewed
  const [showFileUpload, setShowFileUpload]     = useState(false)
  const [uploadFiles, setUploadFiles]           = useState([])
  const [uploading, setUploading]               = useState(false)
  const [showRefModal, setShowRefModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showWfModal, setShowWfModal]       = useState(false)
  const [wfPassword, setWfPassword]         = useState('')
  const [wfPasswordError, setWfPasswordError] = useState('')
  const [checklistUploading, setChecklistUploading] = useState({})  // taskId -> bool
  const [checklistFiles, setChecklistFiles]         = useState({})  // taskId -> file
  const [shareLink, setShareLink] = useState(null)
  const [shareCopySuccess, setShareCopySuccess] = useState(false)
  const [refDocId, setRefDocId] = useState('')
  const [refNote, setRefNote] = useState('')
  const [versionFile, setVersionFile] = useState(null)
  const [versionReason, setVersionReason] = useState('')
  const [versionIsMajor, setVersionIsMajor] = useState(false)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [coverPageLoading, setCoverPageLoading] = useState(false)

  const [fileAccessStats, setFileAccessStats] = useState(null)
  const [showWfHistory, setShowWfHistory] = useState(false)

  // Metadata edit mode
  const [metaEditMode, setMetaEditMode]   = useState(false)
  const [editForm, setEditForm]           = useState({})
  const [metaSaving, setMetaSaving]       = useState(false)
  const [metaError, setMetaError]         = useState('')
  const [lockedFields, setLockedFields]   = useState([])

  const { user } = useAuth()

  const refresh = () => {
    documentsAPI.get(id).then(r => {
      setDoc(r.data)
    }).finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    adminAPI.listUsers().then(r => setUsers(r.data))
    adminAPI.getConfig().then(r => {
      const raw = r.data?.prepare_locked_fields || ''
      setLockedFields(raw.split(',').map(s => s.trim()).filter(Boolean))
    })
  }, [id])

  useEffect(() => {
    if (tab === 'files') {
      documentsAPI.fileAccessStats(id).then(r => setFileAccessStats(r.data)).catch(() => {})
    }
  }, [tab, id])

  async function handleCheckout(action) {
    await documentsAPI.checkout(id, action)
    refresh()
  }

  async function handleWfAction(action) {
    setWfPasswordError('')
    try {
      if (action === 'return') {
        await workflowAPI.return(id, { action: 'return', note: wfNote })
      } else {
        const backendAction = action === 'advance' ? 'approve' : action
        await workflowAPI.action(id, { action: backendAction, note: wfNote, password: wfPassword })
      }
      setWfNote(''); setWfPassword(''); setWfPasswordError(''); setWfAction(null)
      refresh()
    } catch (e) {
      const msg = e.response?.data?.detail || 'Action failed'
      if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('incorrect')) {
        setWfPasswordError(msg)
      } else {
        setWfPasswordError(msg)
      }
    }
  }

  async function handleSubmitWorkflow() {
    setShowWfModal(true)
  }

  async function handleSaveMeta() {
    const cm = editForm.custom_metadata || {}

    // Validate: revision_due must not be later than expiry_date
    if (cm.expiry_date && cm.revision_due) {
      const expiry   = new Date(cm.expiry_date)
      const revision = new Date(cm.revision_due)
      if (revision > expiry) {
        setMetaError('Revision Due date cannot be later than the Expiry Date.')
        return
      }
    }
    setMetaError('')
    setMetaSaving(true)
    try {
      await documentsAPI.update(id, { custom_metadata: cm })
      setMetaEditMode(false)
      refresh()
    } catch (e) {
      setMetaError(e.response?.data?.detail || 'Save failed')
    } finally {
      setMetaSaving(false)
    }
  }

  function openMetaEdit() {
    if (isCheckedOutByOther) return
    const cm = { ...(doc.custom_metadata || {}) }
    const schemaFields = Array.isArray(doc.doc_type?.metadata_schema) ? doc.doc_type.metadata_schema : []

    // Pre-populate core fields into custom_metadata for any matching schema field key
    const coreValues = {
      expiry_date:  doc.expiry_date  ? doc.expiry_date.split('T')[0]  : null,
      revision_due: doc.revision_due ? doc.revision_due.split('T')[0] : null,
      usi:          doc.usi_kks_code || null,
      usi_kks_code: doc.usi_kks_code || null,
      project:      doc.project      || null,
    }
    for (const f of schemaFields) {
      if (!cm[f.key] && coreValues[f.key] != null) cm[f.key] = coreValues[f.key]
    }
    setEditForm({ custom_metadata: cm })
    setMetaError('')
    setMetaEditMode(true)
  }

  async function handleFeedback() {
    if (!feedback.trim()) return
    setSubmittingFb(true)
    try {
      await documentsAPI.addFeedback(id, feedback, taggedUser?.id || null)
      setFeedback('')
      setTaggedUser(null)
      setTagSearch('')
    } catch(e) {
      alert(e.response?.data?.detail || 'Failed to post feedback')
    } finally {
      setSubmittingFb(false)
      refresh()
    }
  }

  async function searchTagUsers(q) {
    setTagSearch(q)
    if (!q.trim()) { setTagResults([]); setShowTagDrop(false); return }
    try {
      const r = await documentsAPI.searchUsers(q)
      setTagResults(r.data || [])
      if (tagInputWrapRef.current) setTagDropRect(tagInputWrapRef.current.getBoundingClientRect())
      setShowTagDrop((r.data || []).length > 0)
    } catch { setTagResults([]) }
  }

  async function handleAddReference() {
    if (!refDocId) return
    await documentsAPI.addReference(id, parseInt(refDocId), refNote)
    setRefDocId('')
    setRefNote('')
    setShowRefModal(false)
    refresh()
  }

  async function submitAccessRequest() {
    setAccessRequestBusy(true); setAccessRequestSent('')
    try {
      const r = await documentsAPI.requestEditAccess(id, accessRequestMsg.trim())
      setAccessRequestSent(r.data?.message || 'Request sent.')
      setAccessRequestMsg('')
      setTimeout(() => setShowAccessRequestModal(false), 2200)
    } catch (e) {
      setAccessRequestSent(e.response?.data?.error || 'Could not send request.')
    } finally { setAccessRequestBusy(false) }
  }

  async function openEditorsModal() {
    try {
      const res = await documentsAPI.getEditors(id)
      setEditorsList(res.data || [])
    } catch {
      setEditorsList(doc?.editors || [])
    }
    // Load pending access requests for this document
    try {
      const reqRes = await documentsAPI.incomingAccessRequests()
      const docRequests = (reqRes.data || []).filter(r => r.document?.id === parseInt(id))
      setPendingAccessRequests(docRequests)
    } catch {
      setPendingAccessRequests([])
    }
    setEditorSearch('')
    setEditorResults([])
    setShowEditorsModal(true)
  }

  useEffect(() => {
    if (!showEditorsModal) return
    const q = editorSearch.trim()
    if (!q) { setEditorResults([]); return }
    const t = setTimeout(() => {
      documentsAPI.searchUsers(q).then(r => {
        const taken = new Set([doc?.creator?.id, ...editorsList.map(u => u.id)])
        setEditorResults((r.data || []).filter(u => !taken.has(u.id)))
      }).catch(() => setEditorResults([]))
    }, 250)
    return () => clearTimeout(t)
  }, [editorSearch, showEditorsModal, editorsList, doc?.creator?.id])

  async function saveEditors() {
    setSavingEditors(true)
    try {
      await documentsAPI.setEditors(id, editorsList.map(u => u.id))
      setShowEditorsModal(false)
      refresh()
    } catch (e) {
      alert(e.response?.data?.error || 'Could not save editors')
    } finally { setSavingEditors(false) }
  }

  async function handleDecideAccessRequest(requestId, action) {
    try {
      await documentsAPI.decideAccessRequest(requestId, action)
      // Remove from pending list
      setPendingAccessRequests(r => r.filter(req => req.id !== requestId))
      // If approved, also add to editors and refresh
      if (action === 'approve') {
        refresh()
      }
    } catch (e) {
      alert(e.response?.data?.error || `Could not ${action} request`)
    }
  }

  async function handleUploadVersion() {
    if (!versionReason) return
    const fd = new FormData()
    if (versionFile) fd.append('file', versionFile)
    fd.append('change_reason', versionReason)
    fd.append('is_major', versionIsMajor)
    await documentsAPI.uploadVersion(id, fd)
    setShowVersionModal(false)
    setVersionFile(null)
    setVersionReason('')
    refresh()
  }

  function normalizeShareLink(rawLink) {
    if (!rawLink) return rawLink
    try {
      const url = new URL(rawLink, window.location.origin)
      const isDocRoute = url.pathname.startsWith('/documents')
      if (isDocRoute && url.origin !== window.location.origin) {
        return `${window.location.origin}${url.pathname}${url.search}`
      }
      return url.href
    } catch (e) {
      if (rawLink.startsWith('/')) {
        return `${window.location.origin}${rawLink}`
      }
      return rawLink
    }
  }

  async function handleDownloadCoverPage() {
    setCoverPageLoading(true)
    try {
      const res = await documentsAPI.downloadCoverPage(id)
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${doc.doc_number || 'cover_page'}_cover_page.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Failed to generate cover page.')
    } finally {
      setCoverPageLoading(false)
    }
  }

  async function handleShare(version) {
    const res = await documentsAPI.getShareLink(id, version)
    setShareLink({ ...res.data, link: normalizeShareLink(res.data.link) })
    setShareCopySuccess(false)
    setShowShareModal(true)
  }

  async function copyShareLink() {
    if (!shareLink?.link) return
    try {
      const link = normalizeShareLink(shareLink.link)
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(link)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = link
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setShareCopySuccess(true)
      setTimeout(() => setShareCopySuccess(false), 2000)
    } catch (e) {
      alert('Copy failed. Please select the link and copy it manually.')
    }
  }

  async function handleDownload(fileId, filename) {
    const res = await documentsAPI.downloadFile(id, fileId)
    const url = URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    documentsAPI.fileAccessStats(id).then(r => setFileAccessStats(r.data)).catch(() => {})
  }

  async function handleDownloadTemplate(levelId, filename) {
    try {
      const res = await workflowAPI.downloadTemplate(id, levelId)
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'checklist_template'
      a.click()
      URL.revokeObjectURL(url)
    } catch { alert('Template not available') }
  }

  async function handleSubmitChecklist(taskId) {
    const file = checklistFiles[taskId]
    if (!file) return
    setChecklistUploading(p => ({ ...p, [taskId]: true }))
    try {
      const fd = new FormData()
      fd.append('file', file)
      await workflowAPI.submitChecklist(id, taskId, fd)
      setChecklistFiles(p => ({ ...p, [taskId]: null }))
      refresh()
    } catch (e) {
      alert(e.response?.data?.detail || 'Upload failed')
    } finally {
      setChecklistUploading(p => ({ ...p, [taskId]: false }))
    }
  }

  async function handleDownloadCompleted(taskId, filename) {
    try {
      const res = await workflowAPI.downloadChecklist(id, taskId)
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'completed_checklist'
      a.click()
      URL.revokeObjectURL(url)
    } catch { alert('File not available') }
  }

  // Count PDF pages from binary content
  async function countPdfPages(file) {
    return new Promise(resolve => {
      if (!file.name.toLowerCase().endsWith('.pdf')) { resolve(null); return }
      const reader = new FileReader()
      reader.onload = e => {
        try {
          const str = new TextDecoder('latin1').decode(new Uint8Array(e.target.result))
          const matches = str.match(/\/Type\s*\/Page[^s]/g)
          resolve(matches ? matches.length : null)
        } catch { resolve(null) }
      }
      reader.onerror = () => resolve(null)
      reader.readAsArrayBuffer(file)
    })
  }

  async function handleUploadFiles() {
    if (!uploadFiles.length) return
    setUploading(true)
    try {
      for (const file of uploadFiles) {
        const vfd = new FormData()
        vfd.append('file', file)
        await documentsAPI.addFile(id, vfd)

        // Auto-update Number of Sheets for Drawing doc type
        if (doc.doc_type?.code === 'DRW' && file.name.toLowerCase().endsWith('.pdf')) {
          const pages = await countPdfPages(file)
          if (pages && pages > 0) {
            const curMeta = doc.custom_metadata || {}
            // Find the field key for Number of Sheets
            const schema = Array.isArray(doc.doc_type?.metadata_schema)
              ? doc.doc_type.metadata_schema : []
            const sheetsField = schema.find(f =>
              f.label?.toLowerCase().includes('number of sheet') ||
              f.key?.toLowerCase().includes('number_of_sheet')
            )
            const key = sheetsField?.key || 'number_of_sheets'
            await documentsAPI.update(id, {
              custom_metadata: { ...curMeta, [key]: String(pages) }
            })
          }
        }
      }
      setUploadFiles([])
      setShowFileUpload(false)
      refresh()
    } catch (e) {
      alert(e.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleFlagDelete() {
    setDeleting(true)
    try {
      await documentsAPI.flagDeletion(id)
      setShowDeleteConfirm(false)
      refresh()
    } catch (e) {
      alert(e.response?.data?.detail || 'Flag for deletion failed')
    } finally {
      setDeleting(false)
    }
  }

  async function handleUnflag() {
    try {
      await documentsAPI.unflagDeletion(id)
      refresh()
    } catch (e) {
      alert(e.response?.data?.detail || 'Could not remove flag')
    }
  }

  async function handleDeleteFile(fileId, filename) {
    if (!window.confirm(`Delete "${filename}"? This cannot be undone.`)) return
    try {
      await documentsAPI.deleteFile(id, fileId)
      refresh()
    } catch (e) {
      alert(e.response?.data?.detail || 'Delete failed')
    }
  }

  if (loading) return <div style={{ padding: 32 }}><Spinner /></div>
  if (!doc) return <div style={{ padding: 32, color: '#A32D2D' }}>Document not found.</div>

  // ── Historical version view ──────────────────────────────────────────────
  // When ?v=X is in the URL and X is older than the current version, we show
  // that version's metadata in a read-only view.
  const viewingHistorical = !!requestedVersion && requestedVersion !== doc.current_version
  const viewingVersionNumber = requestedVersion || doc.current_version
  // Compute the supersession status of the historical version using the same
  // rule the list uses: the highest non-current version is "Released",
  // anything older is "Superseded".
  let viewingVersionStatus = null
  if (viewingHistorical && Array.isArray(doc.versions)) {
    const verKey = (s) => String(s).split('.').map(p => parseInt(p) || 0)
    const cmp = (a, b) => {
      const ka = verKey(a), kb = verKey(b)
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        const da = ka[i] || 0, db = kb[i] || 0
        if (da !== db) return da - db
      }
      return 0
    }
    const sorted = [...doc.versions].sort((a, b) => cmp(b.version_number, a.version_number))
    const nonCurrent = sorted.filter(v => v.version_number !== doc.current_version)
    const mainReleased = doc.status === 'Released'
      ? doc.current_version
      : (nonCurrent[0]?.version_number ?? null)
    viewingVersionStatus = (requestedVersion === mainReleased) ? 'Released' : 'Superseded'
  }

  const wf = doc.workflow

  // Workflow is only "active" (locking) once the document is under formal review
  const inWorkflow = ['In Check','In Review','In Approval','In Archive'].includes(doc.status)
  const wfActive   = wf && !wf.completed && inWorkflow
  const inArchiveWorkflow = wfActive && wf?.purpose === 'archive'

  const LOCKED_STATUSES = ['In Check','In Review','In Approval','Approved','Released','Archived']

  // Checkout ownership
  const isCheckedOutByMe = doc.checked_out && doc.checked_out_by?.id === user?.id
  const isCheckedOutByOther = doc.checked_out && !isCheckedOutByMe

  // ── User permission flags from backend ──────────────────────────────────────
  const isAdminUser  = ['System Admin', 'Sub Admin'].includes(user?.role)
  const userCanEdit  = !!(user?.can_edit   || isAdminUser)
  const userCanCreate= !!(user?.can_create || isAdminUser)
  const userCanDelete= !!(user?.can_delete || isAdminUser)

  // ── Document-level access ────────────────────────────────────────────────────
  const isOwner  = doc.creator?.id === user?.id
  const isEditor = (doc.editors || []).some(u => u.id === user?.id)

  // hasEditAccess: structural access (owner/editor/admin) AND user must have can_edit permission
  const hasEditAccess = (isOwner || isEditor || isAdminUser) && userCanEdit

  // canEdit: structural access + edit permission + not in a locked status + not checked out by someone else
  const canEdit = hasEditAccess && !LOCKED_STATUSES.includes(doc.status) && !isCheckedOutByOther

  // canUploadFile: edit permission required (uploading files modifies the document)
  const canUploadFile = userCanEdit && (isOwner || isEditor || isAdminUser) &&
    doc.status === 'Draft' && !wfActive && !isCheckedOutByOther

  // canNewVersion: edit permission required to create a new version
  const canNewVersion = userCanEdit && (isOwner || isEditor || isAdminUser) &&
    doc.status === 'Released' && !wfActive

  // canDelete: delete permission required
  const canDelete = userCanDelete && (isOwner || isAdminUser) &&
    doc.status === 'Draft' && !wfActive

  // canFlagDelete: edit permission required; blocked during active workflow and once Released
  const canFlagDelete = userCanEdit && (isOwner || isEditor || isAdminUser) &&
    !wfActive && doc.status !== 'Released'

  // Find the current user's pending task at the active step
  const myPendingTask = wf && !wf.completed
    ? (wf.tasks || []).find(t =>
        t.assignee?.id === user?.id &&
        t.status === 'Pending' &&
        t.step === wf.current_step
      )
    : null

  // canWfAction: user must have a pending task assigned to them
  // Workflow approval is an action that requires at minimum read access (no edit flag needed —
  // the task was explicitly assigned to this user by an admin/initiator)
  const canWfAction = !!myPendingTask

  const TABS = [
    { id: 'metadata',   label: 'Metadata' },
    { id: 'files',      label: `Files (${doc.files?.length ?? 0})` },
    { id: 'versions',   label: `Versions (${doc.versions?.length ?? 0})` },
    { id: 'workflow',   label: 'Workflow' },
    { id: 'audit',      label: `Audit Log (${doc.audit_logs?.length ?? 0})` },
    { id: 'feedback',   label: `Feedback (${doc.feedbacks?.length ?? 0})` },
    { id: 'references', label: 'References' },
  ]

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100 }}>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => { if (window.history.length > 1) nav(-1); else nav(backTo) }}
          title="Go back one step."
          style={{ background: 'none', border: '1px solid #D9D9D9', borderRadius: 4, padding: '5px 12px', fontSize: 13, cursor: 'pointer', color: '#0070F2', fontFamily: 'inherit' }}>
          ← Back
        </button>
        <span style={{ fontSize: 12, color: '#6A6D70' }}>{doc.doc_number}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
          {doc.confidential && <Badge label="Confidential" />}
          {doc.checked_out && <Badge label="Checked Out" />}
          <Badge label={viewingHistorical ? (viewingVersionStatus || 'Superseded') : doc.status} />
          {canWfAction && myPendingTask && (
            <>
              <button onClick={() => setWfAction('advance')}
                disabled={myPendingTask.level?.checklist_required === true && !!myPendingTask.level?.checklist_template_name && !myPendingTask.checklist_done}
                title="Approve this document at your assigned level"
                style={{ padding: '5px 12px', borderRadius: 4, border: 'none', background: '#188918', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                ✅ Approve
              </button>
              <button onClick={() => setWfAction('reject')}
                title="Reject this document"
                style={{ padding: '5px 12px', borderRadius: 4, border: 'none', background: '#BB0000', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                ❌ Reject
              </button>
              <button onClick={() => setWfAction('return')}
                title="Return for correction"
                style={{ padding: '5px 12px', borderRadius: 4, border: '1px solid #D9D9D9', background: '#fff', color: '#32363A', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                ↩ Return
              </button>
            </>
          )}
          {doc.workflow_history?.length > 0 && (
            <button onClick={() => setShowWfHistory(true)}
              title="View previous workflow cycles"
              style={{ padding: '5px 12px', borderRadius: 4, border: '1px solid #D9D9D9', background: '#fff', color: '#6A6D70', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
              📋 Workflow History ({doc.workflow_history.length})
            </button>
          )}
        </div>
      </div>

      <div style={{ fontSize: 20, fontWeight: 700, color: '#32363A', margin: '0 0 4px' }}>{doc.title}</div>
      <div style={{ display: 'block', margin: '0 0 8px', color: '#6A6D70', fontSize: 13 }}>
        {doc.doc_type?.name} · {doc.project || '—'} · USI: {doc.usi_kks_code || '—'} · v{viewingVersionNumber}
        {doc.serial_no && ` · ${doc.serial_no}`}
      </div>

      {/* Owner / created info */}
      {doc.creator && (
        <div style={{
          display:'flex', alignItems:'center', gap:10, marginBottom:16,
          padding:'8px 12px', background:'#f8fafc',
          border:'1px solid #e5e7eb', borderRadius:8, width:'fit-content',
        }}>
          <div style={{
            width:30, height:30, borderRadius:'50%',
            background:'linear-gradient(135deg,#3b82f6,#1d4ed8)',
            color:'#fff', fontWeight:700, fontSize:11,
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
          }}>
            {(doc.creator.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div style={{ fontSize:12, color:'#374151' }}>
            <div><strong>Owner:</strong> {doc.creator.name}</div>
            <div style={{ fontSize:11, color:'#6b7280' }}>
              Created {fmtDate(doc.created_at)}
              {doc.creator.email ? ` · ${doc.creator.email}` : ''}
            </div>
          </div>
          {!hasEditAccess && (
            <button
              onClick={() => setShowAccessRequestModal(true)}
              title="Request edit access from the document owner"
              style={{
                marginLeft:6, padding:'6px 12px', borderRadius:7,
                background:'#185FA5', color:'#fff', border:'none',
                fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap',
              }}
            >🔑 Request Edit Access</button>
          )}
        </div>
      )}

      {doc.on_behalf_of && (
        <div style={{
          display:'flex', alignItems:'center', gap:8, marginBottom:12,
          padding:'7px 12px', background:'#EDE7F6', border:'1px solid #7F77DD',
          borderRadius:7, fontSize:12, color:'#4A148C', width:'fit-content',
        }}>
          <span>👤</span>
          <span>Created on behalf of <strong>{doc.on_behalf_of.name}</strong> ({doc.on_behalf_of.email})</span>
        </div>
      )}

      {doc.status === 'Archived' && (
        <div style={{
          background:'#F1EFE8', border:'1px solid #B4B2A9', borderRadius:8,
          padding:'10px 14px', marginBottom:16, fontSize:13, color:'#5F5E5A',
          display:'flex', alignItems:'center', gap:10,
        }}>
          <span style={{ fontSize:16 }}>📦</span>
          <span style={{ flex:1 }}>
            <strong>Archived (Obsolete)</strong>
            {doc.archived_at && <> on {fmtDate(doc.archived_at)} by {doc.archived_by?.name || 'system'}</>}.
            {doc.obsolete_reason && <><br /><em>Reason:</em> {doc.obsolete_reason}</>}
          </span>
        </div>
      )}

      {inArchiveWorkflow && (
        <div style={{
          background:'#FEF3C7', border:'1px solid #F59E0B', borderRadius:8,
          padding:'10px 14px', marginBottom:16, fontSize:13, color:'#854F0B',
          display:'flex', alignItems:'center', gap:10,
        }}>
          <span style={{ fontSize:16 }}>📦</span>
          <span style={{ flex:1 }}>
            <strong>Archive workflow in progress</strong>
            {' '}(Step {wf?.current_step} of {wf?.total_steps}).
            Once final approval is given, this document will be marked Archived (Obsolete).
            {doc.obsolete_reason && <><br /><em>Reason:</em> {doc.obsolete_reason}</>}
          </span>
        </div>
      )}

      {viewingHistorical && (
        <div style={{
          background:'#FEF3C7', border:'1px solid #F59E0B', borderRadius:8,
          padding:'10px 14px', marginBottom:16, fontSize:13, color:'#854F0B',
          display:'flex', alignItems:'center', gap:10,
        }}>
          <span style={{ fontSize:15 }}>🕒</span>
          <span style={{ flex:1 }}>
            Viewing historical version <strong>v{requestedVersion}</strong>
            {viewingVersionStatus && <> — <strong>{viewingVersionStatus}</strong></>}.
            Editing, workflow actions and uploads apply to the current version (v{doc.current_version}) only.
          </span>
          <button
            onClick={() => nav(`/documents/${id}`)}
            style={{
              background:'#fff', border:'1px solid #F59E0B', color:'#854F0B',
              borderRadius:6, padding:'5px 12px', fontSize:12, fontWeight:600, cursor:'pointer',
            }}
          >Switch to v{doc.current_version} →</button>
        </div>
      )}

      {/* Expiry alert */}
      {doc.expiry_date && (() => {
        const diff = (new Date(doc.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)
        return diff < 90 && diff > 0 ? (
          <div style={{ background: '#FCEBEB', border: '1px solid #E24B4A', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#A32D2D' }}>
            ⚠ This document expires on {new Date(doc.expiry_date).toLocaleDateString('en-IN')} — revision may be required
          </div>
        ) : null
      })()}

      {/* Checked out notice */}
      {doc.checked_out && (
        <div style={{ background: isCheckedOutByMe ? '#E6F1FB' : '#FAEEDA', border: `1px solid ${isCheckedOutByMe ? '#185FA5' : '#EF9F27'}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: isCheckedOutByMe ? '#0C447C' : '#854F0B' }}>
          🔒 {isCheckedOutByMe
            ? 'You have this document checked out. Check it in when you are done editing.'
            : `This document is checked out by ${doc.checked_out_by?.name || 'another user'}. Editing is disabled until they check it back in.`}
        </div>
      )}

      {/* Locked banner — shown when workflow is active */}
      {wfActive && (
        <div style={{ background:'#EDE7F6', border:'1px solid #7F77DD',
          borderRadius:8, padding:'10px 16px', marginBottom:16,
          fontSize:13, color:'#4A148C', display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:18 }}>🔒</span>
          <div>
            <strong>Document locked</strong> — Approval workflow is in progress
            (Step {wf?.current_step} of {wf?.total_steps} · Stage: {wf?.stage}).
            {' '}Editing, file upload, file deletion, and new versions are blocked until the workflow completes or is returned.
          </div>
        </div>
      )}

      {/* Workflow progress */}
      {wf && (
        <Card style={{ marginBottom: 16 }}>
          <SectionHead title="Workflow Progress" />
          <WorkflowBar stage={wf.stage} completed={wf.completed} levels={wf.levels} current_step={wf.current_step} />
        </Card>
      )}

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {!doc.checked_out && canEdit && (
          <Btn label="Check Out" onClick={() => handleCheckout('checkout')} icon="🔒"
            title="Lock this document to signal you are actively editing it — other users will see a 'Checked Out' warning and know not to make changes simultaneously." />
        )}
        {isCheckedOutByMe && (
          <Btn label="Check In" onClick={() => handleCheckout('checkin')} variant="warning" icon="🔓"
            title="Release the document lock — marks your editing session as complete and makes the document available for others to work on." />
        )}
        {/* Upload File button — only in Draft/Created with no active workflow */}
        {canUploadFile && (
          <button
            onClick={() => setTab('files')}
            title="Attach one or more files to this document. Available only while the document is in Draft status and no approval workflow is active."
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 8,
              background: '#0F6E56', color: '#fff', border: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            }}>
            ⬆ Upload File
          </button>
        )}

        {doc.status === 'Draft' && userCanEdit && (isOwner || isEditor || isAdminUser) && (
          <Btn label="Initiate Workflow" onClick={handleSubmitWorkflow} variant="primary" icon="⚙"
            title="Configure the approval workflow — assign checkers, reviewers, and approvers — then start the formal review process for this document." />
        )}
        {canWfAction && (
          <Btn label="My Approval Pending" onClick={() => setTab('workflow')}
            variant="primary" icon="⚠"
            title="You have a pending approval task at the current workflow step. Click to go to the Workflow tab and Approve, Reject, or Return the document." />
        )}
        {/* New Version — only allowed after Released */}
        {canNewVersion ? (
          <Btn label="New Version" onClick={() => setShowVersionModal(true)}
            icon="📝" variant="primary"
            title="Create a new revision of this released document. The new version starts as Draft and must go through the full approval workflow before release." />
        ) : doc.status !== 'Draft' && (
          <button disabled title={
            wfActive
              ? 'A workflow is in progress — complete or return the workflow before creating a new version.'
              : `A new version can only be created once the document is Released. Current status: ${doc.status}.`
            }
            style={{ padding:'7px 14px', borderRadius:8, border:'1px solid #e5e7eb',
              background:'#f9fafb', color:'#9ca3af', cursor:'not-allowed',
              fontSize:13, fontFamily:'inherit' }}>
            📝 New Version
          </button>
        )}
        <Btn label="Share Link" onClick={() => handleShare()} icon="🔗"
          title="Generate a shareable link that always points to the latest version of this document. Anyone with the link can view it." />
        <Btn label="Share v" onClick={() => handleShare(doc.current_version)} icon="📌"
          title={`Generate a shareable link pinned specifically to the current version (v${doc.current_version}). The link will not update if a newer version is released.`} />

        <button
          onClick={handleDownloadCoverPage}
          disabled={coverPageLoading}
          title="Download the auto-generated cover page PDF for this document"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 16px', borderRadius: 8,
            background: coverPageLoading ? '#e5e7eb' : '#185FA5', color: '#fff',
            border: 'none', cursor: coverPageLoading ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            opacity: coverPageLoading ? 0.7 : 1,
          }}>
          {coverPageLoading ? '⏳ Generating…' : '📄 Cover Page'}
        </button>

        {/* Archive — only when Released, no active workflow, no historical view */}
        {doc.status === 'Released' && !wfActive && !viewingHistorical && (
          <Btn label="Archive Document" onClick={() => setShowArchiveModal(true)} icon="📦"
            title="Start an approval workflow to archive this document as obsolete. Once approved, the document is moved to Archived status and stays read-only as part of the audit record." />
        )}

        {/* Manage Editors — creator or admin only */}
        {(doc.creator?.id === user?.id || ['System Admin','Sub Admin'].includes(user?.role)) && (
          <Btn label="Editors" onClick={openEditorsModal} icon="👥"
            title="Grant or revoke edit access to this document. Only the creator and listed editors (plus admins) can modify it." />
        )}

        {/* Flag for Deletion */}
        {doc.flagged_for_deletion ? (
          <button
            onClick={handleUnflag}
            title="This document is scheduled for deletion at 12:00 AM IST. Click to remove the flag."
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 8,
              background: '#FEF2F2', color: '#DC2626',
              border: '2px solid #DC2626',
              cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            }}>
            🚩 Flagged — Click to Unflag
          </button>
        ) : canFlagDelete ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            title="Flag this document for deletion. It will be removed at 12:00 AM IST."
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 8,
              background: '#DC2626', color: '#fff', border: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            }}>
            🚩 Flag for Deletion
          </button>
        ) : (
          <button
            disabled
            title={
              doc.status === 'Released'
                ? 'Released documents are part of the official record and cannot be flagged for deletion.'
                : `Deletion cannot be flagged while the document is in the ${wf?.stage} stage. Return the workflow to Prepare first.`
            }
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 8,
              background: '#f9fafb', color: '#9ca3af',
              border: '1px solid #e5e7eb',
              cursor: 'not-allowed', fontSize: 13, fontFamily: 'inherit',
            }}>
            🚩 Flag for Deletion
          </button>
        )}
      </div>

      {/* Flag for Deletion confirmation modal */}
      {showDeleteConfirm && (
        <Modal onClose={() => !deleting && setShowDeleteConfirm(false)}>
          <div style={{ padding: '8px 4px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#DC2626', marginBottom: 12 }}>
              🚩 Flag for Deletion
            </div>
            <p style={{ fontSize: 14, color: '#374151', marginBottom: 8 }}>
              Flag <strong>{doc.doc_number} — {doc.title}</strong> for deletion?
            </p>
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>
              The document will be <strong>permanently deleted at 12:00 AM IST</strong> during the scheduled cleanup.
              You can remove the flag before then if you change your mind.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: '1px solid #d1d5db',
                  background: '#fff', color: '#374151', cursor: deleting ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontFamily: 'inherit',
                }}>
                Cancel
              </button>
              <button
                onClick={handleFlagDelete}
                disabled={deleting}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: 'none',
                  background: deleting ? '#fca5a5' : '#DC2626', color: '#fff',
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                }}>
                {deleting ? 'Flagging…' : 'Yes, Flag for Deletion'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Tabs */}
      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* ── Metadata ─────────────────────────────────────────────────────────── */}
      {tab === 'metadata' && (() => {
        const schema = Array.isArray(doc.doc_type?.metadata_schema) ? doc.doc_type.metadata_schema : []
        const inPrep = doc.status === 'Draft'

        const cellCM = { background: '#f0f7ff', borderRadius: 8, padding: '10px 14px', border: '1px solid #bfdbfe' }
        const lblCM  = { fontSize: 11, color: '#185FA5', marginBottom: 2 }

        return (
          <div>

            {/* ── READ-ONLY view ── */}
            {!metaEditMode && (
              <div>
                {/* Pencil button — only during preparation stage and when not locked by another user */}
                {inPrep && canEdit && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                    <button
                      onClick={openMetaEdit}
                      title="Edit metadata"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 14px', borderRadius: 7, cursor: 'pointer',
                        border: '1px solid #d1d5db', background: '#fff',
                        color: '#374151', fontSize: 13, fontWeight: 500,
                        fontFamily: 'inherit',
                      }}
                      onMouseOver={e => { e.currentTarget.style.background = '#f0f7ff'; e.currentTarget.style.borderColor = '#185FA5'; e.currentTarget.style.color = '#0C447C' }}
                      onMouseOut={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#374151' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                      Edit
                    </button>
                  </div>
                )}
                {/* Render fields using schema order/labels; fall back to raw custom_metadata keys */}
                {(() => {
                  const displayFields = schema.length > 0 ? schema : []
                  const cmKeys = Object.keys(doc.custom_metadata || {})
                  // Fields to show: schema-ordered first, then any custom_metadata keys not in schema
                  const schemaKeys = new Set(displayFields.map(f => f.key))
                  const extraKeys = cmKeys.filter(k => !schemaKeys.has(k))
                  const cm = doc.custom_metadata || {}

                  function ROCell({ fieldKey, label }) {
                    // Fall back to core doc fields when key not yet in custom_metadata
                    let raw = cm[fieldKey]
                    if (!raw && fieldKey === 'expiry_date'  && doc.expiry_date)  raw = doc.expiry_date.split('T')[0]
                    if (!raw && fieldKey === 'revision_due' && doc.revision_due) raw = doc.revision_due.split('T')[0]
                    if (!raw && (fieldKey === 'usi' || fieldKey === 'usi_kks_code') && doc.usi_kks_code) raw = doc.usi_kks_code
                    if (!raw && fieldKey === 'project' && doc.project) raw = doc.project
                    const fieldDef = schema.find(f => f.key === fieldKey)
                    const optLabel = fieldDef?.options
                      ? (() => {
                          const match = fieldDef.options.find(o =>
                            (typeof o === 'object' ? o.value : o) === raw
                          )
                          return match && typeof match === 'object' && match.label !== match.value
                            ? match.label : null
                        })()
                      : null
                    const display = fieldDef?.type === 'date' && raw
                      ? fmtDate(raw)
                      : raw != null ? String(raw) : '—'
                    return (
                      <div style={cellCM}>
                        <div style={lblCM}>{label || fieldKey}</div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{display || '—'}</div>
                        {optLabel && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>{optLabel}</div>}
                      </div>
                    )
                  }

                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {displayFields.map(f => <ROCell key={f.key} fieldKey={f.key} label={f.label} />)}
                      {extraKeys.map(k => <ROCell key={k} fieldKey={k} label={k} />)}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ── EDIT FORM ── */}
            {metaEditMode && (
              <div>
                {schema.some(f => f.restricted || lockedFields.includes(f.key) || ['project','project_station_unit','usi','usi_kks_code'].includes(f.key)) && (
                  <div style={{ background: '#FAEEDA', border: '1px solid #EF9F27', borderRadius: 8,
                    padding: '8px 14px', marginBottom: 16, fontSize: 12, color: '#854F0B' }}>
                    🔒 Fields marked <strong>Restricted</strong> are locked and cannot be edited. <strong>Project</strong> and <strong>USI</strong> are permanently locked as they form part of the document number — only a System Admin can reassign them.
                  </div>
                )}

                {/* Core document fields */}
                {/* Document Metadata fields — use schema if available, else fall back to custom_metadata keys */}
                {(() => {
                  const effectiveFields = schema.length > 0
                    ? schema
                    : Object.keys(editForm.custom_metadata || {}).map(k => ({ key: k, label: k, type: 'text', required: false }))
                  if (!effectiveFields.length) return (
                    <div style={{ color: '#9ca3af', fontSize: 13, padding: '12px 0' }}>
                      No metadata fields defined for this document type.
                    </div>
                  )
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                      {effectiveFields.map(field => {
                        const DOC_NUMBER_FIELDS = ['project', 'project_station_unit', 'usi', 'usi_kks_code']
                        const locked = lockedFields.includes(field.key) || !!field.restricted || DOC_NUMBER_FIELDS.includes(field.key)
                        const val = editForm.custom_metadata?.[field.key] ?? ''
                        const setVal = v => setEditForm(f => ({ ...f, custom_metadata: { ...f.custom_metadata, [field.key]: v } }))
                        return (
                          <div key={field.key} style={{ gridColumn: field.type === 'textarea' ? '1/-1' : undefined }}>
                            <MetaField field={field} val={val} setVal={setVal} locked={locked} />
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}

                {/* Validation / save error */}
                {metaError && (
                  <div style={{
                    background: '#FCEBEB', border: '1px solid #E24B4A',
                    borderRadius: 8, padding: '10px 14px', marginBottom: 12,
                    fontSize: 13, color: '#A32D2D', display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span>⚠</span> {metaError}
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <Btn label={metaSaving ? 'Saving…' : 'Save Changes'} variant="success"
                    disabled={metaSaving} onClick={handleSaveMeta} />
                  <Btn label="Cancel" onClick={() => { setMetaEditMode(false); setMetaError('') }} />
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Files ────────────────────────────────────────────────────────────── */}
      {tab === 'files' && (
        <div>
          {/* Inline upload zone — shown when doc is in preparation */}
          {canUploadFile && (
            <div style={{
              border: '2px dashed #1D9E75', borderRadius: 10,
              padding: '20px 24px', marginBottom: 16,
              background: uploadFiles.length ? '#E1F5EE' : '#f8fffe',
              transition: 'background 0.2s',
            }}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.background='#E1F5EE' }}
            onDragLeave={e => { e.currentTarget.style.background = uploadFiles.length ? '#E1F5EE' : '#f8fffe' }}
            onDrop={e => {
              e.preventDefault()
              const dropped = Array.from(e.dataTransfer.files)
              setUploadFiles(p => [...p, ...dropped])
              e.currentTarget.style.background = '#E1F5EE'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0F6E56', marginBottom: 4 }}>
                    Upload files for this document
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    Drag & drop files here, or click Browse. PDF, DOCX, XLSX, DWG, DXF, TIFF accepted.
                    {' '}Files can be uploaded while document is in Draft or Created status.
                  </div>
                  {uploadFiles.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      {uploadFiles.map((f, i) => (
                        <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                          background: '#fff', border: '1px solid #1D9E75', borderRadius: 99,
                          padding: '3px 10px', marginRight: 6, marginTop: 4, fontSize: 12 }}>
                          <span style={{ color: '#0F6E56', fontWeight: 500 }}>{f.name}</span>
                          <button onClick={() => setUploadFiles(p => p.filter((_,j)=>j!==i))}
                            style={{ background:'none',border:'none',cursor:'pointer',
                              color:'#A32D2D',fontSize:14,lineHeight:1,padding:0 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <label style={{ cursor: 'pointer' }}>
                    <div style={{ padding: '7px 16px', borderRadius: 7,
                      border: '1px solid #1D9E75', background: '#fff',
                      color: '#0F6E56', fontWeight: 600, fontSize: 13 }}>
                      Browse…
                    </div>
                    <input type="file" multiple style={{ display: 'none' }}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.tiff,.tif,.jpeg,.jpg,.png,.zip"
                      onChange={e => setUploadFiles(p => [...p, ...Array.from(e.target.files)])} />
                  </label>
                  {uploadFiles.length > 0 && (
                    <button
                      onClick={handleUploadFiles}
                      disabled={uploading}
                      style={{ padding: '7px 20px', borderRadius: 7, border: 'none',
                        background: uploading ? '#9ca3af' : '#0F6E56', color: '#fff',
                        fontWeight: 600, fontSize: 13, cursor: uploading ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit' }}>
                      {uploading ? 'Uploading…' : `Upload ${uploadFiles.length} file${uploadFiles.length > 1 ? 's' : ''}`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {doc.files?.length === 0 ? <Empty message="No files attached." /> : doc.files?.map(f => {
            // eslint-disable-next-line eqeqeq
            const fStats = fileAccessStats?.by_file?.find(s => s.file_id == f.id)
            return (
            <div key={f.id} style={{
              background: '#fff', border: '1px solid #e5e7eb',
              borderRadius: 8, marginBottom: 8, overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                <div style={{
                  width: 40, height: 40, background: '#E6F1FB', borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#185FA5',
                }}>{f.file_format || 'FILE'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{f.filename}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                    <span>{f.file_format} · {f.file_size ? `${(f.file_size / 1024).toFixed(0)} KB` : '—'} · Uploaded {fmtDate(f.uploaded_at)}</span>
                    <span style={{ color: '#185FA5' }}>
                      👁 {fStats?.view_count ?? 0} view{(fStats?.view_count ?? 0) !== 1 ? 's' : ''} · ⬇ {fStats?.download_count ?? 0} download{(fStats?.download_count ?? 0) !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setViewingFile(f)}
                  title="Preview this file directly in the browser without downloading it."
                  style={{ padding: '5px 12px', borderRadius: 7,
                    border: '1px solid #185FA5', background: '#E6F1FB',
                    color: '#0C447C', cursor: 'pointer', fontSize: 12,
                    fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  👁 View
                </button>
                <Btn label="Download" size="sm" icon="⬇" onClick={() => handleDownload(f.id, f.filename)}
                  title="Download this file to your computer." />
                {canUploadFile && (
                  <button
                    onClick={() => handleDeleteFile(f.id, f.filename)}
                    title="Permanently remove this file from the document. This action cannot be undone."
                    style={{
                      padding: '5px 10px', borderRadius: 7,
                      border: '1px solid #fca5a5', background: '#fff',
                      color: '#A32D2D', cursor: 'pointer', fontSize: 12,
                      fontWeight: 600, fontFamily: 'inherit',
                    }}>
                    🗑 Delete
                  </button>
                )}
              </div>
              {fStats && (fStats.view_count > 0 || fStats.download_count > 0) && (
                <div style={{ borderTop: '1px solid #f3f4f6', padding: '8px 16px', background: '#fafbfc', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  {fStats.viewers.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Viewed by</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {fStats.viewers.map(v => (
                          <span key={v.id} style={{ fontSize: 11, background: '#E6F1FB', color: '#0C447C', borderRadius: 99, padding: '2px 8px' }}>
                            {v.name} ×{v.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {fStats.downloaders.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Downloaded by</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {fStats.downloaders.map(v => (
                          <span key={v.id} style={{ fontSize: 11, background: '#E1F5EE', color: '#0F6E56', borderRadius: 99, padding: '2px 8px' }}>
                            {v.name} ×{v.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}

      {/* ── Versions ─────────────────────────────────────────────────────────── */}
      {tab === 'versions' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            {canEdit && <Btn label="Upload New Version" variant="primary" size="sm" onClick={() => setShowVersionModal(true)}
            title="Upload a revised file to create a new version entry in the version history." />}
          </div>
          {doc.versions?.length === 0 ? <Empty message="No version history." /> : [...doc.versions].reverse().map(v => (
            <div key={v.id} style={{
              display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid #f3f4f6',
            }}>
              <div style={{
                width: 48, height: 48, background: v.is_major ? '#E6F1FB' : '#f9fafb',
                borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: v.is_major ? '#185FA5' : '#6b7280', flexShrink: 0,
              }}>v{v.version_number}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>Version {v.version_number}</span>
                  {v.is_major && <Badge label="Major" />}
                  {v.change_label && <Badge label={v.change_label} />}
                </div>
                <div style={{ fontSize: 13, color: '#374151', marginTop: 2 }}>{v.change_reason}</div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                  By {v.created_by?.name || 'Unknown'} · {fmtDateTime(v.created_at)}
                </div>
              </div>
              <div style={{ flexShrink: 0 }}>
                <Btn label="Share Link" size="sm" onClick={() => handleShare(v.version_number)}
                  title={`Generate a shareable link pinned to version ${v.version_number} of this document.`} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Workflow ─────────────────────────────────────────────────────────── */}
      {tab === 'workflow' && (
        <div>
          {!wf ? <Empty message="No workflow started." /> : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
                {[
                  ['Stage', wf.stage],
                  ['Status', wf.completed ? 'Completed' : 'Active'],
                  ['Started', fmtDate(wf.started_at)],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{k}</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{v}</div>
                  </div>
                ))}
              </div>

              {wf.levels?.length > 0 && (
                <>
                  <SectionHead title="Approval Levels" />
                  {wf.levels.map(lv => (
                    <div key={lv.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
                      {/* Level header */}
                      <div style={{ background: '#f8fafc', padding: '10px 14px',
                        display: 'flex', alignItems: 'center', gap: 10,
                        borderBottom: '1px solid #e5e7eb' }}>
                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#0C447C',
                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{lv.step}</div>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{lv.name}</span>
                          <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>{lv.stage}</span>
                        </div>
                        <Badge label={lv.status} />
                        {/* Checklist template download */}
                        {lv.checklist_required === true && lv.checklist_template_name && (
                          <button
                            onClick={() => handleDownloadTemplate(lv.id, lv.checklist_template_name)}
                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6,
                              border: '1px solid #BA7517', background: '#FAEEDA',
                              color: '#854F0B', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            ⬇ Download Template
                          </button>
                        )}
                        {lv.checklist_required === true && !lv.checklist_template_name && (
                          <span style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>
                            No template uploaded
                          </span>
                        )}
                      </div>

                      {/* Tasks per level */}
                      <div style={{ padding: '8px 14px' }}>
                        {wf.tasks?.filter(t => t.step === lv.step).map(t => (
                          <div key={t.id} style={{ padding: '10px 0',
                            borderBottom: '1px solid #f9fafb',
                            display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                            {/* User avatar */}
                            <div style={{ width: 32, height: 32, borderRadius: '50%',
                              background: '#E6F1FB', color: '#185FA5',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                              {(t.assignee?.name || 'U').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <span style={{ fontWeight: 500, fontSize: 13 }}>{t.assignee?.name || 'Unknown'}</span>
                                  {t.completed_at && (
                                    <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>
                                      {fmtDateTime(t.completed_at)}
                                    </span>
                                  )}
                                </div>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                  {t.checklist_file_name && (
                                    <button
                                      onClick={() => handleDownloadCompleted(t.id, t.checklist_file_name)}
                                      style={{ fontSize: 11, padding: '3px 9px', borderRadius: 5,
                                        border: '1px solid #1D9E75', background: '#E1F5EE',
                                        color: '#0F6E56', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                      ⬇ Completed Checklist
                                    </button>
                                  )}
                                  <Badge label={t.status} />
                                </div>
                              </div>

                              {/* Checklist upload for pending tasks */}
                              {lv.checklist_required === true && lv.checklist_template_name && t.status === 'Pending' && (
                                <div style={{ marginTop: 8, padding: '8px 12px',
                                  background: t.checklist_done ? '#E1F5EE' : '#FFF9EC',
                                  border: `1px solid ${t.checklist_done ? '#1D9E75' : '#BA7517'}44`,
                                  borderRadius: 7 }}>
                                  {t.checklist_done ? (
                                    <div style={{ fontSize: 12, color: '#0F6E56', fontWeight: 500 }}>
                                      ✓ Checklist submitted — {t.checklist_file_name}
                                    </div>
                                  ) : (
                                    <>
                                      <div style={{ fontSize: 11, color: '#854F0B', marginBottom: 6 }}>
                                        Checklist required before approving. Download the template above, fill it, then upload here.
                                      </div>
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <label style={{ cursor: 'pointer' }}>
                                          <div style={{ fontSize: 11, padding: '5px 12px',
                                            background: '#fff', border: '1px solid #BA7517',
                                            borderRadius: 6, color: '#854F0B', fontWeight: 500 }}>
                                            {checklistFiles[t.id] ? `✓ ${checklistFiles[t.id].name}` : 'Choose completed checklist…'}
                                          </div>
                                          <input type="file" style={{ display: 'none' }}
                                            accept=".pdf,.doc,.docx,.xls,.xlsx"
                                            onChange={e => {
                                              if (e.target.files[0])
                                                setChecklistFiles(p => ({ ...p, [t.id]: e.target.files[0] }))
                                            }} />
                                        </label>
                                        {checklistFiles[t.id] && (
                                          <button
                                            onClick={() => handleSubmitChecklist(t.id)}
                                            disabled={checklistUploading[t.id]}
                                            style={{ fontSize: 11, padding: '5px 14px',
                                              background: checklistUploading[t.id] ? '#9ca3af' : '#0C447C',
                                              color: '#fff', border: 'none', borderRadius: 6,
                                              cursor: checklistUploading[t.id] ? 'not-allowed' : 'pointer',
                                              fontWeight: 600 }}>
                                            {checklistUploading[t.id] ? 'Uploading…' : 'Submit Checklist'}
                                          </button>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}

                              {t.action_note && (
                                <div style={{ fontSize: 12, color: '#374151', marginTop: 6,
                                  background: '#f9fafb', padding: '4px 8px', borderRadius: 4 }}>
                                  Note: {t.action_note}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* My action panel — only shown if current user has a pending task */}
              {canWfAction && myPendingTask && (
                <div style={{ marginTop: 20, padding: '16px', background: '#E6F1FB',
                  border: '2px solid #185FA5', borderRadius: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0C447C', marginBottom: 12 }}>
                    Your Approval Required — Step {myPendingTask.step}
                  </div>

                  {/* Checklist gate warning */}
                  {myPendingTask.level?.checklist_required === true && myPendingTask.level?.checklist_template_name && !myPendingTask.checklist_done && (
                    <div style={{ background: '#FAEEDA', border: '1px solid #BA7517',
                      borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#854F0B' }}>
                      ⚠ You must submit the completed checklist before approving.
                      Download the template from the level above, fill it, and upload it.
                    </div>
                  )}

                  <textarea value={wfNote} onChange={e => setWfNote(e.target.value)}
                    placeholder="Add a note or comment (optional)…"
                    rows={2} style={{ width: '100%', boxSizing: 'border-box',
                      marginBottom: 12, fontFamily: 'inherit', fontSize: 13,
                      resize: 'vertical', borderRadius: 7 }} />

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      disabled={myPendingTask.level?.checklist_required === true && !!myPendingTask.level?.checklist_template_name && !myPendingTask.checklist_done}
                      onClick={() => setWfAction('advance')}
                      title={
                        myPendingTask.level?.checklist_required === true && !!myPendingTask.level?.checklist_template_name && !myPendingTask.checklist_done
                          ? 'You must submit the completed checklist before you can approve.'
                          : 'Approve this document at your assigned level. Requires your login password as a digital signature. If all assignees at this step approve, the document advances to the next stage.'
                      }
                      style={{
                        padding: '9px 20px', borderRadius: 8, border: 'none',
                        background: (myPendingTask.level?.checklist_required === true && !!myPendingTask.level?.checklist_template_name && !myPendingTask.checklist_done)
                          ? '#9ca3af' : '#0F6E56',
                        color: '#fff', cursor: (myPendingTask.level?.checklist_required === true && !!myPendingTask.level?.checklist_template_name && !myPendingTask.checklist_done)
                          ? 'not-allowed' : 'pointer',
                        fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
                      }}>
                      ✅ Approve
                    </button>
                    <button onClick={() => setWfAction('reject')}
                      title="Reject the document. It will be returned to Draft status and the workflow will be reset. The author must make corrections and re-submit."
                      style={{ padding: '9px 20px', borderRadius: 8, border: 'none',
                        background: '#A32D2D', color: '#fff', cursor: 'pointer',
                        fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>
                      ❌ Reject
                    </button>
                    <button onClick={() => setWfAction('return')}
                      title="Return the document for correction without a hard rejection. The workflow resets to Draft status so the initiator can reconfigure approvers and re-initiate."
                      style={{ padding: '9px 20px', borderRadius: 8,
                        border: '1px solid #e5e7eb', background: '#fff',
                        color: '#374151', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                      ↩ Return for Correction
                    </button>
                  </div>
                </div>
              )}

              {/* Waiting message — in workflow but not current user's turn */}
              {inWorkflow && !canWfAction && wf && !wf.completed && (
                <div style={{ marginTop: 16, padding: '12px 16px', background: '#f8fafc',
                  border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, color: '#6b7280' }}>
                  Waiting for approvers at step {wf.current_step} to complete their review.
                </div>
              )}

              {/* ── Admin Workflow Recovery ── */}
              {['System Admin', 'Sub Admin'].includes(user?.role) && wf && !wf.completed && (
                <AdminWorkflowRecovery
                  docId={id} wf={wf} users={users}
                  onDone={() => refresh()}
                />
              )}

              {/* ── Admin Reassign Doc Number ── */}
              {user?.role === 'System Admin' && (
                <AdminReassignDocNumber doc={doc} onDone={() => refresh()} />
              )}
            </>
          )}

          {/* Admin Fix Status — shown even when no workflow (orphaned status) */}
          {user?.can_delete && !wf && inWorkflow && (
            <div style={{ marginTop: 20, padding: 16, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#9a3412', marginBottom: 8 }}>⚠ Orphaned Status</div>
              <div style={{ fontSize: 12, color: '#7c2d12', marginBottom: 12 }}>
                Document status is "{doc.status}" but no workflow instance exists. Click below to fix.
              </div>
              <button
                onClick={async () => { await workflowAPI.adminFixStatus(id); refresh() }}
                style={{ padding: '7px 16px', background: '#ea580c', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >Fix Status</button>
            </div>
          )}
        </div>
      )}

      {/* ── Audit Log ────────────────────────────────────────────────────────── */}
      {tab === 'audit' && (
        <div>
          {doc.audit_logs?.length === 0 ? <Empty message="No audit entries." /> : (() => {
            // Flatten: one row per changed field, or one row per event if no fields
            const rows = []
            ;[...doc.audit_logs].reverse().forEach(e => {
              const hasFields = e.old_value && Object.keys(e.old_value).length > 0
              if (hasFields) {
                Object.entries(e.old_value).forEach(([field, oldVal]) => {
                  rows.push({ id: `${e.id}-${field}`, timestamp: e.timestamp, user: e.user, action: e.action, note: e.note, field, oldVal, newVal: e.new_value?.[field] })
                })
              } else {
                rows.push({ id: e.id, timestamp: e.timestamp, user: e.user, action: e.action, note: e.note, field: null, oldVal: null, newVal: null })
              }
            })

            const thStyle = { padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#6b7280', textAlign: 'left', letterSpacing: '.06em', textTransform: 'uppercase', background: '#f8fafc', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' }
            const tdStyle = { padding: '10px 14px', fontSize: 12, color: '#374151', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' }

            return (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Timestamp</th>
                      <th style={thStyle}>User</th>
                      <th style={thStyle}>Field</th>
                      <th style={{ ...thStyle, width: '20%' }}>Old</th>
                      <th style={{ ...thStyle, width: '20%' }}>New</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={row.id} style={{ background: i % 2 === 0 ? '#fff' : '#fafbfc' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'}
                        onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafbfc'}
                      >
                        {/* TIMESTAMP */}
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 500, color: '#374151' }}>
                            {row.timestamp ? new Date(row.timestamp).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'}
                          </div>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                            {row.timestamp ? new Date(row.timestamp).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : ''}
                          </div>
                        </td>

                        {/* USER */}
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#e0eaf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#0C447C', flexShrink: 0 }}>
                              {(row.user?.name || 'S').charAt(0).toUpperCase()}
                            </div>
                            <span style={{ fontWeight: 500 }}>{row.user?.name || 'System'}</span>
                          </div>
                        </td>

                        {/* FIELD */}
                        <td style={tdStyle}>
                          {row.field ? (
                            <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 6, background: '#1e293b', color: '#fff', fontSize: 11, fontWeight: 600 }}>{row.field}</span>
                          ) : (
                            <div>
                              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 6, background: '#e0eaf8', color: '#0C447C', fontSize: 11, fontWeight: 600 }}>{row.action}</span>
                              {row.note && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>{row.note}</div>}
                            </div>
                          )}
                        </td>

                        {/* OLD */}
                        <td style={tdStyle}>
                          {row.field && (
                            row.oldVal != null && row.oldVal !== ''
                              ? <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 10px', color: '#991b1b', fontSize: 12, display: 'inline-block', maxWidth: 200, wordBreak: 'break-word' }}>{row.oldVal}</div>
                              : <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', color: '#9ca3af', fontSize: 11, fontStyle: 'italic', display: 'inline-block' }}>—</div>
                          )}
                        </td>

                        {/* NEW */}
                        <td style={tdStyle}>
                          {row.field && (
                            row.newVal != null && row.newVal !== ''
                              ? <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '4px 10px', color: '#166534', fontSize: 12, display: 'inline-block', maxWidth: 200, wordBreak: 'break-word' }}>{row.newVal}</div>
                              : <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', color: '#9ca3af', fontSize: 11, fontStyle: 'italic', display: 'inline-block' }}>—</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── Workflow History Modal ────────────────────────────────────────────── */}
      {showWfHistory && (
        <div
          onClick={() => setShowWfHistory(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 3000,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', flexDirection: 'column',
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              margin: '32px auto', width: '90%', maxWidth: 900,
              background: '#fff', borderRadius: 12, overflow: 'hidden',
              display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 64px)',
            }}>
            {/* Modal header */}
            <div style={{
              background: '#0C447C', color: '#fff',
              padding: '14px 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Workflow History — {doc.doc_number}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
                  {doc.workflow_history.length} completed cycle{doc.workflow_history.length !== 1 ? 's' : ''}
                </div>
              </div>
              <button onClick={() => setShowWfHistory(false)}
                style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
                  fontSize: 20, cursor: 'pointer', width: 34, height: 34, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            {/* Scrollable body */}
            <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>
              {[...doc.workflow_history].reverse().map((snap, si) => (
                <div key={snap.id} style={{
                  border: `1px solid ${snap.outcome === 'rejected' ? '#fca5a5' : '#86efac'}`,
                  borderRadius: 10, marginBottom: 20, overflow: 'hidden',
                }}>
                  {/* Cycle header */}
                  <div style={{
                    background: snap.outcome === 'rejected' ? '#FCEBEB' : '#E1F5EE',
                    padding: '10px 16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        fontWeight: 700, fontSize: 13,
                        color: snap.outcome === 'rejected' ? '#A32D2D' : '#0F6E56',
                      }}>
                        {snap.outcome === 'rejected' ? '✕ Rejected' : '✓ Released'} — Cycle #{doc.workflow_history.length - si}
                      </span>
                      {snap.rejected_at_stage && (
                        <span style={{ fontSize: 11, background: '#fca5a5', color: '#7f1d1d',
                          borderRadius: 99, padding: '1px 8px' }}>
                          at {snap.rejected_at_stage}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', textAlign: 'right' }}>
                      <div>{snap.mode || 'Auto Populate'}</div>
                      <div>Started: {fmtDate(snap.initiated_at)} · Ended: {fmtDate(snap.snapshot_at)}</div>
                    </div>
                  </div>

                  {snap.rejection_note && (
                    <div style={{ padding: '8px 16px', background: '#fff7f7', fontSize: 12,
                      borderBottom: '1px solid #fca5a5', color: '#7f1d1d' }}>
                      Rejection reason: {snap.rejection_note}
                    </div>
                  )}

                  <div style={{ padding: '12px 16px', background: '#fff' }}>
                    {(snap.snapshot?.levels || []).map(lv => (
                      <div key={lv.step} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <div style={{
                            background: lv.status === 'Done' ? '#E1F5EE' : lv.status === 'In Progress' ? '#E6F1FB' : '#f3f4f6',
                            color: lv.status === 'Done' ? '#0F6E56' : lv.status === 'In Progress' ? '#185FA5' : '#6b7280',
                            borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700,
                          }}>Step {lv.step}</div>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{lv.name}</span>
                          <span style={{ fontSize: 11, color: '#9ca3af' }}>({lv.stage})</span>
                          {lv.status === 'Done' && <span style={{ fontSize: 11, color: '#0F6E56' }}>✓ Completed</span>}
                        </div>
                        {(lv.tasks || []).map((t, ti) => (
                          <div key={ti} style={{
                            marginLeft: 16, marginBottom: 6, padding: '8px 12px',
                            background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{
                                  width: 28, height: 28, borderRadius: '50%', background: '#E6F1FB',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 11, fontWeight: 700, color: '#185FA5', flexShrink: 0,
                                }}>
                                  {(t.assignee_name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()}
                                </div>
                                <span style={{ fontWeight: 600, fontSize: 12 }}>{t.assignee_name || 'Unknown'}</span>
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 99,
                                  background: t.status === 'Approved' ? '#E1F5EE' : t.status === 'Pending' ? '#FAEEDA' : '#FCEBEB',
                                  color: t.status === 'Approved' ? '#0F6E56' : t.status === 'Pending' ? '#854F0B' : '#A32D2D',
                                }}>{t.status}</span>
                              </div>
                              {t.completed_at && (
                                <span style={{ fontSize: 10, color: '#9ca3af' }}>{fmtDateTime(t.completed_at)}</span>
                              )}
                            </div>
                            {t.action_note && (
                              <div style={{ fontSize: 11, color: '#374151', marginTop: 6,
                                paddingLeft: 36 }}>💬 {t.action_note}</div>
                            )}
                            {t.digital_sig_log && (
                              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6, paddingLeft: 36,
                                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4,
                                padding: '4px 8px', marginLeft: 36 }}>
                                ✍ Signed by {t.digital_sig_log.user} — {t.digital_sig_log.action}
                                {t.digital_sig_log.ip ? ` · IP: ${t.digital_sig_log.ip}` : ''}
                              </div>
                            )}
                            {t.checklist_file_name && (
                              <div style={{ fontSize: 11, color: '#185FA5', marginTop: 6, paddingLeft: 36 }}>
                                📎 {t.checklist_file_name}
                                {t.checklist_file_path && (
                                  <a href={`/api/workflow/${doc.id}/history-checklist/download?path=${encodeURIComponent(t.checklist_file_path)}&token=${encodeURIComponent(localStorage.getItem('dms_token') || '')}`}
                                    download={t.checklist_file_name}
                                    style={{ marginLeft: 8, fontSize: 11, color: '#0C447C', fontWeight: 600 }}>⬇ Download</a>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Feedback ─────────────────────────────────────────────────────────── */}
      {tab === 'feedback' && (
        <div>
          {/* Feedback list */}
          {doc.feedbacks?.length === 0 && <Empty message="No feedback yet." />}
          {doc.feedbacks?.map(fb => (
            <div key={fb.id} style={{ background: '#f9fafb', borderRadius: 10,
              padding: '12px 16px', marginBottom: 10, border: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                {/* Author */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ width: 30, height: 30, background: '#E6F1FB', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: '#185FA5', flexShrink: 0 }}>
                    {fb.user?.name?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() || '?'}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                      {fb.user?.name || 'User'}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>
                      {fmtDateTime(fb.created_at)}
                    </div>
                  </div>
                </div>
                {/* Tagged user badge */}
                {fb.tagged_user && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                    background: '#EDE7F6', border: '1px solid #7F77DD44',
                    borderRadius: 99, padding: '3px 10px' }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#7F77DD',
                      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 700 }}>
                      {fb.tagged_user.name?.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
                    </div>
                    <span style={{ fontSize: 11, color: '#4A148C', fontWeight: 500 }}>
                      Feedback requested from {fb.tagged_user.name}
                    </span>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{fb.comment}</div>
            </div>
          ))}

          {/* Post feedback form */}
          <div style={{ marginTop: 20, background: '#f8fafc', borderRadius: 10,
            padding: '16px', border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>
              Post Feedback / Request Review
            </div>

            {/* Tag a user to request feedback */}
            <div style={{ marginBottom: 10, position: 'relative' }}>
              <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                Request feedback from (optional) — tag a user
              </label>
              {taggedUser ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                  background: '#EDE7F6', border: '1px solid #7F77DD',
                  borderRadius: 8, padding: '7px 12px' }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#7F77DD',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700 }}>
                    {taggedUser.name?.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#4A148C', flex: 1 }}>
                    {taggedUser.name}
                    {taggedUser.department && <span style={{ color: '#9c27b0', marginLeft: 6, fontSize: 11 }}>· {taggedUser.department}</span>}
                  </span>
                  <button onClick={() => { setTaggedUser(null); setTagSearch('') }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                      color: '#7F77DD', fontSize: 16, lineHeight: 1 }}>×</button>
                </div>
              ) : (
                <div ref={tagInputWrapRef} style={{ position: 'relative' }}>
                  <input
                    value={tagSearch}
                    onChange={e => searchTagUsers(e.target.value)}
                    onBlur={() => setTimeout(() => setShowTagDrop(false), 200)}
                    placeholder="Search user by name or SAP ID…"
                    style={{ width: '100%', boxSizing: 'border-box', fontSize: 13 }}
                  />
                  {showTagDrop && tagResults.length > 0 && tagDropRect && (
                    <div style={{ position: 'fixed', top: tagDropRect.bottom + 2, left: tagDropRect.left,
                      width: tagDropRect.width,
                      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
                      zIndex: 9999, maxHeight: 200, overflowY: 'auto',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
                      {tagResults.map(u => (
                        <div key={u.id}
                          onMouseDown={() => { setTaggedUser(u); setTagSearch(''); setShowTagDrop(false) }}
                          style={{ padding: '9px 14px', cursor: 'pointer',
                            borderBottom: '1px solid #f9fafb',
                            display: 'flex', alignItems: 'center', gap: 10 }}
                          onMouseOver={e => e.currentTarget.style.background = '#f5f3ff'}
                          onMouseOut={e => e.currentTarget.style.background = '#fff'}>
                          <div style={{ width: 28, height: 28, borderRadius: '50%',
                            background: '#7F77DD', color: '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                            {u.name?.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                            <div style={{ fontSize: 11, color: '#9ca3af' }}>
                              {u.sap_username && <span style={{ marginRight: 8 }}>{u.sap_username}</span>}
                              {u.department}
                              {u.role && <span style={{ marginLeft: 6 }}>· {u.role}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Comment box */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                Comment <span style={{ color: '#A32D2D' }}>*</span>
              </label>
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder={taggedUser
                  ? `Write your feedback request to ${taggedUser.name}…`
                  : 'Add your feedback, comment, or review note…'}
                rows={3}
                style={{ width: '100%', boxSizing: 'border-box',
                  fontFamily: 'inherit', fontSize: 13, borderRadius: 7, resize: 'vertical' }}
                onKeyDown={e => e.key === 'Enter' && e.ctrlKey && handleFeedback()}
              />
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                Ctrl+Enter to post
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={handleFeedback}
                disabled={submitingFb || !feedback.trim()}
                style={{ padding: '8px 22px', borderRadius: 8, border: 'none',
                  background: submitingFb || !feedback.trim() ? '#9ca3af' : '#0C447C',
                  color: '#fff', cursor: submitingFb || !feedback.trim() ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>
                {submitingFb ? 'Posting…' : taggedUser ? `📨 Request Feedback from ${taggedUser.name.split(' ')[0]}` : '💬 Post Feedback'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── References ───────────────────────────────────────────────────────── */}
      {tab === 'references' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Btn label="Add Reference" size="sm" variant="primary" onClick={() => setShowRefModal(true)}
              title="Link another document as a cross-reference — useful for related specs, drawings, or superseded documents." />
          </div>
          {doc.references?.length === 0 ? <Empty message="No cross-references yet." /> : doc.references.map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{r.target?.doc_number} — {r.target?.title}</div>
                {r.note && <div style={{ fontSize: 12, color: '#6b7280' }}>{r.note}</div>}
              </div>
              <Btn label="View" size="sm" onClick={() => nav(`/documents/${r.target?.id}`)}
                title="Open the referenced document in a new detail view." />
            </div>
          ))}
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────────── */}

      {/* Workflow action confirm modal */}
      {wfAction && (
        <Modal
          title={
            wfAction === 'advance' ? '✅ Confirm Approval' :
            wfAction === 'return'  ? '↩ Return for Correction' :
            '❌ Reject Document'
          }
          onClose={() => { setWfAction(null); setWfPassword(''); setWfPasswordError('') }}
        >
          {/* Info message — styled as info/warning, not error */}
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13,
            background: wfAction === 'advance' ? '#E6F1FB' : wfAction === 'return' ? '#FFF9EC' : '#FCEBEB',
            border: `1px solid ${wfAction === 'advance' ? '#185FA5' : wfAction === 'return' ? '#BA7517' : '#E24B4A'}44`,
            color:   wfAction === 'advance' ? '#0C447C' : wfAction === 'return' ? '#854F0B' : '#A32D2D',
          }}>
            {wfAction === 'advance' && 'This will approve the document at your level. If all approvers at this level approve, the document advances to the next stage.'}
            {wfAction === 'reject'  && 'This will reject the document and return it to Draft. The workflow will be reset and the author can re-initiate after corrections.'}
            {wfAction === 'return'  && 'This will reset the entire workflow and return the document to Draft status. The initiator can re-initiate with correct configuration.'}
          </div>

          {/* Note / comment */}
          <label style={{ display:'block', fontSize:12, color:'#6b7280', marginBottom:4 }}>
            {wfAction === 'advance' ? 'Approval comment (optional)' : 'Reason / note'}
          </label>
          <textarea value={wfNote} onChange={e => setWfNote(e.target.value)}
            placeholder={wfAction === 'advance' ? 'Add approval comment…' : 'Add reason for this action…'}
            rows={2}
            style={{ width:'100%', boxSizing:'border-box', marginBottom:14,
              fontFamily:'inherit', fontSize:13, borderRadius:7 }} />

          {/* Password authentication — required for approve and reject */}
          {wfAction !== 'return' && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display:'block', fontSize:12, fontWeight:600,
                color:'#374151', marginBottom:4 }}>
                🔐 Authenticate with your login password
                <span style={{ color:'#A32D2D', marginLeft:4 }}>*</span>
              </label>
              <input
                type="password"
                value={wfPassword}
                onChange={e => { setWfPassword(e.target.value); setWfPasswordError('') }}
                placeholder="Enter your login password to sign this action…"
                autoComplete="current-password"
                style={{
                  width:'100%', boxSizing:'border-box',
                  borderColor: wfPasswordError ? '#E24B4A' : '#d1d5db',
                  borderRadius:7,
                }}
                onKeyDown={e => e.key === 'Enter' && wfPassword && handleWfAction(wfAction)}
              />
              {/* Inline error — NOT a browser popup */}
              {wfPasswordError && (
                <div style={{
                  marginTop:6, padding:'8px 12px', borderRadius:6,
                  background:'#FCEBEB', border:'1px solid #E24B4A44',
                  fontSize:12, color:'#A32D2D',
                  display:'flex', alignItems:'center', gap:6,
                }}>
                  <span>⚠</span> {wfPasswordError}
                </div>
              )}
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:4 }}>
                Your password is used as a digital signature and logged in the audit trail.
              </div>
            </div>
          )}

          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', paddingTop:4 }}>
            <Btn label="Cancel"
              onClick={() => { setWfAction(null); setWfPassword(''); setWfPasswordError('') }} />
            <Btn
              label={wfAction === 'advance' ? '✅ Confirm Approve' : wfAction === 'return' ? '↩ Confirm Return' : '❌ Confirm Reject'}
              variant={wfAction === 'advance' ? 'success' : wfAction === 'return' ? 'warning' : 'danger'}
              disabled={wfAction !== 'return' && !wfPassword}
              onClick={() => handleWfAction(wfAction)}
            />
          </div>
        </Modal>
      )}

      {/* Upload version modal */}
      {showVersionModal && (
        <Modal title="Upload New Version" onClose={() => setShowVersionModal(false)}>
          {/* Rule: New version only allowed after Released */}
          <div style={{ background:'#E6F1FB', border:'1px solid #185FA5',
            borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:12, color:'#0C447C' }}>
            Creating <strong>v{doc?.current_version ? (() => {
              const p=(doc.current_version||'1.0').split('.');
              return versionIsMajor ? `${parseInt(p[0])+1}.0` : `${p[0]}.${parseInt(p[1]||0)+1}`
            })() : '...'}</strong> based on the Released version v{doc?.current_version}.
            This version will start in <strong>Draft</strong> status and must go through the approval workflow before release.
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              Change Reason <span style={{ color:'#A32D2D' }}>*</span> (mandatory)
            </label>
            <input value={versionReason} onChange={e => setVersionReason(e.target.value)}
              placeholder="Describe what has changed in this revision…"
              style={{ width: '100%', boxSizing: 'border-box',
                borderColor: versionReason.trim() ? '#d1d5db' : '#fca5a5' }} />
            {!versionReason.trim() && (
              <div style={{ fontSize:11, color:'#A32D2D', marginTop:4 }}>
                Change reason is required before uploading a new version
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <input type="checkbox" id="major" checked={versionIsMajor}
              onChange={e => setVersionIsMajor(e.target.checked)} />
            <label htmlFor="major" style={{ fontSize: 13 }}>Major version (e.g. 1.0 → 2.0)</label>
          </div>
          <div style={{
            border: '2px dashed #d1d5db', borderRadius: 8, padding: 20, textAlign: 'center',
            marginBottom: 8, cursor: 'pointer', background: versionFile ? '#f0fdf4' : '#fafafa',
          }} onClick={() => document.getElementById('ver-input').click()}>
            {versionFile
              ? <div style={{ fontSize: 13, color: '#0F6E56', fontWeight: 500 }}>✅ {versionFile.name}</div>
              : <div style={{ fontSize: 13, color: '#6b7280' }}>Drop new file or click to browse <span style={{ color:'#9ca3af' }}>(optional)</span></div>
            }
            <input id="ver-input" type="file" style={{ display: 'none' }}
              onChange={e => setVersionFile(e.target.files[0])} />
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 16 }}>
            You can attach the file later from the Files tab — only the change reason is required to create the version.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn label="Cancel" onClick={() => setShowVersionModal(false)} />
            <Btn label={versionFile ? 'Upload Version' : 'Create Version'} variant="primary" disabled={!versionReason.trim()} onClick={handleUploadVersion} />
          </div>
        </Modal>
      )}

      {/* Add reference modal */}
      {showRefModal && (
        <Modal title="Add Cross-Reference" onClose={() => setShowRefModal(false)}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Target Document ID *</label>
            <input value={refDocId} onChange={e => setRefDocId(e.target.value)}
              placeholder="Enter document ID number" style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Note (optional)</label>
            <input value={refNote} onChange={e => setRefNote(e.target.value)}
              placeholder="Reason for cross-reference…" style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn label="Cancel" onClick={() => setShowRefModal(false)} />
            <Btn label="Add Reference" variant="primary" disabled={!refDocId} onClick={handleAddReference} />
          </div>
        </Modal>
      )}

      {/* Workflow Init Modal */}
      {showWfModal && (
        <WorkflowInitModal
          docId={parseInt(id)}
          docTitle={doc.title}
          docTypeId={doc.doc_type?.id}
          currentUser={user}
          editors={doc.editors || []}
          onClose={() => setShowWfModal(false)}
          onSuccess={() => { setShowWfModal(false); refresh() }}
        />
      )}

      {/* Editors Modal */}
      {showEditorsModal && (
        <Modal title="Manage Editors" onClose={() => setShowEditorsModal(false)}>
          <div style={{ fontSize:12, color:'#6b7280', marginBottom:12 }}>
            The creator and any users listed below can edit this document.
            Admins can always edit.
          </div>

          {/* Pending Access Requests Section */}
          {pendingAccessRequests.length > 0 && (
            <div style={{ marginBottom:16, padding:12, background:'#FFF9EC', border:'1px solid #BA7517',
              borderRadius:8 }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#854F0B', marginBottom:8 }}>
                🔑 Pending Edit Access Requests ({pendingAccessRequests.length})
              </div>
              {pendingAccessRequests.map(req => (
                <div key={req.id} style={{ marginBottom:8, padding:10, background:'#fff',
                  border:'1px solid #e5e7eb', borderRadius:6 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                    <div>
                      <div style={{ fontWeight:500, fontSize:13 }}>{req.requester?.name || 'User'}</div>
                      <div style={{ fontSize:11, color:'#9ca3af' }}>{req.requester?.email}</div>
                    </div>
                  </div>
                  {req.message && (
                    <div style={{ fontSize:12, color:'#374151', marginBottom:8, fontStyle:'italic' }}>
                      "{req.message}"
                    </div>
                  )}
                  <div style={{ display:'flex', gap:6 }}>
                    <button
                      onClick={() => handleDecideAccessRequest(req.id, 'approve')}
                      title="Approve this user as an editor"
                      style={{ flex:1, padding:'6px 12px', borderRadius:6, border:'none',
                        background:'#0F6E56', color:'#fff', cursor:'pointer',
                        fontSize:12, fontWeight:600, fontFamily:'inherit' }}>
                      ✅ Approve
                    </button>
                    <button
                      onClick={() => handleDecideAccessRequest(req.id, 'deny')}
                      title="Deny this access request"
                      style={{ flex:1, padding:'6px 12px', borderRadius:6,
                        border:'1px solid #e5e7eb', background:'#fff', color:'#374151',
                        cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
                      ✕ Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#6b7280', marginBottom:6 }}>
              Owner (always has access)
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px',
              background:'#f8fafc', borderRadius:8 }}>
              <span style={{ fontSize:13, fontWeight:500 }}>{doc?.creator?.name || '—'}</span>
              {doc?.creator && <span style={{ fontSize:11, color:'#9ca3af' }}>creator</span>}
            </div>
          </div>

          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#6b7280', marginBottom:6 }}>
              Editors ({editorsList.length})
            </div>
            {editorsList.length === 0 ? (
              <div style={{ fontSize:12, color:'#9ca3af', padding:'6px 10px' }}>
                No additional editors yet — only the creator and admins can edit.
              </div>
            ) : editorsList.map(u => (
              <div key={u.id} style={{ display:'flex', alignItems:'center', gap:8,
                padding:'7px 10px', background:'#fff', border:'1px solid #e5e7eb',
                borderRadius:8, marginBottom:6 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:500 }}>{u.name}</div>
                  <div style={{ fontSize:11, color:'#9ca3af' }}>{u.email}</div>
                </div>
                <button
                  onClick={() => setEditorsList(l => l.filter(x => x.id !== u.id))}
                  style={{ background:'none', border:'none', cursor:'pointer',
                    color:'#9ca3af', fontSize:16 }}
                  title="Remove">×</button>
              </div>
            ))}
          </div>

          <div style={{ marginBottom:12, position:'relative' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#6b7280', marginBottom:6 }}>
              Add an editor
            </div>
            <input
              value={editorSearch}
              onChange={e => setEditorSearch(e.target.value)}
              placeholder="Search by name, email, or SAP ID…"
              style={{ width:'100%', boxSizing:'border-box', padding:'8px 12px',
                fontSize:13, border:'1px solid #e5e7eb', borderRadius:8 }}
            />
            {editorResults.length > 0 && (
              <div style={{ marginTop:6, border:'1px solid #e5e7eb', borderRadius:8,
                maxHeight:180, overflowY:'auto', background:'#fff' }}>
                {editorResults.map(u => (
                  <div key={u.id}
                    onClick={() => {
                      setEditorsList(l => [...l, u])
                      setEditorSearch('')
                      setEditorResults([])
                    }}
                    style={{ padding:'8px 12px', cursor:'pointer',
                      borderBottom:'1px solid #f3f4f6', fontSize:13 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >
                    <div style={{ fontWeight:500 }}>{u.name}</div>
                    <div style={{ fontSize:11, color:'#9ca3af' }}>
                      {u.email}{u.department ? ` · ${u.department}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <Btn label="Cancel" onClick={() => setShowEditorsModal(false)} />
            <Btn label={savingEditors ? 'Saving…' : 'Save'}
              variant="primary" disabled={savingEditors} onClick={saveEditors} />
          </div>
        </Modal>
      )}

      {/* Edit-access request modal */}
      {showAccessRequestModal && (
        <Modal title="Request Edit Access" onClose={() => setShowAccessRequestModal(false)}>
          <div style={{ fontSize:13, color:'#6b7280', marginBottom:14 }}>
            Send a request to <strong style={{ color:'#111827' }}>{doc?.creator?.name || 'the document owner'}</strong> asking to be added as an editor on this document.
          </div>
          <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 }}>
            Optional message
          </label>
          <textarea
            value={accessRequestMsg}
            onChange={e => setAccessRequestMsg(e.target.value)}
            rows={3}
            placeholder="Why do you need edit access?"
            style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px',
              fontSize:13, border:'1px solid #d1d5db', borderRadius:8,
              fontFamily:'inherit', resize:'vertical', marginBottom:12 }}
          />
          {accessRequestSent && (
            <div style={{
              background: accessRequestSent.startsWith('Could not') ? '#FCEBEB' : '#E1F5EE',
              color: accessRequestSent.startsWith('Could not') ? '#A32D2D' : '#0F6E56',
              padding:'8px 12px', borderRadius:8, fontSize:12, marginBottom:12,
            }}>{accessRequestSent}</div>
          )}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <Btn label="Cancel" onClick={() => setShowAccessRequestModal(false)} />
            <Btn
              label={accessRequestBusy ? 'Sending…' : 'Send Request'}
              variant="primary"
              disabled={accessRequestBusy}
              onClick={submitAccessRequest}
            />
          </div>
        </Modal>
      )}

      {/* Archive Workflow Modal */}
      {showArchiveModal && (
        <WorkflowInitModal
          docId={parseInt(id)}
          docTitle={doc.title}
          docTypeId={doc.doc_type?.id}
          currentUser={user}
          editors={doc.editors || []}
          purpose="archive"
          onClose={() => setShowArchiveModal(false)}
          onSuccess={() => { setShowArchiveModal(false); refresh() }}
        />
      )}

      {/* Share link modal */}
      {showShareModal && shareLink && (
        <Modal title="Share Document Link" onClose={() => setShowShareModal(false)}>
          <div style={{ background: '#f0f7ff', borderRadius: 8, padding: '12px 14px', marginBottom: 14, fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>
            {shareLink.link}
          </div>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 14px' }}>
            Version: <strong>{shareLink.version}</strong> — {shareLink.version === 'latest' ? 'This link always points to the latest version.' : 'This link is pinned to this specific version.'}
          </p>
          {shareCopySuccess && (
            <p style={{ margin: '0 0 10px', color: '#16a34a', fontSize: 13 }}>Copied to clipboard.</p>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn label="Copy Link" variant="primary" onClick={copyShareLink} />
            <Btn label="Open Link" onClick={() => window.open(shareLink.link, '_blank')} />
            <Btn label="Close" onClick={() => setShowShareModal(false)} />
          </div>
        </Modal>
      )}
      {/* ── File Viewer ── */}
      {viewingFile && (
        <FileViewer
          file={viewingFile}
          docId={id}
          onClose={() => {
            setViewingFile(null)
            documentsAPI.fileAccessStats(id).then(r => setFileAccessStats(r.data)).catch(() => {})
          }}
        />
      )}
    </div>
  )
}
