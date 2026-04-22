import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth'

const IDLE_MS   = 3 * 60 * 1000  // 3 minutes total idle time
const WARN_MS   = 30 * 1000      // show warning 30 s before logout

const EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']

export function useIdleLogout() {
  const { logout } = useAuth()
  const navigate   = useNavigate()
  const logoutRef  = useRef(null)
  const warnRef    = useRef(null)
  const [warning, setWarning]     = useState(false)
  const [countdown, setCountdown] = useState(WARN_MS / 1000)
  const countRef   = useRef(null)

  const doLogout = useCallback(() => {
    clearInterval(countRef.current)
    setWarning(false)
    logout()
    navigate('/login', { replace: true })
  }, [logout, navigate])

  const reset = useCallback(() => {
    // Cancel any pending timers
    clearTimeout(logoutRef.current)
    clearTimeout(warnRef.current)
    clearInterval(countRef.current)
    setWarning(false)
    setCountdown(WARN_MS / 1000)

    // Schedule warning, then logout
    warnRef.current  = setTimeout(() => {
      setWarning(true)
      setCountdown(WARN_MS / 1000)
      countRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) { clearInterval(countRef.current); return 0 }
          return prev - 1
        })
      }, 1000)
    }, IDLE_MS - WARN_MS)

    logoutRef.current = setTimeout(doLogout, IDLE_MS)
  }, [doLogout])

  useEffect(() => {
    reset()
    EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }))
    return () => {
      clearTimeout(logoutRef.current)
      clearTimeout(warnRef.current)
      clearInterval(countRef.current)
      EVENTS.forEach(e => window.removeEventListener(e, reset))
    }
  }, [reset])

  return { warning, countdown, stayLoggedIn: reset }
}
