import { useState, useCallback, useEffect, useRef } from 'react'
import { documentsAPI, adminAPI } from '../api'
import { Modal, Input, Select, Btn, SearchableSelect } from './ui'

export default function UploadModal({ onClose, onSuccess }) {
  const [docTypes, setDocTypes]   = useState([])
  const [selDocType, setSelDocType] = useState(null)  // full doc type object
  const [form, setForm] = useState({
    title: '', doc_type_id: '', confidential: false,
    change_reason: 'Initial upload',
  })
  const [customMeta, setCustomMeta] = useState({})   // key → value for dynamic fields
  const [hierSel, setHierSel]       = useState({})   // key → selected parent (for hierarchical)
  const [files, setFiles]     = useState([])
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]       = useState('')
  const [pdfPageCount, setPdfPageCount] = useState(null)

  useEffect(() => { adminAPI.listDocTypes().then(r => setDocTypes(r.data)) }, [])

  // When doc type changes, set selected doc type object & reset custom metadata
  useEffect(() => {
    if (!form.doc_type_id) { setSelDocType(null); setCustomMeta({}); setHierSel({}); return }
    const dt = docTypes.find(d => String(d.id) === String(form.doc_type_id))
    setSelDocType(dt || null)
    setForm(f => ({ ...f, title: dt?.name || '' }))
    setCustomMeta({})
    setHierSel({})
    setPdfPageCount(null)
  }, [form.doc_type_id, docTypes])

  // Count pages in a PDF file using PDF.js via browser
  async function countPdfPages(file) {
    return new Promise(resolve => {
      if (!file.name.toLowerCase().endsWith('.pdf')) { resolve(null); return }
      const reader = new FileReader()
      reader.onload = e => {
        try {
          // Quick page count: count /Page objects in PDF binary
          const text = new Uint8Array(e.target.result)
          const str  = new TextDecoder('latin1').decode(text)
          // Count /Type /Page occurrences (standard PDF page marker)
          const matches = str.match(/\/Type\s*\/Page[^s]/g)
          if (matches && matches.length > 0) {
            resolve(matches.length)
          } else {
            // Fallback: count stream objects as rough estimate
            const streams = (str.match(/\/Page/g) || []).length
            resolve(streams > 0 ? streams : null)
          }
        } catch { resolve(null) }
      }
      reader.onerror = () => resolve(null)
      reader.readAsArrayBuffer(file)
    })
  }

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false)
    const dropped = Array.from(e.dataTransfer?.files || e.target.files || [])
    setFiles(prev => [...prev, ...dropped])

    // Auto-count PDF pages for "Number of Sheets" field
    dropped.forEach(async file => {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const pages = await countPdfPages(file)
        if (pages && pages > 0) {
          // Find the Number of Sheets field key in schema
          const schemaArr = (() => {
            const dt = docTypes.find(d => String(d.id) === String(form.doc_type_id))
            const s = dt?.metadata_schema
            if (!s) return []
            return Array.isArray(s) ? s : Object.values(s)
          })()
          const sheetsField = schemaArr.find(f =>
            f.label?.toLowerCase().includes('number of sheet') ||
            f.key?.toLowerCase().includes('number_of_sheet')
          )
          if (sheetsField) {
            setCustomMeta(m => ({ ...m, [sheetsField.key]: String(pages) }))
            setPdfPageCount(pages)
          }
        }
      }
    })
  }, [docTypes, form.doc_type_id])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  function setMeta(k, v) { setCustomMeta(m => ({ ...m, [k]: v })) }

  // Get schema fields from selected doc type
  const schemaFields = (() => {
    if (!selDocType?.metadata_schema) return []
    const s = selDocType.metadata_schema
    if (Array.isArray(s)) return s
    if (typeof s === 'object') return Object.values(s)
    return []
  })()

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.doc_type_id) { setError('Document Type is required.'); return }

    // Validate required custom fields
    for (const f of schemaFields) {
      if (f.required && !customMeta[f.key]?.toString().trim()) {
        setError(`"${f.label}" is required for this document type.`)
        return
      }
    }

    setLoading(true); setError('')
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => {
        if (k === 'tags') fd.append(k, JSON.stringify(v.split(',').map(t => t.trim()).filter(Boolean)))
        else fd.append(k, v === true ? 'true' : v === false ? 'false' : v)
      })
      fd.append('custom_metadata', JSON.stringify(customMeta))
      files.forEach(f => fd.append('files', f))
      await documentsAPI.create(fd)
      onSuccess(); onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Creation failed')
    } finally { setLoading(false) }
  }

  const dtOptions = docTypes.map(d => ({ value: d.id, label: `${d.code} — ${d.name}` }))

  // ── Dynamic field renderer ────────────────────────────────────────────────────
  function renderField(field) {
    const val = customMeta[field.key] ?? ''
    const req  = field.required
    const lbl  = `${field.label}${req ? ' *' : ''}`
    const iS   = { width:'100%', boxSizing:'border-box', fontSize:13, padding:'7px 10px',
                   borderRadius:7, border:'1px solid #d1d5db' }

    switch (field.type) {
      case 'text': {
        const isAutoSheets = (
          field.label?.toLowerCase().includes('number of sheet') ||
          field.key?.toLowerCase().includes('number_of_sheet')
        ) && pdfPageCount !== null
        return (
          <div key={field.key}>
            <label style={{ fontSize:11, color:'#6b7280', display:'block', marginBottom:3 }}>
              {lbl}
              {isAutoSheets && (
                <span style={{ marginLeft:8, fontSize:10, background:'#E1F5EE',
                  color:'#0F6E56', padding:'1px 7px', borderRadius:99, fontWeight:500 }}>
                  ✓ Auto-detected from PDF
                </span>
              )}
            </label>
            <input value={val} onChange={e => setMeta(field.key, e.target.value)}
              style={{ ...iS, borderColor: isAutoSheets ? '#1D9E75' : undefined }}
              placeholder={field.placeholder || ''} />
            {isAutoSheets && (
              <div style={{ fontSize:10, color:'#0F6E56', marginTop:2 }}>
                {pdfPageCount} page{pdfPageCount !== 1 ? 's' : ''} detected in uploaded PDF
              </div>
            )}
          </div>
        )
      }
      case 'textarea':
        return (
          <div key={field.key} style={{ gridColumn:'1/-1' }}>
            <label style={{ fontSize:11, color:'#6b7280', display:'block', marginBottom:3 }}>{lbl}</label>
            <textarea value={val} onChange={e => setMeta(field.key, e.target.value)}
              rows={3} style={{ ...iS, fontFamily:'inherit', resize:'vertical' }} />
          </div>
        )
      case 'number':
        return (
          <div key={field.key}>
            <label style={{ fontSize:11, color:'#6b7280', display:'block', marginBottom:3 }}>{lbl}</label>
            <input type="number" value={val} onChange={e => setMeta(field.key, e.target.value)} style={iS} />
          </div>
        )
      case 'date':
        return (
          <div key={field.key}>
            <label style={{ fontSize:11, color:'#6b7280', display:'block', marginBottom:3 }}>{lbl}</label>
            <input type="date" value={val} onChange={e => setMeta(field.key, e.target.value)} style={iS} />
          </div>
        )
      case 'checkbox':
        return (
          <div key={field.key} style={{ display:'flex', alignItems:'center', gap:8, paddingTop:18 }}>
            <input type="checkbox" id={field.key} checked={!!val}
              onChange={e => setMeta(field.key, e.target.checked)} />
            <label htmlFor={field.key} style={{ fontSize:13, cursor:'pointer' }}>{lbl}</label>
          </div>
        )
      case 'dropdown':
        return (
          <div key={field.key} style={{ position:'relative' }}>
            <label style={{ fontSize:11, color:'#6b7280', display:'block', marginBottom:3 }}>{lbl}</label>
            <SearchableSelect
              options={field.options || []}
              value={val}
              onChange={v => setMeta(field.key, v)}
              placeholder={'— Select ' + field.label + ' —'}
            />
          </div>
        )
      case 'multi':
        return (
          <div key={field.key} style={{ gridColumn:'1/-1' }}>
            <label style={{ fontSize:11, color:'#6b7280', display:'block', marginBottom:3 }}>{lbl}</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {(field.options || []).map(opt => {
                const selected = (val || []).includes(opt)
                return (
                  <button type="button" key={opt} onClick={() => {
                    const cur = Array.isArray(val) ? val : []
                    setMeta(field.key, selected ? cur.filter(v=>v!==opt) : [...cur, opt])
                  }} style={{
                    padding:'4px 12px', borderRadius:99, fontSize:12, cursor:'pointer',
                    border:`1.5px solid ${selected ? '#185FA5' : '#d1d5db'}`,
                    background: selected ? '#E6F1FB' : '#fff',
                    color: selected ? '#185FA5' : '#374151', fontWeight: selected ? 600 : 400,
                  }}>{opt}</button>
                )
              })}
            </div>
          </div>
        )
      case 'hierarchical': {
        const parentVal = hierSel[field.key] || ''
        const children  = (field.children || {})[parentVal] || []
        return (
          <div key={field.key} style={{ gridColumn:'1/-1' }}>
            <label style={{ fontSize:11, color:'#6b7280', display:'block', marginBottom:3 }}>{lbl}</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <div>
                <label style={{ fontSize:10, color:'#9ca3af', marginBottom:2, display:'block' }}>
                  Level 1 (Parent)
                </label>
                <SearchableSelect
                  options={field.options || []}
                  value={parentVal}
                  placeholder={'— Select Level 1 —'}
                  onChange={v => {
                    setHierSel(h => ({...h, [field.key]: v}))
                    setMeta(field.key, v)
                  }}
                />
              </div>
              {children.length > 0 && (
                <div>
                  <label style={{ fontSize:10, color:'#9ca3af', marginBottom:2, display:'block' }}>
                    Level 2 (Sub-option of "{parentVal}")
                  </label>
                  <SearchableSelect
                    options={children}
                    value={customMeta[field.key + '_child'] || ''}
                    placeholder={'— Select Level 2 —'}
                    onChange={v => setMeta(field.key + '_child', v)}
                  />
                </div>
              )}
            </div>
            {parentVal && (
              <div style={{ fontSize:11, color:'#185FA5', marginTop:4 }}>
                Selected: {parentVal}{customMeta[field.key+'_child'] ? ` → ${customMeta[field.key+'_child']}` : ''}
              </div>
            )}
          </div>
        )
      }
      default:
        return (
          <div key={field.key}>
            <label style={{ fontSize:11, color:'#6b7280', display:'block', marginBottom:3 }}>{lbl}</label>
            <input value={val} onChange={e => setMeta(field.key, e.target.value)} style={iS} />
          </div>
        )
    }
  }

  return (
    <Modal title="Create New Document" onClose={onClose} width={680}>
      <form onSubmit={handleSubmit}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>

          {/* Fixed fields */}
          <Select label="Document Type" required value={form.doc_type_id}
            onChange={v => set('doc_type_id', v)} options={dtOptions} />

          {/* Serial Number — system generated, shown as info */}
          {form.doc_type_id && (
            <div>
              <label style={{ fontSize:11, color:'#6b7280', display:'block', marginBottom:3 }}>
                Document Number / Serial No.
              </label>
              <div style={{
                padding:'7px 12px', borderRadius:7, border:'1px dashed #d1d5db',
                background:'#f8fafc', fontSize:12, color:'#9ca3af',
                display:'flex', alignItems:'center', gap:8,
              }}>
                <span>⚙</span>
                <span>Auto-generated on creation — follows <strong>{selDocType?.number_pattern || '{CODE}-{YEAR}-{SEQ}'}</strong> sequence for {selDocType?.name}</span>
              </div>
            </div>
          )}
          <div style={{ display:'flex', alignItems:'center', gap:8, paddingTop:20 }}>
            <input type="checkbox" id="conf" checked={form.confidential}
              onChange={e => set('confidential', e.target.checked)} />
            <label htmlFor="conf" style={{ fontSize:13, cursor:'pointer' }}>Confidential Document</label>
          </div>
          <div style={{ gridColumn:'1/-1' }}>
            <Input label="Change Reason / Notes" value={form.change_reason}
              onChange={v => set('change_reason', v)} />
          </div>
        </div>

        {/* Dynamic metadata fields for selected document type */}
        {schemaFields.length > 0 && (
          <div style={{ marginTop:16, paddingTop:14,
            borderTop:'2px dashed #7F77DD',
          }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#4A148C', marginBottom:10,
              display:'flex', alignItems:'center', gap:8 }}>
              <span>📋</span>
              {selDocType?.name} — Specific Fields
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px 16px' }}>
              {schemaFields.map(field => renderField(field))}
            </div>
          </div>
        )}

        {/* File drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={{ border:`2px dashed ${dragging ? '#185FA5' : '#d1d5db'}`, borderRadius:10,
            padding:'20px', textAlign:'center', background: dragging ? '#f0f7ff' : '#fafafa',
            marginTop:16, marginBottom:16, cursor:'pointer' }}
          onClick={() => document.getElementById('file-input').click()}
        >
          <div style={{ fontSize:28, marginBottom:6 }}>📎</div>
          <div style={{ fontSize:13, color:'#374151', fontWeight:500 }}>
            Drop files here or click to browse
          </div>
          <div style={{ fontSize:11, color:'#9ca3af', marginTop:4 }}>
            PDF · DWG · CAD · DOC · XLS · PPT · JPEG · ZIP · Video · TIFF · BMP
          </div>
          <input id="file-input" type="file" multiple style={{ display:'none' }} onChange={onDrop} />
        </div>

        {pdfPageCount !== null && (
          <div style={{ margin:'4px 0 6px', padding:'6px 12px',
            background:'#E1F5EE', border:'1px solid #1D9E75',
            borderRadius:7, fontSize:12, color:'#0F6E56',
            display:'flex', alignItems:'center', gap:6 }}>
            <span>📄</span>
            <span>
              <strong>{pdfPageCount} page{pdfPageCount !== 1 ? 's' : ''}</strong> detected in PDF
              — "Number of Sheets" field auto-filled
            </span>
          </div>
        )}
        {files.length > 0 && (
          <div style={{ marginBottom:14 }}>
            {files.map((f, i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between',
                alignItems:'center', padding:'6px 10px', background:'#f0f7ff',
                borderRadius:6, marginBottom:4, fontSize:13 }}>
                <span>📄 {f.name} <span style={{ color:'#9ca3af' }}>({(f.size/1024).toFixed(0)} KB)</span></span>
                <button type="button" onClick={() => setFiles(files.filter((_,j)=>j!==i))}
                  style={{ background:'none',border:'none',color:'#A32D2D',cursor:'pointer',fontSize:16 }}>×</button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div style={{ background:'#FCEBEB', color:'#A32D2D', borderRadius:8,
            padding:'8px 12px', fontSize:13, marginBottom:12 }}>{error}</div>
        )}

        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <Btn label="Cancel" onClick={onClose} />
          <Btn label={loading ? 'Creating…' : 'Create Document'} variant="primary"
            disabled={loading} onClick={handleSubmit} />
        </div>
      </form>
    </Modal>
  )
}
