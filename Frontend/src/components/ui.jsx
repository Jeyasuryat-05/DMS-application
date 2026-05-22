import { useState, useEffect, useRef } from 'react'
import {
  ObjectStatus,
  Button,
  Card as UI5Card,
  Input as UI5Input,
  Select as UI5Select,
  Option,
  TextArea,
  Label,
  BusyIndicator,
  Dialog,
  Bar,
  Title,
  ComboBox,
  ComboBoxItem,
  TabContainer,
  Tab,
  FlexBox,
  Text,
} from '@ui5/webcomponents-react'

// ─── Status badge ─────────────────────────────────────────────────────────────
const STATUS_STATE = {
  'Draft':        'Information',
  'Under Review': 'Critical',
  'Approved':     'Positive',
  'Released':     'Positive',
  'Superseded':   'None',
  'Rejected':     'Negative',
  'Archived':     'None',
  'Expired':      'Critical',
  'Prepare':      'Information',
  'Check':        'Critical',
  'Review':       'Information',
  'Approve':      'Positive',
  'Completed':    'Positive',
  'Pending':      'Critical',
}

export function Badge({ label, size = 'sm' }) {
  const state = STATUS_STATE[label] || 'None'
  return (
    <ObjectStatus state={state} style={{ fontSize: size === 'sm' ? 11 : 13 }}>
      {label}
    </ObjectStatus>
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

// ─── Field wrapper ────────────────────────────────────────────────────────────
export function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && (
        <Label required={required} style={{ display: 'block', marginBottom: 4 }}>
          {label}
        </Label>
      )}
      {children}
    </div>
  )
}

// ─── Input ────────────────────────────────────────────────────────────────────
export function Input({ label, required, value, onChange, placeholder, type = 'text', style = {}, ...rest }) {
  return (
    <Field label={label} required={required}>
      <UI5Input
        type={type === 'password' ? 'Password' : type === 'number' ? 'Number' : 'Text'}
        value={value ?? ''}
        onInput={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', ...style }}
        {...rest}
      />
    </Field>
  )
}

// ─── Select ───────────────────────────────────────────────────────────────────
export function Select({ label, required, value, onChange, options, placeholder = '— Select —' }) {
  const handleChange = e => {
    onChange(e.detail.selectedOption?.dataset?.value ?? '')
  }
  return (
    <Field label={label} required={required}>
      <UI5Select onChange={handleChange} style={{ width: '100%' }}>
        <Option data-value="" selected={!value}>{placeholder}</Option>
        {options.map(o => {
          const v = o.value ?? o
          const l = o.label ?? o
          return (
            <Option key={v} data-value={v} selected={value === v}>{l}</Option>
          )
        })}
      </UI5Select>
    </Field>
  )
}

// ─── Textarea ─────────────────────────────────────────────────────────────────
export function Textarea({ label, required, value, onChange, rows = 3, placeholder }) {
  return (
    <Field label={label} required={required}>
      <TextArea
        value={value ?? ''}
        onInput={e => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        style={{ width: '100%' }}
      />
    </Field>
  )
}

// ─── Metric card ──────────────────────────────────────────────────────────────
export function Metric({ label, value, color = 'var(--sapTextColor)', sub }) {
  return (
    <UI5Card style={{ textAlign: 'center' }}>
      <div style={{ padding: '1rem' }}>
        <div style={{ fontSize: 11, color: 'var(--sapContent_LabelColor)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 600, color }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--sapContent_LabelColor)', marginTop: 2 }}>{sub}</div>}
      </div>
    </UI5Card>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────────
export function Table({ columns, rows, onRowClick }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: 'var(--sapFontFamily)' }}>
        <thead>
          <tr style={{ background: 'var(--sapList_HeaderBackground)', borderBottom: '1px solid var(--sapList_BorderColor)' }}>
            {columns.map(c => (
              <th key={c.key} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--sapList_HeaderTextColor)', whiteSpace: 'nowrap' }}>
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
                borderBottom: '1px solid var(--sapList_BorderColor)',
                cursor: onRowClick ? 'pointer' : 'default',
                background: 'var(--sapList_Background)',
              }}
              onMouseOver={e => onRowClick && (e.currentTarget.style.background = 'var(--sapList_Hover_Background)')}
              onMouseOut={e => (e.currentTarget.style.background = 'var(--sapList_Background)')}
            >
              {columns.map(c => (
                <td key={c.key} style={{ padding: '10px 12px', color: 'var(--sapTextColor)' }}>
                  {c.render ? c.render(row[c.key], row) : row[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: 32, textAlign: 'center', color: 'var(--sapContent_LabelColor)' }}>No records found</td></tr>
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

  const triggerStyle = {
    width: '100%', boxSizing: 'border-box', fontSize: 13,
    padding: '7px 10px', borderRadius: 4,
    border: `1px solid ${open ? 'var(--sapField_Focus_BorderColor)' : 'var(--sapField_BorderColor)'}`,
    background: 'var(--sapField_Background)', color: value ? 'var(--sapTextColor)' : 'var(--sapField_PlaceholderTextColor)',
    cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    userSelect: 'none', outline: 'none', fontFamily: 'var(--sapFontFamily)',
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div ref={triggerRef} tabIndex={0}
        onClick={() => open ? closeDrop() : openDrop()}
        onKeyDown={handleTriggerKey} onBlur={handleBlur}
        style={triggerStyle}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {selectedLabel || placeholder || '— Select —'}
        </span>
        <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--sapContent_LabelColor)', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
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
          <div style={{ position: 'fixed', top, left, width: dropRect.width,
            background: 'var(--sapList_Background)', border: '1px solid var(--sapList_BorderColor)',
            borderRadius: 4, zIndex: 9999, boxShadow: 'var(--sapContent_Shadow2)',
            display: 'flex', flexDirection: 'column', maxHeight: maxH }}>
            <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--sapList_BorderColor)', flexShrink: 0 }}>
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                onKeyDown={handleSearchKey} onBlur={handleBlur}
                placeholder="Type to search or ↑↓ to navigate…"
                onClick={e => e.stopPropagation()}
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '5px 8px',
                  borderRadius: 4, border: '1px solid var(--sapField_BorderColor)',
                  fontFamily: 'var(--sapFontFamily)', background: 'var(--sapField_Background)' }} />
            </div>
            <div onClick={() => { onChange(''); closeDrop() }}
              onMouseDown={e => e.preventDefault()}
              style={{ padding: '7px 12px', fontSize: 12, color: 'var(--sapContent_LabelColor)',
                cursor: 'pointer', borderBottom: '1px solid var(--sapList_BorderColor)', flexShrink: 0 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--sapList_Hover_Background)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--sapList_Background)'}>
              — Clear selection —
            </div>
            <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
              {filtered.length === 0
                ? <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--sapContent_LabelColor)', textAlign: 'center' }}>No matches found</div>
                : filtered.map((opt, idx) => {
                    const v = optVal(opt), l = optLabel(opt)
                    const isSel = value === v, isHl = idx === highlighted
                    return (
                      <div key={v} onClick={() => selectOpt(opt)}
                        onMouseDown={e => e.preventDefault()}
                        onMouseEnter={() => setHighlighted(idx)} onMouseLeave={() => setHighlighted(-1)}
                        style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer',
                          borderBottom: '1px solid var(--sapList_BorderColor)',
                          background: isHl ? 'var(--sapList_Hover_Background)' : isSel ? 'var(--sapList_SelectionBackgroundColor)' : 'var(--sapList_Background)',
                          color: isSel ? 'var(--sapList_SelectionBorderColor)' : 'var(--sapTextColor)',
                          fontWeight: isSel ? 600 : 400 }}>
                        {l}
                      </div>
                    )
                  })
              }
            </div>
            <div style={{ padding: '4px 8px', borderTop: '1px solid var(--sapList_BorderColor)',
              fontSize: 10, color: 'var(--sapContent_LabelColor)', textAlign: 'right', flexShrink: 0 }}>
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
          overflowY: 'auto',
          boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
          display: 'flex',
          flexDirection: 'column',
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
        {/* Body */}
        <div style={{ padding: '16px 20px', flex: 1 }}>
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
      <BusyIndicator active size="Medium" />
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
      <Title level="H5" style={{ color: 'var(--sapContent_LabelColor)', textTransform: 'uppercase', letterSpacing: 0.8 }}>{title}</Title>
      {action}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────
export function Empty({ message = 'No records found.' }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--sapContent_LabelColor)', fontSize: 14 }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
      <Text>{message}</Text>
    </div>
  )
}
