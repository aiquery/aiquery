import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import ChatBot from './ChatBot'
import Logo from './Logo'
import LLMConfig from './LLMConfig'
import ThirdPartyConnections from './ThirdPartyConnections'
import Members from './Members'
import ChatHistory from './ChatHistory'
import UserMenu from './UserMenu'
import HelpDropdown from './HelpDropdown'
import NotificationsDropdown from './NotificationsDropdown'
import BigQueryIcon from './icons/BigQueryIcon'
import AirtableIcon from './icons/AirtableIcon'
import AzureSQLIcon from './icons/AzureSQLIcon'
import DatabricksIcon from './icons/DatabricksIcon'
import MySQLIcon from './icons/MySQLIcon'
import PostgreSQLIcon from './icons/PostgreSQLIcon'
import RedshiftIcon from './icons/RedshiftIcon'
import SnowflakeIcon from './icons/SnowflakeIcon'
import ConnectionConfigModal from './ConnectionConfigModal'
import RAGManagement from './RAGManagement'
import { useAuth } from '../contexts/AuthContext'
import './ChatApp.css'

function ChatApp() {
  const { user, token, isAuthenticated } = useAuth()
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(undefined)
  /** Bump to remount ChatBot when "New Chat" is clicked while session is already undefined */
  const [chatBotKey, setChatBotKey] = useState(0)
  /** Bump after each chat reply so Chat History refreshes (title/order) even when session id unchanged */
  const [historyRefreshTick, setHistoryRefreshTick] = useState(0)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const workspaceCreationHref = useMemo(() => {
    if (activeWorkspaceId) {
      return `/app_admin/workspace_creation?workspaceId=${activeWorkspaceId}`
    }
    return '/app_admin/workspace_creation'
  }, [activeWorkspaceId])
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string | null>(null)
  const [planName, setPlanName] = useState<string>('Free')
  const [connectedDatabases, setConnectedDatabases] = useState<Array<{ id: string; name: string }>>([])
  const [connections, setConnections] = useState<Record<string, any>>({})
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [showDbModal, setShowDbModal] = useState(false)
  const [dbModalPosition, setDbModalPosition] = useState<{ x: number; y: number } | null>(null)
  const [dbModalSize, setDbModalSize] = useState<{ width: number; height: number }>({ width: 1000, height: 720 })
  const [isDbDragging, setIsDbDragging] = useState(false)
  const [isDbResizing, setIsDbResizing] = useState(false)
  const [isDbMaximized, setIsDbMaximized] = useState(false)
  const [showConnectionPanel, setShowConnectionPanel] = useState(true)
  const [showRagPanel, setShowRagPanel] = useState(true)
  const [isConnectionMaximized, setIsConnectionMaximized] = useState(false)
  const [isRagMaximized, setIsRagMaximized] = useState(false)
  const dbModalRestoreRef = useRef<{ position: { x: number; y: number } | null; size: { width: number; height: number } } | null>(null)
  const dbDragOffsetRef = useRef({ x: 0, y: 0 })
  const dbResizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 })
  const DB_MODAL_POSITION_KEY = 'aiquery_chat_db_modal_position'
  const DB_MODAL_SIZE_KEY = 'aiquery_chat_db_modal_size'
  const ACTIVE_DB_KEY = 'aiquery_active_database_id'
  const [showShareModal, setShowShareModal] = useState(false)
  const [membersLoading, setMembersLoading] = useState(false)
  const [members, setMembers] = useState<Array<{ id: number; name: string | null; email: string }>>([])
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([])
  const [memberRoles, setMemberRoles] = useState<Record<number, 'admin' | 'view'>>({})
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'view'>('view')
  const [inviteStatus, setInviteStatus] = useState<string | null>(null)
  const [shareSaving, setShareSaving] = useState(false)

  const handleSessionChange = (sessionId: string | undefined) => {
    setCurrentSessionId(sessionId)
    if (sessionId === undefined) {
      setChatBotKey((k) => k + 1)
    }
  }

  const dataSources = [
    { id: 'bigquery', name: 'Google BigQuery', icon: 'bigquery', color: '#4285F4', type: 'bigquery' },
    { id: 'redshift', name: 'AWS Redshift', icon: 'redshift', color: '#FF9900', type: 'redshift' },
    { id: 'azure', name: 'Azure SQL', icon: 'azure', color: '#0078D4', type: 'azure' },
    { id: 'snowflake', name: 'Snowflake', icon: 'snowflake', color: '#29B5E8', type: 'snowflake' },
    { id: 'mysql', name: 'MySQL', icon: 'mysql', color: '#4479A1', type: 'mysql' },
    { id: 'postgres', name: 'PostgreSQL', icon: 'postgres', color: '#336791', type: 'postgres' },
    { id: 'airtable', name: 'Airtable', icon: 'airtable', color: '#18BFFF', type: 'airtable' },
    { id: 'databricks', name: 'Databricks', icon: 'databricks', color: '#FF3621', type: 'databricks' }
  ]

  const getDatabaseIcon = (id: string) => {
    switch (id) {
      case 'bigquery':
        return <BigQueryIcon />
      case 'redshift':
        return <RedshiftIcon />
      case 'azure':
        return <AzureSQLIcon />
      case 'snowflake':
        return <SnowflakeIcon />
      case 'mysql':
        return <MySQLIcon />
      case 'postgres':
        return <PostgreSQLIcon />
      case 'airtable':
        return <AirtableIcon />
      case 'databricks':
        return <DatabricksIcon />
      default:
        return <span className="chat-database-fallback">{id[0]?.toUpperCase() || 'D'}</span>
    }
  }

  const activeSource = activeSourceId
    ? dataSources.find((source) => source.id === activeSourceId) || null
    : null

  useEffect(() => {
    try {
      const savedPosition = localStorage.getItem(DB_MODAL_POSITION_KEY)
      if (savedPosition) {
        const parsed = JSON.parse(savedPosition)
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          setDbModalPosition({ x: parsed.x, y: parsed.y })
        }
      }
      const savedSize = localStorage.getItem(DB_MODAL_SIZE_KEY)
      if (savedSize) {
        const parsed = JSON.parse(savedSize)
        if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') {
          setDbModalSize({ width: parsed.width, height: parsed.height })
        }
      }
    } catch (error) {
      console.error('Error loading modal layout:', error)
    }
  }, [])

  useEffect(() => {
    if (dbModalPosition) {
      localStorage.setItem(DB_MODAL_POSITION_KEY, JSON.stringify(dbModalPosition))
    }
    localStorage.setItem(DB_MODAL_SIZE_KEY, JSON.stringify(dbModalSize))
  }, [dbModalPosition, dbModalSize])

  useEffect(() => {
    const activeId = localStorage.getItem('aiquery_active_workspace_id')
    if (!activeId) return

    setActiveWorkspaceId(activeId)
    try {
      axios
        .get(`/api/workspaces/${activeId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        .then((response) => {
          if (response.data.success && response.data.workspace) {
            const wname = response.data.workspace.name
            setActiveWorkspaceName(wname)
            try {
              if (wname) localStorage.setItem('aiquery_active_workspace_name', wname)
            } catch {
              /* ignore */
            }
          }
        })
        .catch((error) => {
          console.error('Error loading active workspace:', error)
        })
    } catch (error) {
      console.error('Error loading active workspace:', error)
    }
  }, [])

  useEffect(() => {
    if (showShareModal) {
      loadMembers()
      loadWorkspaceMembers()
    }
  }, [showShareModal])

  const loadMembers = async () => {
    if (!isAuthenticated) {
      setMembers([])
      return
    }

    setMembersLoading(true)
    try {
      const response = await axios.get('/api/members', {
        headers: { 'Authorization': `Bearer ${token}` }
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
    if (!isAuthenticated || !activeWorkspaceId) return
    try {
      const response = await axios.get(`/api/workspaces/${activeWorkspaceId}`, {
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

  const handleToggleMember = (userId: number) => {
    setSelectedMemberIds((prev) => (
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    ))
  }

  const getMemberRole = (userId: number) => memberRoles[userId] || 'view'

  const handleRoleChange = (userId: number, role: 'admin' | 'view') => {
    setMemberRoles((prev) => ({ ...prev, [userId]: role }))
    setSelectedMemberIds((prev) => (
      prev.includes(userId) ? prev : [...prev, userId]
    ))
  }

  const handleOpenShare = () => {
    if (!isAuthenticated) {
      alert('Please log in to share this workspace.')
      return
    }
    if (!activeWorkspaceId) {
      alert('Please select a workspace before sharing.')
      return
    }
    setShowShareModal(true)
  }

  const handleSaveShare = async () => {
    if (!activeWorkspaceId) return
    setShareSaving(true)
    try {
      const rolesPayload = selectedMemberIds.reduce<Record<number, 'admin' | 'view'>>((acc, id) => {
        acc[id] = getMemberRole(id)
        return acc
      }, {})
      await axios.put(`/api/workspaces/${activeWorkspaceId}`, {
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

  useEffect(() => {
    if (!isAuthenticated) return

    axios.get('/api/subscription', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then((response) => {
      if (response.data.success) {
        const plan = response.data.planName || response.data.subscription?.planName || 'free'
        const label = String(plan).toLowerCase() === 'startpro'
          ? 'StartPro'
          : String(plan).toLowerCase() === 'smartpro'
          ? 'SmartPro'
          : String(plan).toLowerCase() === 'enterprise'
          ? 'Enterprise'
          : 'Free'
        setPlanName(label)
      }
    }).catch((error) => {
      console.error('Error loading plan:', error)
    })
  }, [isAuthenticated, token])

  const loadConnections = async () => {
    try {
      const response = await axios.get('/api/connections', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.data.success && response.data.connections) {
        setConnections(response.data.connections)
      }
    } catch (error) {
      console.error('Error loading connections:', error)
    }
  }

  useEffect(() => {
    if (!isAuthenticated) return

    axios.get('/api/connections', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then((response) => {
      if (response.data.success && response.data.connections) {
        const labelMap: Record<string, string> = {
          bigquery: 'Google BigQuery',
          redshift: 'AWS Redshift',
          azure: 'Azure SQL',
          snowflake: 'Snowflake',
          mysql: 'MySQL',
          postgres: 'PostgreSQL',
          airtable: 'Airtable',
          databricks: 'Databricks'
        }
        const connected = Object.entries(response.data.connections)
          .filter(([, value]: any) => value?._connectionStatus === 'connected')
          .map(([key]) => ({
            id: key,
            name: labelMap[key] || key
          }))
        setConnectedDatabases(connected)
        setConnections(response.data.connections)
      }
    }).catch((error) => {
      console.error('Error loading connections:', error)
    })
  }, [isAuthenticated, token])

  const handleDatabaseClick = (id: string) => {
    setActiveSourceId(id)
    localStorage.setItem(ACTIVE_DB_KEY, id)
    setShowConnectionPanel(true)
    setShowRagPanel(true)
    setIsConnectionMaximized(false)
    setIsRagMaximized(false)
    setShowDbModal(true)
  }

  const orderedDatabases = (() => {
    if (!activeSourceId) return connectedDatabases
    const active = connectedDatabases.find((db) => db.id === activeSourceId)
    if (!active) return connectedDatabases
    return [active, ...connectedDatabases.filter((db) => db.id !== activeSourceId)]
  })()

  useEffect(() => {
    if (connectedDatabases.length === 0) return
    const savedActive = localStorage.getItem(ACTIVE_DB_KEY)
    if (savedActive && connectedDatabases.some((db) => db.id === savedActive)) {
      setActiveSourceId(savedActive)
      return
    }
    if (!activeSourceId) {
      setActiveSourceId(connectedDatabases[0].id)
      localStorage.setItem(ACTIVE_DB_KEY, connectedDatabases[0].id)
    }
  }, [connectedDatabases, activeSourceId])

  useEffect(() => {
    if (showDbModal && !dbModalPosition) {
      const width = dbModalSize.width
      const height = dbModalSize.height
      const x = Math.max(16, Math.floor((window.innerWidth - width) / 2))
      const y = Math.max(16, Math.floor((window.innerHeight - height) / 2))
      setDbModalPosition({ x, y })
    }
  }, [showDbModal, dbModalPosition, dbModalSize])

  useEffect(() => {
    if (!isDbDragging && !isDbResizing) return

    const handleMouseMove = (event: MouseEvent) => {
      if (isDbDragging && dbModalPosition) {
        const newX = event.clientX - dbDragOffsetRef.current.x
        const newY = event.clientY - dbDragOffsetRef.current.y
        const maxX = window.innerWidth - dbModalSize.width
        const maxY = window.innerHeight - dbModalSize.height
        setDbModalPosition({
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY))
        })
      } else if (isDbResizing) {
        const deltaX = event.clientX - dbResizeStartRef.current.x
        const deltaY = event.clientY - dbResizeStartRef.current.y
        const minWidth = 720
        const minHeight = 520
        const maxWidth = window.innerWidth - 24
        const maxHeight = window.innerHeight - 24
        const nextWidth = Math.max(minWidth, Math.min(dbResizeStartRef.current.width + deltaX, maxWidth))
        const nextHeight = Math.max(minHeight, Math.min(dbResizeStartRef.current.height + deltaY, maxHeight))
        setDbModalSize({ width: nextWidth, height: nextHeight })
      }
    }

    const handleMouseUp = () => {
      setIsDbDragging(false)
      setIsDbResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = isDbDragging ? 'grabbing' : 'nwse-resize'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isDbDragging, isDbResizing, dbModalPosition, dbModalSize])

  const handleDbDragStart = (event: React.MouseEvent) => {
    if (!dbModalPosition) return
    if (isDbMaximized) return
    dbDragOffsetRef.current = {
      x: event.clientX - dbModalPosition.x,
      y: event.clientY - dbModalPosition.y
    }
    setIsDbDragging(true)
  }

  const handleDbResizeStart = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (isDbMaximized) return
    dbResizeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      width: dbModalSize.width,
      height: dbModalSize.height
    }
    setIsDbResizing(true)
  }

  const handleToggleDbMaximize = () => {
    if (!isDbMaximized) {
      dbModalRestoreRef.current = {
        position: dbModalPosition,
        size: dbModalSize
      }
      setDbModalPosition({ x: 12, y: 12 })
      setDbModalSize({
        width: Math.max(720, window.innerWidth - 24),
        height: Math.max(520, window.innerHeight - 24)
      })
      setIsDbMaximized(true)
    } else {
      const restore = dbModalRestoreRef.current
      if (restore?.position) {
        setDbModalPosition(restore.position)
      }
      if (restore?.size) {
        setDbModalSize(restore.size)
      }
      setIsDbMaximized(false)
    }
  }

  const handleToggleConnectionMaximize = () => {
    setIsConnectionMaximized((prev) => {
      const next = !prev
      if (next) {
        setIsRagMaximized(false)
        setShowConnectionPanel(true)
        setShowRagPanel(false)
      } else {
        setShowRagPanel(true)
      }
      return next
    })
  }

  const handleToggleRagMaximize = () => {
    setIsRagMaximized((prev) => {
      const next = !prev
      if (next) {
        setIsConnectionMaximized(false)
        setShowRagPanel(true)
        setShowConnectionPanel(false)
      } else {
        setShowConnectionPanel(true)
      }
      return next
    })
  }

  const handleSaveConnection = async (sourceId: string, config: any) => {
    try {
      const source = dataSources.find((s) => s.id === sourceId)
      if (!source) return

      const { _connectionStatus, ...cleanConfig } = config
      const existingStatus = connections[sourceId]?._connectionStatus
      const statusToSave = _connectionStatus || existingStatus || 'untested'

      await axios.post('/api/connections', {
        sourceId,
        sourceType: source.type,
        config: cleanConfig,
        connectionStatus: statusToSave
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      await loadConnections()
    } catch (error) {
      console.error('Error saving connection:', error)
      alert('Failed to save connection. Please try again.')
      throw error
    }
  }

  const updateConnectionStatus = async (sourceId: string, status: 'connected' | 'failed' | 'untested', testConfig?: any) => {
    const configToUse = testConfig || connections[sourceId]
    if (configToUse) {
      setConnections((prev) => ({ ...prev, [sourceId]: { ...configToUse, _connectionStatus: status } }))
    }

    if (isAuthenticated) {
      try {
        const updateResponse = await axios.put(`/api/connections/${sourceId}/status`, { status }, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        if (updateResponse.data.success) {
          await loadConnections()
        }
      } catch (error: any) {
        if (error.response?.status === 404 && configToUse && testConfig) {
          try {
            const source = dataSources.find((s) => s.id === sourceId)
            if (source) {
              const { _connectionStatus, ...cleanConfig } = configToUse
              await axios.post('/api/connections', {
                sourceId,
                sourceType: source.type,
                config: cleanConfig,
                connectionStatus: status
              }, {
                headers: { 'Authorization': `Bearer ${token}` }
              })
              await loadConnections()
            }
          } catch (saveError) {
            console.error('Error saving connection after test:', saveError)
          }
        } else {
          console.error('Error updating connection status:', error)
        }
      }
    }
  }

  const handleDisconnect = async (sourceId: string) => {
    const remainingDatabases = connectedDatabases.filter((db) => db.id !== sourceId)
    const nextActiveId = activeSourceId === sourceId ? (remainingDatabases[0]?.id ?? null) : activeSourceId
    setConnections((prev) => {
      const updated = { ...prev }
      delete updated[sourceId]
      return updated
    })
    setConnectedDatabases(remainingDatabases)
    if (activeSourceId === sourceId) {
      setActiveSourceId(nextActiveId)
      if (nextActiveId) {
        localStorage.setItem(ACTIVE_DB_KEY, nextActiveId)
      } else {
        localStorage.removeItem(ACTIVE_DB_KEY)
      }
    }

    if (isAuthenticated) {
      try {
        await axios.delete(`/api/connections/${sourceId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      } catch (error) {
        console.error('Error deleting connection:', error)
      }
    }
  }

  return (
    <div className="chat-page">
      <aside className="chat-sidebar-primary">
        <a className="chat-sidebar-logo" href="/app_admin" aria-label="Go to admin" title="Workspace Admin">
          <img src="/images/aiquery_logo7.png" alt="AIquery" />
        </a>
        <div className="chat-sidebar-primary-bottom">
          <HelpDropdown variant="sidebar" triggerClassName="chat-sidebar-icon-button circle small" />
          <NotificationsDropdown variant="sidebar" triggerClassName="chat-sidebar-icon-plain" />
          <div className="chat-sidebar-user-menu">
            <UserMenu />
          </div>
        </div>
      </aside>

      <div className="chat-content-column">
        <div className="chat-topbar">
          <div className="chat-topbar-title">
            <a
              className="chat-workspace-name chat-workspace-link"
              href={workspaceCreationHref}
              title="Workspace Settings"
            >
              {activeWorkspaceName || 'Workspace'}
            </a>
            <span className="chat-plan-text">{planName}</span>
          </div>
          <div className="chat-topbar-upgrade">
            <span className="chat-upgrade-text">Upgrade my base</span>
            <a
              className="chat-upgrade-icon"
              href="/app_admin"
              onClick={() => {
                localStorage.setItem('aiquery_admin_active_panel', 'upgrade')
              }}
              aria-label="Upgrade my base"
              title="Upgrade my base"
            >
              <img src="/images/up_plan.png" alt="" aria-hidden="true" />
            </a>
          </div>
          <div className="chat-topbar-actions">
            <button
              className="chat-topbar-button primary"
              onClick={handleOpenShare}
              title="Share workspace"
            >
              Share
            </button>
          </div>
        </div>

        <div className="chat-body">
          <aside className="chat-sidebar-secondary">
            <div className="chat-sidebar-block">
              <div className="chat-sidebar-title-row">
                <span>My Database</span>
              </div>
              <a
                className="chat-sidebar-add"
                href={workspaceCreationHref}
              title="Add a new database"
              >
                <span className="chat-sidebar-add-icon">+</span>
                <span>New Database</span>
              </a>
              <div className="chat-database-list">
                {connectedDatabases.length === 0 ? (
                  <div className="chat-database-empty">No connected database</div>
                ) : (
                  orderedDatabases.map((db) => (
                    <button
                      key={db.id}
                      className={`chat-database-item${activeSourceId === db.id ? ' active' : ''}`}
                      type="button"
                      onClick={() => handleDatabaseClick(db.id)}
                      title={`Open ${db.name}`}
                    >
                      <div className="chat-database-item-left">
                        <span className="chat-database-icon">{getDatabaseIcon(db.id)}</span>
                        <span className="chat-database-name">{db.name}</span>
                      </div>
                      <span className="chat-database-dot" />
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="chat-sidebar-divider" />

            <div className="chat-sidebar-block">
              <div className="chat-sidebar-title-row">Chat History</div>
              <ChatHistory
                onSelectSession={handleSessionChange}
                currentSessionId={currentSessionId}
                showNewChat={true}
                variant="compact"
              />
            </div>

            <div className="chat-sidebar-footer">
              <LLMConfig />
              <ThirdPartyConnections />
              <Members />
            </div>
          </aside>

          <main className="chat-main">
            <div className="chat-content">
              <ChatBot
                key={chatBotKey}
                sessionId={currentSessionId}
                onSessionCreated={(sid) => {
                  setCurrentSessionId(sid)
                  setHistoryRefreshTick((t) => t + 1)
                }}
              />
            </div>
          </main>
        </div>
      </div>

      {showShareModal && (
        <div className="workspace-share-modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="workspace-share-modal" onClick={(event) => event.stopPropagation()}>
            <div className="workspace-share-modal-header">
              <h3>Share workspace</h3>
              <button className="workspace-share-close" onClick={() => setShowShareModal(false)}>
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
                <button className="chat-topbar-button" onClick={handleInviteMember}>
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
                    <div key={member.id} className="workspace-share-item">
                      <label className="workspace-share-item-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedMemberIds.includes(member.id)}
                          onChange={() => handleToggleMember(member.id)}
                        />
                      </label>
                      <div className="workspace-share-item-text">
                        <div className="workspace-share-item-name">{member.name || member.email}</div>
                        <div className="workspace-share-item-email">{member.email}</div>
                      </div>
                      <select
                        className="workspace-share-role-select"
                        value={getMemberRole(member.id)}
                        onChange={(event) => handleRoleChange(member.id, event.target.value as 'admin' | 'view')}
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
              <button className="chat-topbar-button" onClick={() => setShowShareModal(false)}>
                Cancel
              </button>
              <button
                className="chat-topbar-button primary"
                onClick={handleSaveShare}
                disabled={shareSaving}
              >
                {shareSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDbModal && activeSource && (
        <div className="chat-db-modal-overlay" onClick={() => setShowDbModal(false)}>
          <div
            className="chat-db-modal"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: dbModalSize.width,
              height: dbModalSize.height,
              left: dbModalPosition?.x ?? 0,
              top: dbModalPosition?.y ?? 0
            }}
          >
            <div className="chat-db-modal-header" onMouseDown={handleDbDragStart}>
              <div className="chat-db-modal-title">Connection</div>
              <div className="chat-db-modal-actions">
                <button
                  className="chat-db-modal-maximize"
                  onClick={handleToggleDbMaximize}
                  aria-label={isDbMaximized ? 'Restore' : 'Maximize'}
                >
                  {isDbMaximized ? (
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="3" y="3" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
                      <rect x="6" y="6" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    </svg>
                  )}
                </button>
                <button className="chat-db-modal-close" onClick={() => setShowDbModal(false)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="chat-db-modal-body">
              {(!showConnectionPanel || !showRagPanel) && (
                <div className="chat-db-panel-toggles">
                  {!showConnectionPanel && (
                    <button
                      className="chat-db-panel-toggle"
                      onClick={() => {
                        setIsRagMaximized(false)
                        setIsConnectionMaximized(false)
                        setShowConnectionPanel(true)
                      }}
                    >
                      Show Connection
                    </button>
                  )}
                  {!showRagPanel && (
                    <button
                      className="chat-db-panel-toggle"
                      onClick={() => {
                        setIsConnectionMaximized(false)
                        setIsRagMaximized(false)
                        setShowRagPanel(true)
                      }}
                    >
                      Show RAG
                    </button>
                  )}
                </div>
              )}
              <div className={`chat-db-panels${(showConnectionPanel !== showRagPanel) ? ' single' : ''}`}>
                {showConnectionPanel && (
                  <ConnectionConfigModal
                    source={activeSource}
                    existingConfig={connections[activeSource.id] || {}}
                    onSave={async (config) => {
                      await handleSaveConnection(activeSource.id, config)
                    }}
                    isMaximized={isConnectionMaximized}
                    onToggleMaximize={handleToggleConnectionMaximize}
                    onClose={() => {
                      setShowConnectionPanel(false)
                      setIsConnectionMaximized(false)
                      if (!showRagPanel) {
                        setShowDbModal(false)
                      }
                    }}
                    onDisconnect={() => handleDisconnect(activeSource.id)}
                    onTestResult={async (success: boolean, config?: any) => {
                      await updateConnectionStatus(activeSource.id, success ? 'connected' : 'failed', config)
                    }}
                    onSaveAndCreateRAG={() => undefined}
                    inline
                  />
                )}
                {showRagPanel && (
                  <RAGManagement
                    source={activeSource}
                    isMaximized={isRagMaximized}
                    onToggleMaximize={handleToggleRagMaximize}
                    onClose={() => {
                      setShowRagPanel(false)
                      setIsRagMaximized(false)
                      if (!showConnectionPanel) {
                        setShowDbModal(false)
                      }
                    }}
                    inline
                  />
                )}
              </div>
            </div>
            <div className="chat-db-resize-handle" onMouseDown={handleDbResizeStart} />
          </div>
        </div>
      )}
    </div>
  )
}

export default ChatApp
