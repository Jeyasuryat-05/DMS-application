import { useState } from 'react'

// ─── Status badge ─────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  'Draft':        { bg: '#EAF3DE', text: '#3B6D11', border: '#639922' },
  'Under Review': { bg: '#FAEEDA', text: '#854F0B', border: '#EF9F27' },
  'Approved':     { bg: '#E1F5EE', text: '#0F6E56', border: '#1D9E75' },
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

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 14, width, maxWidth: '95vw',
        maxHeight: '90vh', overflowY: 'auto', padding: '1.5rem',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280' }}>×</button>
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
export function WorkflowBar({ stage, completed }) {
  const stages = ['Prepare', 'Check', 'Review', 'Approve']
  const idx = stages.indexOf(stage)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {stages.map((s, i) => {
        const done = completed || i < idx
        const current = !completed && i === idx
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{
              flex: 1, textAlign: 'center', padding: '5px 4px', borderRadius: 6, fontSize: 11, fontWeight: 500,
              background: done ? '#E1F5EE' : current ? '#185FA5' : '#f9fafb',
              color: done ? '#0F6E56' : current ? '#fff' : '#9ca3af',
              border: done ? '1px solid #1D9E75' : current ? 'none' : '1px solid #e5e7eb',
            }}>{done ? '✓ ' : ''}{s}</div>
            {i < 3 && <div style={{ width: 16, height: 2, background: done ? '#1D9E75' : '#e5e7eb' }} />}
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
