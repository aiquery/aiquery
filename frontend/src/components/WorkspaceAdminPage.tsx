import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import axios from 'axios'
import Members from './Members'
import Logo from './Logo'
import UserMenu from './UserMenu'
import CurrentPlanModal from './CurrentPlanModal'
import UpgradePlanModal from './UpgradePlanModal'
import UsageModal from './UsageModal'
import AddMembersPanel from './AddMembersPanel'
import HelpDropdown from './HelpDropdown'
import NotificationsDropdown from './NotificationsDropdown'
import './WorkspaceAdminPage.css'

const WorkspaceAdminPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeNav, setActiveNav] = useState<'home' | 'shared' | 'workspace'>('home')
  const [activePanel, setActivePanel] = useState<'currentPlan' | 'usage' | 'upgrade' | 'addMembers' | 'members' | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [workspaceView, setWorkspaceView] = useState<'grid' | 'list'>('grid')
  const [showUpgradeCard, setShowUpgradeCard] = useState(true)
  const [workspaces, setWorkspaces] = useState<Array<{
    id: number
    name: string
    description?: string | null
    createdAt?: string
    ownerName?: string | null
    ownerEmail?: string | null
  }>>([])
  const [workspaceMembers, setWorkspaceMembers] = useState<Record<number, Array<{ id: number; name: string | null; email: string; role?: string }>>>({})
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingWorkspace, setEditingWorkspace] = useState<{
    id: number
    name: string
    description?: string | null
    ownerName?: string | null
    ownerEmail?: string | null
    createdAt?: string
  } | null>(null)
  const [teamMembers, setTeamMembers] = useState<Array<{ id: number; userId: number; name: string | null; email: string }>>([])
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([])
  const [memberRoles, setMemberRoles] = useState<Record<number, 'admin' | 'view'>>({})
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 6

  useEffect(() => {
    loadWorkspaces()
  }, [])

  useEffect(() => {
    const panel = localStorage.getItem('aiquery_admin_active_panel')
    if (panel === 'upgrade' || panel === 'currentPlan' || panel === 'usage' || panel === 'members' || panel === 'addMembers') {
      setActiveNav('home')
      setActivePanel(panel as typeof activePanel)
    }
    if (panel) {
      localStorage.removeItem('aiquery_admin_active_panel')
    }
  }, [])

  // When returning from Stripe checkout cancel (cancel_url has ?open=currentPlan), open Upgrade Plan panel
  useEffect(() => {
    const open = searchParams.get('open')
    if (open === 'currentPlan') {
      setActiveNav('home')
      setActivePanel('currentPlan')
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('open')
        return next
      })
    }
  }, [searchParams, setSearchParams])

  // Handle Stripe checkout success redirect
  useEffect(() => {
    const sessionId = searchParams.get('session_id')
    const addUsersSuccess = searchParams.get('add_users_success')
    
    if (sessionId) {
      // Remove query params from URL
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev)
        newParams.delete('session_id')
        newParams.delete('add_users_success')
        return newParams
      })
      
      if (addUsersSuccess === 'true') {
        // This was for adding users - call verify endpoint to ensure users are added and payment is recorded
        const verifyAddUsers = async () => {
          try {
            const token = localStorage.getItem('aiquery_token')
            // Call verify endpoint to process the checkout session
            const verifyResponse = await axios.post(
              '/api/stripe/verify-checkout-session',
              { sessionId },
              { headers: { Authorization: `Bearer ${token}` } }
            )
            
            if (verifyResponse.data.success) {
              alert('Payment successful! User slots have been added to your subscription. Check Current Plan to see the updated limit.')
              setActiveNav('home')
              setActivePanel('currentPlan')
              loadWorkspaces()
            } else {
              alert('Payment successful, but there was an issue adding users. Please contact support.')
            }
          } catch (error: any) {
            console.error('Error verifying add users:', error)
            const errorMsg = error.response?.data?.error || error.message || 'Unknown error'
            alert(`Payment successful, but there was an issue: ${errorMsg}. Please contact support if this persists.`)
          }
        }
        
        verifyAddUsers()
      } else {
        // Regular subscription checkout
        const verifyCheckout = async () => {
          try {
            const token = localStorage.getItem('aiquery_token')
            const response = await axios.post(
              '/api/stripe/verify-checkout-session',
              { sessionId },
              { headers: { Authorization: `Bearer ${token}` } }
            )
            
            if (response.data.success) {
              alert('Payment successful! Your subscription has been activated.')
              setActiveNav('home')
              setActivePanel('currentPlan')
              // Reload workspaces to refresh subscription status
              loadWorkspaces()
            } else {
              alert('Payment successful, but there was an issue activating your subscription. Please contact support.')
            }
          } catch (error: any) {
            console.error('Error verifying checkout session:', error)
            const errorMsg = error.response?.data?.error || error.message || 'Unknown error'
            alert(`Payment successful, but subscription activation failed: ${errorMsg}. Please contact support if this persists.`)
          }
        }
        
        verifyCheckout()
      }
    }
  }, [searchParams, setSearchParams])

  const handleOpenCreation = () => {
    navigate('/app_admin/workspace_creation')
  }

  const loadWorkspaces = async () => {
    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.get('/api/workspaces', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.data.success) {
        const nextWorkspaces = response.data.workspaces || []
        setWorkspaces(nextWorkspaces)
        loadWorkspaceMembers(nextWorkspaces)
        const totalPages = Math.max(1, Math.ceil(nextWorkspaces.length / pageSize))
        if (currentPage > totalPages) {
          setCurrentPage(totalPages)
        }
      } else {
        setWorkspaces([])
      }
    } catch (error) {
      console.error('Error loading workspaces:', error)
      setWorkspaces([])
    }
  }

  const loadWorkspaceMembers = async (list: Array<{ id: number }>) => {
    try {
      const token = localStorage.getItem('aiquery_token')
      const results = await Promise.all(list.map(async (workspace) => {
        const response = await axios.get(`/api/workspaces/${workspace.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        if (response.data.success) {
          return { workspaceId: workspace.id, members: response.data.members || [] }
        }
        return { workspaceId: workspace.id, members: [] }
      }))

      const membersMap: Record<number, Array<{ id: number; name: string | null; email: string }>> = {}
      results.forEach((item) => {
        membersMap[item.workspaceId] = item.members
      })
      setWorkspaceMembers(membersMap)
    } catch (error) {
      console.error('Error loading workspace members:', error)
    }
  }

  const loadTeamMembers = async () => {
    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.get('/api/members', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.data.success) {
        setTeamMembers(response.data.members || [])
      } else {
        setTeamMembers([])
      }
    } catch (error) {
      console.error('Error loading team members:', error)
      setTeamMembers([])
    }
  }

  const handleOpenWorkspace = async (workspace: { id: number; name?: string }) => {
    try {
      const token = localStorage.getItem('aiquery_token')
      await axios.post(`/api/workspaces/${workspace.id}/activate`, null, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      localStorage.setItem('aiquery_active_workspace_id', workspace.id.toString())
      if (workspace.name) {
        localStorage.setItem('aiquery_active_workspace_name', workspace.name)
      }
      navigate('/app_admin/chat')
    } catch (error) {
      console.error('Error activating workspace:', error)
      alert('Failed to open workspace. Please try again.')
    }
  }

  const handleDeleteWorkspace = async (workspace: { id: number; name: string }) => {
    if (!confirm(`Delete workspace "${workspace.name}"? This cannot be undone.`)) {
      return
    }

    try {
      const token = localStorage.getItem('aiquery_token')
      await axios.delete(`/api/workspaces/${workspace.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      await loadWorkspaces()
    } catch (error) {
      console.error('Error deleting workspace:', error)
      alert('Failed to delete workspace.')
    }
  }

  const handleEditWorkspace = async (workspace: { id: number; name: string }) => {
    const workspaceDetails = workspaces.find((item) => item.id === workspace.id) || workspace
    setEditingWorkspace(workspaceDetails)
    setEditName(workspaceDetails.name)
    setEditDescription(workspaceDetails.description || '')
    await loadTeamMembers()
    const existingMembers = workspaceMembers[workspace.id] || []
    const selected = existingMembers.map((member) => member.id)
    setSelectedMemberIds(selected)
    const nextRoles: Record<number, 'admin' | 'view'> = {}
    existingMembers.forEach((member) => {
      const role = (member.role || '').toLowerCase()
      nextRoles[member.id] = role === 'admin' ? 'admin' : 'view'
    })
    setMemberRoles(nextRoles)
    setShowEditModal(true)
  }

  const handleSaveEdit = async () => {
    if (!editingWorkspace) return
    if (!editName.trim()) {
      alert('Workspace name is required.')
      return
    }

    try {
      const token = localStorage.getItem('aiquery_token')
      const nextMemberRoles = selectedMemberIds.reduce<Record<number, 'admin' | 'view'>>((acc, id) => {
        acc[id] = memberRoles[id] || 'view'
        return acc
      }, {})
      await axios.put(`/api/workspaces/${editingWorkspace.id}`, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        memberIds: selectedMemberIds,
        memberRoles: nextMemberRoles
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      setShowEditModal(false)
      setEditingWorkspace(null)
      await loadWorkspaces()
    } catch (error) {
      console.error('Error updating workspace:', error)
      alert('Failed to update workspace.')
    }
  }

  const handleToggleMember = (userId: number) => {
    setSelectedMemberIds((prev) => (
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    ))
    setMemberRoles((prev) => ({
      ...prev,
      [userId]: prev[userId] || 'view'
    }))
  }

  const handleRoleChange = (userId: number, role: 'admin' | 'view') => {
    setMemberRoles((prev) => ({
      ...prev,
      [userId]: role
    }))
  }

  const formatDate = (value?: string) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString()
  }

  const totalPages = Math.max(1, Math.ceil(workspaces.length / pageSize))
  const pagedWorkspaces = workspaces.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const sharedWorkspaces = workspaces.filter((workspace) => (workspaceMembers[workspace.id] || []).length > 0)
  const formatRoleLabel = (role?: string) => {
    if (!role) return 'Viewer'
    const normalized = role.toLowerCase()
    if (normalized === 'admin') return 'Admin'
    return 'Viewer'
  }
  const formatListSummary = (items: string[], maxVisible = 2) => {
    if (items.length === 0) return '-'
    if (items.length <= maxVisible) return items.join(', ')
    return `${items.slice(0, maxVisible).join(', ')} +${items.length - maxVisible}`
  }

  return (
    <div className="workspace-admin-page">
      <header className="workspace-topcard">
        <div className="workspace-topcard-left">
          <button
            className="workspace-collapse-button"
            onClick={() => setIsSidebarCollapsed((prev) => !prev)}
            aria-label="Collapse sidebar"
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <Logo imageSrc="/images/aiquery_logo7.png" imageOnly />
        </div>
        <div className="workspace-search">
          <span className="workspace-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <input
            className="workspace-search-input"
            placeholder="Search workspace"
          />
        </div>
        <div className="workspace-topcard-actions">
          <NotificationsDropdown variant="header" triggerClassName="workspace-icon-button" />
          <HelpDropdown variant="header" triggerClassName="workspace-icon-button" />
          <UserMenu onOpenSettings={() => undefined} />
        </div>
      </header>

      <div className="workspace-body">
        <aside className={`workspace-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="workspace-sidebar-section">
            <div
              className={`workspace-sidebar-item ${activeNav === 'home' ? 'active' : ''}`}
              onClick={() => {
                setActiveNav('home')
                setActivePanel(null)
              }}
              title="Home"
            >
              <div className="workspace-sidebar-item-main">
                <span className="workspace-sidebar-icon workspace-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 11.5L12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                </span>
                {!isSidebarCollapsed && <span>Home</span>}
              </div>
            </div>
            <div
              className={`workspace-sidebar-item ${activeNav === 'shared' ? 'active' : ''}`}
              onClick={() => {
                setActiveNav('shared')
                setActivePanel(null)
              }}
              title="Shared"
            >
              <div className="workspace-sidebar-item-main">
                <span className="workspace-sidebar-icon workspace-icon">
                  <img src="/images/shared.png" alt="Shared" className="workspace-sidebar-icon-img" />
                </span>
                {!isSidebarCollapsed && <span>Shared</span>}
              </div>
            </div>
            <div
              className={`workspace-sidebar-item workspace-sidebar-item-workspace ${activeNav === 'workspace' ? 'active' : ''}`}
              onClick={() => {
                setActiveNav('workspace')
                setActivePanel(null)
              }}
              title="Workspace"
            >
              <div className="workspace-sidebar-item-main">
                <span className="workspace-sidebar-icon workspace-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <rect x="3" y="6" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </span>
                {!isSidebarCollapsed && <span>Workspace</span>}
              </div>
              {!isSidebarCollapsed && (
                <div className="workspace-sidebar-item-actions">
                  <a
                    className="workspace-inline-button"
                    href="/app_admin/workspace_creation"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      handleOpenCreation()
                    }}
                    title="Create workspace"
                  >
                    <span className="workspace-icon">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </span>
                  </a>
                  <button
                    className="workspace-inline-button"
                    aria-label="Toggle workspaces"
                    title="Show workspaces"
                    onClick={(event) => {
                      event.stopPropagation()
                      setActiveNav('workspace')
                      setActivePanel(null)
                      setWorkspaceView('list')
                    }}
                  >
                    <span className="workspace-icon">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="workspace-sidebar-divider"></div>

          {user?.isSiteAdmin && (
            <div className="workspace-sidebar-section">
              <a
                className="workspace-plan-link"
                href="/admin"
                onClick={(e) => {
                  e.preventDefault()
                  navigate('/admin')
                }}
                title="Admin Dashboard"
              >
                <span className="workspace-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {!isSidebarCollapsed && <span>Admin</span>}
              </a>
            </div>
          )}

          <div className="workspace-sidebar-divider"></div>

          <div className="workspace-sidebar-section">
            <button
              className="workspace-plan-link"
              onClick={() => setActivePanel('currentPlan')}
              title="Current Plan"
            >
              <span className="workspace-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M3 10h18" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </span>
              {!isSidebarCollapsed && <span>Current Plan</span>}
            </button>
            <button
              className="workspace-plan-link"
              onClick={() => setActivePanel('usage')}
              title="Usage"
            >
              <span className="workspace-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 19h16M7 16V9M12 16V5M17 16v-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
              {!isSidebarCollapsed && <span>Usage</span>}
            </button>
            <button
              className="workspace-plan-link"
              onClick={() => setActivePanel('upgrade')}
              title="Upgrade Plan"
            >
              <span className="workspace-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M6.5 10.5L12 5l5.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              {!isSidebarCollapsed && <span>Upgrade Plan</span>}
            </button>
            <button
              className="workspace-plan-link"
              onClick={() => setActivePanel('addMembers')}
              title="Add Users"
            >
              <span className="workspace-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M19 8v6M22 11h-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              {!isSidebarCollapsed && <span>Add Users</span>}
            </button>
          </div>

          <div className="workspace-sidebar-divider"></div>

          <div className="workspace-sidebar-section">
            <button
              className="workspace-plan-link"
              onClick={() => setActivePanel('members')}
              title="Members"
            >
              <span className="workspace-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 14a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3.5 20a4.5 4.5 0 0 1 9 0M11.5 20a4.5 4.5 0 0 1 9 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
              {!isSidebarCollapsed && <span>Members</span>}
            </button>
          </div>

          <div className="workspace-sidebar-footer">
            <a
              className="workspace-create-button"
              href="/app_admin/workspace_creation"
              onClick={(event) => {
                event.preventDefault()
                handleOpenCreation()
              }}
              title="Create workspace"
            >
              <span className="workspace-create-icon" aria-hidden="true">
                +
              </span>
              {!isSidebarCollapsed && 'Create'}
            </a>
          </div>
        </aside>

        <main className="workspace-main">
          <div className="workspace-content">
            {activePanel === 'currentPlan' && (
              <div className="workspace-inline-panel">
                <CurrentPlanModal onClose={() => setActivePanel(null)} inline />
              </div>
            )}
            {activePanel === 'usage' && (
              <div className="workspace-inline-panel">
                <UsageModal onClose={() => setActivePanel(null)} inline />
              </div>
            )}
            {activePanel === 'upgrade' && (
              <div className="workspace-inline-panel">
                <UpgradePlanModal onClose={() => setActivePanel(null)} inline />
              </div>
            )}
            {activePanel === 'addMembers' && (
              <div className="workspace-inline-panel">
                <AddMembersPanel onClose={() => setActivePanel(null)} />
              </div>
            )}
            {activePanel === 'members' && (
              <div className="workspace-inline-panel">
                <Members inline />
              </div>
            )}

            {!activePanel && activeNav === 'home' ? (
              <div className="workspace-main-grid">
                {showUpgradeCard && (
                  <section className="workspace-section workspace-upgrade-section">
                    <div className="workspace-section-header">
                      <span>Upgrade Plan</span>
                      <button
                        className="workspace-section-close"
                        onClick={() => setShowUpgradeCard(false)}
                        aria-label="Close"
                        title="Close"
                      >
                        ×
                      </button>
                    </div>
                    <p className="workspace-upgrade-text">
                      Unlock more data sources, larger Knowledge Bases, and higher usage limits.
                    </p>
                    <div className="workspace-upgrade-actions">
                      <button
                        className="workspace-upgrade-button primary"
                        onClick={() => setActivePanel('upgrade')}
                        title="Upgrade Plan"
                      >
                        Upgrade Plan
                      </button>
                      <button
                        className="workspace-upgrade-button"
                        onClick={() => setActivePanel('currentPlan')}
                        title="Current Plan"
                      >
                        Current Plan
                      </button>
                    </div>
                  </section>
                )}

                <section className="workspace-section workspace-list-section">
                  <div className="workspace-section-header">
                    <span>Workspaces</span>
                    <div className="workspace-view-toggle">
                      <button
                        className={`workspace-icon-button ${workspaceView === 'list' ? 'active' : ''}`}
                        onClick={() => setWorkspaceView('list')}
                        title="List view"
                      >
                        <span className="workspace-icon">
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M8 7h11M8 12h11M8 17h11M5 7h.01M5 12h.01M5 17h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        </span>
                      </button>
                      <button
                        className={`workspace-icon-button ${workspaceView === 'grid' ? 'active' : ''}`}
                        onClick={() => setWorkspaceView('grid')}
                        title="Grid view"
                      >
                        <span className="workspace-icon">
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                            <rect x="13" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                            <rect x="4" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                            <rect x="13" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        </span>
                      </button>
                    </div>
                  </div>
                  {workspaces.length === 0 ? (
                    <div className="workspace-empty-state">
                      Create a new workspace to get started.
                    </div>
                  ) : workspaceView === 'grid' ? (
                    <div className="workspace-list grid">
                      {pagedWorkspaces.map((workspace) => (
                        <div key={workspace.id} className="workspace-card">
                          <a
                            className="workspace-card-link"
                            href="/app_admin/chat"
                            onClick={(event) => {
                              event.preventDefault()
                              handleOpenWorkspace(workspace)
                            }}
                            title={`Open ${workspace.name}`}
                          >
                            <div className="workspace-card-title">{workspace.name}</div>
                            <div className="workspace-card-meta">
                              <span>Created {formatDate(workspace.createdAt)}</span>
                            </div>
                            <div className="workspace-card-description">
                              {workspace.description || 'Workspace configuration'}
                            </div>
                            <div className="workspace-card-members">
                              {(workspaceMembers[workspace.id] || []).length > 0 ? (
                                (workspaceMembers[workspace.id] || []).map((member) => (
                                  <span key={member.id} className="workspace-member-chip">
                                    {member.name || member.email}
                                  </span>
                                ))
                              ) : (
                                <span className="workspace-member-empty">No shared members</span>
                              )}
                            </div>
                          </a>
                          <div className="workspace-card-actions">
                            <a
                              className="workspace-card-action primary"
                              href="/app_admin/chat"
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                handleOpenWorkspace(workspace)
                              }}
                              title="Open chatbot"
                            >
                              Chatbot
                            </a>
                            <button
                              className="workspace-card-action"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleEditWorkspace(workspace)
                              }}
                              title="Edit workspace"
                            >
                              Edit
                            </button>
                            <button
                              className="workspace-card-action danger"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleDeleteWorkspace(workspace)
                              }}
                              title="Delete workspace"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="workspace-table-wrapper">
                      <table className="workspace-table">
                        <thead>
                          <tr>
                            <th>Workspace Name</th>
                            <th>Creation Time</th>
                            <th>Members</th>
                            <th>Role</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedWorkspaces.map((workspace) => {
                            const members = workspaceMembers[workspace.id] || []
                            return (
                              <tr key={workspace.id}>
                                <td>{workspace.name}</td>
                                <td>{formatDate(workspace.createdAt)}</td>
                                <td>
                                  {members.length > 0
                                    ? members.map((member) => member.name || member.email).join(', ')
                                    : '-'}
                                </td>
                                <td>
                                  {members.length > 0
                                    ? members.map((member) => formatRoleLabel(member.role)).join(', ')
                                    : '-'}
                                </td>
                                <td className="workspace-table-actions">
                                  <a
                                    className="workspace-card-action primary"
                                    href="/app_admin/chat"
                                    onClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      handleOpenWorkspace(workspace)
                                    }}
                                    title="Open chatbot"
                                  >
                                    Chatbot
                                  </a>
                                  <button
                                    className="workspace-card-action"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      handleEditWorkspace(workspace)
                                    }}
                                    title="Edit workspace"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="workspace-card-action danger"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      handleDeleteWorkspace(workspace)
                                    }}
                                    title="Delete workspace"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {workspaces.length > pageSize && (
                    <div className="workspace-pagination">
                      <button
                        className="workspace-card-action"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                        title="Previous page"
                      >
                        Previous
                      </button>
                      <span className="workspace-pagination-info">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        className="workspace-card-action"
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                        title="Next page"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </section>
              </div>
            ) : !activePanel && activeNav === 'shared' ? (
              <section className="workspace-section workspace-shared-section">
                <div className="workspace-section-header">
                  <span>Shared Workspaces</span>
                </div>
                <div className="workspace-shared-table-wrapper">
                  <table className="workspace-shared-table">
                    <thead>
                      <tr>
                        <th>Workspace Name</th>
                        <th>Members</th>
                        <th>Role</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sharedWorkspaces.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="workspace-shared-empty">
                            No shared workspaces yet.
                          </td>
                        </tr>
                      ) : (
                        sharedWorkspaces.map((workspace) => {
                          const members = workspaceMembers[workspace.id] || []
                          return (
                            <tr key={workspace.id}>
                              <td>{workspace.name}</td>
                              <td>
                                {formatListSummary(
                                  members.map((member) => member.name || member.email)
                                )}
                              </td>
                              <td>
                                {formatListSummary(
                                  members.map((member) => formatRoleLabel(member.role))
                                )}
                              </td>
                              <td className="workspace-shared-action-cell">
                                <button
                                  className="workspace-card-action"
                                  onClick={() => handleEditWorkspace(workspace)}
                                  title="Add member"
                                >
                                  Add Member
                                </button>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : !activePanel && activeNav === 'workspace' ? (
              <section className="workspace-section workspace-list-section">
                <div className="workspace-section-header">
                  <span>Workspaces</span>
                </div>
                {workspaces.length === 0 ? (
                  <div className="workspace-empty-state">
                    Create a new workspace to get started.
                  </div>
                ) : (
                  <div className="workspace-table-wrapper">
                    <table className="workspace-table">
                      <thead>
                        <tr>
                          <th>Workspace Name</th>
                          <th>Creation Time</th>
                          <th>Members</th>
                          <th>Role</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedWorkspaces.map((workspace) => {
                          const members = workspaceMembers[workspace.id] || []
                          return (
                            <tr key={workspace.id}>
                              <td>{workspace.name}</td>
                              <td>{formatDate(workspace.createdAt)}</td>
                              <td>
                                {formatListSummary(
                                  members.map((member) => member.name || member.email)
                                )}
                              </td>
                              <td>
                                {formatListSummary(
                                  members.map((member) => formatRoleLabel(member.role))
                                )}
                              </td>
                              <td className="workspace-table-actions">
                                <a
                                  className="workspace-card-action primary"
                                  href="/app_admin/chat"
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    handleOpenWorkspace(workspace)
                                  }}
                                  title="Open chatbot"
                                >
                                  Chatbot
                                </a>
                                <button
                                  className="workspace-card-action"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleEditWorkspace(workspace)
                                  }}
                                  title="Edit workspace"
                                >
                                  Edit
                                </button>
                                <button
                                  className="workspace-card-action danger"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleDeleteWorkspace(workspace)
                                  }}
                                  title="Delete workspace"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {workspaces.length > pageSize && (
                  <div className="workspace-pagination">
                    <button
                      className="workspace-card-action"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                      title="Previous page"
                    >
                      Previous
                    </button>
                    <span className="workspace-pagination-info">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      className="workspace-card-action"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                      title="Next page"
                    >
                      Next
                    </button>
                  </div>
                )}
              </section>
            ) : (
              <div className="workspace-empty-state">
                Select Home to view your workspace overview.
              </div>
            )}
          </div>
        </main>
      </div>

      {showEditModal && editingWorkspace && (
        <div className="workspace-edit-modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="workspace-edit-modal" onClick={(event) => event.stopPropagation()}>
            <div className="workspace-edit-modal-header">
              <h3>Edit Workspace</h3>
              <button
                className="workspace-edit-close"
                onClick={() => setShowEditModal(false)}
                aria-label="Close"
                title="Close"
              >
                ×
              </button>
            </div>
            <div className="workspace-edit-modal-body">
              <label className="workspace-edit-label">Workspace Name</label>
              <input
                className="workspace-edit-input"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="Workspace name"
              />
              <label className="workspace-edit-label">Description</label>
              <textarea
                className="workspace-edit-textarea"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                placeholder="Add a short description"
              />
              {(editingWorkspace?.ownerName || editingWorkspace?.ownerEmail) && (
                <div className="workspace-edit-meta">
                  Created by {editingWorkspace.ownerName || editingWorkspace.ownerEmail}
                </div>
              )}
              {editingWorkspace?.createdAt && (
                <div className="workspace-edit-meta">
                  Created {formatDate(editingWorkspace.createdAt)}
                </div>
              )}
              <label className="workspace-edit-label">Shared Members</label>
              <div className="workspace-edit-members">
                {teamMembers.map((member) => (
                  <label key={member.userId} className="workspace-edit-member">
                    <input
                      type="checkbox"
                      checked={selectedMemberIds.includes(member.userId)}
                      onChange={() => handleToggleMember(member.userId)}
                    />
                    <span>{member.name || member.email}</span>
                    <select
                      className="workspace-edit-role"
                      value={memberRoles[member.userId] || 'view'}
                      onChange={(event) => handleRoleChange(member.userId, event.target.value as 'admin' | 'view')}
                      disabled={!selectedMemberIds.includes(member.userId)}
                      title="Member role"
                    >
                      <option value="admin">Admin</option>
                      <option value="view">View</option>
                    </select>
                  </label>
                ))}
              </div>
            </div>
            <div className="workspace-edit-modal-actions">
              <a
                className="workspace-card-action"
                href={`/app_admin/workspace_creation?workspaceId=${editingWorkspace.id}`}
                title="Edit workspace configuration"
              >
                Edit Configuration
              </a>
              <button className="workspace-card-action" onClick={() => setShowEditModal(false)} title="Cancel">
                Cancel
              </button>
              <button className="workspace-card-action primary" onClick={handleSaveEdit} title="Save changes">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default WorkspaceAdminPage

