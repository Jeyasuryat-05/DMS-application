import { createContext, useContext, useState, useEffect } from 'react'
import { authAPI } from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)  // true until we've checked localStorage

  // On mount: read from localStorage and verify token is still valid
  useEffect(() => {
    const token    = localStorage.getItem('dms_token')
    const stored   = localStorage.getItem('dms_user')

    if (token && stored) {
      try {
        const parsedUser = JSON.parse(stored)
        setUser(parsedUser)
        // Optionally verify token with backend
        // authAPI.me().catch(() => { logout() })
      } catch {
        localStorage.removeItem('dms_token')
        localStorage.removeItem('dms_user')
      }
    }
    setLoading(false)
  }, [])

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
      const msg = e.response?.data?.detail || 'Login failed. Check your email and password.'
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
