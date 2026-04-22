/**
 * Workflow.jsx — FS W_EM_DMS_01 compliant view
 * Tabs: My Inbox | All Pending | Kanban | Alert Dashboard (FS E_EM_DMS_03)
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { workflowAPI, alertsAPI } from '../api'
import { Badge, Card, Metric, Spinner, Empty, Tabs, Btn } from '../components/ui'
import { useAuth } from '../hooks/useAuth'

const C = { blue:'#0C447C', accent:'#185FA5', green:'#0F6E56', red:'#A32D2D',
            amber:'#854F0B', purple:'#534AB7', border:'#e5e7eb' }

const STATUS_META = {
  '05':{ label:'Draft',       color:'#9ca3af', bg:'#f9fafb' },
  '10':{ label:'Created',     color:C.accent,  bg:'#E6F1FB' },
  '15':{ label:'In Check',    color:C.amber,   bg:'#FAEEDA' },
  '20':{ label:'In Review',   color:C.purple,  bg:'#EEEDFE' },
  '25':{ label:'In Approval', color:C.green,   bg:'#E1F5EE' },
  '30':{ label:'Released',    color:C.green,   bg:'#E1F5EE' },
}

function StatusBadge({ code, status }) {
  const m = STATUS_META[code] || { label: status, color:'#6b7280', bg:'#f3f4f6' }
  return (
    <span style={{ padding:'2px 10px', borderRadius:99, fontSize:11, fontWeight:600,
      background:m.bg, color:m.color, border:`1px solid ${m.color}44`, whiteSpace:'nowrap' }}>
      {code && <span style={{ fontFamily:'monospace', marginRight:4 }}>[{code}]</span>}
      {m.label || status}
    </span>
  )
}

// ─── Workflow pipeline bar (FS 4-step) ────────────────────────────────────────
function WfBar({ doc }) {
  const wf = doc.workflow
  if (!wf) return null
  const STEPS = [
    {step:1,label:'Prepare',code:'10'},
    {step:2,label:'Check',  code:'15'},
    {step:3,label:'Review', code:'20'},
    {step:4,label:'Approve',code:'25'},
    {step:5,label:'Released',code:'30'},
  ]
  const cur = wf.current_step || 1
  return (
    <div style={{ display:'flex', alignItems:'center', marginTop:6 }}>
      {STEPS.map((s,i) => {
        const done = wf.completed ? true : s.step < cur
        const active = !wf.completed && s.step === cur
        const rejected = wf.rejected && s.step === cur
        return (
          <div key={s.step} style={{ display:'flex', alignItems:'center', flex:1 }}>
            <div style={{
              flex:1, textAlign:'center', padding:'4px 2px', borderRadius:5, fontSize:10, fontWeight:500,
              background: rejected ? '#FCEBEB' : done ? '#E1F5EE' : active ? C.blue : '#f9fafb',
              color: rejected ? C.red : done ? C.green : active ? '#fff' : '#9ca3af',
              border: rejected ? `1px solid ${C.red}` : done ? `1px solid #1D9E75` : active ? 'none' : `1px solid ${C.border}`,
            }}>
              {done ? '✓' : rejected ? '✗' : s.label}
            </div>
            {i < STEPS.length-1 && (
              <div style={{ width:12, height:2, background: done ? '#1D9E75':'#e5e7eb' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Document card ────────────────────────────────────────────────────────────
function DocCard({ doc, onClick }) {
  const wf = doc.workflow
  return (
    <div onClick={onClick} style={{
      background:'#fff', border:`1px solid ${C.border}`, borderRadius:10,
      padding:'14px 16px', marginBottom:8, cursor:'pointer', transition:'border-color 0.15s',
    }}
    onMouseOver={e=>e.currentTarget.style.borderColor=C.accent}
    onMouseOut={e=>e.currentTarget.style.borderColor=C.border}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:600, fontSize:14 }}>{doc.title}</div>
          <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>
            {doc.doc_number} · {doc.project || '—'} · v{doc.current_version}
          </div>
          {wf && <WfBar doc={doc} />}
        </div>
        <div style={{ flexShrink:0, display:'flex', flexDirection:'column', gap:4, alignItems:'flex-end' }}>
          <StatusBadge code={doc.status_code} status={doc.status} />
          {wf?.rejected && <Badge label="Rejected" />}
          {wf?.mode && (
            <span style={{ fontSize:10, color:'#9ca3af' }}>{wf.mode}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Expiry Alert Dashboard (FS E_EM_DMS_03) ─────────────────────────────────
function AlertDashboard() {
  const [upcoming, setUpcoming]   = useState([])
  const [logs, setLogs]           = useState([])
  const [days, setDays]           = useState(90)
  const [loading, setLoading]     = useState(true)
  const [triggering, setTriggering] = useState(false)
  const nav = useNavigate()

  useEffect(() => {
    setLoading(true)
    Promise.all([
      alertsAPI.upcoming(days),
      alertsAPI.logs(),
    ]).then(([u, l]) => { setUpcoming(u.data); setLogs(l.data) })
      .finally(() => setLoading(false))
  }, [days])

  async function triggerJob() {
    setTriggering(true)
    await alertsAPI.runJob().catch(()=>{})
    setTimeout(() => { setTriggering(false); setLoading(true);
      alertsAPI.upcoming(days).then(r=>setUpcoming(r.data)).finally(()=>setLoading(false))
    }, 2000)
  }

  const critical = upcoming.filter(d=>d.days_left<=7)
  const warning  = upcoming.filter(d=>d.days_left>7&&d.days_left<=30)
  const info     = upcoming.filter(d=>d.days_left>30)

  if (loading) return <Spinner />

  return (
    <div>
      {/* Summary */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:24 }}>
        <Metric label="Expiring (total)" value={upcoming.length} />
        <Metric label="Critical (≤7 days)" value={critical.length} color={C.red} />
        <Metric label="Warning (≤30 days)" value={warning.length} color={C.amber} />
        <Metric label="Info (≤90 days)" value={info.length} color={C.accent} />
      </div>

      {/* Controls */}
      <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:16 }}>
        <span style={{ fontSize:13, color:'#374151', fontWeight:500 }}>Show expiring within:</span>
        {[7,15,30,60,90].map(d=>(
          <button key={d} onClick={()=>setDays(d)} style={{
            padding:'4px 14px', borderRadius:99, fontSize:12, cursor:'pointer', border:'1px solid',
            background:days===d?C.accent:'transparent',
            color:days===d?'#fff':'#374151',
            borderColor:days===d?C.accent:'#d1d5db',
          }}>{d}d</button>
        ))}
        <div style={{ marginLeft:'auto' }}>
          <button onClick={triggerJob} disabled={triggering} style={{
            padding:'6px 16px', borderRadius:8, fontSize:12, fontWeight:600,
            background: triggering?'#9ca3af':C.green, color:'#fff', border:'none',
            cursor:triggering?'not-allowed':'pointer',
          }}>{triggering?'Running…':'▶ Run Alert Job Now'}</button>
        </div>
      </div>

      {/* Alert lead-day legend */}
      <div style={{ background:'#f0f7ff', border:`1px solid #bfdbfe`, borderRadius:8,
        padding:'10px 14px', marginBottom:16, fontSize:12, color:'#1e40af' }}>
        <strong>FS E_EM_DMS_03:</strong> Automated alerts trigger at configured lead days
        (default: 30 / 15 / 7 days before expiry). Configured per document type in Admin → Document Types.
        Background job runs daily at 06:00. Recipients: Document Author + Responsible Person + configured roles.
      </div>

      {/* Expiry table */}
      {upcoming.length === 0 ? <Empty message={`No documents expiring within ${days} days.`} /> : (
        <div style={{ overflowX:'auto', background:'#fff', border:`1px solid ${C.border}`, borderRadius:10 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#EBF4FF', borderBottom:`2px solid ${C.accent}` }}>
                {['Doc Number','Title','Type','Project','Status','Expiry Date','Days Left','Alert Thresholds',''].map(h=>(
                  <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontWeight:600, fontSize:12, color:C.blue, whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {upcoming.map(d=>{
                const bg = d.days_left<=7?'#fff5f5':d.days_left<=30?'#fffbeb':'#fff'
                return (
                  <tr key={d.id} style={{ borderBottom:`1px solid #f3f4f6`, background:bg }}>
                    <td style={{ padding:'10px 12px', fontWeight:600, color:C.accent }}>{d.doc_number}</td>
                    <td style={{ padding:'10px 12px', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.title}</td>
                    <td style={{ padding:'10px 12px', fontSize:11 }}>{d.doc_type}</td>
                    <td style={{ padding:'10px 12px', color:'#6b7280' }}>{d.project||'—'}</td>
                    <td style={{ padding:'10px 12px' }}><StatusBadge status={d.status} /></td>
                    <td style={{ padding:'10px 12px', whiteSpace:'nowrap' }}>
                      {new Date(d.expiry_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                    </td>
                    <td style={{ padding:'10px 12px' }}>
                      <span style={{ fontWeight:700, fontSize:14,
                        color:d.days_left<=7?C.red:d.days_left<=30?C.amber:C.green }}>
                        {d.days_left}d
                      </span>
                    </td>
                    <td style={{ padding:'10px 12px' }}>
                      <div style={{ display:'flex', gap:4 }}>
                        {(d.alert_thresholds||[]).map(t=>(
                          <span key={t} style={{ padding:'1px 7px', borderRadius:99, fontSize:10, fontWeight:600,
                            background:d.days_left<=t?'#FCEBEB':'#f3f4f6',
                            color:d.days_left<=t?C.red:'#6b7280',
                            border:`1px solid ${d.days_left<=t?C.red:'#e5e7eb'}` }}>{t}d</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding:'10px 12px' }}>
                      <button onClick={()=>nav(`/documents/${d.id}`)}
                        style={{ padding:'3px 10px', borderRadius:6, fontSize:11,
                          background:C.lightBlue||'#E6F1FB', color:C.accent,
                          border:`1px solid ${C.accent}44`, cursor:'pointer' }}>View →</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Alert Log */}
      {logs.length > 0 && (
        <div style={{ marginTop:24 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'#6b7280', textTransform:'uppercase',
            letterSpacing:0.5, marginBottom:10 }}>Recent Alert History</div>
          <div style={{ background:'#fff', border:`1px solid ${C.border}`, borderRadius:10, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f9fafb', borderBottom:`1px solid ${C.border}` }}>
                  {['Document','Alert Type','Sent At','Recipients','Status'].map(h=>(
                    <th key={h} style={{ padding:'7px 12px', textAlign:'left', fontWeight:600, color:'#374141' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.slice(0,10).map(l=>(
                  <tr key={l.id} style={{ borderBottom:`1px solid #f9fafb` }}>
                    <td style={{ padding:'8px 12px', fontWeight:500 }}>{l.document?.doc_number||'—'}</td>
                    <td style={{ padding:'8px 12px' }}>
                      <span style={{ background:'#FAEEDA', color:C.amber, borderRadius:99,
                        padding:'2px 8px', fontSize:11, fontWeight:600 }}>{l.alert_type}</span>
                    </td>
                    <td style={{ padding:'8px 12px', color:'#6b7280' }}>
                      {new Date(l.sent_at).toLocaleString('en-IN')}
                    </td>
                    <td style={{ padding:'8px 12px' }}>{l.recipients?.length||0} recipients</td>
                    <td style={{ padding:'8px 12px' }}>
                      <span style={{ color:l.status==='Sent'?C.green:C.red, fontWeight:600 }}>{l.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Workflow page ────────────────────────────────────────────────────────
export default function Workflow() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [tab, setTab]     = useState('inbox')
  const [inbox, setInbox] = useState([])
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([workflowAPI.inbox(), workflowAPI.pending()])
      .then(([i,p]) => { setInbox(i.data); setPending(p.data) })
      .finally(() => setLoading(false))
  }, [])

  const STAGE_ORDER = ['Check','Review','Approve']
  const stageCount = s => pending.filter(d => d.workflow?.stage === s).length

  const TABS = [
    { id:'inbox',   label:`My Inbox (${inbox.length})` },
    { id:'all',     label:`All Pending (${pending.length})` },
    { id:'kanban',  label:'Kanban View' },
    { id:'alerts',  label:'Expiry Alerts 🔔' },
  ]

  return (
    <div style={{ padding:'28px 32px', fontFamily:'system-ui,-apple-system,sans-serif' }}>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ margin:'0 0 4px', fontSize:20, fontWeight:700 }}>Workflow</h1>
        <p style={{ margin:0, color:'#6b7280', fontSize:13 }}>
          DMS Approval Workflow — <span style={{ fontFamily:'monospace', fontSize:11,
            background:'#f3f4f6', padding:'1px 6px', borderRadius:4 }}>
            05→10→15→20→25→30
          </span>&nbsp; Parallel approval · Any rejection returns to Draft
        </p>
      </div>

      {/* Stage summary metrics */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:24 }}>
        {[['Draft (05)',0,'#9ca3af'],['In Check (15)',stageCount('Check'),C.amber],
          ['In Review (20)',stageCount('Review'),C.purple],
          ['In Approval (25)',stageCount('Approve'),C.green],
          ['My Tasks',inbox.length,C.blue]].map(([l,v,c])=>(
          <div key={l} style={{ background:'#f9fafb', borderRadius:10, padding:'1rem', textAlign:'center', border:`1px solid #f0f0f0` }}>
            <div style={{ fontSize:11, color:'#6b7280', marginBottom:4, textTransform:'uppercase', letterSpacing:0.3 }}>{l}</div>
            <div style={{ fontSize:24, fontWeight:700, color:c }}>{v}</div>
          </div>
        ))}
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'inbox' && (
        loading ? <Spinner /> : inbox.length === 0
          ? <Empty message="Your workflow inbox is empty — no pending tasks." />
          : inbox.map(d => <DocCard key={d.id} doc={d} onClick={()=>nav(`/documents/${d.id}`)} />)
      )}

      {tab === 'all' && (
        loading ? <Spinner /> : pending.length === 0
          ? <Empty message="No documents currently in workflow." />
          : pending.map(d => <DocCard key={d.id} doc={d} onClick={()=>nav(`/documents/${d.id}`)} />)
      )}

      {tab === 'kanban' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>
          {[
            { stage:'Check',   code:'15', color:C.amber,   bg:'#FAEEDA' },
            { stage:'Review',  code:'20', color:C.purple,  bg:'#EEEDFE' },
            { stage:'Approve', code:'25', color:C.green,   bg:'#E1F5EE' },
          ].map(({stage,code,color,bg})=>{
            const stageDocs = pending.filter(d=>d.workflow?.stage===stage)
            return (
              <div key={stage}>
                <div style={{ padding:'8px 12px', borderRadius:'8px 8px 0 0', background:bg,
                  border:`1px solid ${color}44`, borderBottom:'none',
                  display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontWeight:700, fontSize:13, color }}>
                    [{code}] {stage}
                  </span>
                  <span style={{ background:color, color:'#fff', borderRadius:99,
                    fontSize:11, padding:'0 8px', lineHeight:'20px' }}>{stageDocs.length}</span>
                </div>
                <div style={{ border:`1px solid ${color}44`, borderTop:'none',
                  borderRadius:'0 0 8px 8px', padding:8, minHeight:200, background:'#fafafa' }}>
                  {stageDocs.length === 0
                    ? <div style={{ fontSize:12, color:'#9ca3af', textAlign:'center', padding:'20px 0' }}>No documents</div>
                    : stageDocs.map(d=>(
                      <div key={d.id} onClick={()=>nav(`/documents/${d.id}`)}
                        style={{ background:'#fff', border:`1px solid ${C.border}`, borderRadius:8,
                          padding:'10px 12px', marginBottom:8, cursor:'pointer', fontSize:13 }}
                        onMouseOver={e=>e.currentTarget.style.borderColor=color}
                        onMouseOut={e=>e.currentTarget.style.borderColor=C.border}>
                        <div style={{ fontWeight:600, fontSize:11, color:C.accent }}>{d.doc_number}</div>
                        <div style={{ fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.title}</div>
                        <div style={{ fontSize:10, color:'#9ca3af', marginTop:4 }}>{d.project||'—'} · {d.workflow?.mode||''}</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'alerts' && <AlertDashboard />}
    </div>
  )
}
