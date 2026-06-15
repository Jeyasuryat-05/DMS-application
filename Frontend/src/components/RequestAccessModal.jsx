import { useState } from 'react'
import { libraryAPI } from '../api'

const BLUE = '#0070F2'
const BORDER = '#D9D9D9'

export default function RequestAccessModal({ folder, onClose, onSuccess }) {
  const [permission, setPermission] = useState('VIEW')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await libraryAPI.requestFolderAccess(folder.id, { permission, reason: reason.trim() })
      onSuccess()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit request')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:9999,
      display:'flex', alignItems:'center', justifyContent:'center' }}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:14, padding:28, width:420, maxWidth:'92%',
          boxShadow:'0 8px 40px rgba(0,0,0,0.22)' }}>

        <h3 style={{ margin:'0 0 4px', fontSize:16, fontWeight:700, color:'#1e293b' }}>
          Request Access
        </h3>
        <div style={{ fontSize:12, color:'#64748b', marginBottom:20 }}>
          Folder: <strong>{folder.name}</strong>
          {folder.folder_manager_name && (
            <> &nbsp;·&nbsp; Manager: <strong>{folder.folder_manager_name}</strong></>
          )}
        </div>

        <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#374151', marginBottom:6 }}>
          Access Level *
        </label>
        <div style={{ display:'flex', gap:10, marginBottom:16 }}>
          {['VIEW', 'UPLOAD'].map(p => (
            <label key={p} style={{ flex:1, display:'flex', alignItems:'center', gap:8,
              padding:'10px 14px', borderRadius:8, cursor:'pointer',
              border:`2px solid ${permission === p ? BLUE : BORDER}`,
              background: permission === p ? '#eff6ff' : '#fff' }}>
              <input type="radio" name="permission" value={p}
                checked={permission === p} onChange={() => setPermission(p)}
                style={{ accentColor: BLUE }} />
              <div>
                <div style={{ fontSize:13, fontWeight:600, color: permission === p ? BLUE : '#1e293b' }}>{p}</div>
                <div style={{ fontSize:11, color:'#64748b' }}>
                  {p === 'VIEW' ? 'Read-only access' : 'Can upload & view documents'}
                </div>
              </div>
            </label>
          ))}
        </div>

        <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#374151', marginBottom:6 }}>
          Reason (optional)
        </label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Briefly explain why you need access…"
          rows={3}
          style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', fontSize:13,
            border:`1px solid ${BORDER}`, borderRadius:8, resize:'vertical', fontFamily:'inherit',
            marginBottom:16 }}
        />

        {error && (
          <div style={{ background:'#fef2f2', color:'#a32d2d', padding:'8px 12px',
            borderRadius:8, fontSize:12, marginBottom:12 }}>{error}</div>
        )}

        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button type="button" onClick={onClose}
            style={{ padding:'8px 18px', borderRadius:8, border:`1px solid ${BORDER}`,
              background:'#fff', cursor:'pointer', fontSize:13 }}>Cancel</button>
          <button type="submit" disabled={loading}
            style={{ padding:'8px 20px', borderRadius:8, border:'none',
              background: loading ? '#9ca3af' : BLUE, color:'#fff',
              cursor: loading ? 'not-allowed' : 'pointer', fontSize:13, fontWeight:600 }}>
            {loading ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </form>
    </div>
  )
}
