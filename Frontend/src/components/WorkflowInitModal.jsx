/**
 * WorkflowInitModal.jsx — FS W_EM_DMS_01
 * Multiple users per level, up to 7 hierarchy levels
 * Auto Populate (4-step default) | User Defined (custom levels)
 */
import { useState, useEffect, useRef } from 'react'
import { adminAPI, workflowAPI } from '../api'

const C = {
  blue:      '#0C447C',
  accent:    '#185FA5',
  green:     '#0F6E56',
  red:       '#A32D2D',
  amber:     '#854F0B',
  purple:    '#534AB7',
  border:    '#e5e7eb',
  lightBlue: '#E6F1FB',
}

const STAGE_COLORS = {
  Prepare: { bg:'#f0fff4', border:'#1D9E75', text:'#0F6E56', dot:'#1D9E75' },
  Check:   { bg:'#FAEEDA', border:'#BA7517', text:'#854F0B', dot:'#BA7517' },
  Review:  { bg:'#EEEDFE', border:'#7F77DD', text:'#534AB7', dot:'#7F77DD' },
  Approve: { bg:'#E6F1FB', border:'#378ADD', text:'#185FA5', dot:'#378ADD' },
}

const DEFAULT_LEVELS = [
  { step:1, name:'Prepare', stage:'Prepare', checklist_required:false, assignees:[], templateFile:null },
  { step:2, name:'Check',   stage:'Check',   checklist_required:false, assignees:[], templateFile:null },
  { step:3, name:'Review',  stage:'Review',  checklist_required:false, assignees:[], templateFile:null },
  { step:4, name:'Approve', stage:'Approve', checklist_required:false, assignees:[], templateFile:null },
]

// ─── User search dropdown ─────────────────────────────────────────────────────
function UserSearch({ onSelect, excluded = [], placeholder = 'Search user by name or SAP ID…' }) {
  const [q, setQ]           = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen]     = useState(false)
  const [loading, setLoading] = useState(false)
  const [dropRect, setDropRect] = useState(null)
  const ref = useRef()

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (open && ref.current) setDropRect(ref.current.getBoundingClientRect())
  }, [open])

  useEffect(() => {
    if (!q.trim()) { setResults([]); setOpen(false); return }
    const t = setTimeout(() => {
      setLoading(true)
      adminAPI.listUsers({ q })
        .then(r => {
          const filtered = (r.data || []).filter(u => u.is_active && !excluded.includes(u.id))
          setResults(filtered)
          setOpen(filtered.length > 0)
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 280)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div ref={ref} style={{ position:'relative', flex:1 }}>
      <div style={{ position:'relative' }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={placeholder}
          style={{
            width:'100%', boxSizing:'border-box', fontSize:12,
            padding:'7px 32px 7px 10px', borderRadius:7,
            border:`1px solid ${C.border}`,
          }}
        />
        {loading && (
          <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
            fontSize:11, color:'#9ca3af' }}>…</span>
        )}
      </div>
      {open && results.length > 0 && dropRect && (
        <div style={{
          position:'fixed', top: dropRect.bottom + 4, left: dropRect.left, width: dropRect.width,
          background:'#fff', border:`1px solid ${C.border}`, borderRadius:8,
          zIndex:9999, maxHeight:200, overflowY:'auto',
          boxShadow:'0 8px 24px rgba(0,0,0,0.14)',
        }}>
          {results.map(u => (
            <div
              key={u.id}
              onClick={() => { onSelect(u); setQ(''); setOpen(false); setResults([]) }}
              style={{ padding:'9px 12px', cursor:'pointer', borderBottom:`1px solid #f9fafb`,
                display:'flex', justifyContent:'space-between', alignItems:'center' }}
              onMouseOver={e => e.currentTarget.style.background = C.lightBlue}
              onMouseOut={e => e.currentTarget.style.background = '#fff'}
            >
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:'#111' }}>{u.name}</div>
                <div style={{ fontSize:11, color:'#6b7280', marginTop:1 }}>
                  {u.sap_username && <span style={{ marginRight:8 }}>SAP: {u.sap_username}</span>}
                  {u.department && <span>{u.department}</span>}
                  {u.role && <span style={{ marginLeft:8, color:'#9ca3af' }}>· {u.role}</span>}
                </div>
              </div>
              <span style={{ fontSize:11, background:C.lightBlue, color:C.accent,
                padding:'2px 8px', borderRadius:99, marginLeft:8, whiteSpace:'nowrap' }}>
                + Add
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── User chip ────────────────────────────────────────────────────────────────
function UserChip({ user, role, onRemove }) {
  const initials = user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2)
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:8, padding:'6px 10px',
      background:'#fff', border:`1px solid ${C.border}`, borderRadius:8,
      marginBottom:4,
    }}>
      <div style={{
        width:28, height:28, borderRadius:'50%', background:C.accent,
        color:'#fff', display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:11, fontWeight:700, flexShrink:0,
      }}>{initials}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:600, color:'#111', whiteSpace:'nowrap',
          overflow:'hidden', textOverflow:'ellipsis' }}>{user.name}</div>
        <div style={{ fontSize:10, color:'#9ca3af' }}>
          {user.sap_username || user.employee_id || user.email || ''}
          {user.department ? ` · ${user.department}` : ''}
        </div>
      </div>
      {role && (
        <span style={{ fontSize:10, padding:'2px 7px', borderRadius:99, background:'#f3f4f6',
          color:'#6b7280', whiteSpace:'nowrap', flexShrink:0 }}>{role}</span>
      )}
      <button
        onClick={onRemove}
        style={{ background:'none', border:'none', cursor:'pointer',
          color:'#9ca3af', fontSize:16, lineHeight:1, padding:'0 2px', flexShrink:0 }}
        title="Remove user"
      >×</button>
    </div>
  )
}

// ─── Level card ───────────────────────────────────────────────────────────────
function LevelCard({ level, index, total, onUpdate, onRemove, onMoveUp, onMoveDown,
                     currentUserId, isUserDefined }) {
  const excluded = [currentUserId, ...level.assignees.map(u => u.id)]
  const sc = STAGE_COLORS[level.stage] || STAGE_COLORS.Approve

  return (
    <div style={{
      border:`2px solid ${sc.border}`, borderRadius:12,
      marginBottom:10, overflow:'hidden', background:'#fff',
    }}>
      {/* Level header */}
      <div style={{
        background: sc.bg, padding:'10px 16px',
        display:'flex', alignItems:'center', gap:10,
        borderBottom:`1px solid ${sc.border}44`,
      }}>
        {/* Step number */}
        <div style={{
          width:32, height:32, borderRadius:'50%',
          background: sc.dot, color:'#fff',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:14, fontWeight:700, flexShrink:0,
        }}>
          {level.step}
        </div>

        {/* Name + stage */}
        <div style={{ flex:1, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          {isUserDefined && level.step > 1 ? (
            <input
              value={level.name}
              onChange={e => onUpdate({ name: e.target.value })}
              style={{
                fontSize:13, fontWeight:700, color: sc.text,
                border:'none', background:'transparent',
                borderBottom:`1px dashed ${sc.border}`,
                padding:'1px 2px', width:130,
              }}
            />
          ) : (
            <span style={{ fontSize:13, fontWeight:700, color: sc.text }}>{level.name}</span>
          )}

          {isUserDefined && level.step > 1 ? (
            <select
              value={level.stage}
              onChange={e => onUpdate({ stage: e.target.value })}
              style={{ fontSize:11, padding:'2px 6px', borderRadius:5,
                border:`1px solid ${sc.border}`, background:'#fff', color: sc.text }}
            >
              {['Check','Review','Approve'].map(s => <option key={s}>{s}</option>)}
            </select>
          ) : (
            <span style={{
              fontSize:11, padding:'2px 8px', borderRadius:99,
              background:`${sc.dot}22`, color: sc.text, fontWeight:500,
            }}>{level.stage}</span>
          )}

          {/* Parallel badge */}
          {level.assignees.length > 1 && (
            <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99,
              background:'#fff', color:sc.text, border:`1px solid ${sc.border}`,
              fontWeight:500 }}>
              Parallel ({level.assignees.length} users — ALL must approve)
            </span>
          )}
        </div>

        {/* Right controls */}
        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
          <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:11,
            cursor:'pointer', color: sc.text, whiteSpace:'nowrap' }}>
            <input
              type="checkbox"
              checked={level.checklist_required}
              onChange={e => onUpdate({ checklist_required: e.target.checked })}
            />
            Checklist
          </label>

          {/* Move up/down */}
          {isUserDefined && level.step > 1 && (
            <>
              <button onClick={onMoveUp} disabled={index <= 1}
                style={{ background:'none', border:'none', cursor: index<=1 ? 'not-allowed':'pointer',
                  fontSize:14, color: index<=1 ? '#d1d5db' : sc.text, padding:'0 2px' }}
                title="Move up">↑</button>
              <button onClick={onMoveDown} disabled={index >= total - 1}
                style={{ background:'none', border:'none', cursor: index>=total-1 ? 'not-allowed':'pointer',
                  fontSize:14, color: index>=total-1 ? '#d1d5db' : sc.text, padding:'0 2px' }}
                title="Move down">↓</button>
              <button onClick={onRemove}
                style={{ background:'none', border:'none', cursor:'pointer',
                  fontSize:18, color:'#ef4444', padding:'0 2px', lineHeight:1 }}
                title="Remove level">×</button>
            </>
          )}
        </div>
      </div>

      {/* Level body */}
      <div style={{ padding:'12px 16px' }}>
        {level.step === 1 ? (
          <div style={{ fontSize:12, color:'#6b7280', fontStyle:'italic',
            display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:28, height:28, borderRadius:'50%', background:'#f3f4f6',
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:11 }}>
              You
            </div>
            <span>Initiator — automatically assigned to you</span>
          </div>
        ) : (
          <>
            {/* User list */}
            {level.assignees.length > 0 && (
              <div style={{ marginBottom:10 }}>
                {level.assignees.map((u, ui) => (
                  <UserChip
                    key={u.id}
                    user={u}
                    role={ui === 0 ? 'Primary' : `Co-approver ${ui}`}
                    onRemove={() => onUpdate({
                      assignees: level.assignees.filter(a => a.id !== u.id)
                    })}
                  />
                ))}
              </div>
            )}

            {/* Add user */}
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <UserSearch
                excluded={excluded}
                placeholder={`Search & add ${level.name}…`}
                onSelect={u => {
                  if (!level.assignees.find(a => a.id === u.id)) {
                    onUpdate({ assignees: [...level.assignees, u] })
                  }
                }}
              />
            </div>

            {level.assignees.length === 0 && (
              <div style={{ fontSize:11, color:'#ef4444', marginTop:6 }}>
                At least one user required for this level
              </div>
            )}

            {level.assignees.length > 1 && (
              <div style={{ fontSize:11, color:'#6b7280', marginTop:6,
                background:'#f8fafc', borderRadius:6, padding:'6px 10px' }}>
                All {level.assignees.length} users will receive the task in parallel.
                The level advances only when <strong>all</strong> approve.
                Any one rejection returns the document to Draft.
              </div>
            )}

            {/* Checklist template upload */}
            {level.checklist_required && (
              <div style={{ marginTop:10, padding:'10px 12px', background:'#FAEEDA',
                border:'1px solid #BA751744', borderRadius:8 }}>
                <div style={{ fontSize:11, fontWeight:600, color:'#854F0B', marginBottom:6 }}>
                  Checklist Template — upload a file that assignees will download, fill, and re-upload
                </div>
                {level.templateFile ? (
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:12, color:'#0F6E56', fontWeight:500 }}>
                      ✓ {level.templateFile.name}
                    </span>
                    <button onClick={() => onUpdate({ templateFile: null })}
                      style={{ background:'none', border:'none', cursor:'pointer',
                        color:'#A32D2D', fontSize:12 }}>Remove</button>
                  </div>
                ) : (
                  <label style={{ display:'flex', alignItems:'center', gap:8,
                    cursor:'pointer', fontSize:12, color:'#854F0B' }}>
                    <div style={{ padding:'6px 14px', background:'#fff',
                      border:'1px solid #BA7517', borderRadius:6, fontSize:12,
                      fontWeight:500, color:'#854F0B' }}>
                      Browse file…
                    </div>
                    <span style={{ color:'#9ca3af' }}>PDF, DOCX, XLSX accepted</span>
                    <input type="file" style={{ display:'none' }}
                      accept=".pdf,.doc,.docx,.xls,.xlsx"
                      onChange={e => {
                        if (e.target.files[0]) onUpdate({ templateFile: e.target.files[0] })
                      }} />
                  </label>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────
export default function WorkflowInitModal({
  docId, docTitle, docTypeId, currentUser, onClose, onSuccess
}) {
  const [mode, setMode]     = useState('Auto Populate')
  const [levels, setLevels] = useState(DEFAULT_LEVELS.map(l => ({ ...l, assignees:[] })))
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  function updateLevel(idx, changes) {
    setLevels(ls => ls.map((l, i) => i === idx ? { ...l, ...changes } : l))
  }

  function addLevel() {
    if (levels.length >= 7) return
    setLevels(ls => [...ls, {
      step: ls.length + 1,
      name: `Level ${ls.length + 1}`,
      stage: 'Approve',
      checklist_required: false,
      assignees: [],
      templateFile: null,
    }])
  }

  function removeLevel(idx) {
    setLevels(ls =>
      ls.filter((_, i) => i !== idx)
        .map((l, i) => ({ ...l, step: i + 1 }))
    )
  }

  function moveLevel(idx, dir) {
    // don't move Prepare (step=1)
    const targetIdx = idx + dir
    if (targetIdx <= 0 || targetIdx >= levels.length) return
    setLevels(ls => {
      const next = [...ls]
      ;[next[idx], next[targetIdx]] = [next[targetIdx], next[idx]]
      return next.map((l, i) => ({ ...l, step: i + 1 }))
    })
  }

  async function submit() {
    setError('')
    // Validate all levels except Prepare have at least 1 assignee
    for (const lv of levels) {
      if (lv.step > 1 && lv.assignees.length === 0) {
        setError(`"${lv.name}" needs at least one user. Please add someone.`)
        return
      }
    }
    setLoading(true)
    try {
      const payload = {
        mode,
        levels: levels.map(lv => ({
          step: lv.step,
          name: lv.name,
          stage: lv.stage,
          checklist_required: lv.checklist_required,
          assignee_ids: lv.assignees.map(u => u.id),
        })),
        check_assignees:   levels.find(l => l.step === 2)?.assignees.map(u => u.id) || [],
        review_assignees:  levels.find(l => l.step === 3)?.assignees.map(u => u.id) || [],
        approve_assignees: levels.find(l => l.step === 4)?.assignees.map(u => u.id) || [],
      }
      const result = await workflowAPI.initiate(docId, payload)

      // After workflow is initiated, upload checklist templates
      // We need to get the level IDs from the workflow status
      try {
        const statusRes = await workflowAPI.status(docId)
        const wfLevels  = statusRes.data.levels || []

        for (const lv of levels) {
          if (lv.checklist_required && lv.templateFile) {
            const matchLevel = wfLevels.find(l => l.step === lv.step)
            if (matchLevel) {
              const fd = new FormData()
              fd.append('file', lv.templateFile)
              await workflowAPI.uploadTemplate(docId, matchLevel.id, fd)
            }
          }
        }
      } catch (uploadErr) {
        // Template upload failed but workflow was initiated — show warning not error
        console.warn('Template upload failed:', uploadErr)
        onSuccess()
        onClose()
        return
      }

      onSuccess()
      onClose()
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to initiate workflow. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const totalUsers = levels.slice(1).reduce((s, l) => s + l.assignees.length, 0)
  const allFilled  = levels.slice(1).every(l => l.assignees.length > 0)

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.6)',
      zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16,
    }}>
      <div style={{
        background:'#fff', borderRadius:16, width:680, maxWidth:'100%',
        maxHeight:'92vh', display:'flex', flexDirection:'column',
        boxShadow:'0 32px 80px rgba(0,0,0,0.3)',
      }}>

        {/* ── Header ── */}
        <div style={{
          background: C.blue, borderRadius:'16px 16px 0 0',
          padding:'16px 24px', flexShrink:0,
          display:'flex', justifyContent:'space-between', alignItems:'flex-start',
        }}>
          <div>
            <div style={{ color:'#fff', fontWeight:700, fontSize:16 }}>
              Initiate Approval Workflow
            </div>
            <div style={{ color:'rgba(255,255,255,0.7)', fontSize:12, marginTop:3 }}>
              {docTitle}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background:'none', border:'none', color:'rgba(255,255,255,0.8)',
              fontSize:22, cursor:'pointer', lineHeight:1, padding:0, marginTop:-2 }}
          >×</button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY:'auto', flex:1, padding:'20px 24px' }}>

          {/* Mode toggle */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:20 }}>
            {[
              {
                id:'Auto Populate',
                icon:'⚙',
                title:'Auto Populate',
                sub:'System proposes 4 default levels. You fill in the users.',
              },
              {
                id:'User Defined',
                icon:'✏',
                title:'User Defined',
                sub:'You define up to 7 custom levels with any names.',
              },
            ].map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                style={{
                  padding:'12px 14px', borderRadius:10, textAlign:'left',
                  border:`2px solid ${mode===m.id ? C.accent : C.border}`,
                  background: mode===m.id ? C.lightBlue : '#fafafa',
                  cursor:'pointer', fontFamily:'inherit',
                }}
              >
                <div style={{ fontSize:13, fontWeight:700,
                  color: mode===m.id ? C.accent : '#374151' }}>
                  {m.icon} {m.title}
                </div>
                <div style={{ fontSize:11, color: mode===m.id ? C.accent : '#9ca3af',
                  marginTop:3 }}>
                  {m.sub}
                </div>
              </button>
            ))}
          </div>

          {/* Status flow */}
          <div style={{ background:'#f8fafc', borderRadius:8, padding:'10px 14px',
            marginBottom:20, display:'flex', alignItems:'center', gap:0 }}>
            {[
              ['05','Draft','#9ca3af'],
              ['10','Created','#185FA5'],
              ['15','In Check','#BA7517'],
              ['20','In Review','#7F77DD'],
              ['25','In Approval','#1D9E75'],
              ['30','Released','#0F6E56'],
            ].map(([code, label, color], i, arr) => (
              <div key={code} style={{ display:'flex', alignItems:'center', flex:1 }}>
                <div style={{ flex:1, textAlign:'center' }}>
                  <div style={{ fontSize:10, fontWeight:700, color }}>{code}</div>
                  <div style={{ fontSize:9, color:'#6b7280', marginTop:1 }}>{label}</div>
                </div>
                {i < arr.length - 1 && (
                  <div style={{ width:10, height:1, background:'#d1d5db', flexShrink:0 }} />
                )}
              </div>
            ))}
          </div>

          {/* Summary bar */}
          <div style={{
            display:'flex', justifyContent:'space-between', alignItems:'center',
            marginBottom:14, padding:'8px 12px',
            background: allFilled ? '#E1F5EE' : '#FFF9EC',
            borderRadius:8, border:`1px solid ${allFilled ? '#1D9E75' : '#BA7517'}44`,
          }}>
            <div style={{ fontSize:12, color: allFilled ? C.green : C.amber, fontWeight:500 }}>
              {allFilled
                ? `✓ All ${levels.length} levels configured — ${totalUsers} user${totalUsers!==1?'s':''} assigned`
                : `${levels.length} levels · ${totalUsers} user${totalUsers!==1?'s':''} assigned · fill remaining levels`
              }
            </div>
            <div style={{ fontSize:11, color:'#9ca3af' }}>
              {mode === 'User Defined' ? `${levels.length}/7 levels` : '4-step workflow'}
            </div>
          </div>

          {/* Level label */}
          <div style={{ fontSize:11, fontWeight:600, color:'#9ca3af',
            textTransform:'uppercase', letterSpacing:0.6, marginBottom:10 }}>
            Approval Hierarchy
          </div>

          {/* Level cards */}
          {levels.map((lv, idx) => (
            <LevelCard
              key={`${lv.step}-${idx}`}
              level={lv}
              index={idx}
              total={levels.length}
              onUpdate={changes => updateLevel(idx, changes)}
              onRemove={() => removeLevel(idx)}
              onMoveUp={() => moveLevel(idx, -1)}
              onMoveDown={() => moveLevel(idx, 1)}
              currentUserId={currentUser?.id}
              isUserDefined={mode === 'User Defined'}
            />
          ))}

          {/* Add level button */}
          {mode === 'User Defined' && levels.length < 7 && (
            <button
              onClick={addLevel}
              style={{
                width:'100%', padding:'11px', marginBottom:4,
                border:`2px dashed ${C.border}`, borderRadius:10,
                background:'none', color:'#6b7280', cursor:'pointer',
                fontSize:13, fontFamily:'inherit',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              }}
            >
              <span style={{ fontSize:18, lineHeight:1 }}>+</span>
              Add Hierarchy Level
              <span style={{ fontSize:11, color:'#9ca3af' }}>({7 - levels.length} remaining)</span>
            </button>
          )}

          {error && (
            <div style={{
              background:'#FCEBEB', color:C.red, borderRadius:8,
              padding:'10px 14px', fontSize:13, marginTop:12,
              border:`1px solid ${C.red}33`,
            }}>
              {error}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding:'14px 24px', borderTop:`1px solid ${C.border}`,
          display:'flex', justifyContent:'space-between', alignItems:'center',
          background:'#fafafa', borderRadius:'0 0 16px 16px', flexShrink:0,
        }}>
          <div style={{ fontSize:12, color:'#6b7280' }}>
            Sequential levels · Parallel users per level · All must approve
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button
              onClick={onClose}
              style={{
                padding:'8px 20px', borderRadius:8,
                border:`1px solid ${C.border}`, background:'#fff',
                cursor:'pointer', fontSize:13, fontFamily:'inherit', color:'#374151',
              }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={loading || !allFilled}
              style={{
                padding:'8px 24px', borderRadius:8, border:'none',
                background: loading || !allFilled ? '#9ca3af' : C.blue,
                color:'#fff', cursor: loading || !allFilled ? 'not-allowed':'pointer',
                fontSize:13, fontWeight:600, fontFamily:'inherit',
              }}
            >
              {loading ? 'Initiating…' : 'Initiate Workflow'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
