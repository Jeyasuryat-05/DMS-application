import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { documentsAPI, adminAPI } from '../api'
import { Badge, Spinner } from '../components/ui'
import UploadModal from '../components/UploadModal'
import { fmtDate } from '../utils/dates'
import { useAuth } from '../hooks/useAuth'
import {
  Title,
  Text,
  Button,
  FlexBox,
} from '@ui5/webcomponents-react'

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  height: 32, padding: '0 10px',
  fontSize: 13, fontFamily: 'inherit',
  border: '1px solid #C0C0C0',
  borderRadius: 4,
  background: '#fff',
  color: '#32363A',
  outline: 'none',
}

const selectStyle = {
  ...inputStyle,
  appearance: 'auto',
  cursor: 'pointer',
}

const labelStyle = {
  display: 'block', fontSize: 11,
  fontWeight: 600,
  color: '#6A6D70',
  marginBottom: 5,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

// SAP color palette
const C = {
  brand:    '#0070F2',
  positive: '#188918',
  critical: '#E9730C',
  negative: '#BB0000',
  neutral:  '#6A6D70',
  bg:       '#F5F6F7',
  white:    '#FFFFFF',
  border:   '#D9D9D9',
  header:   '#F2F2F2',
  text:     '#32363A',
  label:    '#6A6D70',
  hover:    '#EBF5FE',
  link:     '#0070F2',
}

function MetricCard({ label, value, color }) {
  return (
    <div style={{
      flex: 1, textAlign: 'center',
      background: C.white,
      border: `1px solid ${C.border}`,
      borderRadius: 6,
      padding: '14px 16px',
      minWidth: 110,
    }}>
      <div style={{ fontSize: 10, color: C.label, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || C.text }}>{value}</div>
    </div>
  )
}

export default function Documents() {
  const { user } = useAuth()
  const canCreate = !!(user?.can_create || user?.role === 'System Admin')
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const [docs, setDocs] = useState([])
  const [docTypes, setDocTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(searchParams.get('upload') === '1' && canCreate)

  const [filters, setFilters] = useState({
    q: '', doc_number: '', doc_type_id: '', serial_no: '', version: '',
    version_mode: 'all', status: '', confidential: '', flagged_for_deletion: '', limit: '100',
  })

  const STATUSES = ['Draft', 'Under Review', 'Approved', 'Rejected', 'Archived', 'Expired']
  const VERSION_MODES = [
    { value: 'all',      label: 'All Versions' },
    { value: 'latest',   label: 'Latest Versions' },
    { value: 'released', label: 'All Released Versions' },
  ]

  const fetchDocs = useCallback(() => {
    setLoading(true)
    const params = {}
    if (filters.q)                          params.q = filters.q
    if (filters.doc_number)                 params.doc_number = filters.doc_number
    if (filters.doc_type_id)                params.doc_type_id = filters.doc_type_id
    if (filters.serial_no)                  params.serial_no = filters.serial_no
    if (filters.version)                    params.version = filters.version
    if (filters.version_mode)               params.version_mode = filters.version_mode
    if (filters.status)                     params.status = filters.status
    if (filters.confidential !== '')        params.confidential = filters.confidential === 'true'
    if (filters.flagged_for_deletion !== '') params.flagged_for_deletion = filters.flagged_for_deletion === 'true'
    if (filters.limit)                      params.limit = parseInt(filters.limit, 10) || 100
    documentsAPI.list(params)
      .then(r => setDocs(r.data))
      .finally(() => setLoading(false))
  }, [filters])

  useEffect(() => {
    adminAPI.listDocTypes().then(r => setDocTypes(r.data))
  }, [])

  useEffect(() => {
    const t = setTimeout(fetchDocs, 250)
    return () => clearTimeout(t)
  }, [fetchDocs])

  function setF(k, v) { setFilters(f => ({ ...f, [k]: v })) }

  function clearFilters() {
    setFilters({ q: '', doc_number: '', doc_type_id: '', serial_no: '', version: '', version_mode: 'all', status: '', confidential: '', flagged_for_deletion: '', limit: '100' })
  }

  const counts = {
    total:    docs.length,
    approved: docs.filter(d => d.status === 'Approved').length,
    review:   docs.filter(d => d.status === 'Under Review').length,
    draft:    docs.filter(d => d.status === 'Draft').length,
  }

  const columns = [
    {
      key: 'doc_number', label: 'Doc Number',
      render: (v, row) => (
        <div>
          <div style={{ fontWeight: 600, color: C.link, fontSize: 13 }}>{v}</div>
          {row.serial_no && <div style={{ fontSize: 11, color: C.label }}>{row.serial_no}</div>}
        </div>
      )
    },
    {
      key: 'title', label: 'Title',
      render: (v, row) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: 13, color: C.text }}>{v}</div>
          <div style={{ fontSize: 11, color: C.label }}>{row.doc_type?.name}</div>
        </div>
      )
    },
    { key: 'usi_kks_code',    label: 'USI/KKS', render: v => <span style={{ fontSize: 12, color: C.label }}>{v || '—'}</span> },
    { key: 'current_version', label: 'Ver',     render: v => <span style={{ fontSize: 12, color: C.text }}>v{v}</span> },
    {
      key: 'status', label: 'Status',
      render: (v, row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Badge label={v} />
          {row.checked_out  && <Badge label="Checked Out" />}
          {row.confidential && <Badge label="Confidential" />}
        </div>
      )
    },
    {
      key: 'workflow', label: 'Stage',
      render: v => v?.completed ? <Badge label="Completed" /> : (v?.stage && v.stage !== 'Prepare') ? <Badge label={v.stage} /> : <span style={{ color: C.label }}>—</span>
    },
    {
      key: 'expiry_date', label: 'Expiry',
      render: v => {
        if (!v) return <span style={{ fontSize: 12, color: C.label }}>—</span>
        const diff = (new Date(v) - new Date()) / (1000 * 60 * 60 * 24)
        return (
          <span style={{ fontSize: 12, color: diff < 90 ? C.negative : C.text, fontWeight: diff < 90 ? 600 : 400 }}>
            {fmtDate(v)}{diff < 90 && ' ⚠'}
          </span>
        )
      }
    },
    { key: 'created_at', label: 'Created', render: v => <span style={{ fontSize: 12, color: C.text }}>{fmtDate(v)}</span> },
  ]

  return (
    <div style={{ padding: '24px 28px', background: C.bg, minHeight: '100%' }}>

      {/* ── Page header ── */}
      <FlexBox justifyContent="SpaceBetween" alignItems="Center" style={{ marginBottom: 20 }}>
        <div>
          <Title level="H3" style={{ color: C.text }}>Documents</Title>
          <Text style={{ color: C.label, fontSize: 13, display: 'block', marginTop: 4 }}>Manage all engineering documents</Text>
        </div>
        {canCreate && (
          <Button design="Emphasized" onClick={() => setShowUpload(true)}>+ Create Document</Button>
        )}
      </FlexBox>

      {/* ── Metric cards ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <MetricCard label="Total"        value={counts.total} />
        <MetricCard label="Approved"     value={counts.approved} color={C.positive} />
        <MetricCard label="Under Review" value={counts.review}   color={C.critical} />
        <MetricCard label="Draft"        value={counts.draft}    color={C.brand} />
      </div>

      {/* ── Filter panel ── */}
      <div style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: '16px 20px',
        marginBottom: 12,
      }}>
        {/* Row 1 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px 16px', marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Document Number</label>
            <input style={inputStyle} value={filters.doc_number} onChange={e => setF('doc_number', e.target.value)} placeholder="Doc number…" />
          </div>
          <div>
            <label style={labelStyle}>Document Type</label>
            <select style={selectStyle} value={filters.doc_type_id} onChange={e => setF('doc_type_id', e.target.value)}>
              <option value="">All Types</option>
              {docTypes.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Document Part</label>
            <input style={inputStyle} value={filters.serial_no} onChange={e => setF('serial_no', e.target.value)} placeholder="Part number…" />
          </div>
          <div>
            <label style={labelStyle}>Document Version</label>
            <input style={inputStyle} value={filters.version} onChange={e => setF('version', e.target.value)} placeholder="e.g. 1.0" />
          </div>
          <div>
            <label style={labelStyle}>Max Hits</label>
            <input style={inputStyle} type="number" value={filters.limit} onChange={e => setF('limit', e.target.value)} />
          </div>
        </div>

        {/* Row 2 */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: '8px 16px' }}>
          <div>
            <label style={labelStyle}>Search (title, project, USI)</label>
            <input style={inputStyle} value={filters.q} onChange={e => setF('q', e.target.value)} placeholder="Type to search…" />
          </div>
          <div>
            <label style={labelStyle}>Version Selection</label>
            <select style={selectStyle} value={filters.version_mode} onChange={e => setF('version_mode', e.target.value)}>
              {VERSION_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select style={selectStyle} value={filters.status} onChange={e => setF('status', e.target.value)}>
              <option value="">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Confidential</label>
            <select style={selectStyle} value={filters.confidential} onChange={e => setF('confidential', e.target.value)}>
              <option value="">All</option>
              <option value="true">Confidential</option>
              <option value="false">Non-Confidential</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Deletion Indicator</label>
            <select style={selectStyle} value={filters.flagged_for_deletion} onChange={e => setF('flagged_for_deletion', e.target.value)}>
              <option value="">All</option>
              <option value="true">Flagged</option>
              <option value="false">Not Flagged</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 12, color: C.label }}>Filter by number, part, title, project, or USI.</span>
          <button onClick={clearFilters} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.brand, fontWeight: 600, padding: '2px 6px' }}>Clear Filters</button>
        </div>
      </div>

      {/* ── Table panel ── */}
      <div style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
            <Spinner />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: 'inherit' }}>
              <thead>
                <tr style={{ background: C.header, borderBottom: `2px solid ${C.border}` }}>
                  {columns.map(c => (
                    <th key={c.key} style={{
                      padding: '9px 14px', textAlign: 'left',
                      fontWeight: 700, fontSize: 12,
                      color: C.text,
                      whiteSpace: 'nowrap',
                      borderRight: `1px solid ${C.border}`,
                    }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {docs.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} style={{ padding: 40, textAlign: 'center', color: C.label, fontSize: 13 }}>
                      No records found
                    </td>
                  </tr>
                ) : docs.map((row, i) => (
                  <tr key={i}
                    onClick={() => {
                      const v = row.current_version
                      nav(`/documents/${row.id}` + (v ? `?v=${encodeURIComponent(v)}` : ''), { state: { from: '/documents' } })
                    }}
                    style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer', background: C.white }}
                    onMouseOver={e => e.currentTarget.style.background = C.hover}
                    onMouseOut={e => e.currentTarget.style.background = C.white}
                  >
                    {columns.map(c => (
                      <td key={c.key} style={{
                        padding: '10px 14px',
                        color: C.text,
                        borderRight: `1px solid ${C.border}`,
                        verticalAlign: 'top',
                      }}>
                        {c.render ? c.render(row[c.key], row) : row[c.key] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onSuccess={fetchDocs} />
      )}
    </div>
  )
}
