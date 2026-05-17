import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import './DataSourceSidebar.css'
import ConnectionConfigModal from './ConnectionConfigModal'
import RAGManagement from './RAGManagement'
import BigQueryIcon from './icons/BigQueryIcon'
import AirtableIcon from './icons/AirtableIcon'
import AzureSQLIcon from './icons/AzureSQLIcon'
import DatabricksIcon from './icons/DatabricksIcon'
import MySQLIcon from './icons/MySQLIcon'
import PostgreSQLIcon from './icons/PostgreSQLIcon'
import RedshiftIcon from './icons/RedshiftIcon'
import SnowflakeIcon from './icons/SnowflakeIcon'
import LLMConfig from './LLMConfig'
import ThirdPartyConnections from './ThirdPartyConnections'
import Members from './Members'
import CurrentPlanModal from './CurrentPlanModal'
import UpgradePlanModal from './UpgradePlanModal'
import UsageModal from './UsageModal'
import ChatHistory from './ChatHistory'

export interface DataSource {
  id: string
  name: string
  icon: string
  color: string
  type: string
}

const DATA_SOURCES: DataSource[] = [
  { id: 'bigquery', name: 'Google BigQuery', icon: 'bigquery', color: '#4285F4', type: 'bigquery' },
  { id: 'redshift', name: 'AWS Redshift', icon: 'redshift', color: '#FF9900', type: 'redshift' },
  { id: 'azure', name: 'Azure SQL', icon: 'azure', color: '#0078D4', type: 'azure' },
  { id: 'snowflake', name: 'Snowflake', icon: 'snowflake', color: '#29B5E8', type: 'snowflake' },
  { id: 'mysql', name: 'MySQL', icon: 'mysql', color: '#4479A1', type: 'mysql' },
  { id: 'postgres', name: 'PostgreSQL', icon: 'postgres', color: '#336791', type: 'postgres' },
  { id: 'airtable', name: 'Airtable', icon: 'airtable', color: '#18BFFF', type: 'airtable' },
  { id: 'databricks', name: 'Databricks', icon: 'databricks', color: '#FF3621', type: 'databricks' },
]

interface ConnectionConfig {
  [key: string]: {
    host?: string
    port?: number
    database?: string
    username?: string
    password?: string
    projectId?: string
    dataset?: string
    connectionString?: string
    _connectionStatus?: 'connected' | 'failed' | 'untested'
    [key: string]: any
  }
}

interface DataSourceSidebarProps {
  currentSessionId?: string
  onSessionChange?: (sessionId: string | undefined) => void
  mode?: 'sidebar' | 'panel'
  showMembersSection?: boolean
  showPlanSection?: boolean
  showChatHistorySection?: boolean
  compact?: boolean
  panelMode?: 'modal' | 'inline'
  panelTargetId?: string
  panelVisible?: boolean
  onDataSourceSelect?: (source: DataSource) => void
}

const DataSourceSidebar: React.FC<DataSourceSidebarProps> = ({
  currentSessionId,
  onSessionChange,
  mode = 'sidebar',
  showMembersSection = true,
  showPlanSection = true,
  showChatHistorySection = true,
  compact = false,
  panelMode = 'modal',
  panelTargetId,
  panelVisible = true,
  onDataSourceSelect
}) => {
  const { isAuthenticated } = useAuth()
  const { canConfigure } = usePermissions()
  const isPanel = mode === 'panel'
  const [isExpanded, setIsExpanded] = useState(true)
  const [selectedSource, setSelectedSource] = useState<DataSource | null>(null)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [showRAGManagement, setShowRAGManagement] = useState(false)
  const [inlineMaximizedPanel, setInlineMaximizedPanel] = useState<'connection' | 'knowledgeBase' | null>(null)
  const [openingRAGAfterSave, setOpeningRAGAfterSave] = useState(false) // Flag to prevent clearing selectedSource
  const [expandedSources, setExpandedSources] = useState<{ [key: string]: boolean }>({})
  const [connections, setConnections] = useState<ConnectionConfig>({})
  const [loadingConnections, setLoadingConnections] = useState(true)
  const [showCurrentPlan, setShowCurrentPlan] = useState(false)
  const [showUsage, setShowUsage] = useState(false)
  const [showUpgradePlan, setShowUpgradePlan] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    // Load saved width from localStorage or use default
    const saved = localStorage.getItem('aiquery_sidebar_width')
    return saved ? parseInt(saved, 10) : 280
  })
  const [isResizing, setIsResizing] = useState(false)
  const [showAllSources, setShowAllSources] = useState(false)
  
  // View preferences state - load from localStorage or use defaults
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
  
  // Listen for view preference changes from Settings
  useEffect(() => {
    const handleViewPreferencesChange = (event: CustomEvent) => {
      setViewPreferences(event.detail)
    }
    
    window.addEventListener('viewPreferencesChanged' as any, handleViewPreferencesChange as EventListener)
    
    return () => {
      window.removeEventListener('viewPreferencesChanged' as any, handleViewPreferencesChange as EventListener)
    }
  }, [])
  
  // Section heights state - load from localStorage or use defaults
  const [sectionHeights, setSectionHeights] = useState(() => {
    const saved = localStorage.getItem('aiquery_sidebar_section_heights')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        console.error('Error parsing saved section heights:', e)
      }
    }
    // Default heights in pixels
    return {
      dataSources: 300,
      chatHistory: 200,
      llmConfig: 50,
      thirdParty: 50,
      members: 150,
      plan: 150
    }
  })
  
  const [resizingSection, setResizingSection] = useState<string | null>(null)

  const handleSourceClick = (source: DataSource) => {
    // Toggle submenu for all sources
    setExpandedSources(prev => ({
      ...prev,
      [source.id]: !prev[source.id]
    }))
  }

  const handleDataSourceOption = (sourceId: string, option: 'connection' | 'rag') => {
    const source = DATA_SOURCES.find(s => s.id === sourceId)
    if (!source) return

    if (option === 'connection') {
      setSelectedSource(source)
      setShowConfigModal(true)
      setExpandedSources(prev => ({ ...prev, [sourceId]: false }))
    } else if (option === 'rag') {
      setSelectedSource(source)
      setShowRAGManagement(true)
      setExpandedSources(prev => ({ ...prev, [sourceId]: false }))
    }
  }

  // Load connections from API
  useEffect(() => {
    if (isAuthenticated) {
      loadConnections()
    } else {
      setLoadingConnections(false)
    }
  }, [isAuthenticated])

  const loadConnections = async () => {
    try {
      const response = await axios.get('/api/connections')
      if (response.data.success && response.data.connections) {
        setConnections(response.data.connections)
      }
    } catch (error) {
      console.error('Error loading connections:', error)
      // Fallback to localStorage for backward compatibility during migration
      const saved = localStorage.getItem('aiquery_connections')
      if (saved) {
        try {
          setConnections(JSON.parse(saved))
        } catch (e) {
          console.error('Error parsing saved connections:', e)
        }
      }
    } finally {
      setLoadingConnections(false)
    }
  }

  const handleSaveConnection = async (sourceId: string, config: any) => {
    if (!isAuthenticated) {
      // Fallback to localStorage if not authenticated
      const { _connectionStatus, ...cleanConfig } = config
      const updated = { ...connections, [sourceId]: cleanConfig }
      setConnections(updated)
      localStorage.setItem('aiquery_connections', JSON.stringify(updated))
      // For non-authenticated users, close modal immediately (no RAG creation)
      setShowConfigModal(false)
      return
    }

    try {
      const source = DATA_SOURCES.find(s => s.id === sourceId)
      if (!source) return

      // Remove _connectionStatus from config before saving (it's metadata, not connection data)
      const { _connectionStatus, ...cleanConfig } = config
      
      // Preserve existing status if not explicitly set
      const existingStatus = connections[sourceId]?._connectionStatus
      const statusToSave = _connectionStatus || existingStatus || 'untested'

      await axios.post('/api/connections', {
        sourceId,
        sourceType: source.type,
        config: cleanConfig,
        connectionStatus: statusToSave
      })

      // Reload connections from API to get the latest status
      await loadConnections()
      // Don't close modal here - let the callback handle it if RAG creation is needed
      // setShowConfigModal(false) - will be handled by onSaveAndCreateRAG callback
    } catch (error) {
      console.error('Error saving connection:', error)
      alert('Failed to save connection. Please try again.')
      throw error // Re-throw so the modal doesn't close on error
    }
  }

  const updateConnectionStatus = async (sourceId: string, status: 'connected' | 'failed' | 'untested', testConfig?: any) => {
    // Use the config from test if provided, otherwise use existing config
    const configToUse = testConfig || connections[sourceId]
    
    // Update local state immediately
    if (configToUse) {
      const updated = { ...connections, [sourceId]: { ...configToUse, _connectionStatus: status } }
      setConnections(updated)
    }

    // Save to API if authenticated
    if (isAuthenticated) {
      try {
        // Try to update status first
        const updateResponse = await axios.put(`/api/connections/${sourceId}/status`, { status })
        
        // If update succeeds, reload connections
        if (updateResponse.data.success) {
          await loadConnections()
        }
      } catch (error: any) {
        // If status update fails (e.g., connection doesn't exist), save the connection with status
        if (error.response?.status === 404 && configToUse && testConfig) {
          try {
            const source = DATA_SOURCES.find(s => s.id === sourceId)
            if (source) {
              // Remove _connectionStatus from config before saving
              const { _connectionStatus, ...cleanConfig } = configToUse
              
              // Save the connection with the status
              await axios.post('/api/connections', {
                sourceId,
                sourceType: source.type,
                config: cleanConfig,
                connectionStatus: status
              })
              
              // Reload connections to get the latest status
              await loadConnections()
            }
          } catch (saveError) {
            console.error('Error saving connection after test:', saveError)
            // Even if save fails, local state is already updated
          }
        } else {
          console.error('Error updating connection status:', error)
          // Status update failure is not critical, local state is already updated
        }
      }
    }
  }

  const handleDisconnect = async (sourceId: string) => {
    // Update local state immediately
    const updated = { ...connections }
    delete updated[sourceId]
    setConnections(updated)

    // Delete from API if authenticated
    if (isAuthenticated) {
      try {
        await axios.delete(`/api/connections/${sourceId}`)
      } catch (error) {
        console.error('Error deleting connection:', error)
        // On error, we could restore the connection, but for now just log
      }
    } else {
      // Fallback to localStorage
      localStorage.setItem('aiquery_connections', JSON.stringify(updated))
    }
  }

  const getConnectionStatus = (sourceId: string): 'connected' | 'failed' | 'untested' | null => {
    const config = connections[sourceId]
    if (config && config._connectionStatus) {
      return config._connectionStatus
    }
    // Also check localStorage directly
    const statusesSaved = localStorage.getItem('aiquery_connection_statuses')
    if (statusesSaved) {
      const statuses = JSON.parse(statusesSaved)
      if (statuses[sourceId]) {
        return statuses[sourceId]
      }
    }
    return null
  }

  const isConnected = (sourceId: string) => {
    return getConnectionStatus(sourceId) === 'connected'
  }

  // Save sidebar width to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('aiquery_sidebar_width', sidebarWidth.toString())
  }, [sidebarWidth])
  
  // Save section heights to localStorage when they change
  useEffect(() => {
    localStorage.setItem('aiquery_sidebar_section_heights', JSON.stringify(sectionHeights))
  }, [sectionHeights])

  // Update body style to adjust main content margin based on sidebar width
  useEffect(() => {
    const root = document.documentElement
    if (isExpanded) {
      root.style.setProperty('--sidebar-width', `${sidebarWidth}px`)
      document.body.classList.add('sidebar-expanded')
    } else {
      root.style.setProperty('--sidebar-width', '70px')
      document.body.classList.remove('sidebar-expanded')
    }
    return () => {
      document.body.classList.remove('sidebar-expanded')
    }
  }, [isExpanded, sidebarWidth])

  // Handle resize drag
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      
      const newWidth = e.clientX
      const minWidth = 200
      const maxWidth = 600
      
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setSidebarWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])
  
  // Handle vertical section resizing
  const handleSectionResizeStart = (sectionKey: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingSection(sectionKey)
  }
  
  useEffect(() => {
    const handleVerticalMouseMove = (e: MouseEvent) => {
      if (!resizingSection) return
      
      const sidebar = document.querySelector('.data-source-sidebar')
      if (!sidebar) return
      
      const sidebarRect = sidebar.getBoundingClientRect()
      const headerHeight = 60 // Approximate header height
      const mouseY = e.clientY - sidebarRect.top - headerHeight
      
      // Calculate cumulative positions
      const getSectionTop = (heights: typeof sectionHeights, section: string) => {
        let top = 0
        const order = ['dataSources', 'chatHistory', 'llmConfig', 'thirdParty', 'members', 'plan']
        for (const s of order) {
          if (s === section) break
          top += heights[s as keyof typeof heights] + 4 // 4px for resize handle
        }
        return top
      }
      
      let newHeights = { ...sectionHeights }
      const minHeight = 50
      const maxHeight = 600
      
      switch (resizingSection) {
        case 'dataSources': {
          // Resize data sources section (from top)
          if (mouseY >= minHeight && mouseY <= maxHeight) {
            newHeights.dataSources = mouseY
          }
          break
        }
        case 'chatHistory': {
          // Resize chat history section
          const chatHistoryTop = getSectionTop(sectionHeights, 'chatHistory')
          const newHeight = mouseY - chatHistoryTop
          if (newHeight >= minHeight && newHeight <= maxHeight) {
            newHeights.chatHistory = newHeight
          }
          break
        }
        case 'llmConfig': {
          // Resize LLM config section
          const llmConfigTop = getSectionTop(sectionHeights, 'llmConfig')
          const newHeight = mouseY - llmConfigTop
          if (newHeight >= minHeight && newHeight <= maxHeight) {
            newHeights.llmConfig = newHeight
          }
          break
        }
        case 'thirdParty': {
          // Resize third party section
          const thirdPartyTop = getSectionTop(sectionHeights, 'thirdParty')
          const newHeight = mouseY - thirdPartyTop
          if (newHeight >= minHeight && newHeight <= maxHeight) {
            newHeights.thirdParty = newHeight
          }
          break
        }
        case 'members': {
          // Resize members section
          const membersTop = getSectionTop(sectionHeights, 'members')
          const newHeight = mouseY - membersTop
          if (newHeight >= minHeight && newHeight <= maxHeight) {
            newHeights.members = newHeight
          }
          break
        }
      }
      
      setSectionHeights(newHeights)
    }
    
    const handleVerticalMouseUp = () => {
      setResizingSection(null)
    }
    
    if (resizingSection) {
      document.addEventListener('mousemove', handleVerticalMouseMove)
      document.addEventListener('mouseup', handleVerticalMouseUp)
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
    }
    
    return () => {
      document.removeEventListener('mousemove', handleVerticalMouseMove)
      document.removeEventListener('mouseup', handleVerticalMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [resizingSection, sectionHeights])

  // Sync connection statuses from localStorage when component mounts
  useEffect(() => {
    const statusesSaved = localStorage.getItem('aiquery_connection_statuses')
    if (statusesSaved) {
      const statuses = JSON.parse(statusesSaved)
      setConnections(prev => {
        const updated = { ...prev }
        let hasChanges = false
        
        Object.keys(prev).forEach(sourceId => {
          if (statuses[sourceId] && prev[sourceId]._connectionStatus !== statuses[sourceId]) {
            updated[sourceId] = { ...prev[sourceId], _connectionStatus: statuses[sourceId] }
            hasChanges = true
          }
        })
        
        return hasChanges ? updated : prev
      })
    }
  }, []) // Only run on mount

  useEffect(() => {
    if (isPanel && !isExpanded) {
      setIsExpanded(true)
    }
  }, [isPanel, isExpanded])

  // Determine if sidebar is narrow (less than 200px)
  const isNarrow = !isPanel && isExpanded && sidebarWidth < 200

  // Separate connected and unconnected data sources
  const connectedSources = DATA_SOURCES.filter(source => getConnectionStatus(source.id) === 'connected')
  const unconnectedSources = DATA_SOURCES.filter(source => getConnectionStatus(source.id) !== 'connected')
  const sourcesToShow = showAllSources ? DATA_SOURCES : connectedSources

  const handleCompactSourceClick = (source: DataSource) => {
    setSelectedSource(source)
    setShowConfigModal(true)
    setShowRAGManagement(true)
    setInlineMaximizedPanel(null)
    if (onDataSourceSelect) {
      onDataSourceSelect(source)
    }
  }

  const panelTarget = panelTargetId && typeof document !== 'undefined'
    ? document.getElementById(panelTargetId)
    : null

  const inlinePanels = panelMode === 'inline' && panelVisible && panelTarget
    ? createPortal(
        <div className="data-source-inline-panels">
          {showConfigModal && selectedSource && (inlineMaximizedPanel === null || inlineMaximizedPanel === 'connection') && (
            <ConnectionConfigModal
              source={selectedSource}
              existingConfig={connections[selectedSource.id] || {}}
              onSave={async (config) => {
                await handleSaveConnection(selectedSource.id, config)
              }}
              onClose={() => {
                setShowConfigModal(false)
                setInlineMaximizedPanel(prev => (prev === 'connection' ? null : prev))
              }}
              onDisconnect={() => handleDisconnect(selectedSource.id)}
              onTestResult={async (success: boolean, config?: any) => {
                await updateConnectionStatus(selectedSource.id, success ? 'connected' : 'failed', config)
              }}
              onSaveAndCreateRAG={() => {
                const sourceToUse = selectedSource
                console.log('[DataSourceSidebar] onSaveAndCreateRAG called, selectedSource:', sourceToUse?.id)
                setShowConfigModal(false)
                setShowRAGManagement(true)
                setOpeningRAGAfterSave(true)
                setInlineMaximizedPanel('knowledgeBase')
              }}
              onToggleMaximize={() => {
                setInlineMaximizedPanel(prev => (prev === 'connection' ? null : 'connection'))
              }}
              isMaximized={inlineMaximizedPanel === 'connection'}
              inline
            />
          )}
          {showRAGManagement && selectedSource && (inlineMaximizedPanel === null || inlineMaximizedPanel === 'knowledgeBase') && (
            <RAGManagement
              source={selectedSource}
              onClose={() => {
                setShowRAGManagement(false)
                setOpeningRAGAfterSave(false)
                setSelectedSource(null)
                setInlineMaximizedPanel(prev => (prev === 'knowledgeBase' ? null : prev))
              }}
              inline
              onToggleMaximize={() => {
                setInlineMaximizedPanel(prev => (prev === 'knowledgeBase' ? null : 'knowledgeBase'))
              }}
              isMaximized={inlineMaximizedPanel === 'knowledgeBase'}
            />
          )}
        </div>,
        panelTarget
      )
    : null

  if (compact) {
    return (
      <>
        <div 
          className={`data-source-sidebar compact ${isExpanded ? 'expanded' : ''} ${isPanel ? 'panel' : ''}`}
          style={{ width: '100%' }}
        >
          <div className="sidebar-header compact-header">
            <div className="compact-title">
              <svg className="compact-title-icon" viewBox="0 0 24 24" fill="none">
                <ellipse cx="12" cy="5" rx="7" ry="2.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5 5V12.5C5 14.43 8.13 16 12 16C15.87 16 19 14.43 19 12.5V5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5 12.5V19C5 20.93 8.13 22.5 12 22.5C15.87 22.5 19 20.93 19 19V12.5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <h3 className="sidebar-title">Data Sources</h3>
            </div>
          </div>
          <div className="data-sources-compact-list">
            {DATA_SOURCES.map((source) => (
              <button
                key={source.id}
                className={`data-source-compact-item ${selectedSource?.id === source.id ? 'active' : ''}`}
                onClick={() => handleCompactSourceClick(source)}
                title={source.name}
              >
                <div className="source-icon" style={{ backgroundColor: `${source.color}15` }}>
                  {source.icon === 'bigquery' ? (
                    <BigQueryIcon size={20} />
                  ) : source.icon === 'airtable' ? (
                    <AirtableIcon size={20} />
                  ) : source.icon === 'azure' ? (
                    <AzureSQLIcon size={20} />
                  ) : source.icon === 'databricks' ? (
                    <DatabricksIcon size={20} />
                  ) : source.icon === 'mysql' ? (
                    <MySQLIcon size={20} />
                  ) : source.icon === 'postgres' ? (
                    <PostgreSQLIcon size={20} />
                  ) : source.icon === 'redshift' ? (
                    <RedshiftIcon size={20} />
                  ) : source.icon === 'snowflake' ? (
                    <SnowflakeIcon size={20} />
                  ) : (
                    <span style={{ fontSize: '20px' }}>{source.icon}</span>
                  )}
                </div>
                <div className="data-source-compact-text">
                  <span className="source-name">{source.name}</span>
                  {isConnected(source.id) && (
                    <span className="connection-status connected">Connected</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
        {inlinePanels}
      </>
    )
  }

  return (
    <>
      <div 
        className={`data-source-sidebar ${isExpanded ? 'expanded' : ''} ${isResizing ? 'resizing' : ''} ${isNarrow ? 'narrow' : ''} ${isPanel ? 'panel' : ''}`}
        style={{ width: isPanel ? '100%' : (isExpanded ? `${sidebarWidth}px` : '70px') }}
      >
        <div className="sidebar-header">
          {isExpanded && (
            <div className="sidebar-title-wrapper">
              <svg 
                className="data-warehouse-icon" 
                viewBox="0 0 24 24" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* Stacked discs with blue light lines */}
                <defs>
                  <linearGradient id="discGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#e0e0e0" stopOpacity="0.9" />
                    <stop offset="50%" stopColor="#f5f5f5" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="#d0d0d0" stopOpacity="0.9" />
                  </linearGradient>
                  <linearGradient id="lightGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#4285F4" stopOpacity="0.3" />
                    <stop offset="50%" stopColor="#4285F4" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#4285F4" stopOpacity="0.3" />
                  </linearGradient>
                </defs>
                {/* Top disc */}
                <ellipse cx="12" cy="5" rx="8" ry="2" fill="url(#discGradient)" />
                <ellipse cx="12" cy="5" rx="8" ry="2" fill="none" stroke="#c0c0c0" strokeWidth="0.5" />
                {/* Light line 1 */}
                <rect x="4" y="6" width="16" height="1" fill="url(#lightGradient)" />
                {/* Second disc */}
                <ellipse cx="12" cy="9" rx="8" ry="2" fill="url(#discGradient)" />
                <ellipse cx="12" cy="9" rx="8" ry="2" fill="none" stroke="#c0c0c0" strokeWidth="0.5" />
                {/* Light line 2 */}
                <rect x="4" y="10" width="16" height="1" fill="url(#lightGradient)" />
                {/* Third disc */}
                <ellipse cx="12" cy="13" rx="8" ry="2" fill="url(#discGradient)" />
                <ellipse cx="12" cy="13" rx="8" ry="2" fill="none" stroke="#c0c0c0" strokeWidth="0.5" />
                {/* Light line 3 */}
                <rect x="4" y="14" width="16" height="1" fill="url(#lightGradient)" />
                {/* Bottom disc */}
                <ellipse cx="12" cy="17" rx="8" ry="2" fill="url(#discGradient)" />
                <ellipse cx="12" cy="17" rx="8" ry="2" fill="none" stroke="#c0c0c0" strokeWidth="0.5" />
              </svg>
              <h3 className="sidebar-title">Data Sources</h3>
            </div>
          )}
        </div>
        
        {isExpanded && !isPanel && (
          <div 
            className="sidebar-resize-handle"
            onMouseDown={handleMouseDown}
            title="Drag to resize"
          />
        )}
        
        {viewPreferences.showConnectedDataSources && (
          <>
            <div 
              className="data-sources-list resizable-section"
              style={{ height: `${sectionHeights.dataSources}px`, minHeight: '50px', maxHeight: '600px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            >
          {/* Connected Sources Sub-section */}
          <div className="data-sources-connected-section">
            <div className="data-sources-subsection-header">Connected</div>
            {connectedSources.length > 0 ? (
              <div className="data-sources-connected-list">
                {connectedSources.map((source) => (
            <div key={source.id}>
              <button
                className={`data-source-item ${
                  (() => {
                    const status = getConnectionStatus(source.id)
                    if (status === 'connected') return 'connected'
                    if (status === 'failed') return 'failed'
                    return ''
                  })()
                } ${expandedSources[source.id] ? 'expanded' : ''}`}
                onClick={() => handleSourceClick(source)}
                title={source.name}
              >
                <div className="source-icon" style={{ backgroundColor: `${source.color}15` }}>
                  {source.icon === 'bigquery' ? (
                    <BigQueryIcon size={24} />
                  ) : source.icon === 'airtable' ? (
                    <AirtableIcon size={24} />
                  ) : source.icon === 'azure' ? (
                    <AzureSQLIcon size={24} />
                  ) : source.icon === 'databricks' ? (
                    <DatabricksIcon size={24} />
                  ) : source.icon === 'mysql' ? (
                    <MySQLIcon size={24} />
                  ) : source.icon === 'postgres' ? (
                    <PostgreSQLIcon size={24} />
                  ) : source.icon === 'redshift' ? (
                    <RedshiftIcon size={24} />
                  ) : source.icon === 'snowflake' ? (
                    <SnowflakeIcon size={24} />
                  ) : (
                    <span style={{ fontSize: '24px' }}>{source.icon}</span>
                  )}
                </div>
                {isExpanded && (
                  <div className="source-info">
                    <span className="source-name">{source.name}</span>
                    <span className="expand-icon">{expandedSources[source.id] ? '▼' : '▶'}</span>
                    {(() => {
                      const status = getConnectionStatus(source.id)
                      if (status === 'failed') {
                        return <span className="connection-status failed">● Connection Failed</span>
                      } else if (status === 'connected') {
                        return <span className="connection-status connected">● Connected</span>
                      } else {
                        // Show "Not Connected" for untested or no connection
                        return <span className="connection-status not-connected">Not Connected</span>
                      }
                    })()}
                  </div>
                )}
              </button>
              {expandedSources[source.id] && isExpanded && (
                <div className="data-source-submenu">
                  {canConfigure && (
                    <button
                      className="submenu-item"
                      onClick={() => handleDataSourceOption(source.id, 'connection')}
                    >
                      <span className="submenu-icon">🔌</span>
                      <span className="submenu-text">Connection</span>
                    </button>
                  )}
                  {canConfigure && (
                    <button
                      className="submenu-item"
                      onClick={() => handleDataSourceOption(source.id, 'rag')}
                    >
                      <span className="submenu-icon">🧠</span>
                      <span className="submenu-text">RAG Generation</span>
                    </button>
                  )}
                  {!canConfigure && (
                    <div className="submenu-item submenu-item-disabled">
                      <span className="submenu-icon">🔒</span>
                      <span className="submenu-text">View Only - No Configuration Access</span>
                    </div>
                  )}
                </div>
              )}
            </div>
                ))}
              </div>
            ) : (
              <div className="no-connected-sources">
                <p>No connected data sources</p>
              </div>
            )}
          </div>

          {/* Not Connected Sources Sub-section */}
          {isExpanded && unconnectedSources.length > 0 && (
            <div className="data-sources-not-connected-section">
              <div className="data-sources-subsection-header">
                Not Connected
                <button
                  className="show-all-sources-button-inline"
                  onClick={() => setShowAllSources(!showAllSources)}
                  title={showAllSources ? 'Hide unconnected sources' : 'Show unconnected sources'}
                >
                  <span className="toggle-icon">{showAllSources ? '▼' : '▶'}</span>
                </button>
              </div>
              {showAllSources && (
                <div className="data-sources-not-connected-list">
                  {unconnectedSources.map((source) => (
                <div key={source.id}>
                  <button
                    className={`data-source-item ${
                      (() => {
                        const status = getConnectionStatus(source.id)
                        if (status === 'connected') return 'connected'
                        if (status === 'failed') return 'failed'
                        return ''
                      })()
                    } ${expandedSources[source.id] ? 'expanded' : ''}`}
                    onClick={() => handleSourceClick(source)}
                    title={source.name}
                  >
                    <div className="source-icon" style={{ backgroundColor: `${source.color}15` }}>
                      {source.icon === 'bigquery' ? (
                        <BigQueryIcon size={24} />
                      ) : source.icon === 'airtable' ? (
                        <AirtableIcon size={24} />
                      ) : source.icon === 'azure' ? (
                        <AzureSQLIcon size={24} />
                      ) : source.icon === 'databricks' ? (
                        <DatabricksIcon size={24} />
                      ) : source.icon === 'mysql' ? (
                        <MySQLIcon size={24} />
                      ) : source.icon === 'postgres' ? (
                        <PostgreSQLIcon size={24} />
                      ) : source.icon === 'redshift' ? (
                        <RedshiftIcon size={24} />
                      ) : source.icon === 'snowflake' ? (
                        <SnowflakeIcon size={24} />
                      ) : (
                        <span style={{ fontSize: '24px' }}>{source.icon}</span>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="source-info">
                        <span className="source-name">{source.name}</span>
                        <span className="expand-icon">{expandedSources[source.id] ? '▼' : '▶'}</span>
                        {(() => {
                          const status = getConnectionStatus(source.id)
                          if (status === 'failed') {
                            return <span className="connection-status failed">● Connection Failed</span>
                          } else if (status === 'connected') {
                            return <span className="connection-status connected">● Connected</span>
                          } else {
                            // Show "Not Connected" for untested or no connection
                            return <span className="connection-status not-connected">Not Connected</span>
                          }
                        })()}
                      </div>
                    )}
                  </button>
                  {expandedSources[source.id] && isExpanded && (
                    <div className="data-source-submenu">
                      <button
                        className="submenu-item"
                        onClick={() => handleDataSourceOption(source.id, 'connection')}
                      >
                        <span className="submenu-icon">🔌</span>
                        <span className="submenu-text">Connection</span>
                      </button>
                      <button
                        className="submenu-item"
                        onClick={() => handleDataSourceOption(source.id, 'rag')}
                      >
                        <span className="submenu-icon">🧠</span>
                        <span className="submenu-text">RAG Generation</span>
                      </button>
                    </div>
                  )}
                  </div>
                ))}
                </div>
              )}
            </div>
          )}
            </div>
            
            {/* Resize handle for Data Sources */}
            {isExpanded && !isPanel && (
              <div 
                className="section-resize-handle"
                onMouseDown={(e) => handleSectionResizeStart('dataSources', e)}
                title="Drag to resize Data Sources section"
              />
            )}
          </>
        )}

        {/* Chat History */}
        {isAuthenticated && showChatHistorySection && viewPreferences.showChatHistory && (
          <>
            <div 
              className="resizable-section"
              style={{ height: `${sectionHeights.chatHistory}px`, minHeight: '50px', maxHeight: '600px' }}
            >
              <ChatHistory
                onSelectSession={(sessionId) => {
                  if (onSessionChange) {
                    onSessionChange(sessionId)
                  }
                }}
                currentSessionId={currentSessionId}
              />
            </div>
            {/* Resize handle for Chat History */}
            {isExpanded && !isPanel && (
              <div 
                className="section-resize-handle"
                onMouseDown={(e) => handleSectionResizeStart('chatHistory', e)}
                title="Drag to resize Chat History section"
              />
            )}
          </>
        )}

        {viewPreferences.showLLMConfig && (
          <>
            <div 
              className="resizable-section"
              style={{ height: `${sectionHeights.llmConfig}px`, minHeight: '50px', maxHeight: '200px' }}
            >
              <LLMConfig />
            </div>
            {/* Resize handle for LLM Config */}
            {isExpanded && !isPanel && (
              <div 
                className="section-resize-handle"
                onMouseDown={(e) => handleSectionResizeStart('llmConfig', e)}
                title="Drag to resize LLM Configuration section"
              />
            )}
          </>
        )}
        
        {/* Resize handle for LLM Config */}
        {isExpanded && (
          <div 
            className="section-resize-handle"
            onMouseDown={(e) => handleSectionResizeStart('llmConfig', e)}
            title="Drag to resize LLM Configuration section"
          />
        )}

        {viewPreferences.showCommunityChannels && (
          <>
            <div 
              className="resizable-section"
              style={{ height: `${sectionHeights.thirdParty}px`, minHeight: '50px', maxHeight: '200px' }}
            >
              <ThirdPartyConnections />
            </div>
            
            {/* Resize handle for Third Party */}
            {isExpanded && !isPanel && (
              <div 
                className="section-resize-handle"
                onMouseDown={(e) => handleSectionResizeStart('thirdParty', e)}
                title="Drag to resize Third Party Configuration section"
              />
            )}
          </>
        )}

        {showMembersSection && viewPreferences.showTeamMembers && (
          <>
            <div 
              className="resizable-section"
              style={{ height: `${sectionHeights.members}px`, minHeight: '50px', maxHeight: '400px' }}
            >
              <Members />
            </div>
            
            {/* Resize handle for Members */}
            {isExpanded && !isPanel && (
              <div 
                className="section-resize-handle"
                onMouseDown={(e) => handleSectionResizeStart('members', e)}
                title="Drag to resize Members section"
              />
            )}
          </>
        )}
        
        {/* Subscription Buttons */}
        {isAuthenticated && showPlanSection && (
          <div 
            className="subscription-buttons-section resizable-section"
            style={{ height: `${sectionHeights.plan}px`, minHeight: '100px', maxHeight: '300px' }}
          >
            <button
              className="subscription-button current-plan-button"
              onClick={() => setShowCurrentPlan(true)}
              title="View current plan details"
            >
              <span className="subscription-icon">💳</span>
              {isExpanded && <span className="subscription-text">Current Plan</span>}
            </button>
            <button
              className="subscription-button usage-button"
              onClick={() => setShowUsage(true)}
              title="View usage statistics and payment history"
            >
              <span className="subscription-icon">📊</span>
              {isExpanded && <span className="subscription-text">Usage</span>}
            </button>
            <button
              className="subscription-button upgrade-plan-button"
              onClick={() => setShowUpgradePlan(true)}
              title="Upgrade your plan"
            >
              <span className="subscription-icon">⬆️</span>
              {isExpanded && <span className="subscription-text">Upgrade Plan</span>}
            </button>
          </div>
        )}
      </div>

      {panelMode === 'modal' && showConfigModal && selectedSource && (
        <ConnectionConfigModal
          source={selectedSource}
          existingConfig={connections[selectedSource.id] || {}}
          onSave={async (config) => {
            await handleSaveConnection(selectedSource.id, config)
          }}
          onClose={() => {
            setShowConfigModal(false)
            // Only clear selectedSource if we're not opening RAG management
            if (!openingRAGAfterSave) {
              setSelectedSource(null)
            }
          }}
          onDisconnect={() => handleDisconnect(selectedSource.id)}
          onTestResult={async (success: boolean, config?: any) => {
            await updateConnectionStatus(selectedSource.id, success ? 'connected' : 'failed', config)
          }}
          onSaveAndCreateRAG={() => {
            // Store the source before any state changes to avoid closure issues
            const sourceToUse = selectedSource
            console.log('[DataSourceSidebar] onSaveAndCreateRAG called, selectedSource:', sourceToUse?.id)
            
            if (!sourceToUse) {
              console.error('[DataSourceSidebar] ERROR: selectedSource is null, cannot open RAG management')
              return
            }
            
            // Set flag to prevent onClose from clearing selectedSource
            setOpeningRAGAfterSave(true)
            // Close connection modal first
            setShowConfigModal(false)
            
            // Use setTimeout to ensure modal closes before opening RAG
            setTimeout(() => {
              // Ensure selectedSource is still set (it should be due to the flag)
              // If it was cleared, restore it from the stored value
              setSelectedSource((current) => current || sourceToUse)
              console.log('[DataSourceSidebar] Opening RAG management for source:', sourceToUse.id)
              setShowRAGManagement(true)
              
              // Reset flag after opening
              setTimeout(() => {
                setOpeningRAGAfterSave(false)
              }, 100)
            }, 100)
          }}
        />
      )}
      {panelMode === 'modal' && showRAGManagement && selectedSource && (
        <RAGManagement 
          source={selectedSource}
          onClose={() => {
            setShowRAGManagement(false)
            setSelectedSource(null)
            setOpeningRAGAfterSave(false) // Reset flag when RAG modal closes
          }} 
        />
      )}
      {showCurrentPlan && (
        <CurrentPlanModal onClose={() => setShowCurrentPlan(false)} />
      )}
      {showUsage && (
        <UsageModal onClose={() => setShowUsage(false)} />
      )}
      {showUpgradePlan && (
        <UpgradePlanModal onClose={() => setShowUpgradePlan(false)} />
      )}
      {inlinePanels}
    </>
  )
}

export default DataSourceSidebar

