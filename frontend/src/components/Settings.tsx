import React, { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { useDraggableResizable } from '../hooks/useDraggableResizable'
import './Settings.css'

interface SettingsProps {
  onClose: () => void
}

const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const { signOut, token } = useAuth()
  const navigate = useNavigate()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  
  const { modalRef, position, modalSize, isDragging, handleMouseDown, handleResizeStart } = useDraggableResizable({
    initialWidth: 500,
    initialHeight: 600,
    minWidth: 400,
    minHeight: 400,
    storageKey: 'settingsModal'
  })
  
  // View preferences state - load from localStorage or use defaults (all visible by default)
  const [viewPreferences, setViewPreferences] = useState(() => {
    const saved = localStorage.getItem('aiquery_view_preferences')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        console.error('Error parsing view preferences:', e)
      }
    }
    // Default: all sections visible
    return {
      showConnectedDataSources: true,
      showChatHistory: true,
      showLLMConfig: true,
      showCommunityChannels: true,
      showTeamMembers: true
    }
  })
  
  // Save preferences to localStorage whenever they change
  React.useEffect(() => {
    localStorage.setItem('aiquery_view_preferences', JSON.stringify(viewPreferences))
    // Dispatch custom event to notify DataSourceSidebar of changes
    window.dispatchEvent(new CustomEvent('viewPreferencesChanged', { detail: viewPreferences }))
  }, [viewPreferences])
  
  const handleToggle = (key: keyof typeof viewPreferences) => {
    setViewPreferences(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  const handleDeleteAccount = async () => {
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true)
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
        // Sign out and clear all data
        signOut()
        // Clear all localStorage items
        localStorage.clear()
        // Redirect to landing page
        navigate('/')
        // Close settings modal
        onClose()
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

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div 
        ref={modalRef}
        className="settings-content draggable-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${modalSize.width}px`,
          height: `${modalSize.height}px`,
          cursor: isDragging ? 'grabbing' : 'default'
        }}
      >
        <div 
          className="settings-header"
          onMouseDown={handleMouseDown}
          style={{ cursor: 'grab' }}
        >
          <h2>Settings</h2>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-section">
            <h3 className="settings-section-title">View</h3>
            <p className="settings-section-description">
              Control which sections are visible in the sidebar.
            </p>
            
            <div className="view-options">
              <div className="view-option">
                <label className="view-option-label">
                  <span className="view-option-text">Show Connected Data Sources</span>
                  <div className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={viewPreferences.showConnectedDataSources}
                      onChange={() => handleToggle('showConnectedDataSources')}
                    />
                    <span className="toggle-slider"></span>
                  </div>
                </label>
              </div>
              
              <div className="view-option">
                <label className="view-option-label">
                  <span className="view-option-text">Show Chat History</span>
                  <div className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={viewPreferences.showChatHistory}
                      onChange={() => handleToggle('showChatHistory')}
                    />
                    <span className="toggle-slider"></span>
                  </div>
                </label>
              </div>
              
              <div className="view-option">
                <label className="view-option-label">
                  <span className="view-option-text">Show LLM Configuration</span>
                  <div className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={viewPreferences.showLLMConfig}
                      onChange={() => handleToggle('showLLMConfig')}
                    />
                    <span className="toggle-slider"></span>
                  </div>
                </label>
              </div>
              
              <div className="view-option">
                <label className="view-option-label">
                  <span className="view-option-text">Show Community Channels</span>
                  <div className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={viewPreferences.showCommunityChannels}
                      onChange={() => handleToggle('showCommunityChannels')}
                    />
                    <span className="toggle-slider"></span>
                  </div>
                </label>
              </div>
              
              <div className="view-option">
                <label className="view-option-label">
                  <span className="view-option-text">Show Team Members</span>
                  <div className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={viewPreferences.showTeamMembers}
                      onChange={() => handleToggle('showTeamMembers')}
                    />
                    <span className="toggle-slider"></span>
                  </div>
                </label>
              </div>
            </div>
          </div>
          
          <div className="settings-section">
            <h3 className="settings-section-title">Account Management</h3>
            <p className="settings-section-description">
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
            
            {!showDeleteConfirm ? (
              <button 
                className="btn-delete-account" 
                onClick={handleDeleteAccount}
                type="button"
              >
                Delete My Account
              </button>
            ) : (
              <div className="delete-confirm">
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
                <div className="delete-confirm-buttons">
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
            )}
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-cancel" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="resize-handle" onMouseDown={handleResizeStart}></div>
      </div>
    </div>
  )
}

export default Settings

