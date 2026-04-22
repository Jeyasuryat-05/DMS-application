/**
 * Admin.jsx
 * Tabs: Users | Document Types | System Config (auth-code gate + SAP SSO)
 *
 * Users and Doc Types use an Excel-style editable grid:
 *  - Inline cell editing on click
 *  - Add row at bottom
 *  - Row-level save / delete
 *  - CSV export
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { adminAPI, authAPI } from '../api'
import { useNavigate } from 'react-router-dom'
import { fmtDate, fmtDateTime } from '../utils/dates'

// ─── palette ──────────────────────────────────────────────────────────────────
const C = {
  blue:    '#0C447C', lightBlue: '#E6F1FB', accent: '#185FA5',
  green:   '#0F6E56', lightGreen: '#E1F5EE',
  red:     '#A32D2D', lightRed: '#FCEBEB',
  amber:   '#854F0B', lightAmber: '#FAEEDA',
  gray:    '#6b7280', border: '#e5e7eb', bg: '#f8fafc',
  rowHover:'#f0f7ff', rowSelect:'#dbeafe',
}

// ─── Mini components ──────────────────────────────────────────────────────────
const Chip = ({ label, color = C.accent }) => (
  <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:99,
    fontSize:11, fontWeight:600, background: color+'1a', color, border:`1px solid ${color}33` }}>
    {label}
  </span>
)

const GBtn = ({ label, onClick, color = C.accent, disabled }) => (
  <button onClick={onClick} disabled={disabled} style={{
    padding:'5px 13px', borderRadius:7, fontSize:12, fontWeight:600, cursor: disabled ? 'not-allowed':'pointer',
    background: disabled ? '#e5e7eb' : color, color: disabled ? C.gray : '#fff',
    border:'none', opacity: disabled ? 0.6 : 1,
  }}>{label}</button>
)

const Toast = ({ msg, type }) => msg ? (
  <div style={{
    position:'fixed', bottom:24, right:24, zIndex:9999,
    background: type==='error' ? C.lightRed : C.lightGreen,
    color: type==='error' ? C.red : C.green,
    border:`1px solid ${type==='error' ? C.red : C.green}`,
    borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:500,
    boxShadow:'0 4px 20px rgba(0,0,0,0.15)',
  }}>{msg}</div>
) : null

function useToast() {
  const [toast, setToast] = useState(null)
  const show = (msg, type='success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }
  return [toast, show]
}

// ─── Excel Cell ──────────────────────────────────────────────────────────────
function Cell({ value, onChange, type='text', options, readOnly, width }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(value ?? '')
  const ref = useRef()

  useEffect(() => setVal(value ?? ''), [value])

  function commit() {
    setEditing(false)
    if (val !== value) onChange(val)
  }

  const cellStyle = {
    padding:'6px 10px', borderRight:`1px solid ${C.border}`, fontSize:13,
    cursor: readOnly ? 'default' : 'pointer', minWidth: width || 100,
    background: readOnly ? '#fafafa' : editing ? '#fffbeb' : 'transparent',
    whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
    maxWidth: width || 200,
  }

  if (readOnly) return <td style={cellStyle}>{value}</td>
  if (!editing) return (
    <td style={cellStyle} onClick={() => { setEditing(true); setTimeout(() => ref.current?.focus(),10) }}>
      {type==='boolean' ? (value ? '✅ Yes' : '❌ No') : (value || <span style={{color:'#d1d5db'}}>—</span>)}
    </td>
  )

  if (type === 'select') return (
    <td style={{ ...cellStyle, padding:0 }}>
      <select ref={ref} value={val} onChange={e => setVal(e.target.value)}
        onBlur={commit} autoFocus style={{ width:'100%', border:'none', padding:'6px 10px', background:'#fffbeb', fontSize:13, outline:`2px solid ${C.accent}` }}>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </td>
  )

  if (type === 'boolean') return (
    <td style={{ ...cellStyle, padding:0 }}>
      <select ref={ref} value={val} onChange={e => { setVal(e.target.value); onChange(e.target.value === 'true'); setEditing(false) }}
        onBlur={commit} autoFocus style={{ width:'100%', border:'none', padding:'6px 10px', background:'#fffbeb', fontSize:13, outline:`2px solid ${C.accent}` }}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    </td>
  )

  return (
    <td style={{ ...cellStyle, padding:0 }}>
      <input ref={ref} value={val} onChange={e => setVal(e.target.value)}
        onBlur={commit} onKeyDown={e => { if(e.key==='Enter') commit(); if(e.key==='Escape'){setEditing(false);setVal(value??'')} }}
        autoFocus style={{ width:'100%', boxSizing:'border-box', border:'none', padding:'6px 10px', background:'#fffbeb', fontSize:13, outline:`2px solid ${C.accent}` }}
      />
    </td>
  )
}

// ─── Users Grid ──────────────────────────────────────────────────────────────
const ROLES = ['Document Creator','Checker','Reviewer','Approver','EIC','Read-Only','System Admin','Sub-Admin']
const DEPTS = ['Design','QA','Safety','Projects','IT','Management','Procurement','Civil','Electrical','Mechanical','Finance','HR']

function UsersGrid({ toast }) {
  const [rows, setRows]       = useState([])
  const [dirty, setDirty]     = useState({})   // rowId -> changed fields
  const [newRows, setNewRows] = useState([])   // unsaved new rows
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState({ department:'', role:'', is_active:'' })

  const load = useCallback(() => {
    setLoading(true)
    adminAPI.listUsers({ q: search || undefined, ...Object.fromEntries(Object.entries(filter).filter(([,v])=>v!=='')) })
      .then(r => setRows(r.data)).finally(() => setLoading(false))
  }, [search, filter])

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])

  function markDirty(id, field, value) {
    setDirty(d => ({ ...d, [id]: { ...(d[id]||{}), [field]: value } }))
  }

  async function saveRow(row) {
    const changes = dirty[row.id]
    if (!changes) return
    try {
      await adminAPI.updateUser(row.id, changes)
      setDirty(d => { const nd = {...d}; delete nd[row.id]; return nd })
      toast('User saved', 'success')
      load()
    } catch(e) { toast(e.response?.data?.detail || 'Save failed', 'error') }
  }

  async function toggleActive(row) {
    try {
      if (row.is_active) await adminAPI.deactivateUser(row.id)
      else await adminAPI.activateUser(row.id)
      toast(`User ${row.is_active ? 'deactivated':'activated'}`, 'success')
      load()
    } catch(e) { toast('Action failed', 'error') }
  }

  function addNewRow() {
    setNewRows(nr => [...nr, { _id: Date.now(), employee_id:'', name:'', email:'', department:'', role:'Document Creator', password:'', is_active:true }])
  }

  async function saveNewRow(idx) {
    const row = newRows[idx]
    if (!row.name || !row.email) { toast('Name and Email are required', 'error'); return }
    try {
      await adminAPI.createUser({ ...row })
      setNewRows(nr => nr.filter((_,i)=>i!==idx))
      toast('User created', 'success')
      load()
    } catch(e) { toast(e.response?.data?.detail || 'Create failed', 'error') }
  }

  function updateNewRow(idx, field, val) {
    setNewRows(nr => nr.map((r,i) => i===idx ? {...r,[field]:val} : r))
  }

  function exportCSV() {
    const cols = ['employee_id','name','email','department','role','is_active','is_sso_user','last_login']
    const csv  = [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c]??'')).join(','))].join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download = 'users.csv'; a.click()
  }

  const displayed = rows // filter already applied via API

  const thStyle = { padding:'8px 10px', fontWeight:600, fontSize:12, color: C.blue, background:'#EBF4FF',
    borderBottom:`2px solid ${C.accent}`, borderRight:`1px solid ${C.border}`, whiteSpace:'nowrap', textAlign:'left' }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, email, ID…"
          style={{ width:220, fontSize:13 }} />
        <select value={filter.department} onChange={e=>setFilter(f=>({...f,department:e.target.value}))} style={{fontSize:13}}>
          <option value="">All Departments</option>
          {DEPTS.map(d=><option key={d}>{d}</option>)}
        </select>
        <select value={filter.role} onChange={e=>setFilter(f=>({...f,role:e.target.value}))} style={{fontSize:13}}>
          <option value="">All Roles</option>
          {ROLES.map(r=><option key={r}>{r}</option>)}
        </select>
        <select value={filter.is_active} onChange={e=>setFilter(f=>({...f,is_active:e.target.value}))} style={{fontSize:13}}>
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <div style={{marginLeft:'auto', display:'flex', gap:8}}>
          <GBtn label="+ Add User" onClick={addNewRow} color={C.green} />
          <GBtn label="Export CSV" onClick={exportCSV} color={C.gray} />
        </div>
      </div>

      {/* Grid */}
      <div style={{ overflowX:'auto', borderRadius:10, border:`1px solid ${C.border}`, background:'#fff' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr>
              {['SAP Username','Name','Email','Department','Role','DMS','Create','Edit','Delete','Read','Auth Codes','Active','Actions'].map(h=>(
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{padding:32,textAlign:'center',color:C.gray}}>Loading…</td></tr>}
            {!loading && displayed.map(row => (
              <tr key={row.id}
                style={{ borderBottom:`1px solid ${C.border}`, background: dirty[row.id] ? '#fffbeb' : 'white' }}
                onMouseOver={e=>e.currentTarget.style.background=dirty[row.id]?'#fffbeb':C.rowHover}
                onMouseOut={e=>e.currentTarget.style.background=dirty[row.id]?'#fffbeb':'white'}
              >
                <Cell value={row.employee_id} onChange={v=>markDirty(row.id,'employee_id',v)} width={90} />
                <Cell value={row.name}        onChange={v=>markDirty(row.id,'name',v)}        width={150} />
                <Cell value={row.email}       onChange={v=>markDirty(row.id,'email',v)}       width={200} />
                <Cell value={row.department}  onChange={v=>markDirty(row.id,'department',v)}  type="select" options={DEPTS} width={130} />
                <Cell value={row.role}        onChange={v=>markDirty(row.id,'role',v)}        type="select" options={ROLES} width={150} />
                <td style={{padding:'6px 10px',borderRight:`1px solid ${C.border}`}}>
                  <Chip label={row.is_active?'Active':'Inactive'} color={row.is_active?C.green:C.red} />
                </td>
                <td style={{padding:'6px 10px',borderRight:`1px solid ${C.border}`,textAlign:'center'}}>
                  {row.is_sso_user ? <span title="SSO User">🔑</span> : '—'}
                </td>
                <td style={{padding:'6px 10px',borderRight:`1px solid ${C.border}`,fontSize:11,color:C.gray,whiteSpace:'nowrap'}}>
                  {fmtDate(row.last_login)}
                </td>
                <td style={{padding:'6px 10px',whiteSpace:'nowrap'}}>
                  <div style={{display:'flex',gap:5}}>
                    {dirty[row.id] && <GBtn label="Save" onClick={()=>saveRow(row)} color={C.green} />}
                    <GBtn label={row.is_active?'Deactivate':'Activate'}
                          onClick={()=>toggleActive(row)}
                          color={row.is_active?C.red:C.green} />
                  </div>
                </td>
              </tr>
            ))}
            {!loading && displayed.length===0 && newRows.length===0 && (
              <tr><td colSpan={9} style={{padding:32,textAlign:'center',color:C.gray}}>No users found</td></tr>
            )}
            {/* New rows */}
            {newRows.map((nr, idx) => (
              <tr key={nr._id} style={{ background:'#f0fff4', borderBottom:`1px solid ${C.border}` }}>
                <td style={{padding:'4px 6px',borderRight:`1px solid ${C.border}`}}>
                  <input value={nr.employee_id} onChange={e=>updateNewRow(idx,'employee_id',e.target.value)} placeholder="EMP001" style={{width:80,fontSize:12}} />
                </td>
                <td style={{padding:'4px 6px',borderRight:`1px solid ${C.border}`}}>
                  <input value={nr.name} onChange={e=>updateNewRow(idx,'name',e.target.value)} placeholder="Full Name *" style={{width:140,fontSize:12}} />
                </td>
                <td style={{padding:'4px 6px',borderRight:`1px solid ${C.border}`}}>
                  <input value={nr.email} onChange={e=>updateNewRow(idx,'email',e.target.value)} placeholder="email@org.in *" style={{width:190,fontSize:12}} />
                </td>
                <td style={{padding:'4px 6px',borderRight:`1px solid ${C.border}`}}>
                  <select value={nr.department} onChange={e=>updateNewRow(idx,'department',e.target.value)} style={{fontSize:12}}>
                    {DEPTS.map(d=><option key={d}>{d}</option>)}
                  </select>
                </td>
                <td style={{padding:'4px 6px',borderRight:`1px solid ${C.border}`}}>
                  <select value={nr.role} onChange={e=>updateNewRow(idx,'role',e.target.value)} style={{fontSize:12}}>
                    {ROLES.map(r=><option key={r}>{r}</option>)}
                  </select>
                </td>
                <td style={{padding:'4px 6px',borderRight:`1px solid ${C.border}`}} colSpan={2}>—</td>
                <td style={{padding:'4px 6px',borderRight:`1px solid ${C.border}`}}>
                  <input value={nr.password} onChange={e=>updateNewRow(idx,'password',e.target.value)} placeholder="Password" type="password" style={{width:110,fontSize:12}} />
                </td>
                <td style={{padding:'4px 6px',whiteSpace:'nowrap'}}>
                  <div style={{display:'flex',gap:5}}>
                    <GBtn label="Create" onClick={()=>saveNewRow(idx)} color={C.green} />
                    <GBtn label="×" onClick={()=>setNewRows(nr=>nr.filter((_,i)=>i!==idx))} color={C.red} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:8,fontSize:12,color:C.gray}}>{displayed.length} user{displayed.length!==1?'s':''} · Click any cell to edit inline · Changes highlighted in yellow</div>
    </div>
  )
}

// ─── Doc Types Grid ──────────────────────────────────────────────────────────
const ALL_FORMATS = [
  {extension:"pdf",  label:"PDF Document",        icon:"📄", mime_type:"application/pdf"},
  {extension:"doc",  label:"Word (Legacy)",        icon:"📝", mime_type:"application/msword"},
  {extension:"docx", label:"Word (OOXML)",         icon:"📝", mime_type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
  {extension:"xls",  label:"Excel (Legacy)",       icon:"📊", mime_type:"application/vnd.ms-excel"},
  {extension:"xlsx", label:"Excel (OOXML)",        icon:"📊", mime_type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
  {extension:"ppt",  label:"PowerPoint (Legacy)",  icon:"📊", mime_type:"application/vnd.ms-powerpoint"},
  {extension:"pptx", label:"PowerPoint (OOXML)",   icon:"📊", mime_type:"application/vnd.openxmlformats-officedocument.presentationml.presentation"},
  {extension:"dwg",  label:"AutoCAD Drawing",      icon:"📐", mime_type:"image/vnd.dwg"},
  {extension:"dxf",  label:"DXF Drawing Exchange", icon:"📐", mime_type:"image/vnd.dxf"},
  {extension:"dgn",  label:"MicroStation Design",  icon:"📐", mime_type:"application/octet-stream"},
  {extension:"step", label:"STEP 3D Model",        icon:"🏗", mime_type:"application/step"},
  {extension:"stp",  label:"STEP File",            icon:"🏗", mime_type:"application/step"},
  {extension:"iges", label:"IGES 3D Model",        icon:"🏗", mime_type:"model/iges"},
  {extension:"stl",  label:"STL 3D Model",         icon:"🏗", mime_type:"model/stl"},
  {extension:"sldprt",label:"SolidWorks Part",     icon:"🏗", mime_type:"application/octet-stream"},
  {extension:"sldasm",label:"SolidWorks Assembly", icon:"🏗", mime_type:"application/octet-stream"},
  {extension:"catpart",label:"CATIA Part",         icon:"🏗", mime_type:"application/octet-stream"},
  {extension:"prt",  label:"Creo Part",            icon:"🏗", mime_type:"application/octet-stream"},
  {extension:"jpeg", label:"JPEG Image",           icon:"🖼", mime_type:"image/jpeg"},
  {extension:"jpg",  label:"JPG Image",            icon:"🖼", mime_type:"image/jpeg"},
  {extension:"png",  label:"PNG Image",            icon:"🖼", mime_type:"image/png"},
  {extension:"tiff", label:"TIFF Image",           icon:"🖼", mime_type:"image/tiff"},
  {extension:"bmp",  label:"Bitmap Image",         icon:"🖼", mime_type:"image/bmp"},
  {extension:"svg",  label:"SVG Vector",           icon:"🖼", mime_type:"image/svg+xml"},
  {extension:"gif",  label:"GIF Image",            icon:"🖼", mime_type:"image/gif"},
  {extension:"webp", label:"WebP Image",           icon:"🖼", mime_type:"image/webp"},
  {extension:"heic", label:"HEIC Image",           icon:"🖼", mime_type:"image/heic"},
  {extension:"psd",  label:"Photoshop",            icon:"🖼", mime_type:"image/vnd.adobe.photoshop"},
  {extension:"mp4",  label:"MP4 Video",            icon:"🎬", mime_type:"video/mp4"},
  {extension:"avi",  label:"AVI Video",            icon:"🎬", mime_type:"video/x-msvideo"},
  {extension:"mov",  label:"QuickTime Video",      icon:"🎬", mime_type:"video/quicktime"},
  {extension:"mkv",  label:"Matroska Video",       icon:"🎬", mime_type:"video/x-matroska"},
  {extension:"wmv",  label:"WMV Video",            icon:"🎬", mime_type:"video/x-ms-wmv"},
  {extension:"webm", label:"WebM Video",           icon:"🎬", mime_type:"video/webm"},
  {extension:"zip",  label:"ZIP Archive",          icon:"🗜", mime_type:"application/zip"},
  {extension:"7z",   label:"7-Zip Archive",        icon:"🗜", mime_type:"application/x-7z-compressed"},
  {extension:"rar",  label:"RAR Archive",          icon:"🗜", mime_type:"application/x-rar-compressed"},
  {extension:"csv",  label:"CSV Data",             icon:"📊", mime_type:"text/csv"},
  {extension:"xml",  label:"XML Data",             icon:"📄", mime_type:"application/xml"},
  {extension:"json", label:"JSON Data",            icon:"📄", mime_type:"application/json"},
  {extension:"txt",  label:"Plain Text",           icon:"📄", mime_type:"text/plain"},
  {extension:"rtf",  label:"Rich Text Format",     icon:"📝", mime_type:"application/rtf"},
  {extension:"html", label:"HTML Document",        icon:"🌐", mime_type:"text/html"},
  {extension:"epub", label:"eBook (EPUB)",         icon:"📖", mime_type:"application/epub+zip"},
  {extension:"chm",  label:"Compiled HTML Help",   icon:"📖", mime_type:"application/vnd.ms-htmlhelp"},
  {extension:"m",    label:"MATLAB Script",        icon:"🔢", mime_type:"text/plain"},
  {extension:"py",   label:"Python Script",        icon:"🔢", mime_type:"text/x-python"},
  {extension:"eml",  label:"Email Message",        icon:"📧", mime_type:"message/rfc822"},
  {extension:"msg",  label:"Outlook Message",      icon:"📧", mime_type:"application/vnd.ms-outlook"},
]

const FMT_BY_EXT = Object.fromEntries(ALL_FORMATS.map(f=>[f.extension, f]))

// ─── Field types for metadata schema ─────────────────────────────────────────
const FIELD_TYPES = [
  { value:'text',        label:'Text (single line)' },
  { value:'textarea',    label:'Text (multi line)' },
  { value:'number',      label:'Number' },
  { value:'date',        label:'Date' },
  { value:'dropdown',    label:'Dropdown (select one)' },
  { value:'multi',       label:'Multi-select' },
  { value:'hierarchical',label:'Hierarchical Dropdown (parent → child)' },
  { value:'checkbox',    label:'Yes / No (checkbox)' },
  { value:'user',        label:'User Search (person picker)' },
]

function MetadataSchemaEditor({ schema = [], onChange, onSave }) {
  // schema = [{key, label, type, required, options, children, restricted}]
  const [fields, setFields] = useState(schema)
  const [editIdx, setEditIdx] = useState(null)
  const [editField, setEditField] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setFields(schema) }, [JSON.stringify(schema)])

  function push(updated) { setFields(updated); onChange(updated) }

  function addField() {
    const nf = { key: `field_${Date.now()}`, label: 'New Field',
      type: 'text', required: false, options: [], children: {} }
    const updated = [...fields, nf]
    push(updated)
    setEditIdx(updated.length - 1)
    setEditField({ ...nf })
  }

  function removeField(idx) {
    const updated = fields.filter((_, i) => i !== idx)
    push(updated)
    if (editIdx === idx) { setEditIdx(null); setEditField(null) }
  }

  async function saveEdit() {
    if (editIdx === null) return
    const updated = fields.map((f, i) => i === editIdx ? { ...editField } : f)
    push(updated)
    setEditIdx(null); setEditField(null)
    if (onSave) {
      setSaving(true)
      try { await onSave(updated) } finally { setSaving(false) }
    }
  }

  function moveField(idx, dir) {
    const updated = [...fields]
    const target  = idx + dir
    if (target < 0 || target >= updated.length) return
    ;[updated[idx], updated[target]] = [updated[target], updated[idx]]
    push(updated)
  }

  const iS = { width: '100%', boxSizing: 'border-box', fontSize: 12,
    padding: '5px 8px', borderRadius: 6, border: '1px solid #d1d5db' }

  return (
    <div style={{ padding: '14px 16px', background: '#fafafa',
      borderTop: '1px dashed #e5e7eb' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#4A148C' }}>
          📋 Document Metadata Fields
        </div>
        <div style={{ fontSize:11, color:'#9ca3af' }}>
          Define custom fields shown when creating/editing this document type
        </div>
        <button onClick={addField} style={{ marginLeft:'auto', padding:'4px 14px',
          borderRadius:6, border:'none', background:'#4A148C', color:'#fff',
          fontSize:11, fontWeight:600, cursor:'pointer' }}>
          + Add Field
        </button>
      </div>

      {fields.length === 0 && (
        <div style={{ fontSize:12, color:'#9ca3af', fontStyle:'italic', paddingBottom:8 }}>
          No custom fields configured. Click + Add Field to define fields for this document type.
        </div>
      )}

      {/* Field list */}
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {fields.map((f, idx) => (
          <div key={f.key} style={{ background:'#fff', border:'1px solid #e5e7eb',
            borderRadius:8, padding:'8px 12px',
            borderLeft: `4px solid ${f.restricted ? '#EF9F27' : f.required ? '#E24B4A' : '#7F77DD'}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ flex:1 }}>
                <span style={{ fontWeight:600, fontSize:12, color:'#111' }}>{f.label}</span>
                <span style={{ marginLeft:8, fontSize:11, color:'#9ca3af' }}>
                  {FIELD_TYPES.find(t=>t.value===f.type)?.label || f.type}
                  {f.required && <span style={{ color:'#E24B4A', marginLeft:6 }}>* required</span>}
                </span>
                {f.restricted && (
                  <span style={{ marginLeft:8, fontSize:10, color:'#854F0B',
                    background:'#FAEEDA', border:'1px solid #EF9F2733', padding:'1px 6px', borderRadius:99 }}>
                    🔒 restricted
                  </span>
                )}
                {f.type === 'hierarchical' && f.options?.length > 0 && (
                  <span style={{ marginLeft:8, fontSize:10, color:'#4A148C',
                    background:'#EDE7F6', padding:'1px 6px', borderRadius:99 }}>
                    {f.options.length} parent options
                  </span>
                )}
                {(f.type === 'dropdown' || f.type === 'multi') && f.options?.length > 0 && (
                  <span style={{ marginLeft:8, fontSize:10, color:'#185FA5',
                    background:'#E6F1FB', padding:'1px 6px', borderRadius:99 }}>
                    {f.options.length} options
                  </span>
                )}
              </div>
              <div style={{ display:'flex', gap:4 }}>
                <button onClick={() => moveField(idx,-1)} disabled={idx===0}
                  style={{ background:'none',border:'none',cursor:idx===0?'not-allowed':'pointer',
                    color:idx===0?'#d1d5db':'#6b7280',fontSize:13 }}>↑</button>
                <button onClick={() => moveField(idx,1)} disabled={idx===fields.length-1}
                  style={{ background:'none',border:'none',cursor:idx===fields.length-1?'not-allowed':'pointer',
                    color:idx===fields.length-1?'#d1d5db':'#6b7280',fontSize:13 }}>↓</button>
                <button onClick={() => { setEditIdx(idx); setEditField({...f}) }}
                  style={{ padding:'2px 10px',borderRadius:5,border:'1px solid #e5e7eb',
                    background:'#f9fafb',color:'#374151',cursor:'pointer',fontSize:11 }}>Edit</button>
                <button onClick={() => removeField(idx)}
                  style={{ padding:'2px 8px',borderRadius:5,border:'1px solid #fca5a5',
                    background:'#fff',color:'#A32D2D',cursor:'pointer',fontSize:11 }}>✕</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Field editor panel */}
      {editIdx !== null && editField && (
        <div style={{ marginTop:14, background:'#EDE7F6', borderRadius:10,
          padding:'14px 16px', border:'1px solid #7F77DD44' }}>
          <div style={{ fontSize:12, fontWeight:700, color:'#4A148C', marginBottom:12 }}>
            Edit Field — {editField.label}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <div>
              <label style={{ fontSize:11, color:'#6b7280', display:'block', marginBottom:3 }}>
                Field Label *
              </label>
              <input value={editField.label}
                onChange={e => setEditField(f=>({...f, label:e.target.value,
                  key: f.key.startsWith('field_') ? e.target.value.toLowerCase().replace(/[^a-z0-9]/g,'_') : f.key}))}
                style={iS} placeholder="e.g. Plant / System Code" />
            </div>
            <div>
              <label style={{ fontSize:11, color:'#6b7280', display:'block', marginBottom:3 }}>
                Field Type *
              </label>
              <select value={editField.type}
                onChange={e => setEditField(f=>({...f, type:e.target.value, options:[], children:{}}))}
                style={iS}>
                {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:11, color:'#6b7280', display:'block', marginBottom:3 }}>
                Field Key (auto-generated)
              </label>
              <input value={editField.key}
                onChange={e => setEditField(f=>({...f, key:e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'')}))}
                style={{...iS, background:'#f0f0f0'}} />
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:16, paddingTop:18 }}>
              <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer' }}>
                <input type="checkbox" checked={editField.required}
                  onChange={e => setEditField(f=>({...f, required:e.target.checked}))} />
                Required field
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer' }}>
                <input type="checkbox" checked={!!editField.restricted}
                  onChange={e => setEditField(f=>({...f, restricted:e.target.checked}))} />
                <span>
                  Restricted
                  <span style={{ marginLeft:5, fontSize:10, background:'#FAEEDA', border:'1px solid #EF9F27',
                    borderRadius:4, padding:'1px 6px', color:'#854F0B', fontWeight:600 }}>
                    non-editable during preparation
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* Dropdown / Multi options */}
          {(editField.type === 'dropdown' || editField.type === 'multi') && (
            <OptionsEditor
              options={editField.options || []}
              onChange={opts => setEditField(f=>({...f, options:opts}))}
              label="Options (one per line or comma separated)"
            />
          )}

          {/* Hierarchical dropdown */}
          {editField.type === 'hierarchical' && (
            <HierarchicalEditor
              options={editField.options || []}
              children_map={editField.children || {}}
              onChange={(opts, ch) => setEditField(f=>({...f, options:opts, children:ch}))}
            />
          )}

          <div style={{ display:'flex', gap:8, marginTop:12, justifyContent:'flex-end' }}>
            <button onClick={() => { setEditIdx(null); setEditField(null) }}
              style={{ padding:'6px 16px',borderRadius:6,border:'1px solid #d1d5db',
                background:'#fff',cursor:'pointer',fontSize:12 }}>Cancel</button>
            <button onClick={saveEdit} disabled={saving}
              style={{ padding:'6px 18px',borderRadius:6,border:'none',
                background: saving ? '#9ca3af' : '#4A148C',color:'#fff',
                cursor: saving ? 'not-allowed' : 'pointer',fontSize:12,fontWeight:600 }}>
              {saving ? 'Saving…' : 'Save Field'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function OptionsEditor({ options, onChange, label }) {
  const [raw, setRaw] = useState((options||[]).join('\n'))
  useEffect(() => { setRaw((options||[]).join('\n')) }, [options.join(',')])

  function commit(val) {
    setRaw(val)
    const parsed = val.split(/[\n,]/).map(s=>s.trim()).filter(Boolean)
    onChange(parsed)
  }

  return (
    <div>
      <label style={{ fontSize:11, color:'#6b7280', display:'block', marginBottom:3 }}>{label}</label>
      <textarea value={raw} onChange={e=>commit(e.target.value)} rows={5}
        placeholder="Option A\nOption B\nOption C"
        style={{ width:'100%',boxSizing:'border-box',fontSize:12,borderRadius:6,
          border:'1px solid #d1d5db',padding:'5px 8px',fontFamily:'inherit',resize:'vertical' }} />
      <div style={{ fontSize:10,color:'#9ca3af',marginTop:2 }}>
        {(options||[]).length} options configured
      </div>
    </div>
  )
}

function HierarchicalEditor({ options, children_map, onChange }) {
  // options = parent list, children_map = { parent: [child, child...] }
  const [parents, setParents] = useState((options||[]).join('\n'))
  const [selected, setSelected] = useState(options?.[0] || '')
  const [childRaw, setChildRaw] = useState('')

  useEffect(() => {
    setParents((options||[]).join('\n'))
    if (options?.length) setSelected(options[0])
  }, [options.join(',')])

  useEffect(() => {
    setChildRaw((children_map?.[selected]||[]).join('\n'))
  }, [selected, JSON.stringify(children_map)])

  function commitParents(val) {
    setParents(val)
    const parsed = val.split(/[\n,]/).map(s=>s.trim()).filter(Boolean)
    if (parsed.length && !parsed.includes(selected)) setSelected(parsed[0])
    onChange(parsed, children_map || {})
  }

  function commitChildren(val) {
    setChildRaw(val)
    const parsed = val.split(/[\n,]/).map(s=>s.trim()).filter(Boolean)
    const updated = { ...(children_map||{}), [selected]: parsed }
    const parentList = parents.split(/[\n,]/).map(s=>s.trim()).filter(Boolean)
    onChange(parentList, updated)
  }

  const parentList = parents.split(/[\n,]/).map(s=>s.trim()).filter(Boolean)

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:4 }}>
        <div>
          <label style={{ fontSize:11, fontWeight:600, color:'#4A148C', display:'block', marginBottom:4 }}>
            Level 1 — Parent options
          </label>
          <textarea value={parents} onChange={e=>commitParents(e.target.value)} rows={7}
            placeholder="Plant A\nPlant B\nPlant C"
            style={{ width:'100%',boxSizing:'border-box',fontSize:12,borderRadius:6,
              border:'1px solid #7F77DD',padding:'5px 8px',fontFamily:'inherit',resize:'vertical' }} />
          <div style={{ fontSize:10,color:'#9ca3af',marginTop:2 }}>{parentList.length} parent options</div>
        </div>
        <div>
          <label style={{ fontSize:11, fontWeight:600, color:'#4A148C', display:'block', marginBottom:4 }}>
            Level 2 — Children of:
          </label>
          <select value={selected} onChange={e=>setSelected(e.target.value)}
            style={{ width:'100%',boxSizing:'border-box',fontSize:12,padding:'5px 8px',
              borderRadius:6,border:'1px solid #7F77DD',marginBottom:6 }}>
            {parentList.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <textarea value={childRaw} onChange={e=>commitChildren(e.target.value)} rows={5}
            placeholder={selected ? `Children of "${selected}"\nUnit 1\nUnit 2` : 'Select a parent first'}
            disabled={!selected}
            style={{ width:'100%',boxSizing:'border-box',fontSize:12,borderRadius:6,
              border:'1px solid #7F77DD',padding:'5px 8px',fontFamily:'inherit',resize:'vertical' }} />
          <div style={{ fontSize:10,color:'#9ca3af',marginTop:2 }}>
            {(children_map?.[selected]||[]).length} children for "{selected}"
          </div>
        </div>
      </div>
      {/* Preview */}
      {parentList.length > 0 && (
        <div style={{ marginTop:10, background:'#fff', borderRadius:6,
          padding:'8px 12px', border:'1px solid #d1d5db', fontSize:11 }}>
          <strong style={{ color:'#4A148C' }}>Preview:</strong>
          <div style={{ marginTop:6, display:'flex', flexWrap:'wrap', gap:6 }}>
            {parentList.map(p => (
              <div key={p} style={{ background:'#EDE7F6', borderRadius:6,
                padding:'4px 10px', fontSize:11, color:'#4A148C' }}>
                {p}
                {children_map?.[p]?.length > 0 && (
                  <span style={{ color:'#9c27b0', marginLeft:6 }}>
                    → {children_map[p].slice(0,3).join(', ')}
                    {children_map[p].length > 3 && ` +${children_map[p].length-3}`}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DocTypesGrid({ toast }) {
  const [rows, setRows]         = useState([])
  const [dirty, setDirty]       = useState({})
  const [newRows, setNewRows]   = useState([])
  const [expanded, setExpanded] = useState(null)  // id of expanded row (formats panel)
  const [loading, setLoading]   = useState(true)

  const load = () => {
    setLoading(true)
    adminAPI.listDocTypes().then(r=>setRows(r.data)).finally(()=>setLoading(false))
  }
  useEffect(load, [])

  function markDirty(id, field, value) {
    setDirty(d=>({...d,[id]:{...(d[id]||{}),[field]:value}}))
  }

  function toggleFormat(row, ext) {
    const current  = row.allowed_formats?.map(f=>f.extension) || []
    const updated  = current.includes(ext) ? current.filter(e=>e!==ext) : [...current, ext]
    const fullFmts = updated.map(e => FMT_BY_EXT[e] || {extension:e})
    markDirty(row.id, 'allowed_formats', fullFmts)
    // optimistic UI
    setRows(rs=>rs.map(r=>r.id===row.id ? {...r, allowed_formats: fullFmts.map(f=>({...f,id:Math.random()}))} : r))
  }

  async function saveRow(row) {
    const changes = dirty[row.id]
    if (!changes) return
    try {
      await adminAPI.updateDocType(row.id, changes)
      setDirty(d=>{const nd={...d};delete nd[row.id];return nd})
      toast('Saved', 'success')
      load()
    } catch(e) { toast(e.response?.data?.detail||'Save failed','error') }
  }

  function addNewRow() {
    setNewRows(nr=>[...nr,{_id:Date.now(),code:'',name:'',description:'',number_pattern:'',allowed_formats:[]}])
  }

  async function saveNewRow(idx) {
    const row = newRows[idx]
    if (!row.code || !row.name) { toast('Code and Name are required','error'); return }
    try {
      await adminAPI.createDocType({ ...row, allowed_formats: row.allowed_formats })
      setNewRows(nr=>nr.filter((_,i)=>i!==idx))
      toast('Document type created','success')
      load()
    } catch(e) { toast(e.response?.data?.detail||'Create failed','error') }
  }

  function updateNewRow(idx,field,val) {
    setNewRows(nr=>nr.map((r,i)=>i===idx?{...r,[field]:val}:r))
  }

  function toggleNewRowFormat(idx,ext) {
    setNewRows(nr=>nr.map((r,i)=>{
      if(i!==idx) return r
      const cur = r.allowed_formats.map(f=>f.extension)
      const upd = cur.includes(ext)?cur.filter(e=>e!==ext):[...cur,ext]
      return {...r, allowed_formats: upd.map(e=>FMT_BY_EXT[e]||{extension:e})}
    }))
  }

  function exportCSV() {
    const csv=[
      'code,name,description,number_pattern,file_formats',
      ...rows.map(r=>[r.code,r.name,r.description,r.number_pattern,r.allowed_formats?.map(f=>f.extension).join(';')].map(v=>JSON.stringify(v??'')).join(','))
    ].join('\n')
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download='doc_types.csv';a.click()
  }

  const thStyle = { padding:'8px 10px', fontWeight:600, fontSize:12, color:C.blue,
    background:'#EBF4FF', borderBottom:`2px solid ${C.accent}`,
    borderRight:`1px solid ${C.border}`, textAlign:'left', whiteSpace:'nowrap' }

  // Group format catalogue by category
  const FMT_GROUPS = [
    { label:'📄 Office Documents', exts:['pdf','doc','docx','xls','xlsx','ppt','pptx','csv','txt','rtf','html'] },
    { label:'📐 Engineering CAD', exts:['dwg','dxf','dgn','step','stp','iges','stl','sldprt','sldasm','catpart','prt'] },
    { label:'🖼 Images',           exts:['jpeg','jpg','png','tiff','bmp','svg','gif','webp','heic','psd'] },
    { label:'🎬 Video / Media',    exts:['mp4','avi','mov','mkv','wmv','webm'] },
    { label:'🗜 Archives',         exts:['zip','7z','rar'] },
    { label:'📊 Data / Code',      exts:['xml','json','m','py','csv','epub','chm'] },
    { label:'📧 Communication',    exts:['eml','msg'] },
  ]

  function FormatsPanel({ row, onChange }) {
    const active = new Set((dirty[row.id]?.allowed_formats || row.allowed_formats || []).map(f=>f.extension))
    return (
      <div style={{padding:'14px 16px', background:'#f8fafc', borderTop:`1px dashed ${C.border}`}}>
        <div style={{fontSize:12,fontWeight:600,color:C.blue,marginBottom:10}}>Allowed File Formats — click to toggle</div>
        {FMT_GROUPS.map(grp=>(
          <div key={grp.label} style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:600,color:C.gray,marginBottom:4}}>{grp.label}</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
              {grp.exts.map(ext=>{
                const fmt = FMT_BY_EXT[ext]
                const on  = active.has(ext)
                return (
                  <button key={ext} onClick={()=>onChange(ext)} style={{
                    padding:'3px 10px', borderRadius:99, fontSize:11, fontWeight:on?600:400,
                    cursor:'pointer', border:`1.5px solid ${on?C.accent:C.border}`,
                    background: on?C.lightBlue:'#fff', color: on?C.accent:C.gray,
                    display:'flex',alignItems:'center',gap:4,
                  }}>
                    <span>{fmt?.icon||'📄'}</span> .{ext}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div style={{display:'flex',gap:10,marginBottom:14,alignItems:'center'}}>
        <div style={{fontSize:13,color:C.gray}}>Click any cell to edit. Expand a row to manage file formats.</div>
        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
          <GBtn label="+ Add Doc Type" onClick={addNewRow} color={C.green} />
          <GBtn label="Export CSV" onClick={exportCSV} color={C.gray} />
        </div>
      </div>

      <div style={{overflowX:'auto',borderRadius:10,border:`1px solid ${C.border}`,background:'#fff'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr>
              {['','Code','Name','Description','Number Pattern','Formats','Active','Actions'].map(h=>(
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{padding:32,textAlign:'center',color:C.gray}}>Loading…</td></tr>}
            {!loading && rows.map(row=>{
              const isExp = expanded===row.id
              const fmts  = (dirty[row.id]?.allowed_formats||row.allowed_formats||[])
              return (
                <>
                  <tr key={row.id}
                    style={{borderBottom:isExp?'none':`1px solid ${C.border}`,background:dirty[row.id]?'#fffbeb':'white'}}
                    onMouseOver={e=>e.currentTarget.style.background=dirty[row.id]?'#fffbeb':C.rowHover}
                    onMouseOut={e=>e.currentTarget.style.background=dirty[row.id]?'#fffbeb':'white'}
                  >
                    <td style={{padding:'4px 8px',borderRight:`1px solid ${C.border}`,textAlign:'center'}}>
                      <button onClick={()=>setExpanded(isExp?null:row.id)} style={{background:'none',border:'none',cursor:'pointer',fontSize:14,color:C.accent}}>
                        {isExp?'▼':'▶'}
                      </button>
                    </td>
                    <Cell value={row.code}           onChange={v=>markDirty(row.id,'code',v)}           width={70} />
                    <Cell value={row.name}           onChange={v=>markDirty(row.id,'name',v)}           width={160} />
                    <Cell value={row.description}    onChange={v=>markDirty(row.id,'description',v)}    width={200} />
                    <Cell value={row.number_pattern} onChange={v=>markDirty(row.id,'number_pattern',v)} width={220} />
                    <td style={{padding:'6px 10px',borderRight:`1px solid ${C.border}`}}>
                      <div style={{display:'flex',flexWrap:'wrap',gap:3,maxWidth:280}}>
                        {fmts.slice(0,6).map(f=>(
                          <span key={f.extension} style={{fontSize:10,background:C.lightBlue,color:C.accent,borderRadius:99,padding:'1px 7px',fontWeight:600}}>
                            {f.icon||'📄'} .{f.extension}
                          </span>
                        ))}
                        {fmts.length>6 && <span style={{fontSize:10,color:C.gray}}>+{fmts.length-6} more</span>}
                      </div>
                    </td>
                    <td style={{padding:'6px 10px',borderRight:`1px solid ${C.border}`}}>
                      <Chip label={row.is_active?'Active':'Inactive'} color={row.is_active?C.green:C.red} />
                    </td>
                    <td style={{padding:'6px 10px',whiteSpace:'nowrap'}}>
                      {dirty[row.id] && <GBtn label="Save" onClick={()=>saveRow(row)} color={C.green} />}
                    </td>
                  </tr>
                  {isExp && (
                    <tr key={`${row.id}-exp`} style={{borderBottom:`1px solid ${C.border}`}}>
                      <td colSpan={8} style={{padding:0}}>
                        <FormatsPanel row={row} onChange={(ext)=>toggleFormat(row,ext)} />
                        <MetadataSchemaEditor
                          schema={dirty[row.id]?.metadata_schema ?? (row.metadata_schema ? (Array.isArray(row.metadata_schema) ? row.metadata_schema : Object.values(row.metadata_schema)) : [])}
                          onChange={fields => markDirty(row.id, 'metadata_schema', fields)}
                          onSave={async fields => {
                            await adminAPI.updateDocType(row.id, { metadata_schema: fields })
                            setDirty(d => { const nd = {...d}; delete nd[row.id]; return nd })
                            load()
                          }}
                        />
                        {dirty[row.id] && (
                          <div style={{padding:'8px 16px',background:'#fffbeb',borderTop:`1px dashed ${C.border}`,display:'flex',gap:8,alignItems:'center'}}>
                            <span style={{fontSize:12,color:C.amber}}>Unsaved changes</span>
                            <GBtn label="Save Changes" onClick={()=>saveRow(row)} color={C.green} />
                            <GBtn label="Discard" onClick={()=>{setDirty(d=>{const nd={...d};delete nd[row.id];return nd});load()}} color={C.red} />
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {/* New rows */}
            {newRows.map((nr,idx)=>(
              <tr key={nr._id} style={{background:'#f0fff4',borderBottom:`1px solid ${C.border}`}}>
                <td style={{padding:'4px 8px',borderRight:`1px solid ${C.border}`}}>
                  <button onClick={()=>setExpanded(`new-${idx}`)} style={{background:'none',border:'none',cursor:'pointer',fontSize:14,color:C.green}}>
                    {expanded===`new-${idx}`?'▼':'▶'}
                  </button>
                </td>
                <td style={{padding:'4px 6px',borderRight:`1px solid ${C.border}`}}>
                  <input value={nr.code} onChange={e=>updateNewRow(idx,'code',e.target.value)} placeholder="DRW *" style={{width:60,fontSize:12,textTransform:'uppercase'}} />
                </td>
                <td style={{padding:'4px 6px',borderRight:`1px solid ${C.border}`}}>
                  <input value={nr.name} onChange={e=>updateNewRow(idx,'name',e.target.value)} placeholder="Type Name *" style={{width:150,fontSize:12}} />
                </td>
                <td style={{padding:'4px 6px',borderRight:`1px solid ${C.border}`}}>
                  <input value={nr.description} onChange={e=>updateNewRow(idx,'description',e.target.value)} placeholder="Description" style={{width:190,fontSize:12}} />
                </td>
                <td style={{padding:'4px 6px',borderRight:`1px solid ${C.border}`}}>
                  <input value={nr.number_pattern} onChange={e=>updateNewRow(idx,'number_pattern',e.target.value)} placeholder="{TYPE}-{YEAR}-{SEQ}" style={{width:200,fontSize:12}} />
                </td>
                <td style={{padding:'4px 6px',borderRight:`1px solid ${C.border}`}}>
                  <span style={{fontSize:11,color:C.gray}}>{nr.allowed_formats.length} formats selected</span>
                </td>
                <td style={{padding:'4px 6px',borderRight:`1px solid ${C.border}`}}>—</td>
                <td style={{padding:'4px 6px',whiteSpace:'nowrap'}}>
                  <div style={{display:'flex',gap:5}}>
                    <GBtn label="Create" onClick={()=>saveNewRow(idx)} color={C.green} />
                    <GBtn label="×" onClick={()=>setNewRows(nr=>nr.filter((_,i)=>i!==idx))} color={C.red} />
                  </div>
                </td>
              </tr>
            ))}
            {newRows.map((nr,idx)=> expanded===`new-${idx}` && (
              <tr key={`new-${idx}-exp`} style={{background:'#f0fff4',borderBottom:`1px solid ${C.border}`}}>
                <td colSpan={8} style={{padding:0}}>
                  <div style={{padding:'14px 16px',background:'#f8fafc',borderTop:`1px dashed ${C.border}`}}>
                    <div style={{fontSize:12,fontWeight:600,color:C.blue,marginBottom:10}}>Select File Formats</div>
                    {FMT_GROUPS.map(grp=>(
                      <div key={grp.label} style={{marginBottom:10}}>
                        <div style={{fontSize:11,fontWeight:600,color:C.gray,marginBottom:4}}>{grp.label}</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                          {grp.exts.map(ext=>{
                            const on = nr.allowed_formats.some(f=>f.extension===ext)
                            const fmt = FMT_BY_EXT[ext]
                            return (
                              <button key={ext} onClick={()=>toggleNewRowFormat(idx,ext)} style={{
                                padding:'3px 10px',borderRadius:99,fontSize:11,fontWeight:on?600:400,
                                cursor:'pointer',border:`1.5px solid ${on?C.accent:C.border}`,
                                background:on?C.lightBlue:'#fff',color:on?C.accent:C.gray,
                                display:'flex',alignItems:'center',gap:4,
                              }}>
                                <span>{fmt?.icon||'📄'}</span> .{ext}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length===0 && newRows.length===0 && (
              <tr><td colSpan={8} style={{padding:32,textAlign:'center',color:C.gray}}>No document types. Click + Add Doc Type to begin.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:8,fontSize:12,color:C.gray}}>
        {rows.length} document type{rows.length!==1?'s':''} · Click ▶ to expand and manage file formats · Yellow rows have unsaved changes
      </div>
    </div>
  )
}

// ─── System Config (Auth Code + SAP SSO) ─────────────────────────────────────
function SystemConfigPanel({ toast }) {
  const [cfg, setCfg]       = useState(null)
  const [form, setForm]     = useState({})
  const [saving, setSaving] = useState(false)
  const [metaXml, setMetaXml] = useState('')

  useEffect(() => {
    adminAPI.getConfig().then(r => { setCfg(r.data); setForm(r.data) })
  }, [])

  function set(k,v) { setForm(f=>({...f,[k]:v})) }

  async function save() {
    setSaving(true)
    try {
      await adminAPI.saveConfig(form)
      toast('Configuration saved','success')
      adminAPI.getConfig().then(r=>{ setCfg(r.data); setForm(r.data) })
    } catch(e) { toast(e.response?.data?.detail||'Save failed','error') }
    finally { setSaving(false) }
  }

  async function loadMetadata() {
    try {
      const res = await authAPI.ssoMetadata()
      setMetaXml(res.data)
    } catch { toast('Could not load metadata','error') }
  }

  if (!cfg) return <div style={{padding:32,textAlign:'center',color:C.gray}}>Loading…</div>

  const sectionStyle = { background:'#fff', border:`1px solid ${C.border}`, borderRadius:12, padding:'1.2rem 1.4rem', marginBottom:16 }
  const labelStyle   = { display:'block', fontSize:12, fontWeight:600, color:C.gray, marginBottom:4 }
  const inputStyle   = { width:'100%', boxSizing:'border-box', fontSize:13 }

  return (
    <div style={{maxWidth:720}}>
      {/* ── Auth Code Gate ── */}
      <div style={sectionStyle}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
          <div style={{fontSize:20}}>🔐</div>
          <div>
            <div style={{fontWeight:700,fontSize:15}}>Access Code Gate</div>
            <div style={{fontSize:12,color:C.gray}}>Require users to enter a code before they can see the login screen.</div>
          </div>
          <label style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
            <div style={{
              width:44, height:24, borderRadius:12, cursor:'pointer',
              background: form.auth_code_enabled ? C.green : '#d1d5db',
              position:'relative', transition:'background 0.2s',
            }} onClick={()=>set('auth_code_enabled',!form.auth_code_enabled)}>
              <div style={{
                position:'absolute', top:3, left: form.auth_code_enabled?20:3,
                width:18, height:18, borderRadius:'50%', background:'#fff',
                transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </div>
            <span style={{fontSize:13,fontWeight:600,color:form.auth_code_enabled?C.green:C.gray}}>
              {form.auth_code_enabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        </div>
        {form.auth_code_enabled && (
          <div>
            <label style={labelStyle}>Set / Change Access Code</label>
            <input type="password" value={form.auth_code||''} onChange={e=>set('auth_code',e.target.value)}
              placeholder="Enter new code (leave blank to keep current)…" style={inputStyle} />
            <div style={{fontSize:11,color:C.gray,marginTop:4}}>Stored as a SHA-256 hash — never stored in plaintext.</div>
          </div>
        )}
      </div>

      {/* ── SAP SSO ── */}
      <div style={sectionStyle}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
          <div style={{width:40,height:24,background:'#003189',borderRadius:5,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <span style={{color:'#fff',fontSize:11,fontWeight:700}}>SAP</span>
          </div>
          <div>
            <div style={{fontWeight:700,fontSize:15}}>SAP Single Sign-On (SAML 2.0)</div>
            <div style={{fontSize:12,color:C.gray}}>Delegate authentication to your SAP Identity Provider.</div>
          </div>
          <label style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
            <div style={{
              width:44,height:24,borderRadius:12,cursor:'pointer',
              background:form.sap_sso_enabled?C.green:'#d1d5db',
              position:'relative',transition:'background 0.2s',
            }} onClick={()=>set('sap_sso_enabled',!form.sap_sso_enabled)}>
              <div style={{
                position:'absolute',top:3,left:form.sap_sso_enabled?20:3,
                width:18,height:18,borderRadius:'50%',background:'#fff',
                transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </div>
            <span style={{fontSize:13,fontWeight:600,color:form.sap_sso_enabled?C.green:C.gray}}>
              {form.sap_sso_enabled?'Enabled':'Disabled'}
            </span>
          </label>
        </div>

        {form.sap_sso_enabled && (
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px 16px'}}>
            <div style={{gridColumn:'1/-1'}}>
              <label style={labelStyle}>SP Entity ID (this application's URL)</label>
              <input value={form.sap_sso_sp_entity_id||''} onChange={e=>set('sap_sso_sp_entity_id',e.target.value)} placeholder="https://dms.npcil.gov.in" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>SAP IDP Entity ID</label>
              <input value={form.sap_sso_entity_id||''} onChange={e=>set('sap_sso_entity_id',e.target.value)} placeholder="https://sap-idp.npcil.gov.in/sap/saml2/idp/metadata" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>SAP IDP SSO URL (Redirect)</label>
              <input value={form.sap_sso_sso_url||''} onChange={e=>set('sap_sso_sso_url',e.target.value)} placeholder="https://sap-idp.npcil.gov.in/sso" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>SAP IDP SLO URL (Logout)</label>
              <input value={form.sap_sso_slo_url||''} onChange={e=>set('sap_sso_slo_url',e.target.value)} placeholder="https://sap-idp.npcil.gov.in/slo" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Frontend URL (for SSO redirect)</label>
              <input value={form.frontend_url||''} onChange={e=>set('frontend_url',e.target.value)} placeholder="http://localhost:3000" style={inputStyle} />
            </div>
            <div style={{gridColumn:'1/-1'}}>
              <label style={labelStyle}>SAP IDP x509 Certificate (PEM, without headers)</label>
              <textarea value={form.sap_sso_cert||''} onChange={e=>set('sap_sso_cert',e.target.value)}
                rows={5} placeholder="MIIC...paste certificate here..." style={{...inputStyle,resize:'vertical',fontFamily:'monospace',fontSize:11}} />
            </div>

            {/* SP Metadata */}
            <div style={{gridColumn:'1/-1',background:'#f0f7ff',border:`1px solid #bfdbfe`,borderRadius:8,padding:'12px 14px'}}>
              <div style={{fontSize:13,fontWeight:600,color:C.blue,marginBottom:6}}>Service Provider Metadata</div>
              <div style={{fontSize:12,color:C.gray,marginBottom:8}}>
                Register this app in SAP IDP using the SP metadata XML. Download and upload it to SAP NetWeaver Trust Manager.
              </div>
              <div style={{display:'flex',gap:8}}>
                <GBtn label="View SP Metadata XML" onClick={loadMetadata} color={C.accent} />
                {metaXml && (
                  <GBtn label="Download XML" onClick={()=>{
                    const a=document.createElement('a')
                    a.href=URL.createObjectURL(new Blob([metaXml],{type:'application/xml'}))
                    a.download='sp-metadata.xml';a.click()
                  }} color={C.green} />
                )}
              </div>
              {metaXml && (
                <pre style={{marginTop:10,fontSize:10,background:'#fff',padding:10,borderRadius:6,overflow:'auto',maxHeight:160,border:`1px solid ${C.border}`}}>
                  {metaXml}
                </pre>
              )}
            </div>

            {/* SAP IDP registration guide */}
            <div style={{gridColumn:'1/-1',background:'#faeeda',border:`1px solid #EF9F27`,borderRadius:8,padding:'12px 14px'}}>
              <div style={{fontSize:13,fontWeight:600,color:C.amber,marginBottom:6}}>SAP IDP Registration Steps</div>
              <ol style={{margin:0,paddingLeft:18,fontSize:12,color:'#5a3000',lineHeight:1.8}}>
                <li>In SAP NetWeaver → <strong>Trust Manager</strong> → <em>Local Service Providers</em> → Add SP using the metadata XML above.</li>
                <li>Set <strong>NameID Format</strong> to <code>emailAddress</code> or configure attribute mapping for <code>email</code>, <code>displayName</code>, <code>employeeNumber</code>, <code>department</code>.</li>
                <li>Under <em>Trusted Identity Providers</em>, add the SAP IDP and download its metadata to fill in the fields above.</li>
                <li>Save this configuration, then test SSO from the Login page.</li>
              </ol>
            </div>
          </div>
        )}
      </div>

      {/* ── App Settings ── */}
      <div style={sectionStyle}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>⚙️ Application Settings</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px 16px'}}>
          <div>
            <label style={labelStyle}>Application Name</label>
            <input value={form.app_name||''} onChange={e=>set('app_name',e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Organisation</label>
            <input value={form.app_org||''} onChange={e=>set('app_org',e.target.value)} style={inputStyle} />
          </div>
        </div>
      </div>

      <GBtn label={saving?'Saving…':'Save All Configuration'} onClick={save} disabled={saving} color={C.blue} />
    </div>
  )
}

// ─── Flagged Documents Panel ──────────────────────────────────────────────────
function FlaggedDocumentsPanel({ toast }) {
  const [docs, setDocs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const nav = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await adminAPI.flaggedDocuments()
      setDocs(r.data)
    } catch {
      setDocs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleRunJob() {
    if (!window.confirm(`Run the deletion job now? This will permanently delete ${docs.length} flagged document(s).`)) return
    setRunning(true)
    try {
      const r = await adminAPI.runDeletionJob()
      toast(`${r.data.deleted} document(s) deleted successfully.`, 'success')
      load()
    } catch (e) {
      toast(e.response?.data?.detail || 'Job failed', 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      {/* Header row */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
        <div>
          <span style={{ fontWeight:700, fontSize:15 }}>🚩 Documents Flagged for Deletion</span>
          <span style={{ marginLeft:10, fontSize:12, color:C.gray }}>
            Scheduled automatic cleanup runs daily at 12:00 AM IST
          </span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <GBtn label="↻ Refresh" onClick={load} color={C.blue} />
          <GBtn
            label={running ? 'Running…' : `Run Deletion Job (${docs.length})`}
            onClick={handleRunJob}
            color={C.red}
            disabled={running || docs.length === 0}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ color:C.gray, fontSize:13 }}>Loading…</div>
      ) : docs.length === 0 ? (
        <div style={{
          border:`1px solid ${C.border}`, borderRadius:8, padding:'32px 20px',
          textAlign:'center', color:C.gray, fontSize:13,
        }}>
          No documents are currently flagged for deletion.
        </div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ background:C.bg }}>
              {['Doc Number','Title','Status','Flagged At'].map(h => (
                <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontWeight:600,
                  borderBottom:`1px solid ${C.border}`, color:C.blue }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {docs.map(d => (
              <tr key={d.id} style={{ borderBottom:`1px solid ${C.border}` }}
                onMouseEnter={e => e.currentTarget.style.background=C.rowHover}
                onMouseLeave={e => e.currentTarget.style.background=''}>
                <td style={{ padding:'8px 12px' }}>
                  <span
                    onClick={() => nav(`/documents/${d.id}`)}
                    style={{ color:C.accent, cursor:'pointer', fontWeight:600 }}>
                    {d.doc_number}
                  </span>
                </td>
                <td style={{ padding:'8px 12px' }}>{d.title}</td>
                <td style={{ padding:'8px 12px' }}>
                  <Chip label={d.status} color={C.amber} />
                </td>
                <td style={{ padding:'8px 12px', color:C.gray }}>
                  {fmtDateTime(d.flagged_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}


// ─── Activity Logs Panel ──────────────────────────────────────────────────────
function ActivityLogsPanel({ toast }) {
  const today = new Date().toISOString().slice(0, 10)
  const [logType,   setLogType]   = useState('deletions')
  const [dateFrom,  setDateFrom]  = useState(today)
  const [dateTo,    setDateTo]    = useState(today)
  const [docTypeId, setDocTypeId] = useState('')
  const [allTypes,  setAllTypes]  = useState([])
  const [rows,      setRows]      = useState([])
  const [summary,   setSummary]   = useState([])
  const [loading,   setLoading]   = useState(false)
  const nav = useNavigate()

  useEffect(() => {
    adminAPI.listDocTypes().then(r => setAllTypes(r.data)).catch(() => {})
    adminAPI.logsSummary().then(r => setSummary(r.data)).catch(() => {})
  }, [])

  const buildParams = useCallback(() => {
    const p = {}
    if (dateFrom)  p.date_from    = dateFrom
    if (dateTo)    p.date_to      = dateTo
    if (docTypeId) p.doc_type_id  = docTypeId
    return p
  }, [dateFrom, dateTo, docTypeId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const fn = logType === 'deletions' ? adminAPI.deletionLogs : adminAPI.creationLogs
      const r  = await fn(buildParams())
      setRows(r.data)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [logType, buildParams])

  useEffect(() => { load() }, [load])

  function handleDownload() {
    const token = localStorage.getItem('dms_token')
    const fn    = logType === 'deletions' ? adminAPI.deletionLogsDownload : adminAPI.creationLogsDownload
    fetch(fn(buildParams()), { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const label = dateFrom === dateTo ? dateFrom : `${dateFrom}_to_${dateTo}`
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${logType}_log_${label || 'all'}.csv`
        a.click()
      })
      .catch(() => toast('Download failed', 'error'))
  }

  // Clicking a day card sets both from & to to that single day
  function selectDay(d) { setDateFrom(d); setDateTo(d) }

  const typeColor = logType === 'deletions' ? C.red : C.green
  const cols = ['Timestamp (IST)', 'Action', 'Doc Number', 'Title', 'Doc Type', 'Status', 'Version', 'User', 'Note']

  const rangeLabel = dateFrom === dateTo
    ? dateFrom
    : `${dateFrom || '…'} → ${dateTo || '…'}`

  return (
    <div>
      {/* Summary strip — last 7 days */}
      {summary.length > 0 && (
        <div style={{ display:'flex', gap:8, marginBottom:20, overflowX:'auto', paddingBottom:4 }}>
          {summary.slice(0, 7).map(s => {
            const active = s.date >= (dateFrom || '') && s.date <= (dateTo || s.date)
            return (
              <div key={s.date} style={{
                minWidth:110, border:`1px solid ${C.border}`, borderRadius:8,
                padding:'8px 12px', fontSize:12, cursor:'pointer',
                background: active ? C.lightBlue : '#fff',
                outline: active ? `2px solid ${C.blue}` : 'none',
              }} onClick={() => selectDay(s.date)}>
                <div style={{ fontWeight:600, marginBottom:4, color:C.blue }}>{s.date}</div>
                <div style={{ color:C.red }}  >🗑 {s.deletions} deleted</div>
                <div style={{ color:C.green }}>📄 {s.creations} created</div>
              </div>
            )
          })}
        </div>
      )}

      {/* Filters */}
      <div style={{ display:'flex', gap:10, alignItems:'flex-end', marginBottom:16, flexWrap:'wrap' }}>
        {/* Log type toggle */}
        <div style={{ display:'flex', borderRadius:8, overflow:'hidden', border:`1px solid ${C.border}` }}>
          {[['deletions','🗑 Deletion Log'],['creations','📄 Creation Log']].map(([id, label]) => (
            <button key={id} onClick={() => setLogType(id)} style={{
              padding:'7px 16px', border:'none', cursor:'pointer', fontSize:12, fontWeight:600,
              background: logType === id ? (id === 'deletions' ? C.red : C.green) : '#fff',
              color: logType === id ? '#fff' : C.gray,
              fontFamily:'inherit',
            }}>{label}</button>
          ))}
        </div>

        <div>
          <div style={{ fontSize:11, color:C.gray, marginBottom:3 }}>From Date (IST)</div>
          <input type="date" value={dateFrom} max={dateTo || today}
            onChange={e => setDateFrom(e.target.value)}
            style={{ padding:'6px 10px', border:`1px solid ${C.border}`, borderRadius:7, fontSize:13 }} />
        </div>

        <div>
          <div style={{ fontSize:11, color:C.gray, marginBottom:3 }}>To Date (IST)</div>
          <input type="date" value={dateTo} min={dateFrom} max={today}
            onChange={e => setDateTo(e.target.value)}
            style={{ padding:'6px 10px', border:`1px solid ${C.border}`, borderRadius:7, fontSize:13 }} />
        </div>

        <div>
          <div style={{ fontSize:11, color:C.gray, marginBottom:3 }}>Document Type</div>
          <select value={docTypeId} onChange={e => setDocTypeId(e.target.value)}
            style={{ padding:'6px 10px', border:`1px solid ${C.border}`, borderRadius:7, fontSize:13 }}>
            <option value=''>All Types</option>
            {allTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div style={{ display:'flex', gap:6, alignItems:'flex-end' }}>
          <GBtn label="Clear" onClick={() => { setDateFrom(''); setDateTo(''); setDocTypeId('') }} color={C.gray} />
          <GBtn label="↻ Refresh" onClick={load} color={C.blue} />
          <GBtn label="⬇ Download CSV" onClick={handleDownload} color={typeColor} disabled={rows.length === 0} />
        </div>
      </div>

      {/* Record count */}
      <div style={{ fontSize:12, color:C.gray, marginBottom:8 }}>
        {loading ? 'Loading…' : `${rows.length} record(s) found`}
        {rangeLabel && <span> for <strong>{rangeLabel}</strong></span>}
      </div>

      {/* Table */}
      {!loading && rows.length === 0 ? (
        <div style={{ border:`1px solid ${C.border}`, borderRadius:8, padding:'32px 20px',
          textAlign:'center', color:C.gray, fontSize:13 }}>
          No records found for the selected filters.
        </div>
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:C.bg }}>
                {cols.map(h => (
                  <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontWeight:600,
                    borderBottom:`1px solid ${C.border}`, color:C.blue, whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom:`1px solid ${C.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background=C.rowHover}
                  onMouseLeave={e => e.currentTarget.style.background=''}>
                  <td style={{ padding:'7px 10px', whiteSpace:'nowrap', color:C.gray }}>{r.timestamp_ist}</td>
                  <td style={{ padding:'7px 10px' }}>
                    <Chip label={r.action}
                      color={r.action.includes('Delet') ? C.red : C.green} />
                  </td>
                  <td style={{ padding:'7px 10px' }}>
                    {r.doc_id ? (
                      <span onClick={() => nav(`/documents/${r.doc_id}`)}
                        style={{ color:C.accent, cursor:'pointer', fontWeight:600 }}>
                        {r.doc_number}
                      </span>
                    ) : r.doc_number || '—'}
                  </td>
                  <td style={{ padding:'7px 10px', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                    title={r.doc_title}>{r.doc_title || '—'}</td>
                  <td style={{ padding:'7px 10px', whiteSpace:'nowrap' }}>{r.doc_type || '—'}</td>
                  <td style={{ padding:'7px 10px' }}>{r.status ? <Chip label={r.status} color={C.accent} /> : '—'}</td>
                  <td style={{ padding:'7px 10px' }}>{r.version || '—'}</td>
                  <td style={{ padding:'7px 10px', whiteSpace:'nowrap' }}>{r.user_name || '—'}</td>
                  <td style={{ padding:'7px 10px', color:C.gray, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                    title={r.note}>{r.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}


// ─── Main Admin page ──────────────────────────────────────────────────────────
const TABS = [
  { id:'users',    label:'👤 Users' },
  { id:'doctypes', label:'📂 Document Types' },
  { id:'config',   label:'⚙️ System Config' },
  { id:'flagged',  label:'🚩 Flagged for Deletion' },
  { id:'logs',     label:'📋 Activity Logs' },
]

export default function Admin() {
  const [tab, setTab]   = useState('users')
  const [toast, showToast] = useToast()

  return (
    <div style={{padding:'28px 32px',fontFamily:'system-ui,-apple-system,sans-serif'}}>
      <div style={{marginBottom:24}}>
        <h1 style={{margin:'0 0 4px',fontSize:20,fontWeight:700}}>Administration</h1>
        <p style={{margin:0,color:C.gray,fontSize:13}}>Manage users, document types, file formats and system configuration</p>
      </div>

      {/* Tab bar */}
      <div style={{display:'flex',gap:2,borderBottom:`2px solid ${C.border}`,marginBottom:24}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            padding:'9px 20px',border:'none',background:'none',cursor:'pointer',
            fontSize:13,fontWeight:tab===t.id?700:400,fontFamily:'inherit',
            color:tab===t.id?C.blue:C.gray,
            borderBottom:tab===t.id?`3px solid ${C.blue}`:'3px solid transparent',
            marginBottom:-2,
          }}>{t.label}</button>
        ))}
      </div>

      {tab==='users'    && <UsersGrid             toast={showToast} />}
      {tab==='doctypes' && <DocTypesGrid          toast={showToast} />}
      {tab==='config'   && <SystemConfigPanel     toast={showToast} />}
      {tab==='flagged'  && <FlaggedDocumentsPanel toast={showToast} />}
      {tab==='logs'     && <ActivityLogsPanel     toast={showToast} />}

      <Toast msg={toast?.msg} type={toast?.type} />
    </div>
  )
}
