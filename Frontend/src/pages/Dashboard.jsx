import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { reportsAPI, documentsAPI } from '../api'
import { Metric, Card, Badge, Spinner, SectionHead, Btn } from '../components/ui'
import { useAuth } from '../hooks/useAuth'

export default function Dashboard() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [summary, setSummary] = useState(null)
  const [expiring, setExpiring] = useState([])
  const [recent, setRecent] = useState([])
  const [byStatus, setByStatus] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      reportsAPI.summary(),
      reportsAPI.expiring(90),
      reportsAPI.byStatus(),
      documentsAPI.list({ limit: 8 }),
    ]).then(([s, e, bs, r]) => {
      setSummary(s.data)
      setExpiring(e.data)
      setByStatus(bs.data)
      setRecent(r.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 32 }}><Spinner /></div>

  const STATUS_COLOR = {
    'Draft': '#B4B2A9', 'Under Review': '#EF9F27',
    'Approved': '#1D9E75', 'Rejected': '#E24B4A', 'Archived': '#888780',
  }

  const maxCount = Math.max(...byStatus.map(b => b.count), 1)

  return (
    <div style={{ padding: '28px 32px' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: '#111' }}>
          Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {user?.name?.split(' ')[0]} 👋
        </h1>
        <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 28 }}>
        <Metric label="Total Documents"   value={summary?.total_documents ?? 0} />
        <Metric label="Approved"          value={summary?.approved ?? 0}         color="#0F6E56" />
        <Metric label="Under Review"      value={summary?.under_review ?? 0}     color="#854F0B" />
        <Metric label="Pending Workflow"  value={summary?.pending_workflow ?? 0} color="#185FA5" />
        <Metric label="Expiring (90 days)" value={summary?.expiring_90_days ?? 0} color="#A32D2D" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Documents by status bar chart */}
        <Card>
          <SectionHead title="Documents by Status" />
          {byStatus.length === 0
            ? <p style={{ color: '#9ca3af', fontSize: 13 }}>No data yet.</p>
            : byStatus.map(b => (
              <div key={b.status} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span>{b.status}</span>
                  <span style={{ fontWeight: 600 }}>{b.count}</span>
                </div>
                <div style={{ background: '#f3f4f6', borderRadius: 99, height: 8 }}>
                  <div style={{
                    height: 8, borderRadius: 99,
                    width: `${(b.count / maxCount) * 100}%`,
                    background: STATUS_COLOR[b.status] || '#9ca3af',
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            ))
          }
        </Card>

        {/* Expiring alerts */}
        <Card>
          <SectionHead
            title={`Expiring Soon (${expiring.length})`}
            action={expiring.length > 0 && (
              <Btn label="View All" size="sm" onClick={() => nav('/reports?tab=expiring')} />
            )}
          />
          {expiring.length === 0
            ? <p style={{ color: '#9ca3af', fontSize: 13 }}>No documents expiring in the next 90 days.</p>
            : expiring.slice(0, 5).map(d => (
              <div key={d.id}
                onClick={() => nav(`/documents/${d.id}`)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0', borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>{d.title}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{d.doc_number} · {d.project}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 11, color: '#A32D2D', fontWeight: 600 }}>
                    {new Date(d.expiry_date).toLocaleDateString('en-IN')}
                  </div>
                  <Badge label={d.status} />
                </div>
              </div>
            ))
          }
        </Card>
      </div>

      {/* Recent documents */}
      <Card>
        <SectionHead
          title="Recent Documents"
          action={<Btn label="All Documents →" size="sm" onClick={() => nav('/documents')} />}
        />
        {recent.length === 0
          ? <p style={{ color: '#9ca3af', fontSize: 13 }}>No documents yet. <button onClick={() => nav('/documents')} style={{ color: '#185FA5', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>Create one →</button></p>
          : recent.map(doc => (
            <div key={doc.id}
              onClick={() => nav(`/documents/${doc.id}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 0', borderBottom: '1px solid #f9fafb', cursor: 'pointer',
              }}
              onMouseOver={e => e.currentTarget.style.background = '#f8fafc'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{
                width: 36, height: 36, background: '#E6F1FB', borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: '#185FA5', flexShrink: 0,
              }}>{doc.doc_type?.code || 'DOC'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.title}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {doc.doc_number} · {doc.project || '—'} · v{doc.current_version}
                </div>
              </div>
              <div style={{ flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                {doc.workflow && !doc.workflow.completed && (
                  <Badge label={doc.workflow.stage} />
                )}
                <Badge label={doc.status} />
              </div>
            </div>
          ))
        }
      </Card>

      {/* Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 20 }}>
        {[
          { icon: '⬆️', label: 'Create Document',    action: () => nav('/documents?upload=1') },
          { icon: '🔄', label: 'My Workflow Tasks',  action: () => nav('/workflow') },
          { icon: '📊', label: 'Generate Report',    action: () => nav('/reports') },
          { icon: '🔍', label: 'Search Documents',   action: () => nav('/documents') },
        ].map(q => (
          <button key={q.label} onClick={q.action} style={{
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
            padding: '16px', cursor: 'pointer', textAlign: 'center',
            transition: 'all 0.15s', fontFamily: 'inherit',
          }}
          onMouseOver={e => { e.currentTarget.style.borderColor = '#185FA5'; e.currentTarget.style.background = '#f0f7ff' }}
          onMouseOut={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#fff' }}
          >
            <div style={{ fontSize: 24, marginBottom: 6 }}>{q.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{q.label}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
