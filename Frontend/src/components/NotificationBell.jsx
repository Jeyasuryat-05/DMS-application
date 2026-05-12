import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { workflowAPI, documentsAPI } from '../api'

export default function NotificationBell() {
  const nav = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [workflowTasks, setWorkflowTasks] = useState([])
  const [accessRequests, setAccessRequests] = useState([])
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef(null)

  const totalNotifications = workflowTasks.length + accessRequests.length

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  function openDropdown() {
    setIsOpen(true)
    loadNotifications()
  }

  function loadNotifications() {
    setLoading(true)
    Promise.all([
      workflowAPI.inbox().then(r => setWorkflowTasks(r.data || [])),
      documentsAPI.incomingAccessRequests().then(r => setAccessRequests(r.data || [])),
    ]).catch(() => {}).finally(() => setLoading(false))
  }

  function handleWorkflowClick(task) {
    setIsOpen(false)
    nav(`/documents/${task.id}`)
  }

  function handleAccessRequestClick(req) {
    setIsOpen(false)
    nav(`/documents/${req.document.id}`)
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={openDropdown}
        title="Notifications"
        style={{
          background: 'none', border: 'none', position: 'relative',
          cursor: 'pointer', fontSize: 20, color: '#6b7280',
          transition: 'color 0.15s',
          padding: '4px 8px',
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#185FA5'}
        onMouseLeave={e => e.currentTarget.style.color = '#6b7280'}
      >
        🔔
        {totalNotifications > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0,
            background: '#E24B4A', color: '#fff',
            borderRadius: '50%', width: 18, height: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '10px', fontWeight: 700,
          }}>
            {totalNotifications > 99 ? '99+' : totalNotifications}
          </span>
        )}
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: '#fff', borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          zIndex: 1000, minWidth: 340, maxHeight: 480, overflowY: 'auto',
          border: '1px solid #e5e7eb',
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 16px', borderBottom: '1px solid #e5e7eb',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            position: 'sticky', top: 0, background: '#fff',
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>
              Notifications
            </div>
            {isOpen && !loading && (
              <button
                onClick={loadNotifications}
                title="Refresh"
                style={{
                  background: 'none', border: 'none', color: '#6b7280',
                  cursor: 'pointer', fontSize: 14, padding: '2px 6px',
                }}
              >
                🔄
              </button>
            )}
          </div>

          {loading && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9ca3af' }}>
              Loading…
            </div>
          )}

          {!loading && totalNotifications === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
              No notifications
            </div>
          )}

          {!loading && totalNotifications > 0 && (
            <>
              {/* Workflow Section */}
              {workflowTasks.length > 0 && (
                <>
                  <div style={{
                    padding: '10px 16px 6px', fontSize: 11, fontWeight: 700,
                    color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    📋 Workflow Tasks ({workflowTasks.length})
                  </div>
                  {workflowTasks.map((task, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleWorkflowClick(task)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '12px 16px', borderTop: idx === 0 ? '1px solid #f3f4f6' : 'none',
                        borderBottom: '1px solid #f3f4f6', border: 'none',
                        background: '#fafafa', cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                      onMouseLeave={e => e.currentTarget.style.background = '#fafafa'}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#111827', marginBottom: 4 }}>
                        {task.title || `Document #${task.id}`}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {task.workflow?.stage || 'Pending Review'}
                      </div>
                    </button>
                  ))}
                </>
              )}

              {/* Access Request Section */}
              {accessRequests.length > 0 && (
                <>
                  <div style={{
                    padding: '10px 16px 6px', fontSize: 11, fontWeight: 700,
                    color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    🔑 Edit Access Requests ({accessRequests.length})
                  </div>
                  {accessRequests.map((req, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleAccessRequestClick(req)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '12px 16px', borderTop: idx === 0 ? '1px solid #f3f4f6' : 'none',
                        borderBottom: '1px solid #f3f4f6', border: 'none',
                        background: '#fafafa', cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                      onMouseLeave={e => e.currentTarget.style.background = '#fafafa'}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#111827', marginBottom: 4 }}>
                        {req.document?.title || `Document #${req.document?.id}`}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {req.requester?.name || 'User'} requested edit access
                      </div>
                      {req.message && (
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, fontStyle: 'italic' }}>
                          "{req.message.substring(0, 50)}{req.message.length > 50 ? '…' : ''}"
                        </div>
                      )}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
