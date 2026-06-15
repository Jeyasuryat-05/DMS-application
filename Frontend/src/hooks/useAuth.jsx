import { createContext, useContext, useState, useEffect } from 'react'
import { authAPI } from '../api'
import { idleTimedOut } from './idleFlag'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)  // true until we've checked localStorage

  // On mount: read token from localStorage, then VERIFY it with the backend.
  // If the token is missing, expired, or rejected (401/403) → force logout.
  // Until verification completes loading stays true so no page flashes.
  useEffect(() => {
    const token  = localStorage.getItem('dms_token')
    const stored = localStorage.getItem('dms_user')

    if (!token || !stored) {
      // No credentials at all — stay logged out
      setLoading(false)
      return
    }

    let parsedUser = null
    try { parsedUser = JSON.parse(stored) } catch {}

    if (!parsedUser) {
      localStorage.removeItem('dms_token')
      localStorage.removeItem('dms_user')
      setLoading(false)
      return
    }

    // Optimistically set user so the app has data while we verify,
    // but keep loading=true so RequireAuth waits for confirmation.
    authAPI.me()
      .then(res => {
        const freshUser = res.data
        setUser(freshUser)
        localStorage.setItem('dms_user', JSON.stringify(freshUser))
      })
      .catch(() => {
        // Token invalid / expired / 403 — clear everything and go to login
        localStorage.removeItem('dms_token')
        localStorage.removeItem('dms_user')
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  // Periodic sync every 60 seconds — if token is rejected, force logout
  useEffect(() => {
    if (!user) return

    const syncUser = async () => {
      try {
        const res = await authAPI.me()
        const updatedUser = res.data
        setUser(updatedUser)
        localStorage.setItem('dms_user', JSON.stringify(updatedUser))
      } catch (err) {
        const status = err.response?.status
        if (status === 401) {
          // Token expired during the session — force logout.
          // If idle modal is showing, skip the redirect and let the modal handle re-login.
          localStorage.removeItem('dms_token')
          localStorage.removeItem('dms_user')
          setUser(null)
          if (!idleTimedOut) window.location.href = '/login'
        }
        // 403 = permission denied for a specific resource, not token expiry — ignore.
        // Network errors (no status) — silently ignore, try again next tick.
      }
    }

    syncUser()
    const interval = setInterval(syncUser, 60000)
    return () => clearInterval(interval)
  }, [user?.id])  // only restart timer when user identity changes, not on every re-render

  async function login(email, password, gateToken) {
    try {
      const res      = await authAPI.login(email, password, gateToken)
      const token    = res.data.access_token
      const userData = res.data.user

      // Store in localStorage first
      localStorage.setItem('dms_token', token)
      localStorage.setItem('dms_user', JSON.stringify(userData))

      // Then update React state
      setUser(userData)

      return { ok: true }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.detail || 'Login failed. Check your credentials.'
      return { ok: false, error: msg }
    }
  }

  function logout() {
    localStorage.removeItem('dms_token')
    localStorage.removeItem('dms_user')
    setUser(null)
  }

  function updateUser(updates) {
    setUser(prev => {
      const updated = { ...prev, ...updates }
      localStorage.setItem('dms_user', JSON.stringify(updated))
      return updated
    })
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
