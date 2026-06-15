import { useEffect, useRef, useState, useCallback } from 'react'
import { useAuth } from './useAuth'
import { setIdleTimedOut } from './idleFlag'

const IDLE_MS   = 3 * 60 * 1000  // 3 minutes total idle time
const WARN_MS   = 30 * 1000      // show warning 30 s before logout

const EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']

export function useIdleLogout() {
  const { logout } = useAuth()
  const logoutRef  = useRef(null)
  const warnRef    = useRef(null)
  const [warning, setWarning]     = useState(false)
  const [timedOut, setTimedOut]   = useState(false)
  const [countdown, setCountdown] = useState(WARN_MS / 1000)
  const countRef   = useRef(null)

  const doLogout = useCallback(() => {
    clearInterval(countRef.current)
    setWarning(false)
    setIdleTimedOut(true)
    logout()          // clear token/user from context + localStorage
    setTimedOut(true) // show re-login modal instead of navigating away
  }, [logout])

  const reset = useCallback(() => {
    clearTimeout(logoutRef.current)
    clearTimeout(warnRef.current)
    clearInterval(countRef.current)
    setWarning(false)
    setCountdown(WARN_MS / 1000)

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

  // Called after successful re-login to resume the session
  const resumeSession = useCallback(() => {
    setIdleTimedOut(false)
    setTimedOut(false)
    reset()
  }, [reset])

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

  return { warning, countdown, timedOut, stayLoggedIn: reset, resumeSession }
}
