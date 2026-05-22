import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { adminAPI, authAPI } from '../api'

const C = {
  brand:    '#0070F2',
  negative: '#BB0000',
  positive: '#188918',
  text:     '#32363A',
  label:    '#6A6D70',
  border:   '#C0C0C0',
  bg:       '#F5F6F7',
  white:    '#FFFFFF',
  hover:    '#0060D0',
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  height: 36, padding: '0 12px',
  fontSize: 14, fontFamily: 'inherit',
  border: `1px solid ${C.border}`,
  borderRadius: 4,
  background: C.white,
  color: C.text,
  outline: 'none',
}

const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: C.text,
  marginBottom: 6,
}

export default function Login() {
  const { login }  = useAuth()
  const navigate   = useNavigate()

  const [appConfig, setAppConfig] = useState({
    auth_code_required: false,
    sso_enabled: false,
    app_name: 'Document Management System',
    app_org: 'NPCIL',
  })
  const [step, setStep]             = useState('login')
  const [code, setCode]             = useState('')
  const [gateToken, setGateToken]   = useState(null)
  const [empId, setEmpId]           = useState('')
  const [password, setPassword]     = useState('')
  const [error, setError]           = useState('')
  const [infoMsg, setInfoMsg]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [seeding, setSeeding]       = useState(false)
  const [showPw, setShowPw]         = useState(false)

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
    setError(''); setInfoMsg('')
    setSubmitting(true)
    const res = await login(empId, password, gateToken)
    if (res.ok) {
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
    setSeeding(true); setError(''); setInfoMsg('')
    try {
      const res = await adminAPI.seed()
      setInfoMsg(res.data.message || 'Seeded! Use admin@npcil.gov.in / Admin@1234')
    } catch (e) {
      setError(e.response?.data?.detail || 'Seed failed — make sure backend is running on port 8000.')
    }
    setSeeding(false)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(145deg, #1B3A6B 0%, #0070F2 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        width: 420, maxWidth: '100%',
        background: C.white,
        borderRadius: 10,
        boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
        overflow: 'hidden',
      }}>
        {/* Header strip */}
        <div style={{
          background: '#1B3A6B',
          padding: '28px 32px 24px',
          textAlign: 'center',
        }}>
          <div style={{
            width: 56, height: 56,
            background: C.brand,
            borderRadius: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
            fontSize: 26,
            boxShadow: '0 4px 12px rgba(0,112,242,0.4)',
          }}>
            📄
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
            {appConfig.app_name}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
            {appConfig.app_org} — Document Management System
          </div>
        </div>

        {/* Form area */}
        <div style={{ padding: '28px 32px 24px' }}>

          {/* ── Code step ── */}
          {step === 'code' && (
            <form onSubmit={handleCodeSubmit} autoComplete="off">
              <div style={{ background: '#EBF5FE', border: '1px solid #b3d4fc', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: '#0070F2', marginBottom: 18 }}>
                This system requires an access code before login.
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Access Code <span style={{ color: C.negative }}>*</span></label>
                <input
                  style={inputStyle} type="password"
                  value={code} onChange={e => setCode(e.target.value)}
                  placeholder="Enter access code…" autoFocus
                />
              </div>
              {error && <div style={{ background: '#fff0f0', border: '1px solid #ffbaba', color: C.negative, borderRadius: 4, padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
              <button type="submit" style={{
                width: '100%', height: 40,
                background: C.brand, color: '#fff',
                border: 'none', borderRadius: 6,
                fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
              onMouseOver={e => e.currentTarget.style.background = C.hover}
              onMouseOut={e => e.currentTarget.style.background = C.brand}
              >Verify Code</button>
            </form>
          )}

          {/* ── Login step ── */}
          {step === 'login' && (
            <>
              {appConfig.sso_enabled && (
                <button
                  onClick={() => {
                    const u = `/api/auth/sso/login${gateToken ? `?gate_token=${gateToken}` : ''}`
                    window.open(u, 'sso', 'width=600,height=700')
                  }}
                  style={{
                    width: '100%', height: 40,
                    background: C.white, color: C.brand,
                    border: `1px solid ${C.brand}`, borderRadius: 6,
                    fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    marginBottom: 16,
                  }}
                >
                  Sign in with SAP SSO
                </button>
              )}

              <form onSubmit={handleLogin} autoComplete="off">
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Employee ID / Email <span style={{ color: C.negative }}>*</span></label>
                  <input
                    style={inputStyle} type="text"
                    value={empId}
                    onChange={e => setEmpId(e.target.value.includes('@') ? e.target.value : e.target.value.toUpperCase())}
                    placeholder="Enter your employee ID or email"
                    autoFocus
                    onFocus={e => e.target.style.borderColor = C.brand}
                    onBlur={e => e.target.style.borderColor = C.border}
                  />
                </div>

                <div style={{ marginBottom: 22 }}>
                  <label style={labelStyle}>Password <span style={{ color: C.negative }}>*</span></label>
                  <div style={{ position: 'relative' }}>
                    <input
                      style={{ ...inputStyle, paddingRight: 44 }}
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      onFocus={e => e.target.style.borderColor = C.brand}
                      onBlur={e => e.target.style.borderColor = C.border}
                    />
                    <button type="button" onClick={() => setShowPw(p => !p)} style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 15, color: C.label, padding: 0,
                    }}>
                      {showPw ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>

                {error   && <div style={{ background: '#fff0f0', border: '1px solid #ffbaba', color: C.negative, borderRadius: 4, padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
                {infoMsg && <div style={{ background: '#f0fff4', border: '1px solid #b7ebc0', color: C.positive, borderRadius: 4, padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>{infoMsg}</div>}

                <button type="submit" disabled={submitting} style={{
                  width: '100%', height: 42,
                  background: submitting ? '#7cb8f9' : C.brand,
                  color: '#fff', border: 'none', borderRadius: 6,
                  fontSize: 15, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', letterSpacing: '0.02em',
                  transition: 'background 0.15s',
                }}
                onMouseOver={e => { if (!submitting) e.currentTarget.style.background = C.hover }}
                onMouseOut={e => { if (!submitting) e.currentTarget.style.background = C.brand }}
                >
                  {submitting ? 'Signing in…' : 'Sign In'}
                </button>
              </form>

              {appConfig.auth_code_required && (
                <button onClick={() => { setStep('code'); setError('') }} style={{
                  width: '100%', marginTop: 10, padding: '8px',
                  background: 'none', border: 'none',
                  color: C.brand, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  ← Back to access code
                </button>
              )}
            </>
          )}

          {/* Seed */}
          <div style={{ textAlign: 'center', marginTop: 20, paddingTop: 16, borderTop: `1px solid #EBEBEB` }}>
            <button onClick={handleSeed} disabled={seeding} style={{
              background: 'none', border: 'none',
              color: seeding ? C.label : C.brand,
              fontSize: 12, cursor: seeding ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', textDecoration: 'underline',
            }}>
              {seeding ? 'Seeding…' : 'First-time setup (seed demo data)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
