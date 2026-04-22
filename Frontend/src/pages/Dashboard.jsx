import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { reportsAPI, documentsAPI, adminAPI } from '../api'
import { Metric, Card, Badge, Spinner, SectionHead, Btn } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
} from 'recharts'

const TABS = [
  { key: 'overview',  label: 'Overview' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'expiring',  label: 'Expiring' },
  { key: 'recent',    label: 'Recent Documents' },
]

const CHART_TYPES = [
  { key: 'bar',    label: 'Bar' },
  { key: 'pie',    label: 'Pie' },
  { key: 'donut',  label: 'Donut' },
  { key: 'line',   label: 'Line' },
  { key: 'area',   label: 'Area' },
  { key: 'radar',  label: 'Radar' },
]

const STATUS_COLOR = {
  Draft: '#B4B2A9', 'Under Review': '#EF9F27',
  Approved: '#1D9E75', Rejected: '#E24B4A',
  Archived: '#888780', Created: '#185FA5',
}

const PALETTE = [
  '#185FA5','#1D9E75','#EF9F27','#E24B4A','#888780','#B4B2A9',
  '#7c3aed','#0891b2','#d97706','#be123c','#15803d','#1e40af',
]

const CLASSIFY = [
  { key: 'status',      label: 'By Status'         },
  { key: 'type',        label: 'By Doc Type'        },
  { key: 'type_status', label: 'Type × Status'      },
]

export default function Dashboard() {
  const { user } = useAuth()
  const nav = useNavigate()

  const [summary,      setSummary]      = useState(null)
  const [expiring,     setExpiring]     = useState([])
  const [recent,       setRecent]       = useState([])
  const [byStatus,     setByStatus]     = useState([])
  const [byType,       setByType]       = useState([])
  const [byTypeStatus, setByTypeStatus] = useState({ data: [], statuses: [] })
  const [allDocTypes,  setAllDocTypes]  = useState([])
  const [loading,      setLoading]      = useState(true)
  const [activeTab,    setActiveTab]    = useState('overview')
  const [chartType,    setChartType]    = useState('bar')
  const [classify,     setClassify]     = useState('status')

  useEffect(() => {
    Promise.all([
      reportsAPI.summary(),
      reportsAPI.expiring(90),
      reportsAPI.byStatus(),
      reportsAPI.byType(),
      reportsAPI.byTypeStatus(),
      documentsAPI.list({ limit: 8 }),
      adminAPI.listDocTypes(),
    ]).then(([s, e, bs, bt, bts, r, dt]) => {
      setSummary(s.data)
      setExpiring(e.data)
      setByStatus(bs.data)
      setByType(bt.data || [])
      setByTypeStatus(bts.data || { data: [], statuses: [] })
      setRecent(r.data)
      setAllDocTypes(dt.data || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 32 }}><Spinner /></div>

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  return (
    <div style={{ padding: '28px 32px' }}>

      {/* Header + Quick actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: '#111' }}>
            Good {greeting}, {user?.name?.split(' ')[0]} 👋
          </h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { icon: '⬆️', label: 'Create Document',   action: () => nav('/documents?upload=1') },
            { icon: '🔄', label: 'My Workflow Tasks', action: () => nav('/workflow') },
            { icon: '📊', label: 'Generate Report',   action: () => nav('/reports') },
            { icon: '🔍', label: 'Search Documents',  action: () => nav('/documents') },
          ].map(q => (
            <button key={q.label} onClick={q.action} title={q.label} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
              padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 500, color: '#374151',
              transition: 'all 0.15s', whiteSpace: 'nowrap',
            }}
            onMouseOver={e => { e.currentTarget.style.borderColor = '#185FA5'; e.currentTarget.style.background = '#f0f7ff'; e.currentTarget.style.color = '#185FA5' }}
            onMouseOut={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#374151' }}
            >
              <span style={{ fontSize: 16 }}>{q.icon}</span>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        display: 'flex', gap: 4, borderBottom: '2px solid #e5e7eb',
        marginBottom: 24,
      }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '9px 20px',
              border: 'none', borderBottom: activeTab === t.key ? '2px solid #185FA5' : '2px solid transparent',
              background: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: activeTab === t.key ? 600 : 400,
              color: activeTab === t.key ? '#185FA5' : '#6b7280',
              marginBottom: -2,
              transition: 'color 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ════════════════════ OVERVIEW TAB ════════════════════ */}
      {activeTab === 'overview' && (
        <>
          {/* Metrics row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
            <Metric label="Total Documents"    value={summary?.total_documents  ?? 0} />
            <Metric label="Approved"           value={summary?.approved         ?? 0} color="#0F6E56" />
            <Metric label="Under Review"       value={summary?.under_review     ?? 0} color="#854F0B" />
            <Metric label="Pending Workflow"   value={summary?.pending_workflow ?? 0} color="#185FA5" />
            <Metric label="Expiring (90 days)" value={summary?.expiring_90_days ?? 0} color="#A32D2D" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            {/* Status chart with type switcher */}
            <StatusChart
              byStatus={byStatus} byType={byType} byTypeStatus={byTypeStatus}
              allDocTypes={allDocTypes}
              chartType={chartType} setChartType={setChartType}
              classify={classify}  setClassify={setClassify}
            />

            {/* Expiring alerts */}
            <Card>
              <SectionHead
                title={`Expiring Soon (${expiring.length})`}
                action={expiring.length > 0 && (
                  <Btn label="View All" size="sm" onClick={() => nav('/reports?tab=expiring')} />
                )}
              />
              <ExpiringList items={expiring.slice(0, 5)} nav={nav} />
            </Card>
          </div>

          {/* Recent documents */}
          <Card>
            <SectionHead
              title="Recent Documents"
              action={<Btn label="All Documents →" size="sm" onClick={() => nav('/documents')} />}
            />
            <RecentList items={recent} nav={nav} />
          </Card>

        </>
      )}

      {/* ════════════════════ ANALYTICS TAB ════════════════════ */}
      {activeTab === 'analytics' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <StatusChart
              byStatus={byStatus} byType={byType} byTypeStatus={byTypeStatus}
              allDocTypes={allDocTypes}
              chartType={chartType} setChartType={setChartType}
              classify={classify}  setClassify={setClassify}
            />

            <Card>
              <SectionHead title="Doc Type Breakdown" />
              {byType.length === 0
                ? <p style={{ color: '#9ca3af', fontSize: 13 }}>No data yet.</p>
                : (
                  <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {byType.filter(b => b.count > 0).sort((a,b) => b.count - a.count).map((b, i) => {
                      const max = Math.max(...byType.map(x => x.count), 1)
                      return (
                        <div key={b.type} style={{ marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span style={{ color: '#374151', fontWeight: 500 }}>{b.type}</span>
                            <span style={{ fontWeight: 700, color: PALETTE[i % PALETTE.length] }}>{b.count}</span>
                          </div>
                          <div style={{ background: '#f3f4f6', borderRadius: 99, height: 6 }}>
                            <div style={{
                              height: 6, borderRadius: 99,
                              width: `${(b.count / max) * 100}%`,
                              background: PALETTE[i % PALETTE.length],
                              transition: 'width 0.5s ease',
                            }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              }
            </Card>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <Card>
              <SectionHead title="Expiring Summary" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '8px 0' }}>
                {[
                  { label: '30 days', key: 'expiring_30_days', color: '#E24B4A' },
                  { label: '60 days', key: 'expiring_60_days', color: '#EF9F27' },
                  { label: '90 days', key: 'expiring_90_days', color: '#185FA5' },
                  { label: 'Overdue', key: 'overdue',          color: '#7c3aed' },
                ].map(m => (
                  <div key={m.key} style={{
                    background: '#f9fafb', borderRadius: 10, padding: '14px 16px',
                    borderLeft: `4px solid ${m.color}`,
                  }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: m.color }}>
                      {summary?.[m.key] ?? 0}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{m.label}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionHead title="Workflow Status" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '8px 0' }}>
                {[
                  { label: 'Pending',   key: 'pending_workflow', color: '#185FA5' },
                  { label: 'Completed', key: 'completed',        color: '#1D9E75' },
                  { label: 'Rejected',  key: 'rejected',         color: '#E24B4A' },
                  { label: 'Total',     key: 'total_documents',  color: '#374151' },
                ].map(m => (
                  <div key={m.key} style={{
                    background: '#f9fafb', borderRadius: 10, padding: '14px 16px',
                    borderLeft: `4px solid ${m.color}`,
                  }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: m.color }}>
                      {summary?.[m.key] ?? 0}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{m.label}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}

      {/* ════════════════════ EXPIRING TAB ════════════════════ */}
      {activeTab === 'expiring' && (
        <Card>
          <SectionHead
            title={`Expiring in 90 Days (${expiring.length})`}
            action={<Btn label="Full Report →" size="sm" onClick={() => nav('/reports')} />}
          />
          {expiring.length === 0
            ? <p style={{ color: '#9ca3af', fontSize: 13 }}>No documents expiring in the next 90 days.</p>
            : expiring.map(d => (
              <div key={d.id}
                onClick={() => nav(`/documents/${d.id}`)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 0', borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#111' }}>{d.title}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{d.doc_number} · {d.project || '—'}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#A32D2D', fontWeight: 600 }}>
                    {new Date(d.expiry_date).toLocaleDateString('en-IN')}
                  </span>
                  <Badge label={d.status} />
                </div>
              </div>
            ))
          }
        </Card>
      )}

      {/* ════════════════════ RECENT TAB ════════════════════ */}
      {activeTab === 'recent' && (
        <Card>
          <SectionHead
            title="Recent Documents"
            action={<Btn label="All Documents →" size="sm" onClick={() => nav('/documents')} />}
          />
          <RecentList items={recent} nav={nav} />
        </Card>
      )}
    </div>
  )
}

/* ── Documents chart: classify + individual doc-type drill-down ── */
function StatusChart({ byStatus, byType, byTypeStatus, allDocTypes, chartType, setChartType, classify, setClassify }) {
  const [selectedType, setSelectedType] = useState(null)

  // Build count lookup from byTypeStatus for the dropdown labels
  const countByType = {}
  ;(byTypeStatus.data || []).forEach(row => {
    countByType[row.type] = (byTypeStatus.statuses || []).reduce((s, st) => s + (row[st] || 0), 0)
  })

  // ── When a specific type is selected, always show its status breakdown ──
  const drillData = (() => {
    if (!selectedType) return null
    const row = (byTypeStatus.data || []).find(d => d.type === selectedType)
    if (!row) return []
    return (byTypeStatus.statuses || [])
      .map((s, i) => ({ name: s, value: row[s] || 0, fill: STATUS_COLOR[s] || PALETTE[i % PALETTE.length] }))
      .filter(d => d.value > 0)
  })()

  const isDrilling   = selectedType !== null
  const isTypeStatus = !isDrilling && classify === 'type_status'

  const availableCharts = isTypeStatus
    ? [{ key: 'stacked', label: 'Stacked' }, { key: 'grouped', label: 'Grouped' }]
    : CHART_TYPES

  const effectiveChart = isTypeStatus
    ? (['stacked', 'grouped'].includes(chartType) ? chartType : 'stacked')
    : chartType

  // Simple (non-drill) data
  const raw = classify === 'status' ? byStatus : byType
  const simpleData = raw.map((b, i) => {
    const name = classify === 'status' ? b.status : b.type
    return {
      name, value: b.count,
      fill: classify === 'status'
        ? (STATUS_COLOR[name] || PALETTE[i % PALETTE.length])
        : PALETTE[i % PALETTE.length],
    }
  })

  const title = isDrilling
    ? `${selectedType} — Status Breakdown`
    : classify === 'status'      ? 'Documents by Status'
    : classify === 'type'        ? 'Documents by Doc Type'
    :                              'Status Breakdown per Doc Type'

  const isEmpty = isDrilling
    ? drillData.length === 0
    : isTypeStatus
      ? (byTypeStatus.data || []).length === 0
      : simpleData.length === 0

  return (
    <Card>
      {/* Row 1: title + classify toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: '#111' }}>{title}</span>
        {!isDrilling && (
          <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 8, padding: 2, gap: 2 }}>
            {CLASSIFY.map(c => (
              <button key={c.key} onClick={() => setClassify(c.key)} style={{
                padding: '4px 10px', borderRadius: 6, border: 'none',
                fontSize: 11, cursor: 'pointer', fontWeight: 500,
                background: classify === c.key ? '#185FA5' : 'transparent',
                color: classify === c.key ? '#fff' : '#6b7280',
                transition: 'all 0.15s',
              }}>{c.label}</button>
            ))}
          </div>
        )}
        {isDrilling && (
          <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
            filtered view
          </span>
        )}
      </div>

      {/* Row 2: Doc type dropdown */}
      {allDocTypes.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <select
            value={selectedType || ''}
            onChange={e => setSelectedType(e.target.value || null)}
            style={{
              width: '100%', padding: '7px 12px',
              border: '1px solid #d1d5db', borderRadius: 8,
              fontSize: 13, color: '#111', background: '#fff',
              cursor: 'pointer', outline: 'none',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              appearance: 'auto',
            }}
          >
            <option value=''>All Doc Types</option>
            {allDocTypes.map(dt => {
              const count = countByType[dt.name]
              return (
                <option key={dt.id} value={dt.name}>
                  {dt.name}{count != null ? `  (${count})` : ''}
                </option>
              )
            })}
          </select>
        </div>
      )}

      {/* Row 3: chart type pills */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
        {availableCharts.map(ct => (
          <button key={ct.key} onClick={() => setChartType(ct.key)} style={{
            padding: '3px 10px', borderRadius: 6, border: '1px solid',
            fontSize: 11, cursor: 'pointer', fontWeight: 500,
            borderColor: effectiveChart === ct.key ? '#185FA5' : '#e5e7eb',
            background: effectiveChart === ct.key ? '#185FA5' : '#fff',
            color: effectiveChart === ct.key ? '#fff' : '#6b7280',
            transition: 'all 0.15s',
          }}>{ct.label}</button>
        ))}
      </div>

      {/* Chart area */}
      {isEmpty
        ? <p style={{ color: '#9ca3af', fontSize: 13 }}>No data for this selection.</p>
        : isDrilling
          ? <ResponsiveContainer width="100%" height={220}>
              {effectiveChart === 'bar'   ? <BarChartView   data={drillData} /> :
               effectiveChart === 'pie'   ? <PieChartView   data={drillData} hole={false} /> :
               effectiveChart === 'donut' ? <PieChartView   data={drillData} hole={true}  /> :
               effectiveChart === 'line'  ? <LineChartView  data={drillData} /> :
               effectiveChart === 'area'  ? <AreaChartView  data={drillData} /> :
                                            <RadarChartView data={drillData} />}
            </ResponsiveContainer>
          : isTypeStatus
            ? <TypeStatusChart
                data={byTypeStatus.data || []}
                statuses={byTypeStatus.statuses || []}
                mode={effectiveChart}
                onTypeClick={setSelectedType}
              />
            : <ResponsiveContainer width="100%" height={220}>
                {effectiveChart === 'bar'   ? <BarChartView   data={simpleData} /> :
                 effectiveChart === 'pie'   ? <PieChartView   data={simpleData} hole={false} /> :
                 effectiveChart === 'donut' ? <PieChartView   data={simpleData} hole={true}  /> :
                 effectiveChart === 'line'  ? <LineChartView  data={simpleData} /> :
                 effectiveChart === 'area'  ? <AreaChartView  data={simpleData} /> :
                                              <RadarChartView data={simpleData} />}
              </ResponsiveContainer>
      }
    </Card>
  )
}

/* ── Stacked / Grouped bar: doc type on X, each status as a segment ── */
function TypeStatusChart({ data, statuses, mode, onTypeClick }) {
  const stacked = mode === 'stacked'
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={data}
        margin={{ top: 4, right: 8, left: -16, bottom: 60 }}
        barCategoryGap={stacked ? '30%' : '20%'}
        onClick={e => e?.activeLabel && onTypeClick && onTypeClick(e.activeLabel)}
        style={{ cursor: 'pointer' }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="type" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          formatter={(value, name) => [value, name]}
          contentStyle={{ fontSize: 12 }}
          cursor={{ fill: 'rgba(24,95,165,0.08)' }}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" iconSize={8} />
        {statuses.map((status, i) => (
          <Bar
            key={status} dataKey={status} name={status}
            stackId={stacked ? 'stack' : undefined}
            fill={STATUS_COLOR[status] || PALETTE[i % PALETTE.length]}
            radius={!stacked ? [3, 3, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function BarChartView({ data }) {
  return (
    <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
      <Tooltip />
      <Bar dataKey="value" name="Documents" radius={[4,4,0,0]}>
        {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
      </Bar>
    </BarChart>
  )
}

function PieChartView({ data, hole }) {
  const inner = hole ? '55%' : '0%'
  return (
    <PieChart>
      <Pie data={data} dataKey="value" nameKey="name"
        cx="50%" cy="50%" innerRadius={inner} outerRadius="75%"
        paddingAngle={2} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}
        labelLine={false}
      >
        {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
      </Pie>
      <Tooltip formatter={(v) => [v, 'Documents']} />
      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
    </PieChart>
  )
}

function LineChartView({ data }) {
  return (
    <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
      <Tooltip />
      <Line type="monotone" dataKey="value" name="Documents"
        stroke="#185FA5" strokeWidth={2} dot={{ r: 4, fill: '#185FA5' }} />
    </LineChart>
  )
}

function AreaChartView({ data }) {
  return (
    <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%"  stopColor="#185FA5" stopOpacity={0.25} />
          <stop offset="95%" stopColor="#185FA5" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
      <Tooltip />
      <Area type="monotone" dataKey="value" name="Documents"
        stroke="#185FA5" strokeWidth={2} fill="url(#areaGrad)" />
    </AreaChart>
  )
}

function RadarChartView({ data }) {
  return (
    <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
      <PolarGrid stroke="#e5e7eb" />
      <PolarAngleAxis dataKey="name" tick={{ fontSize: 11 }} />
      <Radar name="Documents" dataKey="value"
        stroke="#185FA5" fill="#185FA5" fillOpacity={0.25} />
      <Tooltip />
    </RadarChart>
  )
}

/* ── Shared sub-components ── */
function ExpiringList({ items, nav }) {
  if (!items.length)
    return <p style={{ color: '#9ca3af', fontSize: 13 }}>No documents expiring in the next 90 days.</p>
  return items.map(d => (
    <div key={d.id} onClick={() => nav(`/documents/${d.id}`)}
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

function RecentList({ items, nav }) {
  if (!items.length)
    return <p style={{ color: '#9ca3af', fontSize: 13 }}>No documents yet.</p>
  return items.map(doc => (
    <div key={doc.id} onClick={() => nav(`/documents/${doc.id}`)}
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
        {doc.workflow && !doc.workflow.completed && <Badge label={doc.workflow.stage} />}
        <Badge label={doc.status} />
      </div>
    </div>
  ))
}
