import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'


const STATUS_COLORS = {
  'Draft':        { bg: '#EBF5FE', color: '#0070F2', border: '#0070F2' },
  'Under Review': { bg: '#FEF3C7', color: '#E9730C', border: '#E9730C' },
  'In Check':     { bg: '#F3E8FF', color: '#7c3aed', border: '#7c3aed' },
  'In Review':    { bg: '#F3E8FF', color: '#7c3aed', border: '#7c3aed' },
  'In Approval':  { bg: '#EDE9FE', color: '#6366f1', border: '#6366f1' },
  'Approved':     { bg: '#E6F4EA', color: '#188918', border: '#188918' },
  'Released':     { bg: '#D1FAE5', color: '#059669', border: '#059669' },
  'Rejected':     { bg: '#FEE2E2', color: '#BB0000', border: '#BB0000' },
  'Archived':     { bg: '#F3F4F6', color: '#6A6D70', border: '#D9D9D9' },
  'Expired':      { bg: '#FEE2E2', color: '#dc2626', border: '#dc2626' },
  'Confidential': { bg: '#FEF9C3', color: '#854d0e', border: '#ca8a04' },
  'Checked Out':  { bg: '#FEF3C7', color: '#92400e', border: '#d97706' },
  'Completed':    { bg: '#D1FAE5', color: '#059669', border: '#059669' },
  'Pending':      { bg: '#FEF3C7', color: '#E9730C', border: '#E9730C' },
  'Active':       { bg: '#E6F4EA', color: '#188918', border: '#188918' },
}

export function Badge({ label, size = 'sm' }) {
  const c = STATUS_COLORS[label] || { bg: '#F3F4F6', color: '#6A6D70', border: '#D9D9D9' }
  return (
    <span style={{
      display: 'inline-block',
      padding: size === 'sm' ? '2px 8px' : '3px 10px',
      fontSize: size === 'sm' ? 11 : 13,
      fontWeight: 600,
      borderRadius: 99,
      background: c.bg,
      color: c.color,
      border: `1px solid ${c.border}`,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────
const VARIANT_STYLES = {
  default:  { background: '#fff',     color: '#32363A', border: '1px solid #D9D9D9' },
  primary:  { background: '#0070F2',  color: '#fff',    border: 'none' },
  success:  { background: '#188918',  color: '#fff',    border: 'none' },
  danger:   { background: '#BB0000',  color: '#fff',    border: 'none' },
  warning:  { background: '#E9730C',  color: '#fff',    border: 'none' },
  ghost:    { background: 'none',     color: '#0070F2', border: 'none' },
}
const SIZE_PAD = { sm: '4px 10px', md: '6px 14px', lg: '8px 18px' }
const SIZE_FONT = { sm: 12, md: 13, lg: 14 }

export function Btn({ label, onClick, variant = 'default', disabled = false, icon, size = 'md', style = {}, title }) {
  const vs = VARIANT_STYLES[variant] || VARIANT_STYLES.default
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...vs,
        padding: SIZE_PAD[size] || SIZE_PAD.md,
        fontSize: SIZE_FONT[size] || 13,
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        fontFamily: 'inherit',
        fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        ...style,
      }}
    >
      {icon && <span>{icon}</span>}{label}
    </button>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, style = {}, highlight = false }) {
  return (
    <div style={{
      background: '#fff',
      border: highlight ? '1.5px solid #0070F2' : '1px solid #D9D9D9',
      borderRadius: 6,
      ...style,
    }}>
      <div style={{ padding: '1rem 1.25rem' }}>{children}</div>
    </div>
  )
}

const fieldInputStyle = {
  width: '100%', boxSizing: 'border-box',
  height: 34, padding: '0 10px',
  fontSize: 13, fontFamily: 'inherit',
  border: '1px solid #C0C0C0', borderRadius: 4,
  background: '#fff', color: '#32363A', outline: 'none',
}

// ─── Field wrapper ────────────────────────────────────────────────────────────
export function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && (
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#32363A', marginBottom: 5 }}>
          {label}{required && <span style={{ color: '#BB0000', marginLeft: 2 }}>*</span>}
        </label>
      )}
      {children}
    </div>
  )
}

// ─── Input ────────────────────────────────────────────────────────────────────
export function Input({ label, required, value, onChange, placeholder, type = 'text', style = {}, ...rest }) {
  return (
    <Field label={label} required={required}>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...fieldInputStyle, ...style }}
        onFocus={e => e.target.style.borderColor = '#0070F2'}
        onBlur={e => e.target.style.borderColor = '#C0C0C0'}
        {...rest}
      />
    </Field>
  )
}

// ─── Select ───────────────────────────────────────────────────────────────────
export function Select({ label, required, value, onChange, options, placeholder = '— Select —' }) {
  return (
    <Field label={label} required={required}>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        style={{ ...fieldInputStyle, height: 34, appearance: 'auto', cursor: 'pointer' }}
        onFocus={e => e.target.style.borderColor = '#0070F2'}
        onBlur={e => e.target.style.borderColor = '#C0C0C0'}
      >
        <option value="">{placeholder}</option>
        {options.map(o => {
          const v = String(o.value ?? o)
          const l = o.label ?? o
          return <option key={v} value={v}>{l}</option>
        })}
      </select>
    </Field>
  )
}

// ─── Textarea ─────────────────────────────────────────────────────────────────
export function Textarea({ label, required, value, onChange, rows = 3, placeholder }) {
  return (
    <Field label={label} required={required}>
      <textarea
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        style={{ ...fieldInputStyle, height: 'auto', padding: '7px 10px', resize: 'vertical', fontFamily: 'inherit' }}
        onFocus={e => e.target.style.borderColor = '#0070F2'}
        onBlur={e => e.target.style.borderColor = '#C0C0C0'}
      />
    </Field>
  )
}

// ─── Metric card ──────────────────────────────────────────────────────────────
export function Metric({ label, value, color = '#32363A', sub }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #D9D9D9', borderRadius: 6, textAlign: 'center', padding: '1rem' }}>
      <div style={{ fontSize: 11, color: '#6A6D70', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#6A6D70', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────────
export function Table({ columns, rows, onRowClick }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: 'inherit' }}>
        <thead>
          <tr style={{ background: '#F2F2F2', borderBottom: '2px solid #D9D9D9' }}>
            {columns.map(c => (
              <th key={c.key} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#32363A', whiteSpace: 'nowrap' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}
              onClick={() => onRowClick && onRowClick(row)}
              style={{ borderBottom: '1px solid #D9D9D9', cursor: onRowClick ? 'pointer' : 'default', background: '#fff' }}
              onMouseOver={e => onRowClick && (e.currentTarget.style.background = '#EBF5FE')}
              onMouseOut={e => (e.currentTarget.style.background = '#fff')}
            >
              {columns.map(c => (
                <td key={c.key} style={{ padding: '10px 12px', color: '#32363A' }}>
                  {c.render ? c.render(row[c.key], row) : row[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: 32, textAlign: 'center', color: '#6A6D70' }}>No records found</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── SearchableSelect ─────────────────────────────────────────────────────────
export function SearchableSelect({ options = [], value, onChange, placeholder }) {
  const [open, setOpen]               = useState(false)
  const [search, setSearch]           = useState('')
  const [pos, setPos]                 = useState({ top: 0, left: 0, width: 0, maxH: 200, flipUp: false })
  const [highlighted, setHighlighted] = useState(-1)
  const [mounted, setMounted]         = useState(false)
  const triggerRef = useRef(null)
  const listRef    = useRef(null)
  const portalEl   = useRef(null)

  // create a stable DOM node for the portal on mount
  useEffect(() => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    portalEl.current = el
    setMounted(true)
    return () => { document.body.removeChild(el) }
  }, [])

  const optVal   = o => (o && typeof o === 'object') ? o.value : o
  const optLabel = o => (o && typeof o === 'object') ? o.label : o
  const selectedLabel = (() => {
    if (!value) return null
    const m = options.find(o => optVal(o) === value)
    return m ? optLabel(m) : value
  })()

  const calcPos = () => {
    if (!triggerRef.current) return
    const r     = triggerRef.current.getBoundingClientRect()
    const GAP   = 4, MAX_H = 280
    const below = window.innerHeight - r.bottom - GAP
    const above = r.top - GAP
    const flipUp = below < 160 && above > below
    const maxH   = Math.max(80, Math.min(MAX_H, flipUp ? above : below) - GAP)
    const left   = Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8))
    const top    = flipUp ? r.top - GAP - maxH : r.bottom + GAP
    setPos({ top, left, width: r.width, maxH, flipUp })
  }

  const openDrop = () => { calcPos(); setOpen(true); setSearch(''); setHighlighted(-1) }
  const closeDrop = () => { setOpen(false); setSearch(''); setHighlighted(-1) }
  const selectOpt = opt => { onChange(optVal(opt)); closeDrop(); triggerRef.current?.focus() }

  // close on outside click — checks both trigger and portal node
  useEffect(() => {
    if (!open) return
    const onDown = e => {
      const inTrigger = triggerRef.current?.contains(e.target)
      const inPortal  = portalEl.current?.contains(e.target)
      if (!inTrigger && !inPortal) closeDrop()
    }
    const onScroll = () => { if (open) { calcPos() } }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', calcPos)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', calcPos)
    }
  }, [open])

  useEffect(() => { setHighlighted(-1) }, [search])
  useEffect(() => {
    if (highlighted >= 0 && listRef.current)
      listRef.current.children[highlighted]?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const filtered = options.filter(o => !search.trim() || optLabel(o).toLowerCase().includes(search.toLowerCase()))

  const handleTriggerKey = e => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); if (!open) openDrop() }
    if (e.key === 'Escape') closeDrop()
  }
  const handleSearchKey = e => {
    if (e.key === 'Escape') { closeDrop(); triggerRef.current?.focus(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => h <= 0 ? -1 : h - 1); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (highlighted >= 0 && filtered[highlighted]) selectOpt(filtered[highlighted])
      else if (filtered.length === 1) selectOpt(filtered[0])
    }
  }

  const triggerStyle = {
    width: '100%', boxSizing: 'border-box', fontSize: 13,
    padding: '7px 10px', borderRadius: 6,
    border: `1px solid ${open ? '#185FA5' : '#d1d5db'}`,
    boxShadow: open ? '0 0 0 2px rgba(24,95,165,0.18)' : 'none',
    background: '#fff', color: value ? '#111827' : '#9ca3af',
    cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    userSelect: 'none', outline: 'none', fontFamily: 'inherit',
  }

  const dropdown = open ? (
    <div style={{
      position: 'fixed', top: pos.top, left: pos.left, width: pos.width,
      background: '#fff', border: '1px solid #d1d5db',
      borderRadius: 6, zIndex: 99999, boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
      display: 'flex', flexDirection: 'column', maxHeight: pos.maxH,
    }}>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={handleSearchKey}
          placeholder="Type to search or ↑↓ to navigate…"
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '5px 8px',
            borderRadius: 4, border: '1px solid #d1d5db', fontFamily: 'inherit',
            background: '#fff', outline: 'none' }} />
      </div>
      <div onMouseDown={e => e.preventDefault()} onClick={() => { onChange(''); closeDrop() }}
        style={{ padding: '7px 12px', fontSize: 12, color: '#6b7280',
          cursor: 'pointer', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}
        onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
        onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
        — Clear selection —
      </div>
      <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.length === 0
          ? <div style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>No matches found</div>
          : filtered.map((opt, idx) => {
              const v = optVal(opt), l = optLabel(opt)
              const isSel = value === v, isHl = idx === highlighted
              return (
                <div key={v}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => selectOpt(opt)}
                  onMouseEnter={() => setHighlighted(idx)}
                  onMouseLeave={() => setHighlighted(-1)}
                  style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer',
                    borderBottom: '1px solid #f3f4f6',
                    background: isHl ? '#EBF4FF' : isSel ? '#dbeafe' : '#fff',
                    color: isSel ? '#1d4ed8' : '#111827',
                    fontWeight: isSel ? 600 : 400 }}>
                  {l}
                </div>
              )
            })
        }
      </div>
      <div style={{ padding: '4px 8px', borderTop: '1px solid #e5e7eb',
        fontSize: 10, color: '#9ca3af', textAlign: 'right', flexShrink: 0 }}>
        {filtered.length} of {options.length} options
      </div>
    </div>
  ) : null

  return (
    <div style={{ position: 'relative' }}>
      <div ref={triggerRef} tabIndex={0}
        onClick={() => open ? closeDrop() : openDrop()}
        onKeyDown={handleTriggerKey}
        style={triggerStyle}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {selectedLabel || placeholder || '— Select —'}
        </span>
        <span style={{ marginLeft: 8, fontSize: 10, color: '#6b7280', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {mounted && portalEl.current && createPortal(dropdown, portalEl.current)}
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 8,
          width: Math.min(width, window.innerWidth * 0.95),
          maxHeight: '90vh',
          boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: '1px solid #e5e7eb',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#32363A' }}>{title}</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 18,
            cursor: 'pointer', color: '#6A6D70', lineHeight: 1, padding: '2px 6px',
          }}>✕</button>
        </div>
        {/* Body — scrolls independently so fixed-position portals are not clipped */}
        <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        border: '3px solid #D9D9D9',
        borderTopColor: '#0070F2',
        animation: 'spin 0.7s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap',
      borderBottom: '2px solid #D9D9D9',
      marginBottom: 20,
      background: '#fff',
      borderRadius: '6px 6px 0 0',
    }}>
      {tabs.map(t => {
        const isActive = active === t.id
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            padding: '10px 18px',
            fontSize: 13, fontWeight: isActive ? 700 : 400,
            color: isActive ? '#0070F2' : '#6A6D70',
            background: isActive ? '#EBF5FE' : 'transparent',
            border: 'none',
            borderBottom: isActive ? '2px solid #0070F2' : '2px solid transparent',
            marginBottom: -2,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
            whiteSpace: 'nowrap',
          }}>
            {t.badge ? `${t.label} (${t.badge})` : t.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Workflow pipeline bar ────────────────────────────────────────────────────
export function WorkflowBar({ stage, completed, levels, current_step }) {
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
              flex: 1, textAlign: 'center', padding: '5px 4px', borderRadius: 4, fontSize: 11, fontWeight: 500,
              background: done ? '#e6f4ea' : current ? '#0070F2' : '#F5F6F7',
              color: done ? '#188918' : current ? '#fff' : '#6A6D70',
              border: done ? '1px solid #188918' : current ? 'none' : '1px solid #D9D9D9',
            }}>{done ? '✓ ' : ''}{s}</div>
            {i < items.length - 1 && <div style={{ width: 16, height: 2, background: done ? '#188918' : '#D9D9D9' }} />}
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
      <span style={{ fontSize: 12, fontWeight: 700, color: '#6A6D70', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
      {action}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────
export function Empty({ message = 'No records found.' }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: '#6A6D70', fontSize: 14 }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
      <div>{message}</div>
    </div>
  )
}
