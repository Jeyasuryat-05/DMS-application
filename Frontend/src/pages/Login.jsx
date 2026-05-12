import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { adminAPI, authAPI } from '../api'

export default function Login() {
  const { login }  = useAuth()
  const navigate   = useNavigate()

  const [appConfig, setAppConfig] = useState({
    auth_code_required: false,
    sso_enabled: false,
    app_name: 'DMS Portal',
    app_org: 'NPCIL',
  })
  const [step, setStep]           = useState('login')
  const [code, setCode]           = useState('')
  const [gateToken, setGateToken] = useState(null)
  const [empId, setEmpId]         = useState('')
  const [password, setPassword]   = useState('')
  const [error, setError]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [seeding, setSeeding]     = useState(false)

  useEffect(() => {
    authAPI.config()
      .then(r => {
        setAppConfig(r.data)
        if (r.data.auth_code_required) setStep('code')
      })
      .catch(() => {})
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    if (submitting) return
    setError('')
    setSubmitting(true)

    const res = await login(empId, password, gateToken)

    if (res.ok) {
      // Use React Router navigate — AuthProvider already has the user set
      // RequireAuth will see user is set and render the dashboard
      navigate('/', { replace: true })
    } else {
      setError(res.error)
      setSubmitting(false)
    }
  }

  async function handleCodeSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      const res = await authAPI.verifyCode(code)
      setGateToken(res.data.gate_token)
      setStep('login')
    } catch {
      setError('Invalid access code.')
    }
  }

  async function handleSeed() {
    setSeeding(true)
    try {
      const res = await adminAPI.seed()
      setError(res.data.message || 'Seeded! Use admin@npcil.gov.in / Admin@1234')
    } catch (e) {
      setError(e.response?.data?.detail || 'Seed failed — make sure backend is running on port 8000.')
    }
    setSeeding(false)
  }

  const cardStyle = {
    background: '#fff', borderRadius: 16, padding: '2.5rem 2rem',
    width: 400, maxWidth: '100%',
    boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0C447C 0%, #185FA5 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={cardStyle}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56, background: '#0C447C', borderRadius: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 12px', fontSize: 26,
          }}>📁</div>
          <h1 style={{ margin: '0 0 2px', fontSize: 20, fontWeight: 700, color: '#111' }}>
            {appConfig.app_name}
          </h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
            {appConfig.app_org} — Document Management System
          </p>
        </div>

        {/* Auth Code Gate */}
        {step === 'code' && (
          <form onSubmit={handleCodeSubmit} autoComplete="off">
            <div style={{
              background: '#f0f7ff', border: '1px solid #bfdbfe',
              borderRadius: 10, padding: '12px 14px', marginBottom: 16,
              fontSize: 13, color: '#1e40af',
            }}>
              This system requires an access code before login.
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                Access Code
              </label>
              <input
                type="password" value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="Enter access code…" required autoFocus
                autoComplete="off"
                readOnly
                onFocus={e => e.currentTarget.removeAttribute('readOnly')}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            {error && (
              <div style={{ background: '#FCEBEB', color: '#A32D2D', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>
                {error}
              </div>
            )}
            <button type="submit" style={{
              width: '100%', padding: 10, background: '#0C447C', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>
              Verify Code
            </button>
          </form>
        )}

        {/* Login Form */}
        {step === 'login' && (
          <>
            {appConfig.sso_enabled && (
              <button
                onClick={() => {
                  const u = `/api/auth/sso/login${gateToken ? `?gate_token=${gateToken}` : ''}`
                  window.open(u, 'sso', 'width=600,height=700')
                }}
                style={{
                  width: '100%', padding: '10px 16px',
                  border: '1.5px solid #0070F3', borderRadius: 8,
                  background: '#fff', color: '#0070F3',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 14,
                }}
              >
                <svg width="32" height="18" viewBox="0 0 32 18" fill="none">
                  <rect width="32" height="18" rx="3" fill="#003189"/>
                  <text x="4" y="13" fill="#fff" fontSize="10" fontWeight="bold" fontFamily="Arial">SAP</text>
                </svg>
                Sign in with SAP SSO
              </button>
            )}

            <form onSubmit={handleLogin} autoComplete="off">
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                  Employee ID / Email
                </label>
                <input
                  type="text" value={empId}
                  onChange={e => setEmpId(e.target.value.includes('@') ? e.target.value : e.target.value.toUpperCase())}
                  placeholder="Enter your employee ID or email"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  autoComplete="off"
                  readOnly
                  onFocus={e => e.currentTarget.removeAttribute('readOnly')}
                  required autoFocus
                />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                  Password
                </label>
                <input
                  type="password" value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  autoComplete="off"
                  readOnly
                  onFocus={e => e.currentTarget.removeAttribute('readOnly')}
                  required
                />
              </div>

              {error && (
                <div style={{
                  background: error.includes('seeded') || error.includes('Seeded') ? '#E1F5EE' : '#FCEBEB',
                  color: error.includes('seeded') || error.includes('Seeded') ? '#0F6E56' : '#A32D2D',
                  borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12,
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                style={{
                  width: '100%', padding: 10,
                  background: submitting ? '#9ca3af' : '#0C447C',
                  color: '#fff', border: 'none', borderRadius: 8,
                  fontSize: 14, fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            {appConfig.auth_code_required && (
              <button
                onClick={() => { setStep('code'); setError('') }}
                style={{
                  width: '100%', marginTop: 10, background: 'none', border: 'none',
                  color: '#6b7280', fontSize: 12, cursor: 'pointer',
                }}
              >
                ← Back to access code
              </button>
            )}
          </>
        )}

        {/* Seed */}
        <div style={{ textAlign: 'center', marginTop: 20, borderTop: '1px solid #f0f0f0', paddingTop: 14 }}>
          <button
            onClick={handleSeed} disabled={seeding}
            style={{
              background: 'none', border: 'none', color: '#185FA5',
              fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            {seeding ? 'Seeding…' : 'First-time setup (seed demo data)'}
          </button>
        </div>

      </div>
    </div>
  )
}
