import { useState, useEffect, useRef } from 'react'
import WorkflowInitModal from '../components/WorkflowInitModal'
import FileViewer from '../components/FileViewer'
import { useParams, useNavigate } from 'react-router-dom'
import { documentsAPI, workflowAPI, adminAPI } from '../api'
import { useAuth } from '../hooks/useAuth'
import {
  Badge, Btn, Card, Spinner, Tabs, WorkflowBar,
  SectionHead, Empty, Input, Textarea, Select, Modal
} from '../components/ui'

export default function DocumentDetail() {
  const { id } = useParams()
  const nav = useNavigate()
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
  const [refDocId, setRefDocId] = useState('')
  const [refNote, setRefNote] = useState('')
  const [versionFile, setVersionFile] = useState(null)
  const [versionReason, setVersionReason] = useState('')
  const [versionIsMajor, setVersionIsMajor] = useState(false)

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
    // First submit doc to Created status, then open workflow modal
    await workflowAPI.submit(id)
    await refresh()
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
      const r = await adminAPI.listUsers({ q })
      setTagResults((r.data || []).filter(u => u.is_active && u.id !== user?.id))
      if (tagInputWrapRef.current) setTagDropRect(tagInputWrapRef.current.getBoundingClientRect())
      setShowTagDrop(true)
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

  async function handleUploadVersion() {
    if (!versionFile || !versionReason) return
    const fd = new FormData()
    fd.append('file', versionFile)
    fd.append('change_reason', versionReason)
    fd.append('is_major', versionIsMajor)
    await documentsAPI.uploadVersion(id, fd)
    setShowVersionModal(false)
    setVersionFile(null)
    setVersionReason('')
    refresh()
  }

  async function handleShare(version) {
    const res = await documentsAPI.getShareLink(id, version)
    setShareLink(res.data)
    setShowShareModal(true)
  }

  async function handleDownload(fileId, filename) {
    const res = await documentsAPI.downloadFile(id, fileId)
    const url = URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
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
        vfd.append('file',          file)
        vfd.append('change_reason', 'File uploaded during preparation')
        vfd.append('is_major',      false)
        await documentsAPI.uploadVersion(id, vfd)

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

  const wf = doc.workflow

  // Workflow is only "active" (locking) once the document is under formal review
  const inWorkflow = ['In Check','In Review','In Approval'].includes(doc.status)
  const wfActive   = wf && !wf.completed && inWorkflow

  const LOCKED_STATUSES = ['In Check','In Review','In Approval','Approved','Released','Archived']

  // Can edit metadata in Draft or Created (preparation stage), not during formal review
  const canEdit    = !LOCKED_STATUSES.includes(doc.status)

  // Can upload files only in Draft or Created, no active workflow
  const canUploadFile = (doc.status === 'Draft' || doc.status === 'Created') && !wfActive

  // Can create new version ONLY if currently Released
  const canNewVersion = doc.status === 'Released' && !wfActive

  // Can delete document only in Draft/Created, no active workflow
  const canDelete  = (doc.status === 'Draft' || doc.status === 'Created') && !wfActive

  // Find the current user's pending task at the active step
  const myPendingTask = wf && !wf.completed
    ? (wf.tasks || []).find(t =>
        t.assignee?.id === user?.id &&
        t.status === 'Pending' &&
        t.step === wf.current_step
      )
    : null

  // Can approve/reject only if user has a pending task
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Btn label="← Back" onClick={() => nav('/documents')} title="Return to the documents list." />
        <span style={{ fontSize: 12, color: '#9ca3af' }}>{doc.doc_number}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {doc.confidential && <Badge label="Confidential" />}
          {doc.checked_out && <Badge label="Checked Out" />}
          <Badge label={doc.status} />
        </div>
      </div>

      <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700 }}>{doc.title}</h1>
      <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 13 }}>
        {doc.doc_type?.name} · {doc.project || '—'} · USI: {doc.usi_kks_code || '—'} · v{doc.current_version}
        {doc.serial_no && ` · ${doc.serial_no}`}
      </p>

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
        <div style={{ background: '#FAEEDA', border: '1px solid #EF9F27', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#854F0B' }}>
          🔒 This document is currently checked out (User ID: {doc.checked_out_by})
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
          <WorkflowBar stage={wf.stage} completed={wf.completed} />
        </Card>
      )}

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {!doc.checked_out && canEdit && (
          <Btn label="Check Out" onClick={() => handleCheckout('checkout')} icon="🔒"
            title="Lock this document to signal you are actively editing it — other users will see a 'Checked Out' warning and know not to make changes simultaneously." />
        )}
        {doc.checked_out && (
          <Btn label="Check In" onClick={() => handleCheckout('checkin')} variant="warning" icon="🔓"
            title="Release the document lock — marks your editing session as complete and makes the document available for others to work on." />
        )}
        {/* Upload File button — only in Draft/Created with no active workflow */}
        {canUploadFile && (
          <button
            onClick={() => setTab('files')}
            title="Attach one or more files to this document. Available only while the document is in Draft or Created status and no approval workflow is active."
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 8,
              background: '#0F6E56', color: '#fff', border: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            }}>
            ⬆ Upload File
          </button>
        )}

        {doc.status === 'Draft' && (
          <Btn label="Submit for Workflow" onClick={handleSubmitWorkflow} variant="primary" icon="🚀"
            title="Mark this document as ready and submit it for the formal Check → Review → Approve workflow. The document status will change from Draft to Created." />
        )}
        {doc.status === 'Created' && (
          <Btn label="Initiate Workflow" onClick={() => setShowWfModal(true)} variant="primary" icon="⚙"
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
        ) : doc.status !== 'Draft' && doc.status !== 'Created' && (
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
      </div>

      {/* Tabs */}
      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* ── Metadata ─────────────────────────────────────────────────────────── */}
      {tab === 'metadata' && (() => {
        const schema = Array.isArray(doc.doc_type?.metadata_schema) ? doc.doc_type.metadata_schema : []
        const inPrep = doc.status === 'Draft' || doc.status === 'Created'

        // ── helper: render one custom field as an input ──────────────────────
        function MetaInput({ field }) {
          const locked  = lockedFields.includes(field.key) || !!field.restricted
          const val     = editForm.custom_metadata?.[field.key] ?? ''
          const setVal  = v => setEditForm(f => ({ ...f, custom_metadata: { ...f.custom_metadata, [field.key]: v } }))
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
          // text / user / default
          return (
            <div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>{field.label}{field.required && <span style={{ color: '#A32D2D' }}> *</span>}</div>
              <input value={val} onChange={e => setVal(e.target.value)} style={baseInp} />
            </div>
          )
        }

        const cellCM = { background: '#f0f7ff', borderRadius: 8, padding: '10px 14px', border: '1px solid #bfdbfe' }
        const lblCM  = { fontSize: 11, color: '#185FA5', marginBottom: 2 }

        return (
          <div>

            {/* ── READ-ONLY view ── */}
            {!metaEditMode && (
              <div>
                {/* Pencil button — only during preparation stage */}
                {inPrep && (
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
                      ? (() => { try { return new Date(raw).toLocaleDateString('en-IN') } catch { return raw } })()
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
                {schema.some(f => f.restricted || lockedFields.includes(f.key)) && (
                  <div style={{ background: '#FAEEDA', border: '1px solid #EF9F27', borderRadius: 8,
                    padding: '8px 14px', marginBottom: 16, fontSize: 12, color: '#854F0B' }}>
                    🔒 Fields marked <strong>Restricted</strong> are locked by administrator settings and cannot be edited during preparation.
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
                      {effectiveFields.map(field => (
                        <div key={field.key} style={{ gridColumn: field.type === 'textarea' ? '1/-1' : undefined }}>
                          <MetaInput field={field} />
                        </div>
                      ))}
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

          {doc.files?.length === 0 ? <Empty message="No files attached." /> : doc.files?.map(f => (
            <div key={f.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', background: '#fff', border: '1px solid #e5e7eb',
              borderRadius: 8, marginBottom: 8,
            }}>
              <div style={{
                width: 40, height: 40, background: '#E6F1FB', borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: '#185FA5',
              }}>{f.file_format || 'FILE'}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{f.filename}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  {f.file_format} · {f.file_size ? `${(f.file_size / 1024).toFixed(0)} KB` : '—'} · Uploaded {new Date(f.uploaded_at).toLocaleDateString('en-IN')}
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
          ))}
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
                  By {v.created_by?.name || 'Unknown'} · {new Date(v.created_at).toLocaleString('en-IN')}
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
                  ['Started', new Date(wf.started_at).toLocaleDateString('en-IN')],
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
                                      {new Date(t.completed_at).toLocaleString('en-IN')}
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
                      title="Return the document for correction without a hard rejection. The workflow resets to Created status so the initiator can reconfigure approvers and re-submit."
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
            </>
          )}
        </div>
      )}

      {/* ── Audit Log ────────────────────────────────────────────────────────── */}
      {tab === 'audit' && (
        <div>
          {doc.audit_logs?.length === 0 ? <Empty message="No audit entries." /> : (
            <div style={{ position: 'relative' }}>
              {[...doc.audit_logs].reverse().map((e, i) => (
                <div key={e.id} style={{ display: 'flex', gap: 14, paddingBottom: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ width: 10, height: 10, background: '#185FA5', borderRadius: '50%', marginTop: 4 }} />
                    {i < doc.audit_logs.length - 1 && <div style={{ width: 2, flex: 1, background: '#e5e7eb', marginTop: 4 }} />}
                  </div>
                  <div style={{ paddingBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{e.action}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>by {e.user?.name || 'System'}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{new Date(e.timestamp).toLocaleString('en-IN')}</div>
                    {e.note && <div style={{ fontSize: 12, color: '#374151', marginTop: 2, background: '#f9fafb', padding: '4px 8px', borderRadius: 4 }}>{e.note}</div>}
                    {e.old_value && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                      Changed: {JSON.stringify(e.old_value)} → {JSON.stringify(e.new_value)}
                    </div>}
                  </div>
                </div>
              ))}
            </div>
          )}
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
                      {new Date(fb.created_at).toLocaleString('en-IN')}
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
            {wfAction === 'return'  && 'This will reset the entire workflow and return the document to Created status. The initiator can re-initiate with correct configuration.'}
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
            marginBottom: 16, cursor: 'pointer', background: versionFile ? '#f0fdf4' : '#fafafa',
          }} onClick={() => document.getElementById('ver-input').click()}>
            {versionFile
              ? <div style={{ fontSize: 13, color: '#0F6E56', fontWeight: 500 }}>✅ {versionFile.name}</div>
              : <div style={{ fontSize: 13, color: '#6b7280' }}>Drop new file or click to browse</div>
            }
            <input id="ver-input" type="file" style={{ display: 'none' }}
              onChange={e => setVersionFile(e.target.files[0])} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn label="Cancel" onClick={() => setShowVersionModal(false)} />
            <Btn label="Upload Version" variant="primary" disabled={!versionFile || !versionReason} onClick={handleUploadVersion} />
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
          onClose={() => setShowWfModal(false)}
          onSuccess={() => { setShowWfModal(false); refresh() }}
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
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn label="Copy Link" variant="primary" onClick={() => { navigator.clipboard.writeText(shareLink.link); }} />
            <Btn label="Close" onClick={() => setShowShareModal(false)} />
          </div>
        </Modal>
      )}
      {/* ── File Viewer ── */}
      {viewingFile && (
        <FileViewer
          file={viewingFile}
          docId={id}
          onClose={() => setViewingFile(null)}
        />
      )}
    </div>
  )
}
