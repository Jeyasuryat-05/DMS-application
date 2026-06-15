import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { useIdleLogout } from './hooks/useIdleLogout'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Documents from './pages/Documents'
import DocumentDetail from './pages/DocumentDetail'
import Workflow from './pages/Workflow'
import Reports from './pages/Reports'
import Admin from './pages/Admin'
import DocumentLibrary from './pages/DocumentLibrary'

const C = {
  brand: '#0070F2', hover: '#0060D0', negative: '#BB0000',
  text: '#32363A', label: '#6A6D70', border: '#C0C0C0', white: '#FFFFFF',
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', height: 36, padding: '0 12px',
  fontSize: 14, fontFamily: 'inherit', border: `1px solid ${C.border}`,
  borderRadius: 4, background: C.white, color: C.text, outline: 'none',
}

function SessionExpiredModal({ onResumed }) {
  const { login } = useAuth()
  const [empId, setEmpId]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [error, setError]       = useState('')
  const [busy, setBusy]         = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    const res = await login(empId, password)
    if (res.ok) {
      onResumed()
    } else {
      setError(res.error)
      setBusy(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: C.white, borderRadius: 10, width: 380, maxWidth: '90%',
        boxShadow: '0 8px 40px rgba(0,0,0,0.28)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ background: '#1B3A6B', padding: '20px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🔒</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 2 }}>
            Session Expired
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>
            You were logged out due to inactivity. Sign in to continue.
          </div>
        </div>

        {/* Form */}
        <div style={{ padding: '20px 24px 24px' }}>
          <form onSubmit={handleSubmit} autoComplete="off">
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 5 }}>
                Employee ID / Email <span style={{ color: C.negative }}>*</span>
              </label>
              <input
                style={inputStyle} type="text" value={empId} autoFocus
                onChange={e => setEmpId(e.target.value.includes('@') ? e.target.value : e.target.value.toUpperCase())}
                placeholder="Enter your employee ID or email"
                onFocus={e => e.target.style.borderColor = C.brand}
                onBlur={e => e.target.style.borderColor = C.border}
              />
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 5 }}>
                Password <span style={{ color: C.negative }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  style={{ ...inputStyle, paddingRight: 40 }}
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  onFocus={e => e.target.style.borderColor = C.brand}
                  onBlur={e => e.target.style.borderColor = C.border}
                />
                <button type="button" onClick={() => setShowPw(p => !p)} style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
                  color: C.label, padding: 0,
                }}>
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                background: '#fff0f0', border: '1px solid #ffbaba', color: C.negative,
                borderRadius: 4, padding: '8px 12px', fontSize: 13, marginBottom: 14,
              }}>{error}</div>
            )}

            <button type="submit" disabled={busy} style={{
              width: '100%', height: 40,
              background: busy ? '#7cb8f9' : C.brand,
              color: '#fff', border: 'none', borderRadius: 6,
              fontSize: 14, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
            onMouseOver={e => { if (!busy) e.currentTarget.style.background = C.hover }}
            onMouseOut={e => { if (!busy) e.currentTarget.style.background = C.brand }}
            >
              {busy ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function IdleWarning({ countdown, onStay }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: '32px 36px',
        maxWidth: 380, width: '90%', textAlign: 'center',
        boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⏱</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 18, color: '#1a1a2e' }}>
          Session Timeout Warning
        </h2>
        <p style={{ margin: '0 0 20px', color: '#555', fontSize: 14 }}>
          You've been idle. You'll be logged out automatically in{' '}
          <strong style={{ color: '#d32f2f' }}>{countdown}s</strong>.
        </p>
        <button
          onClick={onStay}
          style={{
            background: '#1565C0', color: '#fff', border: 'none',
            borderRadius: 8, padding: '10px 28px', fontSize: 15,
            cursor: 'pointer', fontWeight: 600,
          }}
        >
          Stay Logged In
        </button>
      </div>
    </div>
  )
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  const { warning, countdown, timedOut, stayLoggedIn, resumeSession } = useIdleLogout()

  // Wait for the token verification round-trip before deciding
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#F5F6F7',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          border: '3px solid #D9D9D9', borderTopColor: '#0070F2',
          animation: 'spin 0.7s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (!user && !timedOut) {
    return <Navigate to="/login" replace />
  }

  return (
    <>
      {children}
      {warning && !timedOut && <IdleWarning countdown={countdown} onStay={stayLoggedIn} />}
      {timedOut && <SessionExpiredModal onResumed={resumeSession} />}
    </>
  )
}

function RequireRole({ roles, children }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />
  }
  return children
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="documents" element={<Documents />} />
            <Route path="documents/:id" element={<DocumentDetail />} />
            <Route path="library" element={<DocumentLibrary />} />
            <Route path="workflow" element={<Workflow />} />
            <Route path="reports" element={<Reports />} />
            <Route path="admin" element={
              <RequireRole roles={['System Admin', 'Sub Admin']}>
                <Admin />
              </RequireRole>
            } />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
