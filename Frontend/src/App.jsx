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
  const { warning, countdown, stayLoggedIn } = useIdleLogout()
  const token      = localStorage.getItem('dms_token')
  const storedUser = localStorage.getItem('dms_user')

  if (!token || !storedUser) {
    return <Navigate to="/login" replace />
  }
  return (
    <>
      {children}
      {warning && <IdleWarning countdown={countdown} onStay={stayLoggedIn} />}
    </>
  )
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
            <Route path="workflow" element={<Workflow />} />
            <Route path="reports" element={<Reports />} />
            <Route path="admin" element={<Admin />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
