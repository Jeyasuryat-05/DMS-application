import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { libraryAPI } from '../api'
import UploadModal from '../components/UploadModal'

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
  Draft: '#f59e0b', Created: '#3b82f6', 'In Check': '#8b5cf6',
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

function getGroupKey(doc, groupBy) {
  if (groupBy === 'status')  return doc.status || 'Unknown'
  if (groupBy === 'creator') return doc.creator?.name || 'Unknown'
  if (groupBy === 'project') return doc.project || 'No Project'
  if (groupBy === 'date') {
    if (!doc.created_at) return 'Unknown Date'
    const d = new Date(doc.created_at)
    return isNaN(d) ? 'Unknown Date' : d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
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
function FolderNode({ node, depth, selectedId, onSelect, onAddChild, onDelete }) {
  const [open, setOpen] = useState(depth === 0)
  const hasChildren = node.children?.length > 0
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
        <span style={{ fontSize:10, color:'#94a3b8', flexShrink:0 }}>{node.code}</span>
        <button
          onClick={e => { e.stopPropagation(); setMenuOpen(m => !m) }}
          style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'#94a3b8', padding:'0 2px', borderRadius:4, flexShrink:0 }}
        >⋮</button>

        {menuOpen && (
          <>
            <div onClick={() => setMenuOpen(false)} style={{ position:'fixed', inset:0, zIndex:100 }} />
            <div style={{ position:'absolute', right:8, top:28, background:WHITE, border:`1px solid ${BORDER}`, borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,0.12)', zIndex:101, minWidth:160, overflow:'hidden' }}>
              {[
                { icon:'📁', label:'New Sub-folder', action: () => { setMenuOpen(false); onAddChild(node) } },
                { icon:'🗑', label:'Delete',           action: () => { setMenuOpen(false); onDelete(node) }, red:true },
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
              onAddChild={onAddChild} onDelete={onDelete} />
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
          <span style={{ fontSize:11, color:'#94a3b8' }}>
            {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : ''}
          </span>
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

/* ─── Main Page ───────────────────────────────────────────── */
export default function DocumentLibrary() {
  const navigate = useNavigate()
  const [tree, setTree] = useState([])
  const [selectedFolder, setSelectedFolder] = useState(null)
  const [folderDocs, setFolderDocs] = useState(null)
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState('none')
  const [uploadOpen, setUploadOpen] = useState(false)

  const loadTree = useCallback(async () => {
    const res = await libraryAPI.tree()
    setTree(res.data)
  }, [])

  useEffect(() => { loadTree() }, [loadTree])

  async function loadFolderDocs(folder) {
    setLoadingDocs(true)
    setFolderDocs(null)
    setSearch('')
    try {
      const res = await libraryAPI.folderDocuments(folder.id)
      setFolderDocs(res.data)
    } catch {
      setFolderDocs({ folder, documents: [], total: 0 })
    } finally { setLoadingDocs(false) }
  }

  function handleSelectFolder(node) {
    setSelectedFolder(node)
    loadFolderDocs(node)
  }

  function goToAdminDocTypes(parentNode) {
    navigate('/admin', { state: { tab: 'doctypes', parentId: parentNode?.id || null } })
  }

  async function handleDelete(folder) {
    if (!window.confirm(`Delete folder "${folder.name}"?\n\nThis will fail if the folder has documents or sub-folders.`)) return
    try {
      await libraryAPI.deleteFolder(folder.id)
      loadTree()
      if (selectedFolder?.id === folder.id) { setSelectedFolder(null); setFolderDocs(null) }
    } catch (e) {
      alert(e.response?.data?.error || 'Cannot delete this folder')
    }
  }

  const filteredDocs = (folderDocs?.documents || []).filter(d =>
    !search || d.title.toLowerCase().includes(search.toLowerCase()) || d.doc_number.toLowerCase().includes(search.toLowerCase())
  )

  const grouped = groupDocs(filteredDocs, groupBy)

  return (
    <div style={{ display:'flex', height:'calc(100vh - 56px)', background:BG, overflow:'hidden' }}>

      {/* ── Left Panel ── */}
      <div style={{ width:280, flexShrink:0, background:WHITE, borderRight:`1px solid ${BORDER}`, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'16px 14px 12px', borderBottom:`1px solid ${BORDER}` }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontWeight:700, fontSize:14, color:'#1e293b' }}>📚 Document Library</span>
            <button
              onClick={() => goToAdminDocTypes(null)}
              title="Add new document type (folder) in Administration"
              style={{ background:BLUE, color:WHITE, border:'none', borderRadius:7, padding:'5px 10px', fontSize:12, fontWeight:600, cursor:'pointer' }}
            >+ Folder</button>
          </div>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'8px 6px' }}>
          {tree.length === 0 ? (
            <div style={{ textAlign:'center', padding:'40px 20px', color:'#94a3b8', fontSize:13 }}>
              <div style={{ fontSize:40, marginBottom:8 }}>📂</div>
              No folders yet.<br />
              <button onClick={() => goToAdminDocTypes(null)} style={{ marginTop:12, background:BLUE, color:WHITE, border:'none', borderRadius:8, padding:'8px 16px', fontSize:13, cursor:'pointer' }}>Create First Folder</button>
            </div>
          ) : tree.map(node => (
            <FolderNode key={node.id} node={node} depth={0}
              selectedId={selectedFolder?.id}
              onSelect={handleSelectFolder}
              onAddChild={(n) => goToAdminDocTypes(n)}
              onDelete={handleDelete}
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
            <div style={{ fontSize:13 }}>Click a folder on the left to view its documents</div>
          </div>
        ) : (
          <>
            {/* Folder header */}
            <div style={{ padding:'14px 24px', background:WHITE, borderBottom:`1px solid ${BORDER}`, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:20 }}>📂</span>
                  <span style={{ fontWeight:700, fontSize:17, color:'#1e293b' }}>{selectedFolder.name}</span>
                  <span style={{ fontSize:11, color:'#94a3b8', background:'#f1f5f9', padding:'2px 8px', borderRadius:99 }}>{selectedFolder.code}</span>
                </div>
                {selectedFolder.description && (
                  <div style={{ fontSize:12, color:'#64748b', marginTop:3, marginLeft:28 }}>{selectedFolder.description}</div>
                )}
              </div>

              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                {/* Search */}
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search documents…"
                  style={{ padding:'7px 12px', border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, width:180 }}
                />

                {/* Group by */}
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

                <button
                  onClick={() => goToAdminDocTypes(selectedFolder)}
                  style={{ padding:'7px 12px', background:'#f1f5f9', color:'#374151', border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, fontWeight:500, cursor:'pointer', whiteSpace:'nowrap' }}
                >📁 Sub-folder</button>
                <button
                  onClick={() => setUploadOpen(true)}
                  style={{ padding:'7px 16px', background:BLUE, color:WHITE, border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}
                >+ Upload Document</button>
              </div>
            </div>

            {/* Documents area */}
            <div style={{ flex:1, overflowY:'auto', padding:20 }}>
              {loadingDocs ? (
                <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>⏳</div>
                  <div>Loading documents…</div>
                </div>
              ) : filteredDocs.length === 0 ? (
                <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>
                  <div style={{ fontSize:48, marginBottom:12 }}>📄</div>
                  <div style={{ fontSize:15, fontWeight:600, color:'#475569', marginBottom:6 }}>
                    {search ? 'No documents match your search' : 'No documents in this folder'}
                  </div>
                  {!search && (
                    <button
                      onClick={() => setUploadOpen(true)}
                      style={{ marginTop:12, background:BLUE, color:WHITE, border:'none', borderRadius:8, padding:'10px 22px', fontSize:13, fontWeight:600, cursor:'pointer' }}
                    >Upload First Document</button>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>
                    {filteredDocs.length} document{filteredDocs.length !== 1 ? 's' : ''}
                    {search ? ` matching "${search}"` : ''}
                    {groupBy !== 'none' ? ` · grouped by ${GROUP_OPTIONS.find(o => o.value === groupBy)?.label}` : ''}
                  </div>
                  {grouped.map(({ key, docs }) => (
                    <GroupSection
                      key={key}
                      groupKey={key}
                      docs={docs}
                      groupBy={groupBy}
                      onDocClick={(id) => navigate(`/documents/${id}`)}
                    />
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Upload Modal ── */}
      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          preselectedDocTypeId={selectedFolder?.id}
          onSuccess={() => {
            setUploadOpen(false)
            if (selectedFolder) loadFolderDocs(selectedFolder)
          }}
        />
      )}
    </div>
  )
}
