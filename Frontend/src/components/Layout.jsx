import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useState, useEffect } from 'react'
import { workflowAPI } from '../api'

const NAV = [
  { to: '/',          icon: '🏠', label: 'Dashboard' },
  { to: '/documents', icon: '📄', label: 'Documents' },
  { to: '/workflow',  icon: '🔄', label: 'Workflow' },
  { to: '/reports',   icon: '📊', label: 'Reports' },
  { to: '/admin',     icon: '⚙️', label: 'Administration' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    workflowAPI.pending().then(r => setPendingCount(r.data.length)).catch(() => {})
  }, [])

  function handleLogout() {
    logout()
    nav('/login')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220, background: '#0C447C', color: '#fff',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, background: '#185FA5', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📁</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>DMS Portal</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>NPCIL</div>
            </div>
          </div>
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, padding: '12px 0' }}>
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 16px', textDecoration: 'none', fontSize: 13, fontWeight: 500,
              color: isActive ? '#fff' : 'rgba(255,255,255,0.65)',
              background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
              borderLeft: isActive ? '3px solid #60a5fa' : '3px solid transparent',
              transition: 'all 0.15s',
            })}>
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              {item.label}
              {item.to === '/workflow' && pendingCount > 0 && (
                <span style={{ marginLeft: 'auto', background: '#E24B4A', color: '#fff', borderRadius: 99, fontSize: 10, padding: '1px 6px' }}>{pendingCount}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>{user?.name}</div>
          <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 10 }}>{user?.role} · {user?.department}</div>
          <button onClick={handleLogout} style={{
            background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
            padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', width: '100%',
          }}>Sign Out</button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflowY: 'auto', background: '#f8fafc' }}>
        <Outlet />
      </main>
    </div>
  )
}
