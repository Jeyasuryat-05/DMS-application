import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { documentsAPI, adminAPI } from '../api'
import { Badge, Btn, Card, Table, Spinner, Input, Select, Metric } from '../components/ui'
import UploadModal from '../components/UploadModal'
import { fmtDate } from '../utils/dates'

export default function Documents() {
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const [docs, setDocs] = useState([])
  const [docTypes, setDocTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(searchParams.get('upload') === '1')

  const [filters, setFilters] = useState({
    q: '', doc_number: '', doc_type_id: '', serial_no: '', version: '',
    version_mode: 'all', status: '', confidential: '', flagged_for_deletion: '', limit: '100',
  })

  const STATUSES = ['Draft', 'Under Review', 'Approved', 'Rejected', 'Archived', 'Expired']
  const VERSION_MODES = [
    { value: 'all', label: 'All Versions' },
    { value: 'latest', label: 'Latest Versions' },
    { value: 'released', label: 'All Released Versions' },
  ]

  const fetchDocs = useCallback(() => {
    setLoading(true)
    const params = {}
    if (filters.q)                    params.q = filters.q
    if (filters.doc_number)           params.doc_number = filters.doc_number
    if (filters.doc_type_id)          params.doc_type_id = filters.doc_type_id
    if (filters.serial_no)            params.serial_no = filters.serial_no
    if (filters.version)              params.version = filters.version
    if (filters.version_mode)         params.version_mode = filters.version_mode
    if (filters.status)               params.status = filters.status
    if (filters.confidential !== '')  params.confidential = filters.confidential === 'true'
    if (filters.flagged_for_deletion !== '') params.flagged_for_deletion = filters.flagged_for_deletion === 'true'
    if (filters.limit)                params.limit = parseInt(filters.limit, 10) || 100
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

  const counts = {
    total:   docs.length,
    approved: docs.filter(d => d.status === 'Approved').length,
    review:   docs.filter(d => d.status === 'Under Review').length,
    draft:    docs.filter(d => d.status === 'Draft').length,
  }

  const dtOptions = docTypes.map(d => ({ value: d.id, label: d.name }))

  const columns = [
    {
      key: 'doc_number', label: 'Doc Number',
      render: (v, row) => (
        <div>
          <div style={{ fontWeight: 600, color: '#185FA5', fontSize: 13 }}>{v}</div>
          {row.serial_no && <div style={{ fontSize: 11, color: '#9ca3af' }}>{row.serial_no}</div>}
        </div>
      )
    },
    {
      key: 'title', label: 'Title',
      render: (v, row) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{v}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>{row.doc_type?.name}</div>
        </div>
      )
    },
    { key: 'usi_kks_code', label: 'USI/KKS', render: v => <span style={{ fontSize: 12 }}>{v || '—'}</span> },
    { key: 'current_version', label: 'Ver', render: v => <span style={{ fontSize: 12 }}>v{v}</span> },
    {
      key: 'status', label: 'Status',
      render: (v, row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Badge label={v} />
          {row.checked_out && <Badge label="Checked Out" />}
          {row.confidential && <Badge label="Confidential" />}
        </div>
      )
    },
    {
      key: 'workflow', label: 'Stage',
      render: (v) => v?.completed ? <Badge label="Completed" /> : (v && v.stage && v.stage !== 'Prepare') ? <Badge label={v.stage} /> : '—'
    },
    {
      key: 'expiry_date', label: 'Expiry',
      render: v => {
        if (!v) return '—'
        const diff = (new Date(v) - new Date()) / (1000 * 60 * 60 * 24)
        return (
          <span style={{ fontSize: 12, color: diff < 90 ? '#A32D2D' : '#374151', fontWeight: diff < 90 ? 600 : 400 }}>
            {fmtDate(v)}
            {diff < 90 && ` ⚠`}
          </span>
        )
      }
    },
    {
      key: 'created_at', label: 'Created',
      render: v => <span style={{ fontSize: 12 }}>{fmtDate(v)}</span>
    },
  ]

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700 }}>Documents</h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>Manage all engineering documents</p>
        </div>
        <Btn label="+ Create Document" variant="primary" onClick={() => setShowUpload(true)} />
      </div>

      {/* Summary metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <Metric label="Total"       value={counts.total} />
        <Metric label="Approved"    value={counts.approved} color="#0F6E56" />
        <Metric label="Under Review" value={counts.review}  color="#854F0B" />
        <Metric label="Draft"       value={counts.draft}    color="#185FA5" />
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Document</label>
            <input value={filters.doc_number} onChange={e => setF('doc_number', e.target.value)}
              placeholder="Doc number…" style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Document Type</label>
            <select value={filters.doc_type_id} onChange={e => setF('doc_type_id', e.target.value)} style={{ width: '100%' }}>
              <option value="">All Types</option>
              {docTypes.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Document Part</label>
            <input value={filters.serial_no} onChange={e => setF('serial_no', e.target.value)}
              placeholder="Part number…" style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Document Version</label>
            <input value={filters.version} onChange={e => setF('version', e.target.value)}
              placeholder="e.g. 1.0" style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Maximum Number of Hits</label>
            <input type="number" min="1" value={filters.limit} onChange={e => setF('limit', e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 12, alignItems: 'end', marginTop: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Search (title, project, USI)</label>
            <input value={filters.q} onChange={e => setF('q', e.target.value)}
              placeholder="Type to search…" style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Version Selection</label>
            <select value={filters.version_mode} onChange={e => setF('version_mode', e.target.value)} style={{ width: '100%' }}>
              {VERSION_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Status</label>
            <select value={filters.status} onChange={e => setF('status', e.target.value)} style={{ width: '100%' }}>
              <option value="">All Statuses</option>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Confidential</label>
            <select value={filters.confidential} onChange={e => setF('confidential', e.target.value)} style={{ width: '100%' }}>
              <option value="">All</option>
              <option value="true">Confidential</option>
              <option value="false">Non-Confidential</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Deletion indicator</label>
            <select value={filters.flagged_for_deletion} onChange={e => setF('flagged_for_deletion', e.target.value)} style={{ width: '100%' }}>
              <option value="">All</option>
              <option value="true">Flagged for Deletion</option>
              <option value="false">Not Flagged</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Use the search form above to filter documents by number, part, title, project, or USI.
          </div>
          <Btn label="Clear Filters" size="sm"
            onClick={() => setFilters({ q: '', doc_number: '', doc_type_id: '', serial_no: '', version: '', version_mode: 'all', status: '', confidential: '', flagged_for_deletion: '', limit: '100' })} />
        </div>
      </Card>

      {/* Table */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {loading
          ? <Spinner />
          : <Table columns={columns} rows={docs} onRowClick={row => {
              const v = row.current_version
              nav(
                `/documents/${row.id}` + (v ? `?v=${encodeURIComponent(v)}` : ''),
                { state: { from: '/documents' } },
              )
            }} />
        }
      </Card>

      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onSuccess={fetchDocs} />
      )}
    </div>
  )
}
