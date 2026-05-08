import { useState, useEffect, useRef } from 'react'

// ─── Status badge ─────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  'Draft':        { bg: '#EAF3DE', text: '#3B6D11', border: '#639922' },
  'Under Review': { bg: '#FAEEDA', text: '#854F0B', border: '#EF9F27' },
  'Approved':     { bg: '#E1F5EE', text: '#0F6E56', border: '#1D9E75' },
  'Released':     { bg: '#E1F5EE', text: '#0F6E56', border: '#1D9E75' },
  'Superseded':   { bg: '#F1EFE8', text: '#5F5E5A', border: '#B4B2A9' },
  'Rejected':     { bg: '#FCEBEB', text: '#A32D2D', border: '#E24B4A' },
  'Archived':     { bg: '#F1EFE8', text: '#5F5E5A', border: '#888780' },
  'Expired':      { bg: '#FAECE7', text: '#993C1D', border: '#D85A30' },
  'Prepare':      { bg: '#E6F1FB', text: '#185FA5', border: '#378ADD' },
  'Check':        { bg: '#FAEEDA', text: '#854F0B', border: '#EF9F27' },
  'Review':       { bg: '#EEEDFE', text: '#534AB7', border: '#7F77DD' },
  'Approve':      { bg: '#E1F5EE', text: '#0F6E56', border: '#1D9E75' },
  'Completed':    { bg: '#E1F5EE', text: '#0F6E56', border: '#1D9E75' },
  'Pending':      { bg: '#FAEEDA', text: '#854F0B', border: '#EF9F27' },
}

export function Badge({ label, size = 'sm' }) {
  const c = STATUS_COLORS[label] || { bg: '#F1EFE8', text: '#5F5E5A', border: '#B4B2A9' }
  return (
    <span style={{
      display: 'inline-block',
      padding: size === 'sm' ? '2px 10px' : '4px 14px',
      borderRadius: 99, fontSize: size === 'sm' ? 11 : 13, fontWeight: 500,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────
const BTN_VARIANTS = {
  default: { background: 'transparent', color: 'var(--c-text)', border: '1px solid #ccc' },
  primary: { background: '#185FA5', color: '#fff', border: 'none' },
  success: { background: '#0F6E56', color: '#fff', border: 'none' },
  danger:  { background: '#A32D2D', color: '#fff', border: 'none' },
  warning: { background: '#854F0B', color: '#fff', border: 'none' },
  ghost:   { background: 'transparent', color: '#185FA5', border: '1px solid #185FA5' },
}

export function Btn({ label, onClick, variant = 'default', disabled = false, icon, size = 'md', style = {}, title }) {
  const v = BTN_VARIANTS[variant] || BTN_VARIANTS.default
  const pad = size === 'sm' ? '4px 10px' : '7px 16px'
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      padding: pad, borderRadius: 8, fontSize: size === 'sm' ? 12 : 13,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
      ...v, ...style,
    }}>
      {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
      {label}
    </button>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, style = {}, highlight = false }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 12,
      border: highlight ? '1.5px solid #185FA5' : '1px solid #e5e7eb',
      padding: '1rem 1.25rem', ...style,
    }}>{children}</div>
  )
}

// ─── Input ────────────────────────────────────────────────────────────────────
export function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && (
        <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>
          {label}{required && <span style={{ color: '#A32D2D', marginLeft: 2 }}>*</span>}
        </label>
      )}
      {children}
    </div>
  )
}

export function Input({ label, required, value, onChange, placeholder, type = 'text', style = {}, ...rest }) {
  return (
    <Field label={label} required={required}>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} style={{ width: '100%', boxSizing: 'border-box', ...style }} {...rest} />
    </Field>
  )
}

export function Select({ label, required, value, onChange, options, placeholder = '— Select —' }) {
  return (
    <Field label={label} required={required}>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%' }}>
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
        ))}
      </select>
    </Field>
  )
}

export function Textarea({ label, required, value, onChange, rows = 3, placeholder }) {
  return (
    <Field label={label} required={required}>
      <textarea value={value} onChange={e => onChange(e.target.value)}
        rows={rows} placeholder={placeholder}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }} />
    </Field>
  )
}

// ─── Metric card ──────────────────────────────────────────────────────────────
export function Metric({ label, value, color = '#111', sub }) {
  return (
    <div style={{ background: '#f9fafb', borderRadius: 10, padding: '1rem', textAlign: 'center', border: '1px solid #f0f0f0' }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────────
export function Table({ columns, rows, onRowClick }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            {columns.map(c => (
              <th key={c.key} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: '#374151', whiteSpace: 'nowrap' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}
              onClick={() => onRowClick && onRowClick(row)}
              style={{
                borderBottom: '1px solid #f3f4f6',
                cursor: onRowClick ? 'pointer' : 'default',
                background: 'white',
              }}
              onMouseOver={e => onRowClick && (e.currentTarget.style.background = '#f0f7ff')}
              onMouseOut={e => (e.currentTarget.style.background = 'white')}
            >
              {columns.map(c => (
                <td key={c.key} style={{ padding: '10px 12px', color: '#374151' }}>
                  {c.render ? c.render(row[c.key], row) : row[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>No records found</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── SearchableSelect ─────────────────────────────────────────────────────────
// Shared keyboard-accessible dropdown used across all modals/pages.
// options: string[] OR {value, label}[]
export function SearchableSelect({ options = [], value, onChange, placeholder }) {
  const [open, setOpen]               = useState(false)
  const [search, setSearch]           = useState('')
  const [dropRect, setDropRect]       = useState(null)
  const [highlighted, setHighlighted] = useState(-1)
  const ref        = useRef(null)
  const triggerRef = useRef(null)
  const listRef    = useRef(null)

  const optVal   = o => (o && typeof o === 'object') ? o.value : o
  const optLabel = o => (o && typeof o === 'object') ? o.label : o
  const selectedLabel = (() => {
    if (!value) return null
    const m = options.find(o => optVal(o) === value)
    return m ? optLabel(m) : value
  })()

  useEffect(() => {
    const onDown  = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onScroll = e => { if (ref.current && ref.current.contains(e.target)) return; setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('scroll', onScroll, true) }
  }, [])

  const filtered = options.filter(o => !search.trim() || optLabel(o).toLowerCase().includes(search.toLowerCase()))
  useEffect(() => { setHighlighted(-1) }, [search])
  useEffect(() => {
    if (highlighted >= 0 && listRef.current)
      listRef.current.children[highlighted]?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const openDrop  = () => { if (ref.current) setDropRect(ref.current.getBoundingClientRect()); setOpen(true); setSearch(''); setHighlighted(-1) }
  const closeDrop = () => { setOpen(false); setSearch(''); setHighlighted(-1) }
  const selectOpt = opt => { onChange(optVal(opt)); closeDrop(); triggerRef.current?.focus() }
  const handleBlur = e => { if (!ref.current?.contains(e.relatedTarget)) closeDrop() }

  const handleTriggerKey = e => {
    if (e.key === 'Enter' || e.key === ' ' || (e.key === 'ArrowDown' && e.altKey)) { e.preventDefault(); if (!open) openDrop() }
    if (e.key === 'Escape') closeDrop()
  }
  const handleSearchKey = e => {
    if (e.key === 'Escape' || (e.key === 'ArrowUp' && e.altKey)) { closeDrop(); triggerRef.current?.focus(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => h <= 0 ? -1 : h - 1); return }
    if (e.key === 'Enter' || (e.key === ' ' && highlighted >= 0)) {
      e.preventDefault()
      if (highlighted >= 0 && filtered[highlighted]) selectOpt(filtered[highlighted])
      else if (e.key === 'Enter' && filtered.length === 1) selectOpt(filtered[0])
    }
  }

  const iS = { width:'100%', boxSizing:'border-box', fontSize:13, padding:'7px 10px', borderRadius:7, border:'1px solid #d1d5db' }

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <div ref={triggerRef} tabIndex={0}
        onClick={() => open ? closeDrop() : openDrop()}
        onKeyDown={handleTriggerKey} onBlur={handleBlur}
        onFocus={e => e.currentTarget.style.borderColor = '#3b82f6'}
        style={{ ...iS, cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center',
          background:'#fff', userSelect:'none', outline:'none',
          color: value ? '#111' : '#9ca3af', borderColor: open ? '#3b82f6' : '#d1d5db' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>
          {selectedLabel || placeholder || '— Select —'}
        </span>
        <span style={{ marginLeft:8, fontSize:10, color:'#9ca3af', flexShrink:0 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && dropRect && (() => {
        const MAX_H   = 280
        const GAP     = 4
        const vw      = window.innerWidth
        const vh      = window.innerHeight
        const below   = vh - dropRect.bottom - GAP
        const above   = dropRect.top - GAP
        const flipUp  = below < 160 && above > below
        const maxH    = Math.max(80, Math.min(MAX_H, flipUp ? above : below) - GAP)
        const top     = flipUp ? dropRect.top - GAP - maxH : dropRect.bottom + GAP
        const rawLeft = dropRect.left
        const left    = Math.max(8, Math.min(rawLeft, vw - dropRect.width - 8))
        return (
        <div style={{ position:'fixed', top, left, width: dropRect.width,
          background:'#fff', border:'1px solid #d1d5db', borderRadius:8, zIndex:9999,
          boxShadow:'0 8px 24px rgba(0,0,0,0.15)', display:'flex', flexDirection:'column', maxHeight: maxH }}>
          <div style={{ padding:'6px 8px', borderBottom:'1px solid #f0f0f0', flexShrink:0 }}>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearchKey} onBlur={handleBlur}
              placeholder="Type to search or ↑↓ to navigate…"
              onClick={e => e.stopPropagation()}
              style={{ width:'100%', boxSizing:'border-box', fontSize:12, padding:'5px 8px', borderRadius:6, border:'1px solid #e5e7eb' }} />
          </div>
          <div onClick={() => { onChange(''); closeDrop() }}
            onMouseDown={e => e.preventDefault()}
            style={{ padding:'7px 12px', fontSize:12, color:'#9ca3af', cursor:'pointer', borderBottom:'1px solid #f9fafb', flexShrink:0 }}
            onMouseEnter={e => e.currentTarget.style.background='#f9fafb'}
            onMouseLeave={e => e.currentTarget.style.background='#fff'}>
            — Clear selection —
          </div>
          <div ref={listRef} style={{ overflowY:'auto', flex:1 }}>
            {filtered.length === 0
              ? <div style={{ padding:'10px 12px', fontSize:12, color:'#9ca3af', textAlign:'center' }}>No matches found</div>
              : filtered.map((opt, idx) => {
                  const v = optVal(opt), l = optLabel(opt)
                  const isSel = value === v, isHl = idx === highlighted
                  return (
                    <div key={v} onClick={() => selectOpt(opt)}
                      onMouseDown={e => e.preventDefault()}
                      onMouseEnter={() => setHighlighted(idx)} onMouseLeave={() => setHighlighted(-1)}
                      style={{ padding:'8px 12px', fontSize:12, cursor:'pointer', borderBottom:'1px solid #f9fafb',
                        background: isHl ? '#dbeafe' : isSel ? '#E6F1FB' : '#fff',
                        color: isSel ? '#0C447C' : '#111', fontWeight: isSel ? 600 : 400 }}>
                      {l}
                    </div>
                  )
                })
            }
          </div>
          <div style={{ padding:'4px 8px', borderTop:'1px solid #f0f0f0', fontSize:10, color:'#9ca3af', textAlign:'right', flexShrink:0 }}>
            {filtered.length} of {options.length} options
          </div>
        </div>
        )
      })()}
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, width = 560 }) {
  const innerRef = useRef(null)

  useEffect(() => {
    // Auto-focus first form field (skips the × close button)
    const firstField = innerRef.current?.querySelector(
      'input:not([type="hidden"]), select, textarea, [tabindex="0"]'
    )
    const t = setTimeout(() => firstField?.focus(), 30)

    // Escape closes modal
    const onEsc = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEsc)
    return () => { clearTimeout(t); document.removeEventListener('keydown', onEsc) }
  }, [])

  // Focus trap — Tab/Shift+Tab stay inside modal
  const handleKeyDown = e => {
    if (e.key !== 'Tab') return
    const sel = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const nodes = [...(innerRef.current?.querySelectorAll(sel) || [])]
    if (!nodes.length) return
    const first = nodes[0], last = nodes[nodes.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.45)',
      display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div ref={innerRef} onKeyDown={handleKeyDown}
        style={{ background:'#fff', borderRadius:14, width, maxWidth:'95vw',
          maxHeight:'90vh', overflowY:'auto', padding:'1.5rem',
          boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h3 style={{ margin:0, fontSize:16, fontWeight:600 }}>{title}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#6b7280' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <div style={{
        width: 32, height: 32, border: '3px solid #e5e7eb',
        borderTop: '3px solid #185FA5', borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #e5e7eb', marginBottom: 20 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: active === t.id ? 600 : 400,
          color: active === t.id ? '#185FA5' : '#6b7280',
          borderBottom: active === t.id ? '2px solid #185FA5' : '2px solid transparent',
          fontFamily: 'inherit',
        }}>{t.label}{t.badge ? <span style={{ marginLeft: 6, background: '#E24B4A', color: '#fff', borderRadius: 99, fontSize: 10, padding: '1px 6px' }}>{t.badge}</span> : null}</button>
      ))}
    </div>
  )
}

// ─── Workflow pipeline bar ────────────────────────────────────────────────────
export function WorkflowBar({ stage, completed, levels, current_step }) {
  // If levels are provided, render one node per level (custom workflows).
  // Otherwise fall back to the default 4-step Prepare/Check/Review/Approve.
  const items = Array.isArray(levels) && levels.length > 0
    ? levels.map(lv => lv.name)
    : ['Prepare', 'Check', 'Review', 'Approve']
  const idx = Array.isArray(levels) && levels.length > 0
    ? Math.max(0, (current_step ?? 1) - 1)
    : items.indexOf(stage)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {items.map((s, i) => {
        const done = completed || i < idx
        const current = !completed && i === idx
        return (
          <div key={`${s}-${i}`} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{
              flex: 1, textAlign: 'center', padding: '5px 4px', borderRadius: 6, fontSize: 11, fontWeight: 500,
              background: done ? '#E1F5EE' : current ? '#185FA5' : '#f9fafb',
              color: done ? '#0F6E56' : current ? '#fff' : '#9ca3af',
              border: done ? '1px solid #1D9E75' : current ? 'none' : '1px solid #e5e7eb',
            }}>{done ? '✓ ' : ''}{s}</div>
            {i < items.length - 1 && <div style={{ width: 16, height: 2, background: done ? '#1D9E75' : '#e5e7eb' }} />}
          </div>
        )
      })}
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────
export function SectionHead({ title, action }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8 }}>{title}</h3>
      {action}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────
export function Empty({ message = 'No records found.' }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: '#9ca3af', fontSize: 14 }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
      {message}
    </div>
  )
}
