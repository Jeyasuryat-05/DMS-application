import { useState, useEffect } from 'react'
import { reportsAPI, adminAPI } from '../api'
import { Card, Metric, Badge, Spinner, Tabs, SectionHead, Btn, Empty } from '../components/ui'
import { fmtDate, fmtDateTime } from '../utils/dates'

export default function Reports() {
  const [tab, setTab] = useState('overview')
  const [summary, setSummary] = useState(null)
  const [byStatus, setByStatus] = useState([])
  const [byType, setByType] = useState([])
  const [expiring, setExpiring] = useState([])
  const [auditLogs,   setAuditLogs]   = useState([])
  const [allDocTypes, setAllDocTypes] = useState([])
  const [auditFilter, setAuditFilter] = useState({
    action: '', date_from: '', date_to: '',
    doc_type_id: '', doc_number: '', user_name: '',
  })
  const [loading,    setLoading]    = useState(true)
  const [expiryDays, setExpiryDays] = useState(90)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      reportsAPI.summary(),
      reportsAPI.byStatus(),
      reportsAPI.byType(),
      reportsAPI.expiring(expiryDays),
      adminAPI.listDocTypes(),
    ]).then(([s, bs, bt, e, dt]) => {
      setSummary(s.data)
      setByStatus(bs.data)
      setByType(bt.data)
      setExpiring(e.data)
      setAllDocTypes(dt.data || [])
    }).finally(() => setLoading(false))
  }, [expiryDays])

  useEffect(() => {
    if (tab === 'audit') {
      const params = {}
      if (auditFilter.action)      params.action      = auditFilter.action
      if (auditFilter.date_from)   params.date_from   = auditFilter.date_from
      if (auditFilter.date_to)     params.date_to     = auditFilter.date_to
      if (auditFilter.doc_type_id) params.doc_type_id = auditFilter.doc_type_id
      if (auditFilter.doc_number)  params.doc_number  = auditFilter.doc_number
      if (auditFilter.user_name)   params.user_name   = auditFilter.user_name
      reportsAPI.audit(params).then(r => setAuditLogs(r.data))
    }
  }, [tab, auditFilter])

  function exportCSV(data, filename) {
    if (!data.length) return
    const keys = Object.keys(data[0])
    const csv = [keys.join(','), ...data.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
  }

  const STATUS_COLOR = {
    Draft: '#B4B2A9', 'Under Review': '#EF9F27', Approved: '#1D9E75',
    Rejected: '#E24B4A', Archived: '#888780', Expired: '#D85A30',
  }
  const maxStatus = Math.max(...byStatus.map(b => b.count), 1)
  const maxType   = Math.max(...byType.map(b => b.count), 1)

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'expiring', label: `Expiring (${expiring.length})` },
    { id: 'audit',    label: 'Audit Log' },
  ]

  if (loading && !summary) return <div style={{ padding: 32 }}><Spinner /></div>

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700 }}>Reports & Analytics</h1>
        <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>Document statistics, expiry alerts and full audit trail</p>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* ── Overview ─────────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div>
          {/* Summary metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
            <Metric label="Total"           value={summary?.total_documents ?? 0} />
            <Metric label="Approved"        value={summary?.approved ?? 0}         color="#0F6E56" />
            <Metric label="Under Review"    value={summary?.under_review ?? 0}     color="#854F0B" />
            <Metric label="Draft"           value={summary?.draft ?? 0}            color="#185FA5" />
            <Metric label="Expiring (90d)"  value={summary?.expiring_90_days ?? 0} color="#A32D2D" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* By Status chart */}
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <SectionHead title="Documents by Status" />
                <Btn label="Export CSV" size="sm" onClick={() => exportCSV(byStatus, 'status_report.csv')} />
              </div>
              {byStatus.map(b => (
                <div key={b.status} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{b.status}</span>
                    <span style={{ fontWeight: 700 }}>{b.count}</span>
                  </div>
                  <div style={{ background: '#f3f4f6', borderRadius: 99, height: 10 }}>
                    <div style={{
                      height: 10, borderRadius: 99, transition: 'width 0.6s ease',
                      width: `${(b.count / maxStatus) * 100}%`,
                      background: STATUS_COLOR[b.status] || '#9ca3af',
                    }} />
                  </div>
                </div>
              ))}
              {byStatus.length === 0 && <Empty message="No data yet." />}
            </Card>

            {/* By Type chart */}
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <SectionHead title="Documents by Type" />
                <Btn label="Export CSV" size="sm" onClick={() => exportCSV(byType, 'type_report.csv')} />
              </div>
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                {byType.filter(b => b.count > 0).map(b => (
                  <div key={b.type} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{b.type}</span>
                      <span style={{ fontWeight: 700, flexShrink: 0 }}>{b.count}</span>
                    </div>
                    <div style={{ background: '#f3f4f6', borderRadius: 99, height: 8 }}>
                      <div style={{
                        height: 8, borderRadius: 99, background: '#185FA5', transition: 'width 0.6s ease',
                        width: `${(b.count / maxType) * 100}%`,
                      }} />
                    </div>
                  </div>
                ))}
                {byType.every(b => b.count === 0) && <Empty message="No documents yet." />}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── Expiring ─────────────────────────────────────────────────────────── */}
      {tab === 'expiring' && (
        <div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
            <label style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>Show docs expiring within:</label>
            {[30, 60, 90, 180].map(d => (
              <button key={d} onClick={() => setExpiryDays(d)} style={{
                padding: '5px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid',
                background: expiryDays === d ? '#185FA5' : 'transparent',
                color: expiryDays === d ? '#fff' : '#374151',
                borderColor: expiryDays === d ? '#185FA5' : '#d1d5db',
              }}>{d} days</button>
            ))}
            <div style={{ marginLeft: 'auto' }}>
              <Btn label="Export CSV" size="sm" onClick={() => exportCSV(expiring, `expiring_${expiryDays}d.csv`)} />
            </div>
          </div>

          {expiring.length === 0
            ? <Empty message={`No documents expiring within ${expiryDays} days.`} />
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      {['Doc Number', 'Title', 'Project', 'Status', 'Expiry Date', 'Days Left', ''].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {expiring.map(d => {
                      const daysLeft = Math.ceil((new Date(d.expiry_date) - new Date()) / (1000 * 60 * 60 * 24))
                      return (
                        <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 12px', fontWeight: 600, color: '#185FA5' }}>{d.doc_number}</td>
                          <td style={{ padding: '10px 12px' }}>{d.title}</td>
                          <td style={{ padding: '10px 12px', color: '#6b7280' }}>{d.project || '—'}</td>
                          <td style={{ padding: '10px 12px' }}><Badge label={d.status} /></td>
                          <td style={{ padding: '10px 12px' }}>{fmtDate(d.expiry_date)}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ fontWeight: 700, color: daysLeft < 30 ? '#A32D2D' : daysLeft < 60 ? '#854F0B' : '#374151' }}>
                              {daysLeft}d
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <a href={`/documents/${d.id}`} style={{ color: '#185FA5', fontSize: 12 }}>View →</a>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      )}

      {/* ── Audit Log ────────────────────────────────────────────────────────── */}
      {tab === 'audit' && (
        <div>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              {/* Row 1 */}
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Doc Type</label>
                <select
                  value={auditFilter.doc_type_id}
                  onChange={e => setAuditFilter(f => ({ ...f, doc_type_id: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#fff' }}
                >
                  <option value=''>All Doc Types</option>
                  {allDocTypes.map(dt => (
                    <option key={dt.id} value={dt.id}>{dt.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Document Number</label>
                <input
                  value={auditFilter.doc_number}
                  onChange={e => setAuditFilter(f => ({ ...f, doc_number: e.target.value }))}
                  placeholder="e.g. DRW-2026-0001"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Username</label>
                <input
                  value={auditFilter.user_name}
                  onChange={e => setAuditFilter(f => ({ ...f, user_name: e.target.value }))}
                  placeholder="Search by name…"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
              {/* Row 2 */}
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Filter by Action</label>
                <input
                  value={auditFilter.action}
                  onChange={e => setAuditFilter(f => ({ ...f, action: e.target.value }))}
                  placeholder="e.g. Approved, Downloaded…"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>From Date</label>
                <input type="date" value={auditFilter.date_from}
                  onChange={e => setAuditFilter(f => ({ ...f, date_from: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>To Date</label>
                <input type="date" value={auditFilter.date_to}
                  onChange={e => setAuditFilter(f => ({ ...f, date_to: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn label="Export CSV" onClick={() => exportCSV(auditLogs, 'audit_log.csv')} />
                <Btn label="Clear" variant="secondary" onClick={() => setAuditFilter({ action: '', date_from: '', date_to: '', doc_type_id: '', doc_number: '', user_name: '' })} />
              </div>
            </div>
          </Card>

          {auditLogs.length === 0
            ? <Empty message="No audit entries match your filters." />
            : (
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      {['Timestamp', 'Action', 'User', 'Document', 'Note'].map(h => (
                        <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map(l => (
                      <tr key={l.id} style={{ borderBottom: '1px solid #f9fafb' }}>
                        <td style={{ padding: '10px 14px', color: '#6b7280', whiteSpace: 'nowrap', fontSize: 12 }}>
                          {fmtDateTime(l.timestamp)}
                        </td>
                        <td style={{ padding: '10px 14px', fontWeight: 500 }}>{l.action}</td>
                        <td style={{ padding: '10px 14px' }}>{l.user?.name || '—'}</td>
                        <td style={{ padding: '10px 14px', color: '#185FA5', fontSize: 12 }}>
                          {l.document ? (
                            <a href={`/documents/${l.document.id}`} style={{ color: '#185FA5', textDecoration: 'none' }}>
                              {l.document.doc_number}
                            </a>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#6b7280', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {l.note || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )
          }
        </div>
      )}
    </div>
  )
}
