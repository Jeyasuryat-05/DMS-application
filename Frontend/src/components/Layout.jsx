import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useState, useEffect, useRef } from 'react'
import { workflowAPI, authAPI } from '../api'

const NAV = [
  { to: '/',          icon: '🏠', label: 'Dashboard' },
  { to: '/documents', icon: '📄', label: 'Documents' },
  { to: '/library',   icon: '📚', label: 'Document Library' },
  { to: '/workflow',  icon: '🔄', label: 'Workflow' },
  { to: '/reports',   icon: '📊', label: 'Reports' },
  { to: '/admin',     icon: '⚙️', label: 'Administration' },
]

function Avatar({ src, name, size = 36 }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return src ? (
    <img src={src} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
  ) : (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
      color: '#fff', fontWeight: 700, fontSize: size * 0.36,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>{initials}</div>
  )
}

function ProfileModal({ user, onClose, onPictureUpdated }) {
  const fileRef = useRef()
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [previewUrl, setPreviewUrl] = useState(user?.profile_picture || null)
  const [pendingFile, setPendingFile] = useState(null)
  const hasSavedPic = !!(user?.profile_picture)

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const allowed = ['image/jpeg', 'image/png']
    if (!allowed.includes(file.type)) {
      setError('Only JPG and PNG files are allowed')
      e.target.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File must be smaller than 5 MB')
      e.target.value = ''
      return
    }
    setError('')
    setSuccess('')
    setPreviewUrl(URL.createObjectURL(file))
    setPendingFile(file)
  }

  function handleCancel() {
    setPreviewUrl(user?.profile_picture || null)
    setPendingFile(null)
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleRemove() {
    if (!window.confirm('Remove your profile picture?')) return
    setRemoving(true)
    setError('')
    try {
      await authAPI.removeProfilePicture()
      setPreviewUrl(null)
      setSuccess('Profile picture removed.')
      setTimeout(() => onPictureUpdated(null), 900)
    } catch (err) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : err?.message || 'Remove failed')
    } finally {
      setRemoving(false)
    }
  }

  async function handleSave() {
    if (!pendingFile) return
    setUploading(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', pendingFile)
      const res = await authAPI.uploadProfilePicture(fd)
      setSuccess('Profile picture updated!')
      setPendingFile(null)
      setTimeout(() => onPictureUpdated(res.data.url), 900)
    } catch (err) {
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail
                : Array.isArray(detail) ? detail.map(d => d.msg).join(', ')
                : err?.message || 'Upload failed'
      setError(msg)
      setPreviewUrl(user?.profile_picture || null)
      setPendingFile(null)
    } finally {
      setUploading(false)
    }
  }

  const fields = [
    { label: 'Full Name',    value: user?.name },
    { label: 'Email',        value: user?.email },
    { label: 'Role',         value: user?.role },
    { label: 'Department',   value: user?.department },
    { label: 'Employee ID',  value: user?.employee_id },
    { label: 'SAP Username', value: user?.sap_username },
  ]

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 16, width: 420, maxWidth: '92vw',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden',
      }}>
        {/* Header band */}
        <div style={{ background: 'linear-gradient(135deg, #0C447C, #185FA5)', padding: '28px 24px 40px', position: 'relative' }}>
          <button onClick={onClose} style={{
            position: 'absolute', top: 14, right: 14, background: 'rgba(255,255,255,0.15)',
            border: 'none', color: '#fff', borderRadius: '50%', width: 30, height: 30,
            fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 17, marginBottom: 4 }}>My Profile</div>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>View your account details</div>
        </div>

        {/* Avatar — overlapping header */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: -40, marginBottom: 12, position: 'relative', zIndex: 1 }}>
          <div style={{ position: 'relative' }}>
            <div style={{ borderRadius: '50%', border: '4px solid #fff', overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
              <Avatar src={previewUrl} name={user?.name} size={80} />
            </div>
            {!pendingFile && (
              <>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || removing}
                  title="Change profile picture"
                  style={{
                    position: 'absolute', bottom: 0, right: 0,
                    background: '#0C447C', border: '2px solid #fff', color: '#fff',
                    borderRadius: '50%', width: 26, height: 26, fontSize: 13,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >📷</button>
                {hasSavedPic && (
                  <button
                    onClick={handleRemove}
                    disabled={uploading || removing}
                    title="Remove profile picture"
                    style={{
                      position: 'absolute', bottom: 0, left: 0,
                      background: '#dc2626', border: '2px solid #fff', color: '#fff',
                      borderRadius: '50%', width: 26, height: 26, fontSize: 13,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >🗑</button>
                )}
              </>
            )}
            <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFileChange} />
          </div>
        </div>

        {/* Name + role */}
        <div style={{ textAlign: 'center', marginBottom: 16, padding: '0 24px' }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#111827' }}>{user?.name}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{user?.role} · {user?.department}</div>
          {error && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{error}</div>}
          {success && <div style={{ color: '#16a34a', fontSize: 12, marginTop: 8, fontWeight: 600 }}>{success}</div>}

          {/* Save / Cancel buttons shown only when a new file is selected */}
          {pendingFile && !uploading && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
              <button onClick={handleSave} style={{
                background: '#0C447C', color: '#fff', border: 'none',
                borderRadius: 8, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>Save Photo</button>
              <button onClick={handleCancel} style={{
                background: '#f3f4f6', color: '#374151', border: 'none',
                borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer',
              }}>Cancel</button>
            </div>
          )}
          {uploading && (
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>Uploading…</div>
          )}
        </div>

        {/* Details grid */}
        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.filter(f => f.value).map(f => (
            <div key={f.label} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: '#f9fafb', borderRadius: 8, padding: '10px 14px',
            }}>
              <div style={{ fontSize: 11, color: '#9ca3af', width: 100, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.label}</div>
              <div style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>{f.value}</div>
            </div>
          ))}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: '#f9fafb', borderRadius: 8, padding: '10px 14px',
          }}>
            <div style={{ fontSize: 11, color: '#9ca3af', width: 100, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Account</div>
            <span style={{ fontSize: 11, background: user?.is_active ? '#dcfce7' : '#fee2e2', color: user?.is_active ? '#15803d' : '#dc2626', borderRadius: 99, padding: '2px 10px', fontWeight: 600 }}>
              {user?.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Layout() {
  const { user, logout, updateUser } = useAuth()
  const nav = useNavigate()
  const [pendingCount, setPendingCount] = useState(0)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    workflowAPI.pending().then(r => setPendingCount(r.data.length)).catch(() => {})
  }, [])

  function handleLogout() {
    logout()
    nav('/login')
  }

  function handlePictureUpdated(url) {
    updateUser({ profile_picture: url || null })
  }

  const profilePic = user?.profile_picture || null

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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <header style={{
          height: 56, background: '#fff', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          padding: '0 20px', flexShrink: 0, gap: 12,
        }}>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            Welcome, <strong style={{ color: '#111827' }}>{user?.name?.split(' ')[0]}</strong>
          </div>
          <button
            onClick={() => setProfileOpen(true)}
            title="My Profile"
            style={{ background: 'none', border: '2px solid transparent', borderRadius: '50%', padding: 2, cursor: 'pointer', transition: 'border-color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#3b82f6'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
          >
            <Avatar src={profilePic} name={user?.name} size={34} />
          </button>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflowY: 'auto', background: '#f8fafc' }}>
          <Outlet />
        </main>
      </div>

      {/* Profile modal */}
      {profileOpen && (
        <ProfileModal
          user={user}
          onClose={() => setProfileOpen(false)}
          onPictureUpdated={(url) => {
            handlePictureUpdated(url)
            setProfileOpen(false)
          }}
        />
      )}
    </div>
  )
}
