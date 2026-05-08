import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { libraryAPI, adminAPI } from '../api'
import UploadModal from '../components/UploadModal'
import { fmtDate } from '../utils/dates'

/* ─── Palette ─────────────────────────────────────────────── */
const BLUE   = '#0C447C'
const BG     = '#f0f4f8'
const WHITE  = '#fff'
const BORDER = '#e2e8f0'

/* ─── Tiny helpers ────────────────────────────────────────── */
function Badge({ label, color = '#64748b' }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: color + '18', color, border: `1px solid ${color}40`,
      textTransform: 'uppercase', letterSpacing: '.04em',
    }}>{label}</span>
  )
}

const STATUS_COLOR = {
  Draft: '#f59e0b', 'In Check': '#8b5cf6',
  'In Review': '#8b5cf6', 'In Approval': '#6366f1',
  Approved: '#10b981', Released: '#059669', Rejected: '#ef4444',
  Archived: '#94a3b8', Expired: '#dc2626',
}

const GROUP_OPTIONS = [
  { value: 'none',    label: 'No Grouping' },
  { value: 'status',  label: 'Status' },
  { value: 'creator', label: 'Creator' },
  { value: 'project', label: 'Project' },
  { value: 'date',    label: 'Month / Year' },
]

const SORT_OPTIONS = [
  { value: 'created_desc', label: 'Newest first' },
  { value: 'created_asc',  label: 'Oldest first' },
  { value: 'updated_desc', label: 'Recently updated' },
  { value: 'title_asc',    label: 'Title (A → Z)' },
  { value: 'title_desc',   label: 'Title (Z → A)' },
  { value: 'status',       label: 'Status' },
  { value: 'doc_number',   label: 'Doc Number' },
]

function sortDocs(docs, sortBy) {
  const copy = [...docs]
  switch (sortBy) {
    case 'created_asc':
      return copy.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    case 'updated_desc':
      return copy.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    case 'title_asc':
      return copy.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    case 'title_desc':
      return copy.sort((a, b) => (b.title || '').localeCompare(a.title || ''))
    case 'status':
      return copy.sort((a, b) => (a.status || '').localeCompare(b.status || ''))
    case 'doc_number':
      return copy.sort((a, b) => (a.doc_number || '').localeCompare(b.doc_number || ''))
    case 'created_desc':
    default:
      return copy.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  }
}

function getGroupKey(doc, groupBy) {
  if (groupBy === 'status')  return doc.status || 'Unknown'
  if (groupBy === 'creator') return doc.creator?.name || 'Unknown'
  if (groupBy === 'project') return doc.project || 'No Project'
  if (groupBy === 'date') {
    if (!doc.created_at) return 'Unknown Date'
    const d = new Date(doc.created_at)
    if (isNaN(d.getTime())) return 'Unknown Date'
    return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' })
  }
  return 'all'
}

function groupDocs(docs, groupBy) {
  if (groupBy === 'none') return [{ key: 'all', docs }]
  const map = {}
  for (const doc of docs) {
    const key = getGroupKey(doc, groupBy)
    if (!map[key]) map[key] = []
    map[key].push(doc)
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, docs]) => ({ key, docs }))
}

/* ─── Folder Tree Node ────────────────────────────────────── */
function FolderNode({ node, depth, selectedId, onSelect, onAddChild, onDelete, onMove, onTogglePublish, canEdit, isAdmin }) {
  const [open, setOpen] = useState(depth === 0)
  const hasChildren = (node.children || []).length > 0
  const isSelected = selectedId === node.id
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div>
      <div
        style={{
          display:'flex', alignItems:'center', gap:4,
          padding:`6px 8px 6px ${14 + depth * 18}px`,
          background: isSelected ? '#e0eaf8' : 'transparent',
          borderRadius:7, cursor:'pointer', position:'relative',
          borderLeft: isSelected ? `3px solid ${BLUE}` : '3px solid transparent',
        }}
        onClick={() => onSelect(node)}
      >
        <span
          onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
          style={{ fontSize:10, color:'#94a3b8', width:14, textAlign:'center', flexShrink:0, userSelect:'none' }}
        >
          {hasChildren ? (open ? '▼' : '▶') : ''}
        </span>
        <span style={{ fontSize:16, flexShrink:0 }}>{open && hasChildren ? '📂' : '📁'}</span>
        <span style={{ fontSize:13, fontWeight: isSelected ? 600 : 400, color: isSelected ? BLUE : '#1e293b', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {node.name}
        </span>
        {node.is_template && (
          <span title="Shared template — visible to everyone"
            style={{ fontSize:9, color:'#a16207', background:'#fef3c7', borderRadius:99, padding:'1px 7px', fontWeight:600, flexShrink:0 }}>
            TEMPLATE
          </span>
        )}
        {canEdit(node) && (
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(m => !m) }}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'#94a3b8', padding:'0 2px', borderRadius:4, flexShrink:0 }}
          >⋮</button>
        )}

        {menuOpen && (
          <>
            <div onClick={() => setMenuOpen(false)} style={{ position:'fixed', inset:0, zIndex:100 }} />
            <div style={{ position:'absolute', right:8, top:28, background:WHITE, border:`1px solid ${BORDER}`, borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,0.12)', zIndex:101, minWidth:160, overflow:'hidden' }}>
              {[
                { icon:'📁', label:'New Sub-folder', action: () => { setMenuOpen(false); onAddChild(node) } },
                { icon:'➡', label:'Move…',           action: () => { setMenuOpen(false); onMove(node) } },
                ...(isAdmin ? [
                  node.is_template
                    ? { icon:'🔒', label:'Unpublish (private)', action: () => { setMenuOpen(false); onTogglePublish(node) } }
                    : { icon:'🌐', label:'Publish as Template', action: () => { setMenuOpen(false); onTogglePublish(node) } },
                ] : []),
                { icon:'🗑', label:'Delete',         action: () => { setMenuOpen(false); onDelete(node) }, red:true },
              ].map(m => (
                <button key={m.label} onClick={m.action}
                  style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'9px 14px', border:'none', background:'none', fontSize:13, cursor:'pointer', color: m.red ? '#ef4444' : '#1e293b', textAlign:'left' }}
                  onMouseEnter={e => e.currentTarget.style.background = m.red ? '#fef2f2' : '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  {m.icon} {m.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {open && hasChildren && (
        <div>
          {node.children.map(child => (
            <FolderNode key={child.id} node={child} depth={depth + 1}
              selectedId={selectedId} onSelect={onSelect}
              onAddChild={onAddChild} onDelete={onDelete} onMove={onMove}
              onTogglePublish={onTogglePublish}
              canEdit={canEdit} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Document Card ───────────────────────────────────────── */
function DocCard({ doc, onClick }) {
  const color = STATUS_COLOR[doc.status] || '#64748b'
  return (
    <div onClick={() => onClick(doc.id)} style={{
      background:WHITE, border:`1px solid ${BORDER}`, borderRadius:10, padding:16,
      cursor:'pointer', transition:'box-shadow .15s',
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
        <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600 }}>{doc.doc_number}</div>
        <Badge label={doc.status} color={color} />
      </div>
      <div style={{ fontSize:14, fontWeight:600, color:'#1e293b', marginBottom:6, lineHeight:1.4 }}>{doc.title}</div>
      {doc.project && <div style={{ fontSize:12, color:'#64748b', marginBottom:6 }}>📌 {doc.project}</div>}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:10, paddingTop:10, borderTop:`1px solid ${BORDER}` }}>
        <div style={{ fontSize:11, color:'#94a3b8' }}>{doc.creator?.name}</div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {doc.file_count > 0 && (
            <span style={{ fontSize:11, color:'#64748b' }}>📎 {doc.file_count} file{doc.file_count > 1 ? 's' : ''}</span>
          )}
          <span style={{ fontSize:11, color:'#94a3b8' }}>{fmtDate(doc.created_at)}</span>
        </div>
      </div>
    </div>
  )
}

/* ─── Group Section ───────────────────────────────────────── */
function GroupSection({ groupKey, docs, groupBy, onDocClick }) {
  const [collapsed, setCollapsed] = useState(false)
  if (groupBy === 'none') {
    return (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:14 }}>
        {docs.map(doc => <DocCard key={doc.id} doc={doc} onClick={onDocClick} />)}
      </div>
    )
  }
  const accentColor = groupBy === 'status' ? (STATUS_COLOR[groupKey] || '#64748b') : BLUE
  return (
    <div style={{ marginBottom:24 }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          display:'flex', alignItems:'center', gap:10, width:'100%',
          background:'none', border:'none', cursor:'pointer', padding:'6px 0', marginBottom: collapsed ? 0 : 12,
          textAlign:'left',
        }}
      >
        <div style={{ width:3, height:18, background:accentColor, borderRadius:99, flexShrink:0 }} />
        <span style={{ fontWeight:700, fontSize:14, color:'#1e293b' }}>{groupKey}</span>
        <span style={{
          fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:99,
          background: accentColor + '18', color: accentColor, border:`1px solid ${accentColor}33`,
        }}>{docs.length}</span>
        <span style={{ marginLeft:'auto', fontSize:11, color:'#94a3b8' }}>{collapsed ? '▶ Show' : '▼ Hide'}</span>
      </button>
      {!collapsed && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:14 }}>
          {docs.map(doc => <DocCard key={doc.id} doc={doc} onClick={onDocClick} />)}
        </div>
      )}
    </div>
  )
}

/* ─── Create / Edit Folder Modal ──────────────────────────── */
function FolderEditModal({ existing, allFolders, defaultParentId, isAdmin, onClose, onSaved }) {
  const [name, setName]         = useState(existing?.name || '')
  const [parentId, setParentId] = useState(existing ? (existing.parent_id ?? '') : (defaultParentId ?? ''))
  const [isTemplate, setIsTemplate] = useState(false)
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState('')

  // For move: prevent cycles by excluding self + descendants
  const excluded = new Set()
  if (existing) {
    ;(function walk(id) {
      excluded.add(id)
      allFolders.filter(f => f.parent_id === id).forEach(c => walk(c.id))
    })(existing.id)
  }

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) { setErr('Name is required'); return }
    setBusy(true); setErr('')
    try {
      if (existing) {
        await libraryAPI.updateFolder(existing.id, {
          name: name.trim(),
          parent_id: parentId === '' ? null : Number(parentId),
        })
      } else {
        await libraryAPI.createFolder({
          name: name.trim(),
          parent_id: parentId === '' ? null : Number(parentId),
          is_template: isAdmin && isTemplate,
        })
      }
      onSaved()
      onClose()
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not save')
    } finally { setBusy(false) }
  }

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center'}}>
      <form onSubmit={submit} style={{background:WHITE, borderRadius:12, padding:24, width:420, maxWidth:'90%'}}>
        <h3 style={{margin:'0 0 4px', fontSize:16, fontWeight:700, color:'#1e293b'}}>
          {existing ? 'Move / Rename Folder' : 'New Folder'}
        </h3>
        <div style={{fontSize:12, color:'#64748b', marginBottom:18}}>
          {existing
            ? 'Rename or change the parent of this folder.'
            : 'Folders are private to you. Pin shared document types inside.'}
        </div>

        <label style={{display:'block', fontSize:12, fontWeight:600, color:'#374151', marginBottom:4}}>Name *</label>
        <input value={name} onChange={e=>setName(e.target.value)} autoFocus
          placeholder="e.g. My Project"
          style={{width:'100%', boxSizing:'border-box', padding:'8px 10px', fontSize:13,
            border:`1px solid ${BORDER}`, borderRadius:8, marginBottom:14}} />

        <label style={{display:'block', fontSize:12, fontWeight:600, color:'#374151', marginBottom:4}}>Parent</label>
        <select value={parentId} onChange={e=>setParentId(e.target.value)}
          style={{width:'100%', padding:'8px 10px', fontSize:13,
            border:`1px solid ${BORDER}`, borderRadius:8, marginBottom:14, background:'#fff'}}>
          <option value="">— No Parent (root) —</option>
          {allFolders.filter(f => !excluded.has(f.id)).map(f => (
            <option key={f.id} value={f.id}>{f.parent_id ? '— ' : ''}{f.name}{f.is_template ? '  (template)' : ''}</option>
          ))}
        </select>

        {!existing && isAdmin && (
          <label style={{display:'flex', alignItems:'center', gap:8, fontSize:12, color:'#374151', marginBottom:14, cursor:'pointer'}}>
            <input type="checkbox" checked={isTemplate} onChange={e=>setIsTemplate(e.target.checked)} />
            <span>Publish as <strong>shared template</strong> (visible to all users)</span>
          </label>
        )}

        {err && (
          <div style={{background:'#fef2f2', color:'#a32d2d', padding:'8px 12px',
            borderRadius:8, fontSize:12, marginBottom:12}}>{err}</div>
        )}
        <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
          <button type="button" onClick={onClose}
            style={{padding:'7px 16px', borderRadius:8, border:`1px solid ${BORDER}`,
              background:'#fff', cursor:'pointer', fontSize:13}}>Cancel</button>
          <button type="submit" disabled={busy}
            style={{padding:'7px 18px', borderRadius:8, border:'none',
              background: busy ? '#9ca3af' : BLUE, color:'#fff',
              cursor: busy ? 'not-allowed' : 'pointer', fontSize:13, fontWeight:600}}>
            {busy ? 'Saving…' : (existing ? 'Save' : 'Create')}
          </button>
        </div>
      </form>
    </div>
  )
}

/* ─── Add Doc Types Modal ─────────────────────────────────── */
function AddDocTypesModal({ folder, onClose, onSaved }) {
  const [docTypes, setDocTypes] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [search, setSearch]     = useState('')
  const [busy, setBusy]         = useState(false)
  const [loading, setLoading]   = useState(true)
  const [err, setErr]           = useState('')

  useEffect(() => {
    adminAPI.listDocTypes()
      .then(r => {
        const list = (r.data || []).filter(d => !d.is_structure_folder)
        setDocTypes(list)
        const initial = new Set((folder.doc_types || []).map(d => d.id))
        setSelected(initial)
      })
      .catch(() => setErr('Could not load document types'))
      .finally(() => setLoading(false))
  }, [folder.id])

  const filtered = docTypes.filter(d =>
    !search ||
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    (d.code || '').toLowerCase().includes(search.toLowerCase())
  )

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      await libraryAPI.updateFolder(folder.id, { doc_type_ids: [...selected] })
      onSaved()
      onClose()
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not save')
    } finally { setBusy(false) }
  }

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center'}}>
      <form onSubmit={submit} style={{background:WHITE, borderRadius:12, padding:24, width:540, maxWidth:'92%', maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <h3 style={{margin:'0 0 4px', fontSize:16, fontWeight:700, color:'#1e293b'}}>
          Pin Document Types in <span style={{color:BLUE}}>{folder.name}</span>
        </h3>
        <div style={{fontSize:12, color:'#64748b', marginBottom:14}}>
          The list updates automatically when new document types are created in Admin.
        </div>

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or code…"
          style={{padding:'8px 12px', fontSize:13, border:`1px solid ${BORDER}`, borderRadius:8, marginBottom:12}}
        />

        <div style={{flex:1, overflowY:'auto', border:`1px solid ${BORDER}`, borderRadius:8, padding:'4px 0', marginBottom:14, minHeight:180, maxHeight:360}}>
          {loading ? (
            <div style={{padding:'20px 12px', textAlign:'center', fontSize:12, color:'#94a3b8'}}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{padding:'20px 12px', textAlign:'center', fontSize:12, color:'#94a3b8'}}>
              {search ? 'No matches.' : 'No document types yet. Create one in Admin first.'}
            </div>
          ) : filtered.map(d => (
            <label key={d.id} style={{
              display:'flex', alignItems:'center', gap:10, padding:'7px 12px',
              cursor:'pointer', fontSize:13, borderBottom:'1px solid #f1f5f9',
            }}>
              <input
                type="checkbox"
                checked={selected.has(d.id)}
                onChange={() => toggle(d.id)}
              />
              <span style={{flex:1}}>{d.name}</span>
              <span style={{fontSize:10, color:'#94a3b8', fontWeight:600,
                background:'#f1f5f9', padding:'2px 8px', borderRadius:99}}>{d.code}</span>
            </label>
          ))}
        </div>

        <div style={{fontSize:12, color:'#64748b', marginBottom:12}}>
          {selected.size} selected
        </div>

        {err && (
          <div style={{background:'#fef2f2', color:'#a32d2d', padding:'8px 12px',
            borderRadius:8, fontSize:12, marginBottom:12}}>{err}</div>
        )}
        <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
          <button type="button" onClick={onClose}
            style={{padding:'7px 16px', borderRadius:8, border:`1px solid ${BORDER}`,
              background:'#fff', cursor:'pointer', fontSize:13}}>Cancel</button>
          <button type="submit" disabled={busy || loading}
            style={{padding:'7px 18px', borderRadius:8, border:'none',
              background: (busy || loading) ? '#9ca3af' : BLUE, color:'#fff',
              cursor: (busy || loading) ? 'not-allowed' : 'pointer', fontSize:13, fontWeight:600}}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

/* ─── Main Page ───────────────────────────────────────────── */
export default function DocumentLibrary() {
  const navigate = useNavigate()
  const [tree, setTree] = useState([])
  const [me, setMe] = useState(null)
  const [selectedFolder, setSelectedFolder] = useState(null)
  const [folderData, setFolderData] = useState(null)
  const [viewingDocType, setViewingDocType] = useState(null)
  const [docTypeView, setDocTypeView] = useState(null)
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState('none')
  const [sortBy, setSortBy] = useState('created_desc')
  const [folderEdit, setFolderEdit] = useState(null) // { existing, defaultParentId } or null
  const [addDocTypesFor, setAddDocTypesFor] = useState(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  const loadTree = useCallback(async () => {
    const res = await libraryAPI.tree()
    setTree(res.data)
    return res.data
  }, [])

  useEffect(() => {
    (async () => {
      const treeData = await loadTree()
      // Restore last drilldown so navigating away (e.g. into a doc detail
      // page) and clicking Back lands the user on the same folder/doc-type.
      let stored = null
      try { stored = JSON.parse(sessionStorage.getItem('dms_library_view') || 'null') } catch {}
      if (stored?.folderId) {
        const findById = (nodes) => {
          for (const n of nodes || []) {
            if (n.id === stored.folderId) return n
            const f = findById(n.children)
            if (f) return f
          }
          return null
        }
        const folder = findById(treeData)
        if (folder) {
          await handleSelectFolder(folder, { skipPersist: true })
          if (stored.docTypeId) {
            const dt = (folder.doc_types || []).find(d => d.id === stored.docTypeId)
            if (dt) await handleOpenDocType(dt, { skipPersist: true })
          }
        }
      }
    })()
    try {
      const u = JSON.parse(localStorage.getItem('dms_user') || 'null')
      setMe(u)
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function persistView(folderId, docTypeId) {
    try {
      if (!folderId && !docTypeId) {
        sessionStorage.removeItem('dms_library_view')
      } else {
        sessionStorage.setItem('dms_library_view', JSON.stringify({ folderId, docTypeId }))
      }
    } catch {}
  }

  const isAdmin = me?.role === 'System Admin'

  function canEdit(folder) {
    if (!folder) return false
    if (folder.owner_id === me?.id) return true
    if (folder.is_template && isAdmin) return true
    return false
  }

  // Flatten tree for parent pickers
  const allFolders = (() => {
    const out = []
    const walk = (nodes, depth = 0) => (nodes || []).forEach(n => {
      out.push({ ...n, _depth: depth })
      walk(n.children, depth + 1)
    })
    walk(tree)
    return out
  })()

  async function handleSelectFolder(folder, opts = {}) {
    setSelectedFolder(folder)
    setViewingDocType(null)
    setDocTypeView(null)
    setSearch('')
    if (!opts.skipPersist) persistView(folder?.id || null, null)
    setLoadingDocs(true)
    try {
      const res = await libraryAPI.folderDocuments(folder.id)
      setFolderData(res.data.folder)
    } catch {
      setFolderData(folder)
    } finally { setLoadingDocs(false) }
  }

  async function handleOpenDocType(dt, opts = {}) {
    setViewingDocType(dt)
    setDocTypeView(null)
    if (!opts.skipPersist) persistView(selectedFolder?.id || null, dt?.id || null)
    setLoadingDocs(true)
    try {
      const res = await libraryAPI.docTypeDocuments(dt.id)
      setDocTypeView(res.data)
    } catch {
      setDocTypeView({ doc_type: dt, documents: [], total: 0 })
    } finally { setLoadingDocs(false) }
  }

  async function handleDelete(folder) {
    if (!window.confirm(`Delete folder "${folder.name}"?\n\nThis only removes the container; pinned document types are not deleted.`)) return
    try {
      await libraryAPI.deleteFolder(folder.id)
      loadTree()
      if (selectedFolder?.id === folder.id) {
        setSelectedFolder(null); setFolderData(null)
      }
    } catch (e) {
      alert(e.response?.data?.error || 'Cannot delete this folder')
    }
  }

  async function handleTogglePublish(folder) {
    if (!isAdmin) return
    const verb = folder.is_template ? 'unpublish' : 'publish'
    const msg  = folder.is_template
      ? `Unpublish "${folder.name}"?\n\nIt will become private to its current owner (or stay un-owned if it was a template — in which case it will be removed from everyone's view).`
      : `Publish "${folder.name}" as a shared template?\n\nIt will become visible to all users.`
    if (!window.confirm(msg)) return
    try {
      await libraryAPI.updateFolder(folder.id, { is_template: !folder.is_template })
      await loadTree()
    } catch (e) {
      alert(e.response?.data?.error || `Could not ${verb}`)
    }
  }

  async function handleRemoveDocType(dt) {
    if (!selectedFolder) return
    if (!window.confirm(`Remove "${dt.name}" from "${selectedFolder.name}"?\n\nThe document type itself is not deleted.`)) return
    const remaining = (folderData?.doc_types || []).filter(d => d.id !== dt.id).map(d => d.id)
    try {
      await libraryAPI.updateFolder(selectedFolder.id, { doc_type_ids: remaining })
      await loadTree()
      const res = await libraryAPI.folderDocuments(selectedFolder.id)
      setFolderData(res.data.folder)
    } catch (e) {
      alert(e.response?.data?.error || 'Could not remove')
    }
  }

  const filteredDocs = sortDocs(
    (docTypeView?.documents || []).filter(d =>
      !search || d.title.toLowerCase().includes(search.toLowerCase()) || d.doc_number.toLowerCase().includes(search.toLowerCase())
    ),
    sortBy,
  )

  const grouped = groupDocs(filteredDocs, groupBy)

  return (
    <div style={{ display:'flex', height:'calc(100vh - 56px)', background:BG, overflow:'hidden' }}>

      {/* ── Left Panel ── */}
      <div style={{ width:280, flexShrink:0, background:WHITE, borderRight:`1px solid ${BORDER}`, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'16px 14px 12px', borderBottom:`1px solid ${BORDER}` }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontWeight:700, fontSize:14, color:'#1e293b' }}>📚 Document Folder</span>
            <button
              onClick={() => setFolderEdit({ existing: null, defaultParentId: null })}
              title="Create a new folder"
              style={{ background:BLUE, color:WHITE, border:'none', borderRadius:7, padding:'5px 10px', fontSize:12, fontWeight:600, cursor:'pointer' }}
            >+ Folder</button>
          </div>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'8px 6px' }}>
          {tree.length === 0 ? (
            <div style={{ textAlign:'center', padding:'40px 20px', color:'#94a3b8', fontSize:13 }}>
              <div style={{ fontSize:40, marginBottom:8 }}>📂</div>
              No folders yet.<br />
              <button onClick={() => setFolderEdit({ existing: null, defaultParentId: null })} style={{ marginTop:12, background:BLUE, color:WHITE, border:'none', borderRadius:8, padding:'8px 16px', fontSize:13, cursor:'pointer' }}>Create First Folder</button>
            </div>
          ) : tree.map(node => (
            <FolderNode key={node.id} node={node} depth={0}
              selectedId={selectedFolder?.id}
              onSelect={handleSelectFolder}
              onAddChild={(n) => setFolderEdit({ existing: null, defaultParentId: n.id })}
              onDelete={handleDelete}
              onMove={(n) => setFolderEdit({ existing: n, defaultParentId: null })}
              onTogglePublish={handleTogglePublish}
              canEdit={canEdit}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {!selectedFolder ? (
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#94a3b8', gap:12 }}>
            <div style={{ fontSize:64 }}>📁</div>
            <div style={{ fontSize:16, fontWeight:600, color:'#475569' }}>Select a folder</div>
            <div style={{ fontSize:13 }}>Click a folder on the left to view its contents</div>
          </div>
        ) : (
          <>
            {/* Folder header */}
            <div style={{ padding:'14px 24px', background:WHITE, borderBottom:`1px solid ${BORDER}`, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {viewingDocType && (
                    <button onClick={() => {
                      setViewingDocType(null); setDocTypeView(null);
                      persistView(selectedFolder?.id || null, null)
                    }}
                      title="Back to folder"
                      style={{ background:'#f1f5f9', border:`1px solid ${BORDER}`, borderRadius:7, padding:'3px 9px', fontSize:12, cursor:'pointer', color:'#374151' }}>
                      ← Back
                    </button>
                  )}
                  <span style={{ fontSize:20 }}>{viewingDocType ? '📄' : '📂'}</span>
                  <span style={{ fontWeight:700, fontSize:17, color:'#1e293b' }}>
                    {viewingDocType ? viewingDocType.name : selectedFolder.name}
                  </span>
                  {viewingDocType ? (
                    <span style={{ fontSize:11, color:'#94a3b8', background:'#f1f5f9', padding:'2px 8px', borderRadius:99 }}>{viewingDocType.code}</span>
                  ) : selectedFolder.is_template && (
                    <span style={{ fontSize:10, color:'#a16207', background:'#fef3c7', padding:'2px 8px', borderRadius:99, fontWeight:600 }}>TEMPLATE</span>
                  )}
                </div>
                {!viewingDocType && selectedFolder.description && (
                  <div style={{ fontSize:12, color:'#64748b', marginTop:3, marginLeft:28 }}>{selectedFolder.description}</div>
                )}
              </div>

              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                {viewingDocType && (
                  <input
                    value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search documents…"
                    style={{ padding:'7px 12px', border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, width:180 }}
                  />
                )}

                {viewingDocType && (
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:12, color:'#64748b', fontWeight:500, whiteSpace:'nowrap' }}>Group by:</span>
                    <select
                      value={groupBy}
                      onChange={e => setGroupBy(e.target.value)}
                      style={{ padding:'7px 10px', border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, background:WHITE, cursor:'pointer', color:'#374151' }}
                    >
                      {GROUP_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {viewingDocType && (
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:12, color:'#64748b', fontWeight:500, whiteSpace:'nowrap' }}>Sort by:</span>
                    <select
                      value={sortBy}
                      onChange={e => setSortBy(e.target.value)}
                      style={{ padding:'7px 10px', border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, background:WHITE, cursor:'pointer', color:'#374151' }}
                    >
                      {SORT_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {viewingDocType && (
                  <button
                    onClick={() => setUploadOpen(true)}
                    style={{ padding:'7px 16px', background:BLUE, color:WHITE, border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}
                  >+ Upload Document</button>
                )}

                {!viewingDocType && canEdit(selectedFolder) && (
                  <>
                    <button
                      onClick={() => setFolderEdit({ existing: null, defaultParentId: selectedFolder.id })}
                      style={{ padding:'7px 12px', background:'#f1f5f9', color:'#374151', border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, fontWeight:500, cursor:'pointer', whiteSpace:'nowrap' }}
                    >📁 Sub-folder</button>
                    <button
                      onClick={() => setAddDocTypesFor(folderData || selectedFolder)}
                      style={{ padding:'7px 12px', background:'#f1f5f9', color:'#374151', border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, fontWeight:500, cursor:'pointer', whiteSpace:'nowrap' }}
                    >📄 Add Doc Type</button>
                  </>
                )}
              </div>
            </div>

            {/* Body */}
            <div style={{ flex:1, overflowY:'auto', padding:20 }}>
              {loadingDocs ? (
                <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>⏳</div>
                  <div>Loading…</div>
                </div>
              ) : viewingDocType ? (
                /* ── Doc-type drilldown: documents grid ── */
                filteredDocs.length === 0 ? (
                  <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>
                    <div style={{ fontSize:48, marginBottom:12 }}>📄</div>
                    <div style={{ fontSize:15, fontWeight:600, color:'#475569', marginBottom: 12 }}>
                      {search ? 'No documents match your search' : 'No documents in this type'}
                    </div>
                    {!search && (
                      <button
                        onClick={() => setUploadOpen(true)}
                        style={{ marginTop:8, background:BLUE, color:WHITE, border:'none', borderRadius:8, padding:'10px 22px', fontSize:13, fontWeight:600, cursor:'pointer' }}
                      >Upload First Document</button>
                    )}
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>
                      {filteredDocs.length} document{filteredDocs.length !== 1 ? 's' : ''}
                      {search ? ` matching "${search}"` : ''}
                      {` · sorted by ${SORT_OPTIONS.find(o => o.value === sortBy)?.label.toLowerCase()}`}
                      {groupBy !== 'none' ? ` · grouped by ${GROUP_OPTIONS.find(o => o.value === groupBy)?.label}` : ''}
                    </div>
                    {grouped.map(({ key, docs }) => (
                      <GroupSection key={key} groupKey={key} docs={docs} groupBy={groupBy}
                        onDocClick={(id) => navigate(`/documents/${id}`, { state: { from: '/library' } })} />
                    ))}
                  </>
                )
              ) : (
                /* ── Folder view: child folder cards + pinned doc-type cards ── */
                (() => {
                  const childFolders = (selectedFolder.children || [])
                  const docTypes = folderData?.doc_types || []
                  const isEmpty = childFolders.length === 0 && docTypes.length === 0
                  if (isEmpty) {
                    return (
                      <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>
                        <div style={{ fontSize:48, marginBottom:12 }}>📂</div>
                        <div style={{ fontSize:15, fontWeight:600, color:'#475569', marginBottom:6 }}>
                          This folder is empty
                        </div>
                        {canEdit(selectedFolder) && (
                          <div style={{ fontSize:12, color:'#94a3b8' }}>
                            Use <strong>Sub-folder</strong> to create nested folders or <strong>Add Doc Type</strong> to pin existing types here.
                          </div>
                        )}
                      </div>
                    )
                  }
                  return (
                    <>
                      {childFolders.length > 0 && (
                        <div style={{ marginBottom: 24 }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'#64748b',
                            textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10 }}>
                            Folders ({childFolders.length})
                          </div>
                          <div style={{ display:'grid',
                            gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:10 }}>
                            {childFolders.map(child => (
                              <div key={child.id}
                                onClick={() => handleSelectFolder(child)}
                                title="Click to open"
                                style={{
                                  background:WHITE, border:`1px solid ${BORDER}`, borderRadius:10,
                                  padding:'12px 14px', cursor:'pointer', display:'flex',
                                  alignItems:'center', gap:10, transition:'all .15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = BLUE; e.currentTarget.style.boxShadow = '0 4px 14px rgba(12,68,124,0.12)' }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.boxShadow = 'none' }}
                              >
                                <span style={{ fontSize:24, flexShrink:0 }}>📁</span>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ fontSize:13, fontWeight:600, color:'#1e293b',
                                    whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                                    {child.name}
                                  </div>
                                  <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>
                                    {child.children?.length ? `${child.children.length} sub-folder${child.children.length !== 1 ? 's' : ''}` : 'Folder'}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {docTypes.length > 0 && (
                        <div>
                          <div style={{ fontSize:11, fontWeight:700, color:'#64748b',
                            textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10 }}>
                            Document Types ({docTypes.length})
                          </div>
                          <div style={{ display:'grid',
                            gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:10 }}>
                            {docTypes.map(dt => (
                              <div key={dt.id}
                                onClick={() => handleOpenDocType(dt)}
                                title="Click to open"
                                style={{
                                  background:WHITE, border:`1px solid ${BORDER}`, borderRadius:10,
                                  padding:'12px 14px', cursor:'pointer', display:'flex',
                                  alignItems:'center', gap:10, transition:'all .15s', position:'relative',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = BLUE; e.currentTarget.style.boxShadow = '0 4px 14px rgba(12,68,124,0.12)' }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.boxShadow = 'none' }}
                              >
                                <span style={{ fontSize:24, flexShrink:0 }}>📄</span>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ fontSize:13, fontWeight:600, color:'#1e293b',
                                    whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                                    {dt.name}
                                  </div>
                                  <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>
                                    {dt.code}
                                  </div>
                                </div>
                                {canEdit(selectedFolder) && (
                                  <button
                                    onClick={e => { e.stopPropagation(); handleRemoveDocType(dt) }}
                                    title={`Remove "${dt.name}" from this folder`}
                                    style={{ background:'none', border:'none', color:'#94a3b8',
                                      fontSize:18, cursor:'pointer', padding:'2px 6px', lineHeight:1,
                                      borderRadius:6, flexShrink:0 }}
                                    onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fef2f2' }}
                                    onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = 'none' }}
                                  >×</button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )
                })()
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Folder Edit Modal ── */}
      {folderEdit && (
        <FolderEditModal
          existing={folderEdit.existing}
          allFolders={allFolders}
          defaultParentId={folderEdit.defaultParentId}
          isAdmin={isAdmin}
          onClose={() => setFolderEdit(null)}
          onSaved={() => {
            loadTree()
            if (selectedFolder) {
              libraryAPI.folderDocuments(selectedFolder.id)
                .then(r => setFolderData(r.data.folder)).catch(() => {})
            }
          }}
        />
      )}

      {/* ── Add Doc Types Modal ── */}
      {addDocTypesFor && (
        <AddDocTypesModal
          folder={addDocTypesFor}
          onClose={() => setAddDocTypesFor(null)}
          onSaved={async () => {
            await loadTree()
            if (selectedFolder) {
              const r = await libraryAPI.folderDocuments(selectedFolder.id)
              setFolderData(r.data.folder)
            }
          }}
        />
      )}

      {/* ── Upload Modal ── */}
      {uploadOpen && viewingDocType && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          preselectedDocTypeId={viewingDocType.id}
          onSuccess={async () => {
            setUploadOpen(false)
            const res = await libraryAPI.docTypeDocuments(viewingDocType.id)
            setDocTypeView(res.data)
          }}
        />
      )}
    </div>
  )
}
