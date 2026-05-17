import React, { useState, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import Settings from './Settings'
import './UserMenu.css'

interface UserMenuProps {
  onOpenSettings?: () => void
}

const UserMenu: React.FC<UserMenuProps> = ({ onOpenSettings }) => {
  const { user, signOut, token } = useAuth()
  const navigate = useNavigate()
  const [showMenu, setShowMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false)
      }
    }

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showMenu])

  const handleLogout = () => {
    signOut()
    navigate('/')
    setShowMenu(false)
  }

  const handleDeleteAccount = async () => {
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true)
      setShowMenu(false)
      return
    }

    setDeleting(true)
    try {
      const response = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json()

      if (response.ok && data.success) {
        signOut()
        localStorage.clear()
        navigate('/')
      } else {
        throw new Error(data.error || 'Failed to delete account')
      }
    } catch (error: any) {
      console.error('Error deleting account:', error)
      alert(error.message || 'Failed to delete account. Please try again.')
      setShowDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  const getUserInitials = () => {
    if (user?.name) {
      return user.name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    }
    if (user?.email) {
      return user.email[0].toUpperCase()
    }
    return 'U'
  }

  return (
    <>
      <div className="user-menu-container" ref={menuRef}>
        <button
          className="user-menu-button"
          onClick={() => setShowMenu(!showMenu)}
          aria-label="User menu"
        >
          <div className="user-avatar">
            {getUserInitials()}
          </div>
        </button>

        {showMenu && (
          <div className="user-menu-dropdown">
            <div className="user-menu-header">
              <div className="user-menu-avatar-large">
                {getUserInitials()}
              </div>
              <div className="user-menu-info">
                <div className="user-menu-name">{user?.name || 'User'}</div>
                <div className="user-menu-email">{user?.email}</div>
              </div>
            </div>
            <div className="user-menu-divider"></div>
            <div className="user-menu-items">
              <button
                className="user-menu-item"
                onClick={() => {
                  if (onOpenSettings) {
                    onOpenSettings()
                  } else {
                    setShowSettings(true)
                  }
                  setShowMenu(false)
                }}
                title="Settings"
              >
                <span className="user-menu-icon">⚙️</span>
                <span>Settings</span>
              </button>
              <a
                className="user-menu-item"
                href="/docs"
                onClick={() => setShowMenu(false)}
                title="Help"
              >
                <span className="user-menu-icon">📚</span>
                <span>Help</span>
              </a>
              <div className="user-menu-divider"></div>
              <button
                className="user-menu-item"
                onClick={handleLogout}
                title="Log out"
              >
                <span className="user-menu-icon">🚪</span>
                <span>Log out</span>
              </button>
              <button
                className="user-menu-item user-menu-item-danger"
                onClick={handleDeleteAccount}
                title="Delete my account"
              >
                <span className="user-menu-icon">🗑️</span>
                <span>Delete my account</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {showSettings && (
        <Settings onClose={() => setShowSettings(false)} />
      )}

      {showDeleteConfirm && (
        <div className="delete-account-modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="delete-account-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Account</h2>
            <p className="delete-warning">
              ⚠️ Are you sure you want to delete your account? This will permanently delete:
            </p>
            <ul className="delete-warning-list">
              <li>Your account and profile</li>
              <li>All saved connection configurations</li>
              <li>All Knowledge Bases and Q&A pairs</li>
            </ul>
            <p className="delete-warning-final">
              This action cannot be undone.
            </p>
            <div className="delete-modal-buttons">
              <button
                className="btn-cancel-delete"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="btn-confirm-delete"
                onClick={handleDeleteAccount}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Yes, Delete My Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default UserMenu

