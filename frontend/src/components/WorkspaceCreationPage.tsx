import React, { useState, useEffect } from 'react'
import axios from 'axios'
import DataSourceSidebar from './DataSourceSidebar'
import Logo from './Logo'
import UserMenu from './UserMenu'
import HelpDropdown from './HelpDropdown'
import LLMConfig from './LLMConfig'
import ThirdPartyConnections from './ThirdPartyConnections'
import { useAuth } from '../contexts/AuthContext'
import { useSearchParams } from 'react-router-dom'
import './WorkspaceCreationPage.css'

type ConnectionStatus = 'connected' | 'failed' | 'untested'

interface TeamMember {
  id: number
  userId: number
  email: string
  name: string | null
  role: 'admin' | 'view'
}

interface WorkspaceRecord {
  id: number
  name: string
  description?: string | null
  createdAt: string
  updatedAt: string
}

const ACTIVE_WORKSPACE_KEY = 'aiquery_active_workspace_id'

const WorkspaceCreationPage: React.FC = () => {
  const { isAuthenticated } = useAuth()
  const [searchParams] = useSearchParams()
  const [workspaceName, setWorkspaceName] = useState('Untitled Workspace')
  const [nameTouched, setNameTouched] = useState(false)
  const [activeSection, setActiveSection] = useState<'data' | 'llm' | 'community'>('data')
  const [hasSelectedSource, setHasSelectedSource] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([])
  const [memberRoles, setMemberRoles] = useState<Record<number, 'admin' | 'view'>>({})
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'view'>('view')
  const [inviteStatus, setInviteStatus] = useState<string | null>(null)
  const [shareSaving, setShareSaving] = useState(false)
  const [shareOpening, setShareOpening] = useState(false)
  const [showLaunchConfirm, setShowLaunchConfirm] = useState(false)
  const [savedWorkspaceId, setSavedWorkspaceId] = useState<string | null>(null)
  const [llmSummary, setLlmSummary] = useState<{
    providerLabel: string
    status: ConnectionStatus
    loading: boolean
  }>({
    providerLabel: 'OpenAI',
    status: 'untested',
    loading: true
  })
  const [communitySummary, setCommunitySummary] = useState<{
    slackConnected: boolean
    teamsConnected: boolean
    loading: boolean
  }>({
    slackConnected: false,
    teamsConnected: false,
    loading: true
  })

  useEffect(() => {
    loadLlmSummary()
    loadCommunitySummary()
  }, [isAuthenticated])

  useEffect(() => {
    const targetWorkspaceId = searchParams.get('workspaceId')
    if (!isAuthenticated || !targetWorkspaceId) return

    setSavedWorkspaceId(targetWorkspaceId)
    const token = localStorage.getItem('aiquery_token')
    axios.get(`/api/workspaces/${targetWorkspaceId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then((response) => {
      if (response.data.success && response.data.workspace?.name && !nameTouched) {
        setWorkspaceName(response.data.workspace.name)
      }
    }).catch((error) => {
      console.error('Error loading workspace name:', error)
    })
  }, [isAuthenticated, searchParams, nameTouched])

  useEffect(() => {
    if (showShareModal) {
      loadMembers()
      loadWorkspaceMembers()
    }
  }, [showShareModal, isAuthenticated])

  const getUserScopedKey = (key: string) => {
    const currentUserId = localStorage.getItem('aiquery_current_user_id')
    return currentUserId ? `${key}_${currentUserId}` : key
  }

  const loadMembers = async () => {
    if (!isAuthenticated) {
      setMembers([])
      return
    }

    setMembersLoading(true)
    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.get('/api/members', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.data.success) {
        setMembers(response.data.members || [])
      } else {
        setMembers([])
      }
    } catch (error) {
      console.error('Error loading members:', error)
      setMembers([])
    } finally {
      setMembersLoading(false)
    }
  }

  const loadWorkspaceMembers = async () => {
    if (!isAuthenticated || !savedWorkspaceId) return
    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.get(`/api/workspaces/${savedWorkspaceId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.data.success && Array.isArray(response.data.members)) {
        const memberIds = response.data.members.map((member: { id: number }) => member.id)
        setSelectedMemberIds(memberIds)
        const roles: Record<number, 'admin' | 'view'> = {}
        response.data.members.forEach((member: { id: number; role?: string }) => {
          roles[member.id] = member.role === 'admin' ? 'admin' : 'view'
        })
        setMemberRoles(roles)
      }
    } catch (error) {
      console.error('Error loading workspace members:', error)
    }
  }

  const loadLlmSummary = async () => {
    const currentUserId = localStorage.getItem('aiquery_current_user_id')
    const statusKey = (provider: 'openai' | 'gemini' | 'anthropic') =>
      currentUserId
        ? `aiquery_llm_connection_status_${provider}_${currentUserId}`
        : `aiquery_llm_connection_status_${provider}`
    const localStatus = (provider: 'openai' | 'gemini' | 'anthropic') => {
      const s = localStorage.getItem(statusKey(provider))
      return s === 'connected' || s === 'failed' || s === 'untested' ? s : 'untested'
    }

    const fallbackProvider =
      (localStorage.getItem(getUserScopedKey('aiquery_llm_provider')) as
        | 'openai'
        | 'gemini'
        | 'anthropic') || 'openai'
    const fallbackProviderLabel =
      fallbackProvider === 'gemini'
        ? 'Gemini'
        : fallbackProvider === 'anthropic'
          ? 'Anthropic'
          : 'OpenAI'

    if (!isAuthenticated) {
      setLlmSummary({
        providerLabel: fallbackProviderLabel,
        status: 'untested',
        loading: false
      })
      return
    }

    setLlmSummary((prev) => ({ ...prev, loading: true }))

    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.get('/api/settings/llm', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.data.success) {
        const responseProvider = (response.data.provider as 'openai' | 'gemini' | 'anthropic') || 'openai'
        const hasOpenaiKey = response.data.hasOpenaiKey === true || !!localStorage.getItem(getUserScopedKey('aiquery_openai_api_key'))
        const hasGeminiKey = response.data.hasGeminiKey === true || !!localStorage.getItem(getUserScopedKey('aiquery_gemini_api_key'))
        const hasAnthropicKey = response.data.hasAnthropicKey === true || !!localStorage.getItem(getUserScopedKey('aiquery_anthropic_api_key'))

        const hasKeyForProvider = (p: 'openai' | 'gemini' | 'anthropic') =>
          p === 'openai' ? hasOpenaiKey : p === 'gemini' ? hasGeminiKey : hasAnthropicKey

        let provider: 'openai' | 'gemini' | 'anthropic' = responseProvider
        if (!hasKeyForProvider(responseProvider)) {
          if (hasAnthropicKey) provider = 'anthropic'
          else if (hasGeminiKey) provider = 'gemini'
          else if (hasOpenaiKey) provider = 'openai'
          else provider = fallbackProvider
        }

        const providerLabel =
          provider === 'gemini' ? 'Gemini' : provider === 'anthropic' ? 'Anthropic' : 'OpenAI'
        const hasKey = hasKeyForProvider(provider)
        const connectionStatus = (response.data.connectionStatus as ConnectionStatus) || 'untested'
        const fromBackendConnected = connectionStatus === 'connected' && hasKey && provider === responseProvider
        const fromLocalConnected = hasKey && localStatus(provider) === 'connected'
        const status = fromBackendConnected || fromLocalConnected ? 'connected' : 'untested'

        setLlmSummary({
          providerLabel,
          status,
          loading: false
        })
        return
      }
    } catch (error) {
      console.error('Error loading LLM summary:', error)
    }

    setLlmSummary({
      providerLabel: fallbackProviderLabel,
      status: 'untested',
      loading: false
    })
  }

  const loadCommunitySummary = async () => {
    if (!isAuthenticated) {
      setCommunitySummary({
        slackConnected: false,
        teamsConnected: false,
        loading: false
      })
      return
    }

    setCommunitySummary((prev) => ({ ...prev, loading: true }))

    try {
      const token = localStorage.getItem('aiquery_token')
      const [slackResponse, teamsResponse] = await Promise.all([
        axios.get('/api/third-party/slack', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }).catch(() => ({ data: { success: false } })),
        axios.get('/api/third-party/teams', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }).catch(() => ({ data: { success: false } }))
      ])

      const slackConfig = slackResponse.data?.config
      const teamsConfig = teamsResponse.data?.config

      setCommunitySummary({
        slackConnected: !!(slackResponse.data?.success && slackConfig?.apiToken && slackConfig?.verificationToken && slackConfig?.signingSecret),
        teamsConnected: !!(teamsResponse.data?.success && teamsConfig?.appId && teamsConfig?.clientSecret),
        loading: false
      })
    } catch (error) {
      console.error('Error loading community summary:', error)
      setCommunitySummary({
        slackConnected: false,
        teamsConnected: false,
        loading: false
      })
    }
  }

  const saveWorkspace = async (includeConfig: boolean) => {
    const trimmedName = workspaceName.trim()
    if (!trimmedName) {
      alert('Please enter a workspace name.')
      return null
    }

    if (!isAuthenticated) {
      alert('Please log in to save workspaces.')
      return null
    }

    try {
      const token = localStorage.getItem('aiquery_token')
      const payload = {
        name: trimmedName,
        memberIds: selectedMemberIds,
        includeConfig
      }
      const response = savedWorkspaceId
        ? await axios.put(`/api/workspaces/${savedWorkspaceId}`, payload, {
            headers: { 'Authorization': `Bearer ${token}` }
          })
        : await axios.post('/api/workspaces', payload, {
            headers: { 'Authorization': `Bearer ${token}` }
          })

      if (!response.data.success || !response.data.workspace) {
        throw new Error('Workspace save failed')
      }

      const workspace: WorkspaceRecord = response.data.workspace
      setSavedWorkspaceId(workspace.id.toString())
      return workspace
    } catch (error) {
      console.error('Error saving workspace:', error)
      alert('Failed to save workspace. Please try again.')
      return null
    }
  }

  const handleSaveWorkspace = async () => {
    const workspace = await saveWorkspace(false)
    if (workspace) {
      alert('Workspace saved.')
    }
  }

  const handleSaveSharing = async () => {
    if (!savedWorkspaceId) return
    setShareSaving(true)
    try {
      const token = localStorage.getItem('aiquery_token')
      const rolesPayload = selectedMemberIds.reduce<Record<number, 'admin' | 'view'>>((acc, id) => {
        acc[id] = memberRoles[id] || 'view'
        return acc
      }, {})
      await axios.put(`/api/workspaces/${savedWorkspaceId}`, {
        memberIds: selectedMemberIds,
        memberRoles: rolesPayload
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      setShowShareModal(false)
    } catch (error) {
      console.error('Error saving workspace members:', error)
      alert('Failed to share workspace. Please try again.')
    } finally {
      setShareSaving(false)
    }
  }

  const handleInviteMember = async () => {
    const email = inviteEmail.trim()
    if (!email || !email.includes('@')) {
      setInviteStatus('Please enter a valid email address.')
      return
    }
    setInviteStatus(null)
    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.post('/api/members/invite', {
        email,
        role: inviteRole
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.data.success) {
        const invitedId = response.data.userId
        if (invitedId) {
          setSelectedMemberIds((prev) => (prev.includes(invitedId) ? prev : [...prev, invitedId]))
          setMemberRoles((prev) => ({ ...prev, [invitedId]: inviteRole }))
        }
        setInviteEmail('')
        setInviteStatus('Invite sent.')
        loadMembers()
      } else {
        setInviteStatus(response.data.error || 'Invite failed.')
      }
    } catch (error: any) {
      const message = error?.response?.data?.error || error?.response?.data?.message || 'Invite failed.'
      setInviteStatus(message)
    }
  }

  const handleLaunchWorkspace = async () => {
    const workspace = await saveWorkspace(true)
    if (!workspace) return

    try {
      const token = localStorage.getItem('aiquery_token')
      await axios.post(`/api/workspaces/${workspace.id}/activate`, null, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspace.id.toString())
      alert('Workspace launched.')
      window.location.href = '/app_admin/chat'
    } catch (error) {
      console.error('Error activating workspace:', error)
      alert('Workspace saved, but activation failed.')
    }
  }

  const handleConfirmLaunch = async () => {
    setShowLaunchConfirm(false)
    await handleLaunchWorkspace()
  }

  const handleToggleMember = (userId: number) => {
    setSelectedMemberIds((prev) => (
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    ))
  }

  const handleRoleChange = (userId: number, role: 'admin' | 'view') => {
    setMemberRoles((prev) => ({ ...prev, [userId]: role }))
    setSelectedMemberIds((prev) => (
      prev.includes(userId) ? prev : [...prev, userId]
    ))
  }

  const handleOpenShare = async () => {
    if (!isAuthenticated) {
      alert('Please log in to share this workspace.')
      return
    }
    setShareOpening(true)
    try {
      if (!savedWorkspaceId) {
        const workspace = await saveWorkspace(false)
        if (!workspace) {
          return
        }
      }
      setShowShareModal(true)
    } finally {
      setShareOpening(false)
    }
  }

  return (
    <div className="workspace-creation-page">
      <header className="workspace-creation-topbar">
        <Logo imageSrc="/images/aiquery_logo7.png" imageOnly />
        <div className="workspace-creation-name">
          <input
            className="workspace-creation-input"
            value={workspaceName}
            onChange={(event) => {
              setWorkspaceName(event.target.value)
              setNameTouched(true)
            }}
            placeholder="Untitled Workspace"
          />
          <button className="workspace-creation-button primary" onClick={handleSaveWorkspace}>
            Save
          </button>
        </div>
        <div className="workspace-creation-actions">
          <HelpDropdown variant="header" triggerClassName="workspace-creation-help-button" />
          <button
            className="workspace-creation-button"
            onClick={handleOpenShare}
            disabled={shareOpening}
          >
            {shareOpening ? 'Saving...' : 'Share'}
          </button>
          <button className="workspace-creation-button primary" onClick={() => setShowLaunchConfirm(true)}>
            Launch
          </button>
        </div>
        <UserMenu onOpenSettings={() => undefined} />
      </header>

      <div className="workspace-creation-body">
        <aside className="workspace-creation-sidebar">
          <div className="workspace-creation-sidebar-section">
            <DataSourceSidebar
              mode="panel"
              compact
              panelMode="inline"
              panelTargetId="workspace-creation-panels"
              panelVisible={activeSection === 'data'}
              showMembersSection={false}
              showPlanSection={false}
              showChatHistorySection={false}
              onDataSourceSelect={() => {
                setActiveSection('data')
                setHasSelectedSource(true)
              }}
            />
          </div>

          <div className="workspace-creation-sidebar-bottom">
            <button
              className={`workspace-creation-sidebar-item chat-style ${activeSection === 'llm' ? 'active' : ''}`}
              onClick={() => setActiveSection('llm')}
            >
              <img
                className="workspace-creation-sidebar-icon chat-style"
                src="/images/llm_logo.png"
                alt=""
                aria-hidden="true"
              />
              <div className="workspace-creation-sidebar-text">
                <span className="workspace-creation-sidebar-title">LLM Configuration</span>
                <div className="workspace-creation-sidebar-subline">
                  {llmSummary.loading ? (
                    <span className="workspace-creation-sidebar-subitem muted">Loading...</span>
                  ) : (
                    <>
                      <span className="workspace-creation-sidebar-subitem-name">{llmSummary.providerLabel}</span>
                      <span
                        className={`workspace-creation-sidebar-subitem-status ${llmSummary.status === 'connected' ? 'connected' : 'not-connected'}`}
                      >
                        {llmSummary.status === 'connected' ? 'Connected' : 'Not Connected'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </button>
            <button
              className={`workspace-creation-sidebar-item chat-style ${activeSection === 'community' ? 'active' : ''}`}
              onClick={() => setActiveSection('community')}
            >
              <img
                className="workspace-creation-sidebar-icon chat-style"
                src="/images/channel_logo.png"
                alt=""
                aria-hidden="true"
              />
              <div className="workspace-creation-sidebar-text">
                <span className="workspace-creation-sidebar-title">Community Channels</span>
                <div className="workspace-creation-sidebar-sublist">
                  {communitySummary.loading ? (
                    <span className="workspace-creation-sidebar-subitem muted">Loading...</span>
                  ) : (communitySummary.slackConnected || communitySummary.teamsConnected) ? (
                    <>
                      {communitySummary.slackConnected && (
                        <div className="workspace-creation-sidebar-subitem">
                          <span className="workspace-creation-sidebar-subitem-name">Slack</span>
                          <span className="workspace-creation-sidebar-subitem-status connected">Connected</span>
                        </div>
                      )}
                      {communitySummary.teamsConnected && (
                        <div className="workspace-creation-sidebar-subitem">
                          <span className="workspace-creation-sidebar-subitem-name">Microsoft Teams</span>
                          <span className="workspace-creation-sidebar-subitem-status connected">Connected</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="workspace-creation-sidebar-subitem">
                      <span className="workspace-creation-sidebar-subitem-name">Not Connected</span>
                    </div>
                  )}
                </div>
              </div>
            </button>
          </div>
        </aside>
        <main className="workspace-creation-main">
          <div className="workspace-creation-panels" id="workspace-creation-panels">
            {activeSection === 'llm' && (
              <LLMConfig inline isOpen onClose={() => setActiveSection('data')} />
            )}
            {activeSection === 'community' && (
              <ThirdPartyConnections inline isOpen onClose={() => setActiveSection('data')} />
            )}
            {activeSection === 'data' && !hasSelectedSource && (
              <div className="workspace-creation-placeholder">
                Select a data source from the sidebar to configure Connection and RAG.
              </div>
            )}
          </div>
        </main>
      </div>

      {showShareModal && (
        <div className="workspace-share-modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="workspace-share-modal" onClick={(event) => event.stopPropagation()}>
            <div className="workspace-share-modal-header">
              <h3>Share workspace</h3>
              <button
                className="workspace-share-close"
                onClick={() => setShowShareModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="workspace-share-modal-body">
              <div className="workspace-share-invite">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="Invite by email"
                  className="workspace-share-invite-input"
                />
                <select
                  className="workspace-share-role-select"
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as 'admin' | 'view')}
                >
                  <option value="admin">Admin</option>
                  <option value="view">View</option>
                </select>
                <button className="workspace-creation-button" onClick={handleInviteMember}>
                  Invite
                </button>
              </div>
              {inviteStatus && (
                <div className="workspace-share-status">{inviteStatus}</div>
              )}
              {membersLoading ? (
                <div className="workspace-share-empty">Loading team members...</div>
              ) : members.length === 0 ? (
                <div className="workspace-share-empty">No team members found.</div>
              ) : (
                <div className="workspace-share-list">
                  {members.map((member) => (
                    <div key={member.userId} className="workspace-share-item">
                      <label className="workspace-share-item-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedMemberIds.includes(member.userId)}
                          onChange={() => handleToggleMember(member.userId)}
                        />
                      </label>
                      <div className="workspace-share-item-text">
                        <div className="workspace-share-item-name">{member.name || member.email}</div>
                        <div className="workspace-share-item-email">{member.email}</div>
                      </div>
                      <select
                        className="workspace-share-role-select"
                        value={memberRoles[member.userId] || 'view'}
                        onChange={(event) => handleRoleChange(member.userId, event.target.value as 'admin' | 'view')}
                      >
                        <option value="admin">Admin</option>
                        <option value="view">View</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="workspace-share-modal-actions">
              <button className="workspace-creation-button" onClick={() => setShowShareModal(false)}>
                Cancel
              </button>
              <button
                className="workspace-creation-button primary"
                onClick={handleSaveSharing}
                disabled={shareSaving}
              >
                {shareSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLaunchConfirm && (
        <div className="workspace-launch-modal-overlay" onClick={() => setShowLaunchConfirm(false)}>
          <div className="workspace-launch-modal" onClick={(event) => event.stopPropagation()}>
            <div className="workspace-launch-modal-header">
              <h3>Confirm Launch</h3>
              <button
                className="workspace-launch-close"
                onClick={() => setShowLaunchConfirm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="workspace-launch-modal-body">
              Are you sure to launch now?
            </div>
            <div className="workspace-launch-modal-actions">
              <button className="workspace-creation-button" onClick={() => setShowLaunchConfirm(false)}>
                No
              </button>
              <button className="workspace-creation-button primary" onClick={handleConfirmLaunch}>
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default WorkspaceCreationPage
