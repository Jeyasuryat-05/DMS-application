import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useState, useEffect, useRef } from 'react'
import { workflowAPI, authAPI } from '../api'
import NotificationBell from './NotificationBell'
import { BusyIndicator } from '@ui5/webcomponents-react'

const ADMIN_ROLES = ['System Admin', 'Sub Admin', 'Sub-Admin']

const NAV = [
  { to: '/',          icon: '🏠', label: 'Dashboard' },
  { to: '/documents', icon: '📄', label: 'Documents' },
  { to: '/library',   icon: '📚', label: 'Document Folder' },
  { to: '/workflow',  icon: '🔄', label: 'Workflow' },
  { to: '/reports',   icon: '📊', label: 'Reports' },
  { to: '/admin',     icon: '⚙️', label: 'Administration', roles: ADMIN_ROLES },
]

const C = {
  brand:    '#0070F2',
  white:    '#FFFFFF',
  border:   '#D9D9D9',
  bg:       '#F5F6F7',
  text:     '#32363A',
  label:    '#6A6D70',
  hover:    '#EBF5FE',
  negative: '#BB0000',
  topbar:   '#FFFFFF',
}

// ── Profile Modal (native overlay) ──────────────────────────────────────────
function ProfileModal({ user, onClose, onPictureUpdated }) {
  const fileRef = useRef()
  const [uploading, setUploading]   = useState(false)
  const [removing,  setRemoving]    = useState(false)
  const [error,     setError]       = useState('')
  const [success,   setSuccess]     = useState('')
  const [previewUrl, setPreviewUrl] = useState(user?.profile_picture || null)
  const [pendingFile, setPendingFile] = useState(null)
  const hasSavedPic = !!(user?.profile_picture)

  // close on Escape
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onClose])

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['image/jpeg','image/png'].includes(file.type)) { setError('Only JPG and PNG files are allowed'); e.target.value = ''; return }
    if (file.size > 5 * 1024 * 1024) { setError('File must be smaller than 5 MB'); e.target.value = ''; return }
    setError(''); setSuccess('')
    setPreviewUrl(URL.createObjectURL(file))
    setPendingFile(file)
  }

  function handleCancel() {
    setPreviewUrl(user?.profile_picture || null)
    setPendingFile(null); setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleRemove() {
    if (!window.confirm('Remove your profile picture?')) return
    setRemoving(true); setError('')
    try {
      await authAPI.removeProfilePicture()
      setPreviewUrl(null); setSuccess('Profile picture removed.')
      setTimeout(() => onPictureUpdated(null), 900)
    } catch (err) {
      const d = err?.response?.data?.detail
      setError(typeof d === 'string' ? d : err?.message || 'Remove failed')
    } finally { setRemoving(false) }
  }

  async function handleSave() {
    if (!pendingFile) return
    setUploading(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', pendingFile)
      const res = await authAPI.uploadProfilePicture(fd)
      setSuccess('Profile picture updated!')
      setPendingFile(null)
      setTimeout(() => onPictureUpdated(res.data.url), 900)
    } catch (err) {
      const d = err?.response?.data?.detail
      setError(typeof d === 'string' ? d : Array.isArray(d) ? d.map(x => x.msg).join(', ') : err?.message || 'Upload failed')
      setPreviewUrl(user?.profile_picture || null); setPendingFile(null)
    } finally { setUploading(false) }
  }

  const initials = (user?.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  const fields = [
    { label: 'Full Name',    value: user?.name },
    { label: 'Email',        value: user?.email },
    { label: 'Role',         value: user?.role },
    { label: 'Department',   value: user?.department },
    { label: 'Employee ID',  value: user?.employee_id },
    { label: 'SAP Username', value: user?.sap_username },
  ].filter(f => f.value)

  return (
    // overlay
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* modal box — stop propagation so clicking inside doesn't close */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.white,
          borderRadius: 8,
          width: 420, maxWidth: '95vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 20px',
          borderBottom: `1px solid ${C.border}`,
          position: 'sticky', top: 0, background: C.white, zIndex: 1,
        }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>My Profile</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 20, color: C.label, lineHeight: 1, padding: '2px 6px',
            borderRadius: 4,
          }}
          onMouseOver={e => e.currentTarget.style.color = C.negative}
          onMouseOut={e => e.currentTarget.style.color = C.label}
          >✕</button>
        </div>

        {/* body */}
        <div style={{ padding: '20px 20px 0' }}>
          {/* avatar */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <div style={{ position: 'relative' }}>
              {previewUrl
                ? <img src={previewUrl} alt={user?.name} style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${C.brand}` }} />
                : (
                  <div style={{ width: 80, height: 80, borderRadius: '50%', background: C.brand, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700, color: '#fff', border: `3px solid ${C.brand}` }}>
                    {initials}
                  </div>
                )
              }
              <button onClick={() => fileRef.current?.click()} disabled={uploading || removing}
                title="Change profile picture"
                style={{ position: 'absolute', bottom: 0, right: 0, background: C.brand, border: '2px solid #fff', color: '#fff', borderRadius: '50%', width: 26, height: 26, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                📷
              </button>
              {hasSavedPic && !pendingFile && (
                <button onClick={handleRemove} disabled={uploading || removing}
                  title="Remove"
                  style={{ position: 'absolute', bottom: 0, left: 0, background: C.negative, border: '2px solid #fff', color: '#fff', borderRadius: '50%', width: 26, height: 26, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  🗑
                </button>
              )}
              <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFileChange} />
            </div>
          </div>

          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{user?.name}</div>
            <div style={{ fontSize: 12, color: C.label, marginTop: 3 }}>{user?.role} · {user?.department}</div>
            {uploading && <div style={{ marginTop: 8 }}><BusyIndicator active size="Small" /></div>}
          </div>

          {error   && <div style={{ background: '#fff0f0', border: '1px solid #ffbaba', color: C.negative, borderRadius: 4, padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>{error}</div>}
          {success && <div style={{ background: '#f0fff4', border: '1px solid #b7ebc0', color: '#188918', borderRadius: 4, padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>{success}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {fields.map(f => (
              <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 12, background: C.bg, borderRadius: 6, padding: '10px 14px', border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.label, width: 100, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{f.label}</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{f.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '12px 20px',
          borderTop: `1px solid ${C.border}`,
          position: 'sticky', bottom: 0, background: C.white,
        }}>
          {pendingFile && !uploading && (
            <>
              <button onClick={handleSave} style={{ padding: '7px 16px', background: C.brand, color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save Photo</button>
              <button onClick={handleCancel} style={{ padding: '7px 16px', background: C.white, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            </>
          )}
          <button onClick={onClose} style={{ padding: '7px 16px', background: C.white, color: C.label, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, cursor: 'pointer' }}
            onMouseOver={e => { e.currentTarget.style.background = C.bg }}
            onMouseOut={e => { e.currentTarget.style.background = C.white }}
          >Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Sidebar nav item ─────────────────────────────────────────────────────────
function SideNavItem({ item, isActive, onClick, badge }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px',
        cursor: 'pointer',
        fontSize: 13, fontWeight: isActive ? 600 : 400,
        color: isActive ? C.brand : hovered ? C.brand : C.text,
        background: isActive ? C.hover : hovered ? '#f4f5f6' : 'transparent',
        borderLeft: isActive ? `3px solid ${C.brand}` : '3px solid transparent',
        borderRadius: '0 6px 6px 0',
        marginRight: 8,
        transition: 'all 0.15s',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
      <span style={{ flex: 1 }}>{item.label}</span>
      {badge > 0 && (
        <span style={{
          background: C.negative, color: '#fff',
          borderRadius: 99, fontSize: 10, fontWeight: 700,
          padding: '1px 6px', minWidth: 18, textAlign: 'center',
        }}>{badge}</span>
      )}
    </div>
  )
}

export default function Layout() {
  const { user, logout, updateUser } = useAuth()
  const nav = useNavigate()
  const location = useLocation()
  const [pendingCount, setPendingCount] = useState(0)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    workflowAPI.inbox().then(r => setPendingCount(r.data.length)).catch(() => {})
  }, [])

  function handleLogout() {
    logout()
    nav('/login')
  }

  function handlePictureUpdated(url) {
    updateUser({ profile_picture: url || null })
    setProfileOpen(false)
  }

  const initials = (user?.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const profilePic = user?.profile_picture || null
  const visibleNav = NAV.filter(item => !item.roles || item.roles.includes(user?.role))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: C.bg }}>

      {/* ── Top Bar ── */}
      <header style={{
        height: 44,
        background: '#1B3A6B',
        display: 'flex', alignItems: 'center',
        padding: '0 16px',
        gap: 12,
        flexShrink: 0,
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        zIndex: 100,
      }}>
        {/* Logo / title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <div style={{ width: 28, height: 28, background: C.brand, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff' }}>D</div>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>DMS Portal</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginLeft: 4 }}>NPCIL</span>
        </div>

        {/* Right side: bell + avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <NotificationBell />

          {/* Avatar / profile button */}
          <button
            onClick={() => setProfileOpen(true)}
            title="My Profile"
            style={{
              background: C.brand, border: '2px solid rgba(255,255,255,0.4)',
              borderRadius: '50%', width: 30, height: 30,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', overflow: 'hidden', padding: 0,
              flexShrink: 0,
            }}
          >
            {profilePic
              ? <img src={profilePic} alt={user?.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{initials}</span>
            }
          </button>

          {/* Sign out */}
          <button
            onClick={handleLogout}
            title="Sign Out"
            style={{
              background: 'none', border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 4, color: 'rgba(255,255,255,0.8)',
              fontSize: 11, padding: '4px 10px', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            onMouseOver={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = '#fff' }}
            onMouseOut={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'rgba(255,255,255,0.8)' }}
          >
            Sign Out
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* ── Sidebar ── */}
        <aside style={{
          width: 220, flexShrink: 0,
          background: C.white,
          borderRight: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
          position: 'sticky',
          top: 0,
          height: '100%',
          alignSelf: 'flex-start',
        }}>
          {/* User info strip */}
          <div style={{
            padding: '12px 16px 10px',
            borderBottom: `1px solid #e8e8e8`,
            background: '#f8f9fa',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name}
            </div>
            <div style={{ fontSize: 11, color: C.label, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.role}
            </div>
          </div>

          {/* Nav items */}
          <nav style={{ flex: 1, padding: '8px 0' }}>
            {visibleNav.map(item => (
              <SideNavItem
                key={item.to}
                item={item}
                isActive={item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)}
                onClick={() => nav(item.to)}
                badge={item.to === '/workflow' ? pendingCount : 0}
              />
            ))}
          </nav>

          {/* Sign out at bottom */}
          <div style={{ padding: '12px 16px', borderTop: `1px solid #e8e8e8` }}>
            <button onClick={handleLogout} style={{
              width: '100%', padding: '7px 12px',
              background: 'transparent', border: `1px solid ${C.border}`,
              borderRadius: 6, fontSize: 12, color: C.label,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            onMouseOver={e => { e.currentTarget.style.background = '#fff0f0'; e.currentTarget.style.color = C.negative; e.currentTarget.style.borderColor = C.negative }}
            onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.label; e.currentTarget.style.borderColor = C.border }}
            >
              Sign Out
            </button>
          </div>
        </aside>

        {/* ── Main Content ── */}
        <main style={{ flex: 1, overflowY: 'auto', background: C.bg }}>
          <Outlet />
        </main>
      </div>

      {profileOpen && (
        <ProfileModal
          user={user}
          onClose={() => setProfileOpen(false)}
          onPictureUpdated={handlePictureUpdated}
        />
      )}
    </div>
  )
}
