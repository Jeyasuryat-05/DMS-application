import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { reportsAPI, documentsAPI, adminAPI } from '../api'
import { Badge, Spinner, SectionHead, Btn } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { fmtDate, istHour } from '../utils/dates'
import { FlexBox } from '@ui5/webcomponents-react'

const C = {
  brand:    '#0070F2',
  positive: '#188918',
  critical: '#E9730C',
  negative: '#BB0000',
  purple:   '#7c3aed',
  bg:       '#F5F6F7',
  white:    '#FFFFFF',
  border:   '#D9D9D9',
  header:   '#F2F2F2',
  text:     '#32363A',
  label:    '#6A6D70',
  hover:    '#EBF5FE',
  tabActive: '#0070F2',
  tabBg:    '#FFFFFF',
  neutral:  '#EDEDED',
}

const CHART_TYPES = [
  { key: 'bar',   label: 'Bar'   },
  { key: 'pie',   label: 'Pie'   },
  { key: 'donut', label: 'Donut' },
]

const STATUS_COLOR = {
  Draft: '#B4B2A9', 'Under Review': '#EF9F27',
  Approved: '#1D9E75', Rejected: '#E24B4A',
  Archived: '#888780',
}

const PALETTE = [
  '#185FA5','#1D9E75','#EF9F27','#E24B4A','#888780','#B4B2A9',
  '#7c3aed','#0891b2','#d97706','#be123c','#15803d','#1e40af',
]

const CLASSIFY = [
  { key: 'status',      label: 'By Status'    },
  { key: 'type',        label: 'By Doc Type'  },
  { key: 'type_status', label: 'Type × Status' },
]

// ── Reusable card shell ──────────────────────────────────────────────────────
function Panel({ children, style = {} }) {
  return (
    <div style={{
      background: C.white,
      border: `1px solid ${C.border}`,
      borderRadius: 6,
      ...style,
    }}>
      {children}
    </div>
  )
}

// ── Metric card ──────────────────────────────────────────────────────────────
function MetricCard({ label, value, color }) {
  return (
    <Panel style={{ flex: 1, textAlign: 'center', padding: '14px 10px', minWidth: 110 }}>
      <div style={{ fontSize: 10, color: C.label, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || C.text }}>{value}</div>
    </Panel>
  )
}

// ── Custom Tab bar ───────────────────────────────────────────────────────────
function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{
      display: 'flex',
      borderBottom: `2px solid ${C.border}`,
      marginBottom: 20,
      background: C.white,
      borderRadius: '6px 6px 0 0',
      overflow: 'hidden',
    }}>
      {tabs.map(t => {
        const isActive = active === t.id
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            padding: '10px 20px',
            fontSize: 13, fontWeight: isActive ? 700 : 400,
            color: isActive ? C.tabActive : C.label,
            background: isActive ? C.hover : 'transparent',
            border: 'none',
            borderBottom: isActive ? `2px solid ${C.tabActive}` : '2px solid transparent',
            marginBottom: -2,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
            whiteSpace: 'nowrap',
          }}>
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

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

  const hour = istHour()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  const quickActions = [
    ...(user?.can_create || user?.role === 'System Admin'
      ? [{ icon: '⬆', label: 'Create Document', action: () => nav('/documents?upload=1') }]
      : []),
    { icon: '🔄', label: 'My Workflow Tasks', action: () => nav('/workflow') },
    { icon: '📊', label: 'Generate Report',   action: () => nav('/reports') },
    { icon: '🔍', label: 'Search Documents',  action: () => nav('/documents') },
  ]

  const TABS = [
    { id: 'overview',  label: 'Overview' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'expiring',  label: 'Expiring' },
    { id: 'recent',    label: 'Recent Documents' },
  ]

  return (
    <div style={{ padding: '24px 28px', background: C.bg, minHeight: '100%' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>
            Good {greeting}, {user?.name?.split(' ')[0]} 👋
          </div>
          <div style={{ fontSize: 13, color: C.label, marginTop: 3 }}>
            {fmtDate(new Date(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {quickActions.map(q => (
            <button key={q.label} onClick={q.action} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px',
              fontSize: 12, fontWeight: 500,
              color: C.brand,
              background: C.white,
              border: `1px solid ${C.brand}`,
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background 0.15s',
            }}
            onMouseOver={e => e.currentTarget.style.background = C.hover}
            onMouseOut={e => e.currentTarget.style.background = C.white}
            >
              <span>{q.icon}</span>
              <span>{q.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />

      {/* ════ OVERVIEW ════ */}
      {activeTab === 'overview' && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <MetricCard label="Total Documents"    value={summary?.total_documents  ?? 0} />
            <MetricCard label="Approved"           value={summary?.approved         ?? 0} color={C.positive} />
            <MetricCard label="Under Review"       value={summary?.under_review     ?? 0} color={C.critical} />
            <MetricCard label="Pending Workflow"   value={summary?.pending_workflow ?? 0} color={C.brand} />
            <MetricCard label="Expiring (90 days)" value={summary?.expiring_90_days ?? 0} color={C.negative} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <StatusChart
              byStatus={byStatus} byType={byType} byTypeStatus={byTypeStatus}
              allDocTypes={allDocTypes}
              chartType={chartType} setChartType={setChartType}
              classify={classify}  setClassify={setClassify}
            />
            <Panel>
              <div style={{ padding: '14px 16px' }}>
                <SectionHead
                  title={`Expiring Soon (${expiring.length})`}
                  action={expiring.length > 0 && (
                    <Btn label="View All" size="sm" onClick={() => nav('/reports?tab=expiring')} />
                  )}
                />
                <ExpiringList items={expiring.slice(0, 5)} nav={nav} />
              </div>
            </Panel>
          </div>

          <Panel>
            <div style={{ padding: '14px 16px' }}>
              <SectionHead
                title="Recent Documents"
                action={<Btn label="All Documents →" size="sm" onClick={() => nav('/documents')} />}
              />
              <RecentList items={recent} nav={nav} />
            </div>
          </Panel>
        </>
      )}

      {/* ════ ANALYTICS ════ */}
      {activeTab === 'analytics' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <StatusChart
              byStatus={byStatus} byType={byType} byTypeStatus={byTypeStatus}
              allDocTypes={allDocTypes}
              chartType={chartType} setChartType={setChartType}
              classify={classify}  setClassify={setClassify}
            />
            <Panel>
              <div style={{ padding: '14px 16px' }}>
                <SectionHead title="Doc Type Breakdown" />
                {byType.length === 0
                  ? <span style={{ color: C.label, fontSize: 13 }}>No data yet.</span>
                  : (
                    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                      {byType.filter(b => b.count > 0).sort((a,b) => b.count - a.count).map((b, i) => {
                        const max = Math.max(...byType.map(x => x.count), 1)
                        return (
                          <div key={b.type} style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                              <span style={{ color: C.text, fontWeight: 500 }}>{b.type}</span>
                              <span style={{ fontWeight: 700, color: PALETTE[i % PALETTE.length] }}>{b.count}</span>
                            </div>
                            <div style={{ background: C.neutral, borderRadius: 99, height: 6 }}>
                              <div style={{ height: 6, borderRadius: 99, width: `${(b.count / max) * 100}%`, background: PALETTE[i % PALETTE.length], transition: 'width 0.5s ease' }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                }
              </div>
            </Panel>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Panel>
              <div style={{ padding: '14px 16px' }}>
                <SectionHead title="Expiring Summary" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingTop: 4 }}>
                  {[
                    { label: '30 days', key: 'expiring_30_days', color: C.negative },
                    { label: '60 days', key: 'expiring_60_days', color: C.critical },
                    { label: '90 days', key: 'expiring_90_days', color: C.brand },
                    { label: 'Overdue', key: 'overdue',          color: C.purple },
                  ].map(m => (
                    <div key={m.key} style={{ background: C.bg, borderRadius: 6, padding: '12px 14px', borderLeft: `4px solid ${m.color}`, border: `1px solid ${C.border}`, borderLeftWidth: 4 }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: m.color }}>{summary?.[m.key] ?? 0}</div>
                      <div style={{ fontSize: 12, color: C.label, marginTop: 2 }}>{m.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
            <Panel>
              <div style={{ padding: '14px 16px' }}>
                <SectionHead title="Workflow Status" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingTop: 4 }}>
                  {[
                    { label: 'Pending',   key: 'pending_workflow', color: C.brand },
                    { label: 'Completed', key: 'completed',        color: C.positive },
                    { label: 'Rejected',  key: 'rejected',         color: C.negative },
                    { label: 'Total',     key: 'total_documents',  color: C.text },
                  ].map(m => (
                    <div key={m.key} style={{ background: C.bg, borderRadius: 6, padding: '12px 14px', border: `1px solid ${C.border}`, borderLeftWidth: 4, borderLeftColor: m.color, borderLeftStyle: 'solid' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: m.color }}>{summary?.[m.key] ?? 0}</div>
                      <div style={{ fontSize: 12, color: C.label, marginTop: 2 }}>{m.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          </div>
        </>
      )}

      {/* ════ EXPIRING ════ */}
      {activeTab === 'expiring' && (
        <Panel>
          <div style={{ padding: '14px 16px' }}>
            <SectionHead
              title={`Expiring in 90 Days (${expiring.length})`}
              action={<Btn label="Full Report →" size="sm" onClick={() => nav('/reports')} />}
            />
            {expiring.length === 0
              ? <span style={{ color: C.label, fontSize: 13 }}>No documents expiring in the next 90 days.</span>
              : expiring.map(d => (
                <div key={d.id} onClick={() => nav(`/documents/${d.id}`)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
                  onMouseOver={e => e.currentTarget.style.background = C.hover}
                  onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: C.text }}>{d.title}</div>
                    <div style={{ fontSize: 12, color: C.label }}>{d.doc_number} · {d.project || '—'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: C.negative, fontWeight: 600 }}>{fmtDate(d.expiry_date)}</span>
                    <Badge label={d.status} />
                  </div>
                </div>
              ))
            }
          </div>
        </Panel>
      )}

      {/* ════ RECENT ════ */}
      {activeTab === 'recent' && (
        <Panel>
          <div style={{ padding: '14px 16px' }}>
            <SectionHead
              title="Recent Documents"
              action={<Btn label="All Documents →" size="sm" onClick={() => nav('/documents')} />}
            />
            <RecentList items={recent} nav={nav} />
          </div>
        </Panel>
      )}
    </div>
  )
}

/* ── Chart renderer — bar/line/area self-size; pie/donut manage own container ── */
function renderChart(type, data) {
  if (type === 'pie')   return <PieChartView data={data} hole={false} />
  if (type === 'donut') return <PieChartView data={data} hole={true}  />
  return <BarChartView data={data} />
}

/* ── Chart sub-components ── */
function StatusChart({ byStatus, byType, byTypeStatus, allDocTypes, chartType, setChartType, classify, setClassify }) {
  const [selectedType, setSelectedType] = useState(null)

  const countByType = {}
  ;(byTypeStatus.data || []).forEach(row => {
    countByType[row.type] = (byTypeStatus.statuses || []).reduce((s, st) => s + (row[st] || 0), 0)
  })

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
    : (['bar', 'pie', 'donut'].includes(chartType) ? chartType : 'bar')

  const raw = classify === 'status' ? byStatus : byType
  const simpleData = raw
    .filter(b => {
      const name = classify === 'status' ? b.status : b.type
      return name && !/^\d+$/.test(name.trim())  // drop purely-numeric names like "1"
    })
    .map((b, i) => {
      const name = classify === 'status' ? b.status : b.type
      return { name, value: b.count, fill: classify === 'status' ? (STATUS_COLOR[name] || PALETTE[i % PALETTE.length]) : PALETTE[i % PALETTE.length] }
    })

  const title = isDrilling ? `${selectedType} — Status Breakdown`
    : classify === 'status' ? 'Documents by Status'
    : classify === 'type'   ? 'Documents by Doc Type'
    : 'Status Breakdown per Doc Type'

  const isEmpty = isDrilling ? drillData.length === 0
    : isTypeStatus ? (byTypeStatus.data || []).length === 0
    : simpleData.length === 0

  return (
    <Panel>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{title}</span>
          {!isDrilling && (
            <div style={{ display: 'flex', background: C.neutral, borderRadius: 6, padding: 2, gap: 2 }}>
              {CLASSIFY.map(c => (
                <button key={c.key} onClick={() => setClassify(c.key)} style={{
                  padding: '3px 9px', borderRadius: 5, border: 'none', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                  background: classify === c.key ? C.brand : 'transparent',
                  color: classify === c.key ? '#fff' : C.label,
                  transition: 'all 0.15s', fontFamily: 'inherit',
                }}>{c.label}</button>
              ))}
            </div>
          )}
        </div>

        {allDocTypes.length > 0 && (
          <select value={selectedType || ''} onChange={e => setSelectedType(e.target.value || null)}
            style={{ width: '100%', padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, background: C.white, marginBottom: 10, fontFamily: 'inherit', cursor: 'pointer', outline: 'none', color: C.text }}>
            <option value=''>All Doc Types</option>
            {allDocTypes.map(dt => {
              const count = countByType[dt.name]
              return <option key={dt.id} value={dt.name}>{dt.name}{count != null ? `  (${count})` : ''}</option>
            })}
          </select>
        )}

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
          {availableCharts.map(ct => (
            <button key={ct.key} onClick={() => setChartType(ct.key)} style={{
              padding: '3px 10px', borderRadius: 4,
              border: `1px solid ${effectiveChart === ct.key ? C.brand : C.border}`,
              fontSize: 11, cursor: 'pointer', fontWeight: 500,
              background: effectiveChart === ct.key ? C.brand : C.white,
              color: effectiveChart === ct.key ? '#fff' : C.label,
              fontFamily: 'inherit',
            }}>{ct.label}</button>
          ))}
        </div>

        {isEmpty
          ? <span style={{ color: C.label, fontSize: 13 }}>No data for this selection.</span>
          : isDrilling
            ? renderChart(effectiveChart, drillData)
            : isTypeStatus
              ? <TypeStatusChart data={byTypeStatus.data || []} statuses={byTypeStatus.statuses || []} mode={effectiveChart} onTypeClick={setSelectedType} />
              : renderChart(effectiveChart, simpleData)
        }
      </div>
    </Panel>
  )
}

/* ─── Pure SVG chart helpers ──────────────────────────────────────────────── */

function svgArcPath(cx, cy, r, startAngle, endAngle) {
  const toRad = a => (a - 90) * Math.PI / 180
  const x1 = cx + r * Math.cos(toRad(startAngle))
  const y1 = cy + r * Math.sin(toRad(startAngle))
  const x2 = cx + r * Math.cos(toRad(endAngle))
  const y2 = cy + r * Math.sin(toRad(endAngle))
  const large = endAngle - startAngle > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}

function svgSlicePath(cx, cy, innerR, outerR, startAngle, endAngle) {
  const toRad = a => (a - 90) * Math.PI / 180
  const cos1s = Math.cos(toRad(startAngle)), sin1s = Math.sin(toRad(startAngle))
  const cos1e = Math.cos(toRad(endAngle)),   sin1e = Math.sin(toRad(endAngle))
  const large = endAngle - startAngle > 180 ? 1 : 0
  const ox1 = cx + outerR * cos1s, oy1 = cy + outerR * sin1s
  const ox2 = cx + outerR * cos1e, oy2 = cy + outerR * sin1e
  const ix1 = cx + innerR * cos1e, iy1 = cy + innerR * sin1e
  const ix2 = cx + innerR * cos1s, iy2 = cy + innerR * sin1s
  if (innerR === 0) {
    return `M ${cx} ${cy} L ${ox1} ${oy1} A ${outerR} ${outerR} 0 ${large} 1 ${ox2} ${oy2} Z`
  }
  return `M ${ox1} ${oy1} A ${outerR} ${outerR} 0 ${large} 1 ${ox2} ${oy2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2} Z`
}

/* SVG Bar Chart */
function BarChartView({ data }) {
  const [tooltip, setTooltip] = useState(null)
  const top = [...data].sort((a, b) => b.value - a.value).slice(0, 12)
  const W = 460, padL = 36, padR = 10, padT = 16, labelH = 60
  const plotH = 180
  const H = padT + plotH + labelH
  const maxVal = Math.max(...top.map(d => d.value), 1)
  const barW = Math.floor((W - padL - padR) / top.length)
  const gap = Math.max(2, Math.floor(barW * 0.18))

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(maxVal * f))

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
        {/* grid lines */}
        {yTicks.map(v => {
          const y = padT + plotH - (v / maxVal) * plotH
          return (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#f0f0f0" strokeWidth={1} />
              <text x={padL - 4} y={y + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text>
            </g>
          )
        })}
        {/* bars */}
        {top.map((d, i) => {
          const bh = Math.max(2, (d.value / maxVal) * plotH)
          const x = padL + i * barW + gap
          const bw = barW - gap * 2
          const y = padT + plotH - bh
          return (
            <g key={i}
              onMouseEnter={e => setTooltip({ x: x + bw / 2, y, name: d.name, value: d.value })}
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: 'default' }}>
              <rect x={x} y={y} width={bw} height={bh} fill={d.fill} rx={3} />
              {/* rotated label */}
              <text
                x={x + bw / 2}
                y={padT + plotH + 8}
                textAnchor="end"
                fontSize={10}
                fill="#6A6D70"
                transform={`rotate(-35, ${x + bw / 2}, ${padT + plotH + 8})`}>
                {d.name.length > 14 ? d.name.slice(0, 13) + '…' : d.name}
              </text>
            </g>
          )
        })}
        {/* axes */}
        <line x1={padL} x2={padL} y1={padT} y2={padT + plotH} stroke="#D9D9D9" strokeWidth={1} />
        <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke="#D9D9D9" strokeWidth={1} />
        {/* tooltip */}
        {tooltip && (
          <g>
            <rect x={tooltip.x - 50} y={tooltip.y - 36} width={100} height={30} rx={4} fill="rgba(0,0,0,0.75)" />
            <text x={tooltip.x} y={tooltip.y - 22} textAnchor="middle" fontSize={10} fill="#fff">
              {tooltip.name.length > 14 ? tooltip.name.slice(0, 13) + '…' : tooltip.name}
            </text>
            <text x={tooltip.x} y={tooltip.y - 10} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#fff">
              {tooltip.value}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}

/* SVG Pie / Donut Chart */
function PieChartView({ data, hole }) {
  const [tooltip, setTooltip] = useState(null)
  const W = 300, H = 300, cx = 150, cy = 150, outerR = 120, innerR = hole ? 60 : 0

  // Only chart slices with value > 0, sorted by value desc; zeros go to bottom legend
  const nonZero = [...data.filter(d => d.value > 0)].sort((a, b) => b.value - a.value)
  const zeros   = data.filter(d => d.value === 0).sort((a, b) => a.name.localeCompare(b.name))
  const total   = nonZero.reduce((s, d) => s + d.value, 0) || 1

  let angle = 0
  const slices = nonZero.map((d, i) => {
    const sweep = (d.value / total) * 356
    const start = angle
    angle += sweep + 2
    const mid = start + sweep / 2
    const midRad = (mid - 90) * Math.PI / 180
    const labelR = outerR + 20
    return {
      ...d, i,
      path: svgSlicePath(cx, cy, innerR, outerR, start, start + sweep),
      pct: (d.value / total * 100).toFixed(0),
      lx: cx + labelR * Math.cos(midRad),
      ly: cy + labelR * Math.sin(midRad),
      showLabel: d.value / total >= 0.07,
    }
  })

  return (
    <div>
      {/* Chart centred */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
          {slices.map((s, i) => (
            <g key={i}
              onMouseEnter={() => setTooltip(s)}
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: 'default' }}>
              <path d={s.path} fill={s.fill} stroke="#fff" strokeWidth={2} />
              {s.showLabel && (
                <text x={s.lx} y={s.ly} textAnchor="middle" dominantBaseline="middle"
                  fontSize={11} fontWeight="600" fill={s.fill}>
                  {s.pct}%
                </text>
              )}
            </g>
          ))}
          {hole && (
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
              fontSize={14} fontWeight="700" fill="#32363A">
              {total}
            </text>
          )}
          {tooltip && (
            <g>
              <rect x={cx - 60} y={cy + outerR + 10} width={120} height={32} rx={4} fill="rgba(0,0,0,0.78)" />
              <text x={cx} y={cy + outerR + 24} textAnchor="middle" fontSize={10} fill="#fff">{tooltip.name}</text>
              <text x={cx} y={cy + outerR + 38} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#fff">
                {tooltip.value} ({tooltip.pct}%)
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Legend below — 3-column grid, non-zero first then zeros */}
      <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 10, marginTop: 4 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '5px 12px' }}>
          {slices.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#32363A', overflow: 'hidden' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.fill, flexShrink: 0, display: 'inline-block' }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.name}>{s.name}</span>
              <span style={{ fontWeight: 700, color: s.fill, flexShrink: 0, marginLeft: 2 }}>{s.value}</span>
            </div>
          ))}
          {zeros.map((d, i) => (
            <div key={'z' + i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#9ca3af', overflow: 'hidden' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#D9D9D9', flexShrink: 0, display: 'inline-block' }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.name}>{d.name}</span>
              <span style={{ fontWeight: 600, color: '#9ca3af', flexShrink: 0, marginLeft: 2 }}>0</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* SVG stacked/grouped bar for TypeStatus */
function TypeStatusChart({ data, statuses, mode, onTypeClick }) {
  const [tooltip, setTooltip] = useState(null)
  const stacked = mode === 'stacked'
  const W = 460, padL = 36, padR = 10, padT = 16, labelH = 64
  const plotH = 180
  const H = padT + plotH + labelH

  const maxVal = stacked
    ? Math.max(...data.map(row => statuses.reduce((s, st) => s + (row[st] || 0), 0)), 1)
    : Math.max(...data.flatMap(row => statuses.map(st => row[st] || 0)), 1)

  const barW = Math.floor((W - padL - padR) / Math.max(data.length, 1))
  const gapOuter = Math.max(2, Math.floor(barW * 0.15))
  const innerW = barW - gapOuter * 2

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(maxVal * f))

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
        {yTicks.map(v => {
          const y = padT + plotH - (v / maxVal) * plotH
          return (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#f0f0f0" strokeWidth={1} />
              <text x={padL - 4} y={y + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text>
            </g>
          )
        })}

        {data.map((row, i) => {
          const groupX = padL + i * barW + gapOuter
          const label = row.type || ''
          let stackY = 0

          const bars = stacked
            ? statuses.map((st, si) => {
                const val = row[st] || 0
                const bh = (val / maxVal) * plotH
                const y = padT + plotH - stackY - bh
                stackY += bh
                return { st, val, bh, x: groupX, y, w: innerW, fill: STATUS_COLOR[st] || PALETTE[si % PALETTE.length] }
              }).filter(b => b.bh > 0)
            : statuses.map((st, si) => {
                const subW = innerW / statuses.length
                const val = row[st] || 0
                const bh = (val / maxVal) * plotH
                return { st, val, bh, x: groupX + si * subW, y: padT + plotH - bh, w: subW - 1, fill: STATUS_COLOR[st] || PALETTE[si % PALETTE.length] }
              }).filter(b => b.bh > 0)

          return (
            <g key={i} onClick={() => onTypeClick && onTypeClick(row.type)} style={{ cursor: 'pointer' }}>
              {bars.map((b, bi) => (
                <rect key={bi} x={b.x} y={b.y} width={b.w} height={b.bh} fill={b.fill} rx={2}
                  onMouseEnter={() => setTooltip({ x: b.x + b.w / 2, y: b.y, name: `${label} / ${b.st}`, value: b.val })}
                  onMouseLeave={() => setTooltip(null)} />
              ))}
              <text
                x={groupX + innerW / 2} y={padT + plotH + 8}
                textAnchor="end" fontSize={10} fill="#6A6D70"
                transform={`rotate(-35, ${groupX + innerW / 2}, ${padT + plotH + 8})`}>
                {label.length > 13 ? label.slice(0, 12) + '…' : label}
              </text>
            </g>
          )
        })}

        <line x1={padL} x2={padL} y1={padT} y2={padT + plotH} stroke="#D9D9D9" strokeWidth={1} />
        <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke="#D9D9D9" strokeWidth={1} />

        {tooltip && (
          <g>
            <rect x={tooltip.x - 60} y={tooltip.y - 40} width={120} height={32} rx={4} fill="rgba(0,0,0,0.75)" />
            <text x={tooltip.x} y={tooltip.y - 26} textAnchor="middle" fontSize={10} fill="#fff">{tooltip.name}</text>
            <text x={tooltip.x} y={tooltip.y - 13} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#fff">{tooltip.value}</text>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 4, paddingTop: 6, borderTop: '1px solid #f0f0f0' }}>
        {statuses.map((st, i) => (
          <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#32363A' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[st] || PALETTE[i % PALETTE.length], display: 'inline-block' }} />
            {st}
          </div>
        ))}
      </div>
    </div>
  )
}


function ExpiringList({ items, nav }) {
  if (!items.length)
    return <span style={{ color: '#6A6D70', fontSize: 13 }}>No documents expiring in the next 90 days.</span>
  return items.map(d => (
    <div key={d.id} onClick={() => nav(`/documents/${d.id}`)}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #D9D9D9', cursor: 'pointer' }}
      onMouseOver={e => e.currentTarget.style.background = '#EBF5FE'}
      onMouseOut={e => e.currentTarget.style.background = 'transparent'}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#32363A' }}>{d.title}</div>
        <div style={{ fontSize: 11, color: '#6A6D70' }}>{d.doc_number} · {d.project}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: '#BB0000', fontWeight: 600 }}>{fmtDate(d.expiry_date)}</div>
        <Badge label={d.status} />
      </div>
    </div>
  ))
}

function RecentList({ items, nav }) {
  if (!items.length)
    return <span style={{ color: '#6A6D70', fontSize: 13 }}>No documents yet.</span>
  return items.map(doc => (
    <div key={doc.id} onClick={() => nav(`/documents/${doc.id}`)}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #D9D9D9', cursor: 'pointer' }}
      onMouseOver={e => e.currentTarget.style.background = '#EBF5FE'}
      onMouseOut={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ width: 36, height: 36, background: '#EBF5FE', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#0070F2', flexShrink: 0 }}>
        {doc.doc_type?.code || 'DOC'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#32363A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</div>
        <div style={{ fontSize: 11, color: '#6A6D70' }}>{doc.doc_number} · {doc.project || '—'} · v{doc.current_version}</div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {doc.workflow && !doc.workflow.completed && doc.workflow.stage !== 'Prepare' && <Badge label={doc.workflow.stage} />}
        <Badge label={doc.status} />
      </div>
    </div>
  ))
}
