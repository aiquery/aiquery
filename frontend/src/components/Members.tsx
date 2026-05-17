import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../contexts/AuthContext'
import { useDraggableResizable } from '../hooks/useDraggableResizable'
import './Members.css'

interface TeamMember {
  id: number
  userId: number
  email: string
  name: string | null
  role: 'admin' | 'view'
  invitedBy: number | null
  invitedAt: string
  joinedAt: string | null
}

interface MembersProps {
  onClose?: () => void
  inline?: boolean
}

const Members: React.FC<MembersProps> = ({ onClose, inline = false }) => {
  const { isAuthenticated } = useAuth()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [activeTab, setActiveTab] = useState<'members' | 'invite'>('members')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'view'>('view')
  const [inviting, setInviting] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [error, setError] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [generatingLink, setGeneratingLink] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  
  const { modalRef, position, modalSize, isDragging, handleMouseDown, handleResizeStart } = useDraggableResizable({
    initialWidth: 700,
    initialHeight: 600,
    minWidth: 500,
    minHeight: 400,
    storageKey: 'membersModal'
  })

  useEffect(() => {
    if (isAuthenticated) {
      loadMembers()
      checkPermissions()
    } else {
      setLoading(false)
    }
  }, [isAuthenticated])

  const loadMembers = async () => {
    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.get('/api/members', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.data.success) {
        setMembers(response.data.members || [])
      }
    } catch (error) {
      console.error('Error loading members:', error)
      setError('Failed to load team members')
    } finally {
      setLoading(false)
    }
  }

  const checkPermissions = async () => {
    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.get('/api/members/permissions?action=configure', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.data.success) {
        setIsAdmin(response.data.hasPermission)
      }
    } catch (error) {
      console.error('Error checking permissions:', error)
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      setError('Please enter an email address')
      return
    }

    setInviting(true)
    setError('')

    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.post('/api/members/invite', {
        email: inviteEmail.trim(),
        role: inviteRole
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.data.success) {
        setInviteEmail('')
        setInviteRole('view')
        setShowInviteModal(false)
        await loadMembers()
        alert('Member invited successfully!')
      } else {
        setError(response.data.error || 'Failed to invite member')
      }
    } catch (error: any) {
      console.error('Error inviting member:', error)
      setError(error.response?.data?.error || 'Failed to invite member')
    } finally {
      setInviting(false)
    }
  }

  const handleUpdateRole = async (userId: number, newRole: 'admin' | 'view') => {
    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.put(`/api/members/${userId}/role`, {
        role: newRole
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.data.success) {
        await loadMembers()
        alert('Member role updated successfully!')
      } else {
        alert(response.data.error || 'Failed to update member role')
      }
    } catch (error: any) {
      console.error('Error updating member role:', error)
      alert(error.response?.data?.error || 'Failed to update member role')
    }
  }

  const handleRemoveMember = async (userId: number, email: string) => {
    if (!confirm(`Are you sure you want to remove ${email} from the team?`)) {
      return
    }

    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.delete(`/api/members/${userId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.data.success) {
        await loadMembers()
        alert('Member removed successfully!')
      } else {
        alert(response.data.error || 'Failed to remove member')
      }
    } catch (error: any) {
      console.error('Error removing member:', error)
      alert(error.response?.data?.error || 'Failed to remove member')
    }
  }

  const generateInviteLink = async () => {
    setGeneratingLink(true)
    setError('')

    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.post('/api/members/invite-link', {
        role: inviteRole
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.data.success) {
        const baseUrl = window.location.origin
        const fullLink = `${baseUrl}/invite/${response.data.token}`
        setInviteLink(fullLink)
      } else {
        setError(response.data.error || 'Failed to generate invite link')
      }
    } catch (error: any) {
      console.error('Error generating invite link:', error)
      setError(error.response?.data?.error || 'Failed to generate invite link')
    } finally {
      setGeneratingLink(false)
    }
  }

  const copyInviteLink = async () => {
    if (!inviteLink) return

    try {
      await navigator.clipboard.writeText(inviteLink)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = inviteLink
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    }
  }

  if (loading) {
    return (
      <div className="members-section">
        <div className="members-header">
          <span className="members-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 14a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3.5 20a4.5 4.5 0 0 1 9 0M11.5 20a4.5 4.5 0 0 1 9 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <span className="members-title">Members</span>
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  if (inline) {
    return (
      <div className="members-panel">
        <div className="members-panel-header">
          <h2>Team Members</h2>
        </div>
        <div className="members-modal-tabs">
          <button
            className={`members-tab ${activeTab === 'members' ? 'active' : ''}`}
            onClick={() => setActiveTab('members')}
          >
            Members List
          </button>
          {isAdmin && (
            <button
              className={`members-tab ${activeTab === 'invite' ? 'active' : ''}`}
              onClick={() => setActiveTab('invite')}
            >
              Invite Team Member
            </button>
          )}
        </div>

        <div className="members-modal-body">
          {activeTab === 'members' && (
            <div className="members-tab-content">
              {members.length > 0 ? (
                <div className="members-list">
                  {members.map((member) => (
                    <div key={member.id} className="members-item">
                      <div className="members-item-info">
                        <div className="members-item-name">
                          {member.name || member.email}
                          {member.id === 0 && (
                            <span className="members-owner-badge">Owner</span>
                          )}
                        </div>
                        <div className="members-item-email">{member.email}</div>
                      </div>
                      <div className="members-item-actions">
                        {isAdmin && member.id !== 0 && (
                          <>
                            <select
                              className="members-role-select"
                              value={member.role}
                              onChange={(e) => handleUpdateRole(member.userId, e.target.value as 'admin' | 'view')}
                            >
                              <option value="admin">Admin</option>
                              <option value="view">View</option>
                            </select>
                            <button
                              className="members-remove-button"
                              onClick={() => handleRemoveMember(member.userId, member.email)}
                              title="Remove member"
                            >
                              🗑️
                            </button>
                          </>
                        )}
                        {!isAdmin && (
                          <span className="members-role-badge">{member.role}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="members-empty">
                  <p>No team members yet</p>
                  {isAdmin && (
                    <p className="members-hint">Go to "Invite Team Member" tab to invite members</p>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'invite' && isAdmin && (
            <div className="members-tab-content">
              {error && (
                <div className="members-error">{error}</div>
              )}

              <div className="members-invite-section">
                <h3>Invite by Email</h3>
                <div className="members-form-group">
                  <label>Email Address</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="members-input"
                  />
                </div>

                <div className="members-form-group">
                  <label>Role</label>
                  <div className="members-role-options">
                    <label className="members-role-option">
                      <input
                        type="radio"
                        name="role"
                        value="admin"
                        checked={inviteRole === 'admin'}
                        onChange={() => {
                          setInviteRole('admin')
                          setInviteLink('')
                        }}
                      />
                      <span>Admin - Full access (configuration + query)</span>
                    </label>
                    <label className="members-role-option">
                      <input
                        type="radio"
                        name="role"
                        value="view"
                        checked={inviteRole === 'view'}
                        onChange={() => {
                          setInviteRole('view')
                          setInviteLink('')
                        }}
                      />
                      <span>View - Query only (no configuration)</span>
                    </label>
                  </div>
                </div>

                <div className="members-modal-actions">
                  <button
                    className="members-button members-button-primary"
                    onClick={handleInvite}
                    disabled={inviting || !inviteEmail.trim()}
                  >
                    {inviting ? 'Inviting...' : 'Send Invitation'}
                  </button>
                </div>
              </div>

              <div className="members-invite-link-section">
                <h3>Invite Link</h3>
                <div className="members-form-group">
                  <label>Generate an invite link to share</label>
                  <div className="members-invite-link-box">
                    <input
                      type="text"
                      value={inviteLink}
                      readOnly
                      placeholder="Click 'Generate Link' to create an invite link"
                      className="members-invite-link-input"
                    />
                    <div className="members-invite-link-actions">
                      <button
                        className="members-button members-button-secondary"
                        onClick={generateInviteLink}
                        disabled={generatingLink}
                      >
                        {generatingLink ? 'Generating...' : 'Generate Link'}
                      </button>
                      {inviteLink && (
                        <button
                          className="members-button members-button-copy"
                          onClick={copyInviteLink}
                          title="Copy invite link"
                        >
                          {linkCopied ? '✓ Copied' : '📋 Copy'}
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="members-invite-link-hint">
                    Share this link with users to invite them to your team. They will be added with the selected role.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="members-section">
        <button
          className="members-header"
          onClick={() => setShowModal(true)}
          title="Manage team members"
        >
          <span className="members-icon">
            <img src="/images/members_logo.png" alt="" aria-hidden="true" />
          </span>
          <span className="members-title">Members</span>
          {isAdmin && (
            <span className="members-badge">Admin</span>
          )}
        </button>

        {showModal && (
          <div className="members-modal-overlay" onClick={() => {
            setShowModal(false)
            setError('')
            setInviteEmail('')
            setInviteLink('')
            setActiveTab('members')
          }}>
            <div 
              ref={modalRef}
              className="members-modal-content draggable-modal"
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
                className="members-modal-header"
                onMouseDown={handleMouseDown}
                style={{ cursor: 'grab' }}
              >
                <h2>Team Members</h2>
                <button 
                  className="members-modal-close"
                  onClick={() => {
                    setShowModal(false)
                    setError('')
                    setInviteEmail('')
                    setInviteLink('')
                    setActiveTab('members')
                  }}
                >
                  ×
                </button>
              </div>

              <div className="members-modal-tabs">
                <button
                  className={`members-tab ${activeTab === 'members' ? 'active' : ''}`}
                  onClick={() => setActiveTab('members')}
                >
                  Members List
                </button>
                {isAdmin && (
                  <button
                    className={`members-tab ${activeTab === 'invite' ? 'active' : ''}`}
                    onClick={() => setActiveTab('invite')}
                  >
                    Invite Team Member
                  </button>
                )}
              </div>

              <div className="members-modal-body">
                {activeTab === 'members' && (
                  <div className="members-tab-content">
                    {members.length > 0 ? (
                      <div className="members-list">
                        {members.map((member) => (
                          <div key={member.id} className="members-item">
                            <div className="members-item-info">
                              <div className="members-item-name">
                                {member.name || member.email}
                                {member.id === 0 && (
                                  <span className="members-owner-badge">Owner</span>
                                )}
                              </div>
                              <div className="members-item-email">{member.email}</div>
                            </div>
                            <div className="members-item-actions">
                              {isAdmin && member.id !== 0 && (
                                <>
                                  <select
                                    className="members-role-select"
                                    value={member.role}
                                    onChange={(e) => handleUpdateRole(member.userId, e.target.value as 'admin' | 'view')}
                                  >
                                    <option value="admin">Admin</option>
                                    <option value="view">View</option>
                                  </select>
                                  <button
                                    className="members-remove-button"
                                    onClick={() => handleRemoveMember(member.userId, member.email)}
                                    title="Remove member"
                                  >
                                    🗑️
                                  </button>
                                </>
                              )}
                              {!isAdmin && (
                                <span className="members-role-badge">{member.role}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="members-empty">
                        <p>No team members yet</p>
                        {isAdmin && (
                          <p className="members-hint">Go to "Invite Team Member" tab to invite members</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'invite' && isAdmin && (
                  <div className="members-tab-content">
                    {error && (
                      <div className="members-error">{error}</div>
                    )}

                    <div className="members-invite-section">
                      <h3>Invite by Email</h3>
                      <div className="members-form-group">
                        <label>Email Address</label>
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="user@example.com"
                          className="members-input"
                        />
                      </div>

                      <div className="members-form-group">
                        <label>Role</label>
                        <div className="members-role-options">
                          <label className="members-role-option">
                            <input
                              type="radio"
                              name="role"
                              value="admin"
                              checked={inviteRole === 'admin'}
                              onChange={() => {
                                setInviteRole('admin')
                                setInviteLink('') // Reset link when role changes
                              }}
                            />
                            <span>Admin - Full access (configuration + query)</span>
                          </label>
                          <label className="members-role-option">
                            <input
                              type="radio"
                              name="role"
                              value="view"
                              checked={inviteRole === 'view'}
                              onChange={() => {
                                setInviteRole('view')
                                setInviteLink('') // Reset link when role changes
                              }}
                            />
                            <span>View - Query only (no configuration)</span>
                          </label>
                        </div>
                      </div>

                      <div className="members-modal-actions">
                        <button
                          className="members-button members-button-primary"
                          onClick={handleInvite}
                          disabled={inviting || !inviteEmail.trim()}
                        >
                          {inviting ? 'Inviting...' : 'Send Invitation'}
                        </button>
                      </div>
                    </div>

                    <div className="members-invite-link-section">
                      <h3>Invite Link</h3>
                      <div className="members-form-group">
                        <label>Generate an invite link to share</label>
                        <div className="members-invite-link-box">
                          <input
                            type="text"
                            value={inviteLink}
                            readOnly
                            placeholder="Click 'Generate Link' to create an invite link"
                            className="members-invite-link-input"
                          />
                          <div className="members-invite-link-actions">
                            <button
                              className="members-button members-button-secondary"
                              onClick={generateInviteLink}
                              disabled={generatingLink}
                            >
                              {generatingLink ? 'Generating...' : 'Generate Link'}
                            </button>
                            {inviteLink && (
                              <button
                                className="members-button members-button-copy"
                                onClick={copyInviteLink}
                                title="Copy invite link"
                              >
                                {linkCopied ? '✓ Copied' : '📋 Copy'}
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="members-invite-link-hint">
                          Share this link with users to invite them to your team. They will be added with the selected role.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="resize-handle" onMouseDown={handleResizeStart}></div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default Members

