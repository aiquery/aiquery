import React, { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import './NotificationsDropdown.css'

export type NotificationsDropdownVariant = 'header' | 'sidebar'

interface Notification {
  id: number
  type: string
  title: string
  message: string
  readAt: string | null
  createdAt: string
}

interface NotificationsDropdownProps {
  variant?: NotificationsDropdownVariant
  triggerClassName?: string
}

const NotificationsDropdown: React.FC<NotificationsDropdownProps> = ({
  variant = 'header',
  triggerClassName = '',
}) => {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const token = localStorage.getItem('aiquery_token')
  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  const fetchNotifications = async () => {
    setLoading(true)
    try {
      const res = await axios.get<{ success: boolean; notifications: Notification[] }>('/api/notifications', { headers })
      if (res.data.success) setNotifications(res.data.notifications || [])
    } catch {
      setNotifications([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) fetchNotifications()
  }, [open])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const markRead = async (id: number) => {
    try {
      await axios.patch(`/api/notifications/${id}/read`, {}, { headers })
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
      )
    } catch {
      // ignore
    }
  }

  const handleSelect = (n: Notification) => {
    setSelectedId(n.id)
    if (!n.readAt) markRead(n.id)
  }

  const formatDate = (s: string) => {
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return s
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString()
  }

  const unreadCount = notifications.filter((n) => !n.readAt).length
  const selected = notifications.find((n) => n.id === selectedId)

  return (
    <div className="notifications-dropdown-wrap" ref={dropdownRef}>
      <button
        type="button"
        className={triggerClassName || 'notifications-dropdown-trigger'}
        aria-label="Notifications"
        title="Notifications"
        onClick={() => setOpen(!open)}
      >
        <span className="notifications-dropdown-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 18h12M9 18v-1a3 3 0 0 1-1-2.2V10a4 4 0 1 1 8 0v4.8a3 3 0 0 1-1 2.2v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        {unreadCount > 0 && (
          <span className="notifications-dropdown-badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={`notifications-dropdown-panel notifications-dropdown-panel--${variant}`}>
          <div className="notifications-dropdown-header">
            <h3 className="notifications-dropdown-title">Notifications</h3>
          </div>
          {loading ? (
            <div className="notifications-dropdown-loading">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="notifications-dropdown-empty">No notifications yet.</div>
          ) : (
            <div className="notifications-dropdown-body">
              <ul className="notifications-dropdown-list">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`notifications-dropdown-item ${selectedId === n.id ? 'selected' : ''} ${!n.readAt ? 'unread' : ''}`}
                    onClick={() => handleSelect(n)}
                  >
                    <span className="notifications-dropdown-item-title">{n.title}</span>
                    <span className="notifications-dropdown-item-date">{formatDate(n.createdAt)}</span>
                  </li>
                ))}
              </ul>
              <div className="notifications-dropdown-detail">
                {selected ? (
                  <>
                    <h4 className="notifications-dropdown-detail-title">{selected.title}</h4>
                    <p className="notifications-dropdown-detail-date">{formatDate(selected.createdAt)}</p>
                    <div className="notifications-dropdown-detail-message">{selected.message}</div>
                  </>
                ) : (
                  <p className="notifications-dropdown-detail-placeholder">Click a notification to view details.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default NotificationsDropdown
