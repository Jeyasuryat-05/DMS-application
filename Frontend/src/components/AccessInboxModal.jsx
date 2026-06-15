import { useState, useEffect } from 'react'
import { libraryAPI } from '../api'

const BLUE = '#0070F2'
const BORDER = '#D9D9D9'

const STATUS_COLOR = {
  pending:  { bg:'#fef3c7', text:'#92400e' },
  approved: { bg:'#d1fae5', text:'#065f46' },
  rejected: { bg:'#fee2e2', text:'#991b1b' },
}

export default function AccessInboxModal({ onClose, onDecided }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [deciding, setDeciding] = useState(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    libraryAPI.accessRequestsInbox()
      .then(r => setRequests(r.data || []))
      .catch(() => setError('Could not load requests'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function decide(requestId, action) {
    setError('')
    try {
      await libraryAPI.decideAccessRequest(requestId, { action, note: note.trim() })
      setDeciding(null)
      setNote('')
      load()
      onDecided()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not process decision')
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:9999,
      display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:14, width:620, maxWidth:'95%',
          maxHeight:'90vh', display:'flex', flexDirection:'column',
          boxShadow:'0 8px 40px rgba(0,0,0,0.22)' }}>

        {/* Header */}
        <div style={{ padding:'20px 24px 16px', borderBottom:`1px solid ${BORDER}`,
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <h3 style={{ margin:0, fontSize:16, fontWeight:700, color:'#1e293b' }}>
              Access Requests Inbox
            </h3>
            <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
              Review and decide on pending folder access requests
            </div>
          </div>
          <button onClick={onClose}
            style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:'auto', padding:20 }}>
          {loading ? (
            <div style={{ textAlign:'center', padding:40, color:'#94a3b8' }}>Loading…</div>
          ) : error ? (
            <div style={{ color:'#a32d2d', padding:20 }}>{error}</div>
          ) : requests.length === 0 ? (
            <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>
              <div style={{ fontSize:40, marginBottom:8 }}>✅</div>
              <div style={{ fontWeight:600 }}>No pending requests</div>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {requests.map(req => (
                <div key={req.id} style={{ border:`1px solid ${BORDER}`, borderRadius:10, padding:16 }}>
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:10 }}>
                    <div>
                      <div style={{ fontWeight:600, fontSize:14, color:'#1e293b' }}>{req.requester_name}</div>
                      <div style={{ fontSize:12, color:'#64748b' }}>{req.requester_email}</div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontSize:12, color:'#64748b' }}>
                        Folder: <strong>{req.folder_name}</strong>
                      </div>
                      <span style={{
                        fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99,
                        background:'#eff6ff', color:BLUE, marginTop:4, display:'inline-block'
                      }}>{req.permission}</span>
                    </div>
                  </div>

                  {req.reason && (
                    <div style={{ fontSize:12, color:'#475569', background:'#f8fafc',
                      padding:'8px 10px', borderRadius:7, marginBottom:10 }}>
                      "{req.reason}"
                    </div>
                  )}

                  <div style={{ fontSize:11, color:'#94a3b8', marginBottom:10 }}>
                    Requested {new Date(req.created_at).toLocaleDateString()}
                  </div>

                  {deciding === req.id ? (
                    <div>
                      <textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Add a note (optional)…"
                        rows={2}
                        style={{ width:'100%', boxSizing:'border-box', padding:'7px 10px',
                          fontSize:12, border:`1px solid ${BORDER}`, borderRadius:7,
                          fontFamily:'inherit', marginBottom:8, resize:'none' }}
                      />
                      <div style={{ display:'flex', gap:8 }}>
                        <button onClick={() => decide(req.id, 'approve')}
                          style={{ flex:1, padding:'8px', borderRadius:8, border:'none',
                            background:'#10b981', color:'#fff', cursor:'pointer',
                            fontSize:13, fontWeight:600 }}>
                          Approve
                        </button>
                        <button onClick={() => decide(req.id, 'reject')}
                          style={{ flex:1, padding:'8px', borderRadius:8, border:'none',
                            background:'#ef4444', color:'#fff', cursor:'pointer',
                            fontSize:13, fontWeight:600 }}>
                          Reject
                        </button>
                        <button onClick={() => { setDeciding(null); setNote('') }}
                          style={{ padding:'8px 14px', borderRadius:8,
                            border:`1px solid ${BORDER}`, background:'#fff',
                            cursor:'pointer', fontSize:13 }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeciding(req.id)}
                      style={{ padding:'7px 16px', borderRadius:8, border:`1px solid ${BLUE}`,
                        background:'#eff6ff', color:BLUE, cursor:'pointer',
                        fontSize:13, fontWeight:600 }}>
                      Review
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {error && deciding && (
            <div style={{ color:'#a32d2d', fontSize:12, marginTop:8 }}>{error}</div>
          )}
        </div>
      </div>
    </div>
  )
}
