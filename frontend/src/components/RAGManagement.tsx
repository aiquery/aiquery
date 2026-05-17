import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import './RAGManagement.css'
import RAGCreationModal from './RAGCreationModal'
import { DataSource } from './DataSourceSidebar'

interface Column {
  name: string
  type: string
  mode?: string
  description?: string
  /** RAG / LLM column text (may mirror description) */
  ragDescription?: string
  nullable?: boolean
}

interface RAGIndex {
  projectId?: string
  baseId?: string
  database?: string
  dataSourceType?: 'bigquery' | 'airtable' | string
  datasets: string[]
  tables: Array<{
    id: string
    name: string
    dataset: string
    /** Short table summary (legacy); prefer `description` when present */
    summary?: string
    tableName?: string
    /** Full table description (matches rich RAG JSON) */
    description?: string
    purpose?: string
    keyColumns?: Array<{ name: string; type: string; description: string; examples?: unknown[] }>
    relationships?: string
    sampleQuestions?: string[]
    columns?: Column[]
  }>
  questions?: Array<{
    question: string
    query: string
    answer?: string
    createdAt?: string
  }>
  createdAt: string
  updatedAt: string
  id?: string
  documents?: Array<{
    table: string
    content: string
    metadata: {
      tableId: string
      datasetId?: string
      schemaName?: string
      schema?: Column[]
      [key: string]: any
    }
  }>
}

interface RAGManagementProps {
  source: DataSource
  onClose: () => void
  inline?: boolean
  onToggleMaximize?: () => void
  isMaximized?: boolean
}

const RAGManagement: React.FC<RAGManagementProps> = ({ source, onClose, inline = false, onToggleMaximize, isMaximized }) => {
  const { isAuthenticated } = useAuth()
  const { canConfigure } = usePermissions()
  const [ragIndexes, setRAGIndexes] = useState<RAGIndex[]>([])
  const [currentIndex, setCurrentIndex] = useState<RAGIndex | null>(null)
  const [loading, setLoading] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingIndex, setEditingIndex] = useState<RAGIndex | null>(null)
  const [selectedConnection, setSelectedConnection] = useState<any>(null)
  const [connections, setConnections] = useState<{ [key: string]: any }>({})
  
  // Tables state
  const [tableFilter, setTableFilter] = useState('')
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set())
  const [editingTable, setEditingTable] = useState<string | null>(null)
  const [tableEditValues, setTableEditValues] = useState<{ 
    name?: string
    dataset?: string
    summary?: string
    description?: string
    purpose?: string
    columns?: Column[]
  }>({})
  
  // Q&A state
  const [questionFilter, setQuestionFilter] = useState('')
  const [selectedQuestions, setSelectedQuestions] = useState<Set<number>>(new Set())
  const [editingQuestion, setEditingQuestion] = useState<number | 'new' | null>(null)
  const [questionEditValues, setQuestionEditValues] = useState<{ question?: string; query?: string; answer?: string }>({})
  
  // Column display state - track which tables are showing all columns
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set())
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Knowledge Base section UI state (per-panel controls)
  type KnowledgeSection = 'tables' | 'fewShot'
  const [tablesCollapsed, setTablesCollapsed] = useState(false)
  const [fewShotCollapsed, setFewShotCollapsed] = useState(false)
  const [tablesClosed, setTablesClosed] = useState(false)
  const [fewShotClosed, setFewShotClosed] = useState(false)
  const [maximizedSection, setMaximizedSection] = useState<KnowledgeSection | null>(null)

  const toggleMaximizeSection = (section: KnowledgeSection) => {
    setMaximizedSection(prev => {
      const next = prev === section ? null : section
      return next
    })
    if (section === 'tables') setTablesCollapsed(false)
    if (section === 'fewShot') setFewShotCollapsed(false)
  }

  const closeSection = (section: KnowledgeSection) => {
    if (section === 'tables') setTablesClosed(true)
    if (section === 'fewShot') setFewShotClosed(true)
    setMaximizedSection(prev => (prev === section ? null : prev))
  }

  const restoreSection = (section: KnowledgeSection) => {
    if (section === 'tables') setTablesClosed(false)
    if (section === 'fewShot') setFewShotClosed(false)
  }

  useEffect(() => {
    if (isMaximized) setIsCollapsed(false)
  }, [isMaximized])
  
  // Dragging and resizing state
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isResizing, setIsResizing] = useState(false)
  const [modalSize, setModalSize] = useState({ width: 1200, height: 700 })
  const modalRef = useRef<HTMLDivElement>(null)
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 })
  const fetchRequestRef = useRef(0)

  useEffect(() => {
    // Reset state whenever user switches data source so stale KB data does not bleed across cards.
    setRAGIndexes([])
    setCurrentIndex(null)
    fetchRAGIndexes()
    loadConnections()
  }, [source.id, source.type, isAuthenticated])

  // Debug: Log permission and auth state
  useEffect(() => {
    console.log('=== Auth/Permission State ===')
    console.log('isAuthenticated:', isAuthenticated)
    console.log('canConfigure:', canConfigure)
    console.log('Button should be visible:', canConfigure || isAuthenticated)
  }, [isAuthenticated, canConfigure])

  // Debug: Log modal state changes
  useEffect(() => {
    console.log('=== Modal State Changed ===')
    console.log('showCreateModal:', showCreateModal)
    console.log('selectedConnection:', selectedConnection ? 'exists' : 'null')
    console.log('Should render modal:', showCreateModal && selectedConnection)
    if (showCreateModal && selectedConnection) {
      console.log('✅ Modal should be visible now!')
    } else {
      console.warn('⚠️ Modal will NOT render because:', {
        showCreateModal,
        hasSelectedConnection: !!selectedConnection
      })
    }
  }, [showCreateModal, selectedConnection])
  
  // Prevent accidental clearing of selectedConnection
  const preservedConnection = useRef<any>(null)
  
  useEffect(() => {
    if (selectedConnection) {
      preservedConnection.current = selectedConnection
      console.log('💾 Preserved connection config:', Object.keys(selectedConnection))
    }
  }, [selectedConnection])
  
  useEffect(() => {
    if (showCreateModal && !selectedConnection) {
      console.error('❌ CRITICAL: showCreateModal is true but selectedConnection is null!')
      console.log('💾 Using preserved connection config instead')
      if (preservedConnection.current) {
        console.log('✅ Restoring preserved connection config (using setTimeout to avoid render issues)')
        // Use setTimeout to avoid state update during render
        setTimeout(() => {
          setSelectedConnection(preservedConnection.current)
        }, 0)
      } else {
        console.error('❌ No preserved connection config available!')
        console.trace('Stack trace for selectedConnection becoming null:')
      }
    }
  }, [showCreateModal, selectedConnection])
  
  // Also preserve connection when modal opens
  useEffect(() => {
    if (showCreateModal && selectedConnection && !preservedConnection.current) {
      preservedConnection.current = selectedConnection
      console.log('💾 Initial preservation of connection config on modal open')
    }
  }, [showCreateModal, selectedConnection])

  useEffect(() => {
    if (ragIndexes.length > 0 && !currentIndex) {
      setCurrentIndex(ragIndexes[0])
    }
  }, [ragIndexes])

  // Debug: Log when tableEditValues changes
  useEffect(() => {
    if (editingTable) {
      console.log('=== tableEditValues changed ===')
      console.log('editingTable:', editingTable)
      console.log('tableEditValues:', tableEditValues)
      console.log('tableEditValues.columns:', tableEditValues.columns)
      if (tableEditValues.columns && tableEditValues.columns.length > 0) {
        console.log('First column in tableEditValues:', tableEditValues.columns[0])
        console.log('First column keys:', Object.keys(tableEditValues.columns[0] || {}))
        console.log('First column hasOwnProperty name:', Object.prototype.hasOwnProperty.call(tableEditValues.columns[0], 'name'))
        if (tableEditValues.columns[0]) {
          console.log('First column name:', tableEditValues.columns[0].name)
          console.log('First column name type:', typeof tableEditValues.columns[0].name)
          console.log('First column name value:', String(tableEditValues.columns[0].name || ''))
        }
      }
    }
  }, [editingTable, tableEditValues])

  const loadConnections = async (): Promise<{ [key: string]: any }> => {
    try {
      console.log('loadConnections called, isAuthenticated:', isAuthenticated)
      if (isAuthenticated) {
        const token = localStorage.getItem('aiquery_token')
        const response = await axios.get('/api/connections', {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        })
        console.log('API response:', response.data)
        if (response.data.success && response.data.connections) {
          setConnections(response.data.connections)
          console.log('Connections loaded from API:', response.data.connections)
          return response.data.connections
        }
      } else {
        const saved = localStorage.getItem('aiquery_connections')
        if (saved) {
          try {
            const parsed = JSON.parse(saved)
            setConnections(parsed)
            console.log('Connections loaded from localStorage:', parsed)
            return parsed
          } catch (e) {
            console.error('Error parsing saved connections:', e)
          }
        }
      }
    } catch (error) {
      console.error('Error loading connections:', error)
      const saved = localStorage.getItem('aiquery_connections')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          setConnections(parsed)
          console.log('Connections loaded from localStorage (fallback):', parsed)
          return parsed
        } catch (e) {
          console.error('Error parsing saved connections:', e)
        }
      }
    }
    console.warn('No connections found, returning empty object')
    return {}
  }

  const fetchRAGIndexes = async (): Promise<RAGIndex[]> => {
    const requestId = ++fetchRequestRef.current
    setLoading(true)
    try {
      const token = localStorage.getItem('aiquery_token')
      const headers: HeadersInit = {}
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const response = await fetch('/api/rag/indexes', { headers })
      if (response.ok) {
        const data = await response.json()
        const allIndexes = data.indexes || []

        const normalizeDs = (t: string | undefined): string => {
          if (!t) return ''
          const x = String(t).toLowerCase().trim()
          if (x === 'postgresql') return 'postgres'
          if (x === 'sqlserver') return 'azure'
          return x
        }

        const indexes = allIndexes.filter((index: RAGIndex) => {
          const idxDs = normalizeDs(index.dataSourceType)
          const srcDs = normalizeDs(source.type)
          return idxDs !== '' && idxDs === srcDs
        })
        
        // Hydrate UI `columns` from keyColumns (canonical in KB JSON); legacy: documents.metadata.schema
        indexes.forEach((index: RAGIndex) => {
          if (index.tables) {
            index.tables.forEach(table => {
              const t = table as RAGIndex['tables'][0]
              if ((!t.columns || t.columns.length === 0) && t.keyColumns && t.keyColumns.length > 0) {
                t.columns = t.keyColumns.map((k) => ({
                  name: k.name,
                  type: k.type,
                  description: k.description,
                  ragDescription: k.description,
                  nullable: false
                }))
              }
              if (!table.columns && index.documents) {
                const doc = index.documents.find(d => {
                  if (!d.metadata) return false
                  const dataSourceType = d.metadata.dataSourceType || index.dataSourceType
                  
                  if (dataSourceType === 'airtable') {
                    return d.metadata.tableId === table.id || d.metadata.tableId === table.name
                  } else if (dataSourceType === 'bigquery') {
                    const docId = `${d.metadata.datasetId || ''}.${d.metadata.tableId || ''}`
                    return docId === table.id || d.metadata.tableId === table.name
                  } else if (dataSourceType === 'databricks') {
                    const docId = d.metadata.schemaName 
                      ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                      : d.metadata.tableId
                    return docId === table.id || d.metadata.tableId === table.name
                  } else if (dataSourceType === 'postgres' || dataSourceType === 'postgresql') {
                    const docId = d.metadata.schemaName 
                      ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                      : d.metadata.tableId
                    return docId === table.id || d.metadata.tableId === table.name
                  } else if (dataSourceType === 'redshift') {
                    const docId = d.metadata.schemaName 
                      ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                      : d.metadata.tableId
                    return docId === table.id || d.metadata.tableId === table.name
                  } else if (dataSourceType === 'azure' || dataSourceType === 'sqlserver') {
                    const docId = d.metadata.schemaName 
                      ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                      : d.metadata.tableId
                    return docId === table.id || d.metadata.tableId === table.name
                  } else if (dataSourceType === 'snowflake') {
                    const docId = d.metadata.schemaName 
                      ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                      : d.metadata.tableId
                    return docId === table.id || d.metadata.tableId === table.name
                  } else if (dataSourceType === 'mysql') {
                    const docId = d.metadata.schemaName 
                      ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                      : d.metadata.tableId
                    return docId === table.id || d.metadata.tableId === table.name
                  } else {
                    // Fallback for unknown data source types
                    const docId = d.metadata.schemaName 
                      ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                      : d.metadata.tableId
                    return docId === table.id || d.metadata.tableId === table.name
                  }
                })
                if (doc?.metadata?.schema && Array.isArray(doc.metadata.schema)) {
                  // Ensure columns have all required properties
                  table.columns = doc.metadata.schema.map((col: any) => ({
                    name: col.name || '',
                    type: col.type || 'STRING',
                    mode: col.mode,
                    description: col.description || col.ragDescription,
                    ragDescription: col.ragDescription,
                    nullable: col.nullable ?? false
                  }))
                }
              } else if (table.columns && Array.isArray(table.columns)) {
                // Ensure existing columns have all required properties
                table.columns = table.columns.map((col: any) => ({
                  name: col.name || '',
                  type: col.type || 'STRING',
                  mode: col.mode,
                  description: col.description || col.ragDescription,
                  ragDescription: col.ragDescription,
                  nullable: col.nullable ?? false
                }))
              }
              if (t.columns?.length && t.keyColumns?.length) {
                const km = new Map(t.keyColumns.map((k) => [k.name, k]))
                t.columns = t.columns.map((c) => {
                  const k = km.get(c.name)
                  const desc =
                    (c.description && String(c.description).trim()) ||
                    (c.ragDescription && String(c.ragDescription).trim()) ||
                    (k?.description && String(k.description).trim()) ||
                    ''
                  return {
                    ...c,
                    description: desc || undefined,
                    ragDescription: k?.description
                  }
                })
              }
            })
          }
        })
        
        if (requestId !== fetchRequestRef.current) {
          return []
        }

        setRAGIndexes(indexes)
        
        // Preserve current selection if it still exists
        if (currentIndex) {
          const preservedIndex = indexes.find((idx: RAGIndex) => getIndexIdentifier(idx) === getIndexIdentifier(currentIndex))
          if (preservedIndex) {
            setCurrentIndex(preservedIndex)
          } else if (indexes.length > 0) {
            setCurrentIndex(indexes[0])
          } else {
            setCurrentIndex(null)
          }
        } else if (indexes.length > 0) {
          setCurrentIndex(indexes[0])
        }
        
        return indexes
      }
      if (requestId === fetchRequestRef.current) {
        setRAGIndexes([])
        setCurrentIndex(null)
      }
      return []
    } catch (err) {
      console.error('Error fetching Knowledge Bases:', err)
      if (requestId === fetchRequestRef.current) {
        setRAGIndexes([])
        setCurrentIndex(null)
      }
      return []
    } finally {
      if (requestId === fetchRequestRef.current) {
        setLoading(false)
      }
    }
  }

  const getIndexIdentifier = (index: RAGIndex): string => {
    const dataSourceType = index.dataSourceType || source.type
    if (dataSourceType === 'airtable') {
      return index.baseId || index.projectId || index.id || ''
    } else if (dataSourceType === 'bigquery') {
      return index.projectId || index.id || ''
    } else if (dataSourceType === 'databricks') {
      return index.database || index.id || ''
    } else if (dataSourceType === 'postgres' || dataSourceType === 'postgresql') {
      return index.database || index.id || ''
    } else if (dataSourceType === 'redshift') {
      return index.database || index.id || ''
    } else if (dataSourceType === 'azure' || dataSourceType === 'sqlserver') {
      return index.database || index.id || ''
    } else if (dataSourceType === 'snowflake') {
      return index.database || index.id || ''
    } else if (dataSourceType === 'mysql') {
      return index.database || index.id || ''
    } else {
      // Fallback for unknown data source types
      return index.database || index.id || ''
    }
  }

  const handleCreateNew = async () => {
    try {
      console.log('=== handleCreateNew called ===')
      console.log('isAuthenticated:', isAuthenticated)
      console.log('canConfigure:', canConfigure)
      console.log('source:', source.id, source.type)
      
      const loadedConnections = await loadConnections()
      console.log('Loaded connections:', loadedConnections)
      console.log('Looking for source.id:', source.id)
      
      const sourceConfig = loadedConnections[source.id] || connections[source.id]
      console.log('Source config found:', sourceConfig)
      
      if (!sourceConfig) {
        console.warn('No source config found')
        alert(`Please configure a ${source.name} connection first.`)
        return
      }

      let isValid = false
      let errorMessage = ''
      if (source.type === 'bigquery') {
        isValid = !!(sourceConfig.projectId && sourceConfig.serviceAccountKey)
        if (!isValid) {
          errorMessage = 'Project ID and Service Account Key are required for BigQuery RAG creation.'
        }
      } else if (source.type === 'airtable') {
        if (!sourceConfig.apiKey) {
          isValid = false
          errorMessage = 'Airtable Token is required for RAG creation.'
        } else if (!sourceConfig.baseId) {
          isValid = false
          errorMessage = 'Base ID is required for RAG creation. Please provide a Base ID in your Airtable connection configuration.'
        } else {
          isValid = true
        }
      } else if (source.type === 'databricks') {
        // Databricks validation based on connection method
        const connectionMethod = sourceConfig.connectionMethod || 'url'
        if (connectionMethod === 'host') {
          // Client connection
          if (!sourceConfig.serverHostname && !sourceConfig.host && !sourceConfig.server) {
            isValid = false
            errorMessage = 'Host is required for Databricks Client connection.'
          } else if (!sourceConfig.clientId) {
            isValid = false
            errorMessage = 'Client ID is required for Databricks Client connection.'
          } else if (!sourceConfig.clientSecret) {
            isValid = false
            errorMessage = 'Client Secret is required for Databricks Client connection.'
          } else if (!sourceConfig.database) {
            isValid = false
            errorMessage = 'Database is required for Databricks RAG creation.'
          } else {
            isValid = true
          }
        } else {
          // URL connection
          if (!sourceConfig.jdbcUrl) {
            isValid = false
            errorMessage = 'JDBC URL is required for Databricks URL connection.'
          } else if (!sourceConfig.tokenName) {
            isValid = false
            errorMessage = 'Token Name is required for Databricks URL connection.'
          } else if (!sourceConfig.token && !sourceConfig.accessToken) {
            isValid = false
            errorMessage = 'Token is required for Databricks URL connection.'
          } else {
            // Try to extract database from JDBC URL if not explicitly set
            let database = sourceConfig.database;
            if (!database && sourceConfig.jdbcUrl) {
              const jdbcMatch = sourceConfig.jdbcUrl.match(/jdbc:databricks:\/\/[^:]+:\d+\/([^;]+)/);
              if (jdbcMatch && jdbcMatch[1]) {
                database = jdbcMatch[1];
                // Store it in the config for later use
                sourceConfig.database = database;
              }
            }
            if (!database) {
              isValid = false
              errorMessage = 'Database is required for Databricks RAG creation. Please ensure your JDBC URL includes the database name (e.g., jdbc:databricks://host:port/database;params) or provide it separately.'
            } else {
              isValid = true
            }
          }
        }
      } else if (source.type === 'postgres' || source.type === 'postgresql') {
        isValid = !!(sourceConfig.database && sourceConfig.username && sourceConfig.password)
        if (!isValid) {
          errorMessage = 'Database, username, and password are required for PostgreSQL RAG creation.'
        }
      } else if (source.type === 'redshift') {
        isValid = !!(sourceConfig.database && sourceConfig.username && sourceConfig.password)
        if (!isValid) {
          errorMessage = 'Database, username, and password are required for Redshift RAG creation.'
        }
      } else if (source.type === 'azure' || source.type === 'sqlserver') {
        isValid = !!(sourceConfig.database && sourceConfig.username && sourceConfig.password)
        if (!isValid) {
          errorMessage = 'Database, username, and password are required for Azure SQL Server / SQL Server RAG creation.'
        }
      } else if (source.type === 'snowflake') {
        isValid = !!(sourceConfig.database && sourceConfig.username && sourceConfig.password && sourceConfig.account && sourceConfig.warehouse)
        if (!isValid) {
          errorMessage = 'Database, username, password, account, and warehouse are required for Snowflake RAG creation.'
        }
      } else if (source.type === 'mysql') {
        isValid = !!(sourceConfig.database && sourceConfig.username && sourceConfig.password)
        if (!isValid) {
          errorMessage = 'Database, username, and password are required for MySQL RAG creation.'
        }
      } else {
        // Unknown data source type
        isValid = Object.keys(sourceConfig).length > 0
        if (!isValid) {
          errorMessage = `Please configure a valid ${source.name} connection first.`
        }
      }

      console.log('Connection validation result:', isValid)

      if (!isValid) {
        console.warn('Connection validation failed')
        alert(errorMessage || `Please configure a valid ${source.name} connection first.`)
        return
      }

      const configWithType = { ...sourceConfig, type: source.type }
      console.log('Setting selectedConnection and showing modal:', configWithType)
      setSelectedConnection(configWithType)
      setShowCreateModal(true)
      console.log('✅ Modal state set - showCreateModal: true, selectedConnection:', configWithType)
    } catch (error) {
      console.error('❌ Error in handleCreateNew:', error)
      alert(`An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleEdit = async (index: RAGIndex) => {
    setEditingIndex(index)
    await loadConnections()
    const sourceConfig = connections[source.id]
    
    if (!sourceConfig || Object.keys(sourceConfig).length === 0) {
      alert(`${source.name} connection not found.`)
      return
    }

    const configWithType = { ...sourceConfig, type: source.type }
    setSelectedConnection(configWithType)
    setShowCreateModal(true)
  }

  const handleDeleteIndex = async (identifier: string) => {
    if (!window.confirm(`Are you sure you want to delete the Knowledge Base?`)) {
      return
    }

    try {
      const token = localStorage.getItem('aiquery_token')
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const response = await fetch(`/api/rag/index/${encodeURIComponent(identifier)}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ dataSourceType: source.type })
      })

      if (response.ok) {
        fetchRAGIndexes()
        setCurrentIndex(null)
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to delete Knowledge Base')
      }
    } catch (err) {
      console.error('Error deleting Knowledge Base:', err)
      alert('Failed to delete Knowledge Base')
    }
  }

  // Dragging handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (modalRef.current && (e.target as HTMLElement).closest('.rag-management-header')) {
      const rect = modalRef.current.getBoundingClientRect()
      setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      setIsDragging(true)
    }
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && modalRef.current) {
        const newX = e.clientX - dragOffset.x
        const newY = e.clientY - dragOffset.y
        const maxX = window.innerWidth - modalRef.current.offsetWidth
        const maxY = window.innerHeight - modalRef.current.offsetHeight
        const x = Math.max(0, Math.min(newX, maxX))
        const y = Math.max(0, Math.min(newY, maxY))
        modalRef.current.style.left = `${x}px`
        modalRef.current.style.top = `${y}px`
        modalRef.current.style.transform = 'none'
      } else if (isResizing && modalRef.current) {
        const deltaX = e.clientX - resizeStartRef.current.x
        const deltaY = e.clientY - resizeStartRef.current.y
        const newWidth = Math.max(600, Math.min(window.innerWidth - 20, resizeStartRef.current.width + deltaX))
        const newHeight = Math.max(400, Math.min(window.innerHeight - 20, resizeStartRef.current.height + deltaY))
        setModalSize({ width: newWidth, height: newHeight })
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(false)
    }

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = isDragging ? 'grabbing' : 'nwse-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, isResizing, dragOffset])

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (modalRef.current) {
      setIsResizing(true)
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: modalSize.width,
        height: modalSize.height
      }
    }
  }

  // Table operations
  const filteredTables = currentIndex?.tables.filter(table => {
    if (!tableFilter) return true
    const search = tableFilter.toLowerCase()
    const displayName = table.id || `${table.dataset}.${table.name}` || table.name || ''
    const desc = (table.description || table.summary || '').toLowerCase()
    const purpose = (table.purpose || '').toLowerCase()
    return displayName.toLowerCase().includes(search) ||
           desc.includes(search) ||
           purpose.includes(search)
  }) || []

  const handleTableToggle = (tableId: string) => {
    setSelectedTables(prev => {
      const newSet = new Set(prev)
      if (newSet.has(tableId)) {
        newSet.delete(tableId)
      } else {
        newSet.add(tableId)
      }
      return newSet
    })
  }

  const handleSelectAllTables = () => {
    if (selectedTables.size === filteredTables.length) {
      setSelectedTables(new Set())
    } else {
      setSelectedTables(new Set(filteredTables.map(t => t.id)))
    }
  }

  const handleDeleteTables = async () => {
    if (!currentIndex || selectedTables.size === 0) return
    
    if (!window.confirm(`Delete ${selectedTables.size} selected table(s)?`)) return

    try {
      const token = localStorage.getItem('aiquery_token')
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const identifier = getIndexIdentifier(currentIndex)
      const response = await fetch('/api/rag/tables', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({
          projectId: currentIndex.projectId,
          baseId: currentIndex.baseId,
          database: currentIndex.database,
          tableIds: Array.from(selectedTables),
          dataSourceType: source.type
        })
      })

      if (response.ok) {
        setSelectedTables(new Set())
        fetchRAGIndexes()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to delete tables')
      }
    } catch (err) {
      console.error('Error deleting tables:', err)
      alert('Failed to delete tables')
    }
  }

  const handleSaveTable = async (tableId: string) => {
    if (!currentIndex) return

    const existing = currentIndex.tables.find((t) => t.id === tableId)
    const nameOk = (tableEditValues.name ?? existing?.name ?? '').toString().trim()
    const datasetOk = (tableEditValues.dataset ?? existing?.dataset ?? '').toString().trim()
    if (!nameOk && !datasetOk) {
      alert('Please provide at least a table name or dataset')
      return
    }

    try {
      const token = localStorage.getItem('aiquery_token')
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      // Prepare updates - only include fields that have been changed
      const updates: Record<string, unknown> = {}
      if (tableEditValues.name !== undefined) updates.name = tableEditValues.name
      if (tableEditValues.dataset !== undefined) updates.dataset = tableEditValues.dataset
      if (tableEditValues.summary !== undefined) updates.summary = tableEditValues.summary
      if (tableEditValues.description !== undefined) {
        updates.description = tableEditValues.description
        updates.summary = tableEditValues.description
      }
      if (tableEditValues.purpose !== undefined) updates.purpose = tableEditValues.purpose
      if (tableEditValues.columns !== undefined) {
        updates.columns = tableEditValues.columns
        updates.keyColumns = tableEditValues.columns.map((c) => ({
          name: c.name,
          type: c.type,
          description: c.description || '',
          examples: [] as unknown[]
        }))
      }

      const response = await fetch('/api/rag/table', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          projectId: currentIndex.projectId,
          baseId: currentIndex.baseId,
          database: currentIndex.database,
          tableId,
          updates,
          dataSourceType: source.type
        })
      })

      if (response.ok) {
        setEditingTable(null)
        setTableEditValues({})
        // Refresh the index list to show updated data
        const updatedIndexes = await fetchRAGIndexes()
        // Re-select the current index after refresh using the fresh data
        if (currentIndex) {
          const updatedIndex = updatedIndexes.find(idx => getIndexIdentifier(idx) === getIndexIdentifier(currentIndex))
          if (updatedIndex) {
            setCurrentIndex(updatedIndex)
          }
        }
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to update table')
      }
    } catch (err) {
      console.error('Error updating table:', err)
      alert('Failed to update table')
    }
  }

  const handleAddColumn = () => {
    setTableEditValues(prev => ({
      ...prev,
      columns: [...(prev.columns || []), { name: '', type: 'STRING', description: '', nullable: false }]
    }))
  }

  const handleRemoveColumn = (index: number) => {
    setTableEditValues(prev => ({
      ...prev,
      columns: prev.columns?.filter((_, i) => i !== index) || []
    }))
  }

  const handleUpdateColumn = (index: number, field: keyof Column, value: any) => {
    setTableEditValues(prev => {
      const columns = [...(prev.columns || [])]
      // Ensure the column object exists with all properties
      if (!columns[index]) {
        columns[index] = { name: '', type: 'STRING', description: '', nullable: false }
      }
      
      // Create a new column object with updated field
      const updatedColumn: Column = {
        name: field === 'name' ? String(value || '') : (columns[index].name || ''),
        type: field === 'type' ? String(value || 'STRING') : (columns[index].type || 'STRING'),
        mode: field === 'mode' ? (value ? String(value) : undefined) : columns[index].mode,
        description: field === 'description' ? (value ? String(value) : undefined) : columns[index].description,
        nullable: field === 'nullable' ? Boolean(value) : (columns[index].nullable ?? false)
      }
      
      columns[index] = updatedColumn
      
      console.log(`[handleUpdateColumn] Updated column ${index} field ${field} to:`, value)
      console.log(`[handleUpdateColumn] Updated column object:`, updatedColumn)
      
      return { ...prev, columns }
    })
  }

  // Q&A operations
  const filteredQuestions = currentIndex?.questions?.filter((qa, idx) => {
    if (!questionFilter) return true
    const search = questionFilter.toLowerCase()
    return qa.question.toLowerCase().includes(search) ||
           qa.query.toLowerCase().includes(search) ||
           (qa.answer && qa.answer.toLowerCase().includes(search))
  }) || []

  const handleQuestionToggle = (index: number) => {
    setSelectedQuestions(prev => {
      const newSet = new Set(prev)
      if (newSet.has(index)) {
        newSet.delete(index)
      } else {
        newSet.add(index)
      }
      return newSet
    })
  }

  const handleSelectAllQuestions = () => {
    if (selectedQuestions.size === filteredQuestions.length) {
      setSelectedQuestions(new Set())
    } else {
      setSelectedQuestions(new Set(filteredQuestions.map((_, idx) => idx)))
    }
  }

  const handleDeleteQuestions = async () => {
    if (!currentIndex || selectedQuestions.size === 0) return
    
    if (!window.confirm(`Delete ${selectedQuestions.size} selected Q&A pair(s)?`)) return

    try {
      const token = localStorage.getItem('aiquery_token')
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const identifier = getIndexIdentifier(currentIndex)
      // Map filtered indices to original indices
      const originalIndices: number[] = []
      currentIndex.questions?.forEach((qa, originalIdx) => {
        const filteredIdx = filteredQuestions.indexOf(qa)
        if (filteredIdx !== -1 && selectedQuestions.has(filteredIdx)) {
          originalIndices.push(originalIdx)
        }
      })

      const response = await fetch('/api/rag/questions', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({
          projectId: currentIndex.projectId,
          baseId: currentIndex.baseId,
          database: currentIndex.database,
          questionIndices: originalIndices,
          dataSourceType: source.type
        })
      })

      if (response.ok) {
        setSelectedQuestions(new Set())
        fetchRAGIndexes()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to delete Q&A pairs')
      }
    } catch (err) {
      console.error('Error deleting Q&A pairs:', err)
      alert('Failed to delete Q&A pairs')
    }
  }

  const handleAddQuestion = () => {
    if (!currentIndex) return
    
    // Create a new empty question entry and set it to edit mode
    const newQuestionIndex = currentIndex.questions?.length || 0
    setQuestionEditValues({
      question: '',
      query: '',
      answer: ''
    })
    // Use a special marker for new questions
    setEditingQuestion('new')
  }

  const handleSaveQuestion = async (questionIndex: number | 'new') => {
    if (!currentIndex) return

    // Validate that question is provided
    if (!questionEditValues.question || questionEditValues.question.trim() === '') {
      alert('Please provide a question')
      return
    }

    try {
      const token = localStorage.getItem('aiquery_token')
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      // If it's a new question, use POST to add it
      if (questionIndex === 'new') {
        const response = await fetch('/api/rag/add-question', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            projectId: currentIndex.projectId,
            baseId: currentIndex.baseId,
            database: currentIndex.database,
            question: questionEditValues.question,
            query: questionEditValues.query || '',
            answer: questionEditValues.answer || '',
            dataSourceType: source.type
          })
        })

        if (response.ok) {
          setEditingQuestion(null)
          setQuestionEditValues({})
          // Refresh the index list to show updated data
          const updatedIndexes = await fetchRAGIndexes()
          // Re-select the current index after refresh using the fresh data
          if (currentIndex) {
            const updatedIndex = updatedIndexes.find(idx => getIndexIdentifier(idx) === getIndexIdentifier(currentIndex))
            if (updatedIndex) {
              setCurrentIndex(updatedIndex)
            }
          }
        } else {
          const data = await response.json()
          alert(data.error || 'Failed to add Q&A pair')
        }
      } else {
        // Existing question - update it
        const updates: any = {}
        if (questionEditValues.question !== undefined) updates.question = questionEditValues.question
        if (questionEditValues.query !== undefined) updates.query = questionEditValues.query
        if (questionEditValues.answer !== undefined) updates.answer = questionEditValues.answer

        const response = await fetch('/api/rag/question', {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            projectId: currentIndex.projectId,
            baseId: currentIndex.baseId,
            database: currentIndex.database,
            questionIndex,
            updates,
            dataSourceType: source.type
          })
        })

        if (response.ok) {
          setEditingQuestion(null)
          setQuestionEditValues({})
          // Refresh the index list to show updated data
          const updatedIndexes = await fetchRAGIndexes()
          // Re-select the current index after refresh using the fresh data
          if (currentIndex) {
            const updatedIndex = updatedIndexes.find(idx => getIndexIdentifier(idx) === getIndexIdentifier(currentIndex))
            if (updatedIndex) {
              setCurrentIndex(updatedIndex)
            }
          }
        } else {
          const data = await response.json()
          alert(data.error || 'Failed to update Q&A pair')
        }
      }
    } catch (err) {
      console.error('Error saving Q&A pair:', err)
      alert('Failed to save Q&A pair')
    }
  }

  const handleRAGCreated = () => {
    console.log('✅ RAG created successfully, closing modal')
    setShowCreateModal(false)
    setEditingIndex(null)
    preservedConnection.current = null // Clear preserved connection on success
    setSelectedConnection(null)
    fetchRAGIndexes()
  }

  // Render modal outside the main overlay using portal
  // Use preserved connection if selectedConnection is temporarily null
  const connectionToUse = selectedConnection || preservedConnection.current
  const shouldRenderModal = showCreateModal && connectionToUse
  
  const modalPortal = shouldRenderModal ? createPortal(
    <RAGCreationModal
      source={source}
      connectionConfig={connectionToUse}
      onClose={() => {
        console.log('RAGCreationModal onClose called')
        setShowCreateModal(false)
        setEditingIndex(null)
        preservedConnection.current = null // Clear preserved connection on close
        setSelectedConnection(null)
      }}
      onSuccess={handleRAGCreated}
      existingIndex={editingIndex && editingIndex.projectId ? {
        projectId: editingIndex.projectId,
        datasets: editingIndex.datasets || [],
        tables: (editingIndex.tables || []).map(t => ({
          id: t.id || '',
          name: t.name || '',
          dataset: t.dataset || '',
          summary: t.summary || ''
        }))
      } : null}
    />,
    document.body
  ) : null

  const contentStyle = inline ? {
    position: 'static' as const,
    width: '100%',
    height: 'auto'
  } : {
    position: 'absolute' as const,
    width: `${modalSize.width}px`,
    height: `${modalSize.height}px`,
    cursor: isDragging ? 'grabbing' : 'default'
  }

  if (!currentIndex && !loading && ragIndexes.length === 0) {
    return (
      <>
        {modalPortal}
        {inline ? (
          <div className="rag-management-panel">
            <div 
              ref={modalRef}
              className="rag-management-content" 
              onClick={(e) => e.stopPropagation()}
              style={contentStyle}
            >
              <div 
                className="rag-management-header"
                onMouseDown={handleMouseDown}
                style={{ cursor: inline ? 'default' : 'grab' }}
              >
                <div className="rag-header-left">
                  <h2>Knowledge Base - {source.name}</h2>
                </div>
                <div className="rag-header-right">
                  {inline && (
                    <button
                      className="rag-management-collapse-btn"
                      onClick={() => setIsCollapsed(v => !v)}
                      aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                      title={isCollapsed ? 'Expand' : 'Collapse'}
                      type="button"
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        {isCollapsed ? (
                          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        ) : (
                          <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        )}
                      </svg>
                    </button>
                  )}
                  {inline && onToggleMaximize && (
                    <button
                      className="rag-management-maximize-btn"
                      onClick={onToggleMaximize}
                      aria-label={isMaximized ? 'Restore' : 'Maximize'}
                      type="button"
                    >
                      {isMaximized ? (
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
                  )}
                  <button className="rag-management-close-btn" onClick={onClose} aria-label="Close">×</button>
                </div>
              </div>
              {!isCollapsed && <div className="rag-management-body">
                <div className="rag-management-actions">
                  {(canConfigure || isAuthenticated) ? (
                    <button 
                      className="btn-create-rag" 
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        console.log('🔘 Button clicked!')
                        handleCreateNew()
                      }}
                      type="button"
                    >
                      + Create New Knowledge Base
                    </button>
                  ) : (
                    <div style={{ padding: '10px', fontSize: '12px', color: '#999', textAlign: 'center' }}>
                      View Only - No Configuration Access
                    </div>
                  )}
                </div>
                <div className="rag-empty">
                  <p>No Knowledge Bases found. Create one to get started!</p>
                </div>
              </div>}
            </div>
          </div>
        ) : (
          <div className="rag-management-overlay" onClick={onClose}>
          <div 
            ref={modalRef}
            className="rag-management-content" 
            onClick={(e) => e.stopPropagation()}
            style={contentStyle}
          >
            <div 
              className="rag-management-header"
              onMouseDown={handleMouseDown}
              style={{ cursor: 'grab' }}
            >
              <div className="rag-header-left">
                <h2>Knowledge Base - {source.name}</h2>
              </div>
              <div className="rag-header-right">
                <button className="rag-management-close-btn" onClick={onClose} aria-label="Close">×</button>
              </div>
            </div>
            <div className="rag-management-body">
              <div className="rag-management-actions">
                {(canConfigure || isAuthenticated) ? (
                  <button 
                    className="btn-create-rag" 
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      console.log('🔘 Button clicked!')
                      handleCreateNew()
                    }}
                    type="button"
                  >
                    + Create New Knowledge Base
                  </button>
                ) : (
                  <div style={{ padding: '10px', fontSize: '12px', color: '#999', textAlign: 'center' }}>
                    View Only - No Configuration Access
                  </div>
                )}
              </div>
              <div className="rag-empty">
                <p>No Knowledge Bases found. Create one to get started!</p>
              </div>
            </div>
            <div className="resize-handle" onMouseDown={handleResizeStart}></div>
          </div>
        </div>
        )}
      </>
    )
  }

  const panelBody = (
    <>
      <div 
        className="rag-management-header"
        onMouseDown={handleMouseDown}
        style={{ cursor: inline ? 'default' : 'grab' }}
      >
        <div className="rag-header-left">
          <h2>Knowledge Base - {source.name}</h2>
        </div>
        <div className="rag-header-right">
          {inline && (
            <button
              className="rag-management-collapse-btn"
              onClick={() => setIsCollapsed(v => !v)}
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
              title={isCollapsed ? 'Expand' : 'Collapse'}
              type="button"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                {isCollapsed ? (
                  <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </button>
          )}
          {inline && onToggleMaximize && (
            <button
              className="rag-management-maximize-btn"
              onClick={onToggleMaximize}
              aria-label={isMaximized ? 'Restore' : 'Maximize'}
              type="button"
            >
              {isMaximized ? (
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
          )}
          <button className="rag-management-close-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {!isCollapsed && (
      <>
        {/* Project Selection Section */}
        {ragIndexes.length > 0 && (
          <div className="rag-project-selection">
            <div className="rag-project-selector-wrapper">
              <label className="rag-project-label">Select Knowledge Base:</label>
              <select 
                className="rag-index-selector"
                value={currentIndex ? getIndexIdentifier(currentIndex) : ''}
                onChange={(e) => {
                  const index = ragIndexes.find(idx => getIndexIdentifier(idx) === e.target.value)
                  if (index) setCurrentIndex(index)
                }}
              >
                {ragIndexes.map(index => (
                  <option key={getIndexIdentifier(index)} value={getIndexIdentifier(index)}>
                    {index.dataSourceType === 'airtable' ? `Base: ${index.baseId}` : 
                     index.dataSourceType === 'bigquery' ? `Project: ${index.projectId}` :
                     `Database: ${index.database || source.name}`}
                  </option>
                ))}
              </select>
            </div>
            {canConfigure && currentIndex && (
              <div className="rag-project-actions">
                <button className="btn-edit" onClick={() => handleEdit(currentIndex)}>Edit</button>
                <button className="btn-delete" onClick={() => handleDeleteIndex(getIndexIdentifier(currentIndex))}>Delete</button>
              </div>
            )}
          </div>
        )}

        <div className="rag-management-body">
        <div className="rag-management-actions">
          {(canConfigure || isAuthenticated) && (
            <button 
              className="btn-create-rag" 
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                console.log('🔘 Button clicked!')
                handleCreateNew()
              }}
              title={!canConfigure ? 'Permission check in progress...' : 'Create a new Knowledge Base'}
            >
              + Create New Knowledge Base
            </button>
          )}
        </div>

        {loading ? (
          <div className="rag-loading">
            <div className="rag-spinner"></div>
            <p>Loading Knowledge Bases...</p>
          </div>
        ) : currentIndex ? (
          <div className="rag-two-column-layout">
            {/* Left Column: Tables */}
            {(tablesClosed || fewShotClosed) && (
              <div className="rag-closed-panels-bar">
                {tablesClosed && (
                  <button
                    type="button"
                    className="rag-restore-panel-btn"
                    onClick={() => restoreSection('tables')}
                    aria-label="Restore Knowledge Base Tables section"
                    title="Restore Knowledge Base Tables"
                  >
                    Restore Knowledge Base Tables
                  </button>
                )}
                {fewShotClosed && (
                  <button
                    type="button"
                    className="rag-restore-panel-btn"
                    onClick={() => restoreSection('fewShot')}
                    aria-label="Restore Few-Shot Prompt section"
                    title="Restore Few-Shot Prompt"
                  >
                    Restore Few-Shot Prompt
                  </button>
                )}
              </div>
            )}

            {!tablesClosed && (maximizedSection === null || maximizedSection === 'tables') && (
            <div className={`rag-column-panel ${tablesCollapsed ? 'rag-panel-collapsed' : ''} ${maximizedSection === 'tables' ? 'rag-panel-maximized' : ''}`}>
              <div className="rag-panel-header">
                <div className="rag-panel-header-top">
                  <h3>Knowledge Base Tables ({currentIndex.tables.length})</h3>
                  <div className="rag-panel-window-controls">
                    <button
                      type="button"
                      className="rag-panel-collapse-btn"
                      onClick={() => setTablesCollapsed(v => !v)}
                      aria-label={tablesCollapsed ? 'Expand Knowledge Base Tables section' : 'Collapse Knowledge Base Tables section'}
                      title={tablesCollapsed ? 'Expand' : 'Collapse'}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        {tablesCollapsed ? (
                          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        ) : (
                          <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        )}
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="rag-panel-icon-btn"
                      onClick={() => toggleMaximizeSection('tables')}
                      aria-label={maximizedSection === 'tables' ? 'Restore Knowledge Base Tables section' : 'Maximize Knowledge Base Tables section'}
                      title={maximizedSection === 'tables' ? 'Restore' : 'Maximize'}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        {maximizedSection === 'tables' ? (
                          <>
                            <path d="M6 4h6v6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                            <path d="M4 6h6v6H4z" fill="none" stroke="currentColor" strokeWidth="1.4" />
                          </>
                        ) : (
                          <path d="M4 4h8v8H4z" fill="none" stroke="currentColor" strokeWidth="1.4" />
                        )}
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="rag-panel-icon-btn"
                      onClick={() => closeSection('tables')}
                      aria-label="Close Knowledge Base Tables section"
                      title="Close"
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              {!tablesCollapsed && (
                <div className="rag-panel-toolbar">
                  <div className="rag-filter-container">
                    <input
                      type="text"
                      className="rag-filter-input"
                      placeholder="🔍 Filter tables..."
                      value={tableFilter}
                      onChange={(e) => setTableFilter(e.target.value)}
                    />
                  </div>
                  <div className="rag-select-controls">
                    <button 
                      className="btn-select-all" 
                      onClick={handleSelectAllTables}
                      title={selectedTables.size === filteredTables.length ? 'Deselect All' : 'Select All'}
                    >
                      {selectedTables.size === filteredTables.length ? '☑' : '☐'} Select All
                    </button>
                    {selectedTables.size > 0 && (
                      <button className="btn-delete-selected" onClick={handleDeleteTables}>
                        🗑️ Delete Selected ({selectedTables.size})
                      </button>
                    )}
                  </div>
                </div>
              )}
              {!tablesCollapsed && (
              <div className="rag-panel-content">
                {filteredTables.length === 0 ? (
                  <div className="rag-empty-state">No tables found</div>
                ) : (
                  <div className="rag-list">
                    {filteredTables.map(table => {
                      const displayName = table.id || `${table.dataset}.${table.name}` || table.name || 'Unknown'
                      const isEditing = editingTable === table.id
                      
                      // Compute normalized columns for this table when editing
                      let normalizedColumns: Column[] = []
                      if (isEditing) {
                        let sourceColumns: any[] = []
                        
                        // Always prefer tableEditValues.columns if it exists when editing this table
                        if (tableEditValues.columns !== undefined) {
                          sourceColumns = tableEditValues.columns
                          console.log('Using tableEditValues.columns for table', table.id, ':', sourceColumns)
                        } else if (table.columns && Array.isArray(table.columns) && table.columns.length > 0) {
                          sourceColumns = table.columns
                          console.log('Using table.columns for table', table.id, ':', sourceColumns)
                        }
                        
                        // Normalize columns using JSON deep clone
                        normalizedColumns = sourceColumns.map((col: any, idx: number) => {
                          try {
                            // Deep clone to remove prototype issues
                            const cleanCol = col ? JSON.parse(JSON.stringify(col)) : {}
                            
                            // Extract values explicitly
                            const colName = cleanCol.name != null && cleanCol.name !== undefined 
                              ? String(cleanCol.name).trim() 
                              : ''
                            const colType = cleanCol.type != null && cleanCol.type !== undefined
                              ? String(cleanCol.type).trim()
                              : 'STRING'
                            const colMode = cleanCol.mode != null && cleanCol.mode !== undefined && cleanCol.mode !== ''
                              ? String(cleanCol.mode).trim()
                              : undefined
                            const colDesc =
                              (cleanCol.description != null &&
                                cleanCol.description !== undefined &&
                                cleanCol.description !== '' &&
                                String(cleanCol.description).trim()) ||
                              (cleanCol.ragDescription != null &&
                                cleanCol.ragDescription !== undefined &&
                                cleanCol.ragDescription !== '' &&
                                String(cleanCol.ragDescription).trim()) ||
                              undefined
                            const colNullable = cleanCol.nullable != null
                              ? Boolean(cleanCol.nullable)
                              : false
                            
                            const normalized: Column = {
                              name: colName,
                              type: colType,
                              mode: colMode,
                              description: colDesc,
                              nullable: colNullable
                            }
                            
                            console.log(`Table ${table.id} Column ${idx} normalization:`, {
                              'original': col,
                              'cleanCol': cleanCol,
                              'cleanCol.name': cleanCol.name,
                              'cleanCol.name type': typeof cleanCol.name,
                              'colName extracted': colName,
                              'colName type': typeof colName,
                              'normalized': normalized,
                              'normalized.name': normalized.name,
                              'normalized.name type': typeof normalized.name,
                              'normalized.name === ""': normalized.name === ''
                            })
                            
                            return normalized
                          } catch (e) {
                            console.error(`Error normalizing column ${idx}:`, e, col)
                            // Fallback: direct property access
                            const fallbackName = col?.name != null ? String(col.name).trim() : ''
                            console.log(`Fallback column ${idx} name:`, fallbackName)
                            return {
                              name: fallbackName,
                              type: col?.type != null ? String(col.type).trim() : 'STRING',
                              mode: col?.mode && col.mode !== '' ? String(col.mode).trim() : undefined,
                              description: col?.description && col.description !== '' ? String(col.description).trim() : undefined,
                              nullable: col?.nullable != null ? Boolean(col.nullable) : false
                            }
                          }
                        })
                        console.log('Final normalizedColumns for table', table.id, ':', normalizedColumns)
                      }
                      
                      return (
                        <div key={table.id} className={`rag-item ${selectedTables.has(table.id) ? 'selected' : ''}`}>
                          <input
                            type="checkbox"
                            checked={selectedTables.has(table.id)}
                            onChange={() => handleTableToggle(table.id)}
                            className="rag-checkbox"
                          />
                          {isEditing ? (
                            <div className="rag-edit-form" onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault()
                                handleSaveTable(table.id)
                              } else if (e.key === 'Escape') {
                                e.preventDefault()
                                setEditingTable(null)
                                setTableEditValues({})
                              }
                            }}>
                              <label className="rag-edit-label">
                                Table Name:
                                <input
                                  type="text"
                                  value={tableEditValues.name ?? table.name ?? ''}
                                  onChange={(e) => setTableEditValues({ ...tableEditValues, name: e.target.value })}
                                  placeholder="Table name"
                                  autoFocus
                                />
                              </label>
                              <label className="rag-edit-label">
                                Dataset:
                                <input
                                  type="text"
                                  value={tableEditValues.dataset ?? table.dataset ?? ''}
                                  onChange={(e) => setTableEditValues({ ...tableEditValues, dataset: e.target.value })}
                                  placeholder="Dataset (optional)"
                                />
                              </label>
                              <label className="rag-edit-label">
                                Table description:
                                <textarea
                                  value={
                                    tableEditValues.description !== undefined
                                      ? tableEditValues.description
                                      : (table.description ?? table.summary ?? '')
                                  }
                                  onChange={(e) =>
                                    setTableEditValues({ ...tableEditValues, description: e.target.value })
                                  }
                                  placeholder="What this table stores and how it is used (2–5 sentences)"
                                  rows={3}
                                />
                              </label>
                              <label className="rag-edit-label">
                                Purpose:
                                <textarea
                                  value={
                                    tableEditValues.purpose !== undefined
                                      ? tableEditValues.purpose
                                      : (table.purpose ?? '')
                                  }
                                  onChange={(e) =>
                                    setTableEditValues({ ...tableEditValues, purpose: e.target.value })
                                  }
                                  placeholder="Business / operational purpose (1–2 sentences)"
                                  rows={2}
                                />
                              </label>
                              
                              {/* Columns: same table layout as read-only (Ellie RAG–style) — name, type, description always visible */}
                              <div className="rag-columns-edit-section">
                                <div className="rag-columns-header">
                                  <label className="rag-edit-label" style={{ marginBottom: 0 }}>
                                    Columns
                                  </label>
                                  <button 
                                    type="button"
                                    className="btn-add-column" 
                                    onClick={handleAddColumn}
                                  >
                                    + Add Column
                                  </button>
                                </div>
                                <div className="rag-kb-columns-wrap">
                                  <table className="rag-kb-columns-table rag-kb-columns-edit-table">
                                    <thead>
                                      <tr>
                                        <th scope="col">Column name</th>
                                        <th scope="col">Data type</th>
                                        <th scope="col">Column description</th>
                                        <th scope="col">Mode</th>
                                        <th scope="col">Null</th>
                                        <th scope="col" className="rag-kb-col-action-th" aria-label="Actions" />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {normalizedColumns.map((column, colIdx) => {
                                        const columnName = column.name != null ? String(column.name) : ''
                                        const columnType = column.type != null ? String(column.type) : 'STRING'
                                        const columnMode = column.mode != null && column.mode !== '' ? String(column.mode) : ''
                                        const columnDescription =
                                          column.description != null && column.description !== ''
                                            ? String(column.description)
                                            : ''
                                        const columnNullable = column.nullable != null ? Boolean(column.nullable) : false

                                        return (
                                          <tr key={`col-${table.id}-${colIdx}`}>
                                            <td className="rag-kb-col-edit-name">
                                              <input
                                                type="text"
                                                value={columnName}
                                                onChange={(e) => handleUpdateColumn(colIdx, 'name', e.target.value)}
                                                placeholder="Column name"
                                                className="rag-column-input rag-kb-col-edit-input"
                                                aria-label={`Column name: ${columnName || `column ${colIdx + 1}`}`}
                                                autoComplete="off"
                                              />
                                            </td>
                                            <td className="rag-kb-col-edit-type">
                                              <select
                                                value={columnType}
                                                onChange={(e) => handleUpdateColumn(colIdx, 'type', e.target.value)}
                                                className="rag-column-select rag-kb-col-edit-select"
                                                aria-label={`Data type for ${columnName || 'column'}`}
                                              >
                                                <option value="STRING">STRING</option>
                                                <option value="INTEGER">INTEGER</option>
                                                <option value="FLOAT">FLOAT</option>
                                                <option value="BOOLEAN">BOOLEAN</option>
                                                <option value="DATE">DATE</option>
                                                <option value="TIMESTAMP">TIMESTAMP</option>
                                                <option value="NUMERIC">NUMERIC</option>
                                                <option value="BYTES">BYTES</option>
                                                <option value="RECORD">RECORD</option>
                                              </select>
                                            </td>
                                            <td className="rag-kb-col-edit-desc">
                                              <textarea
                                                value={columnDescription}
                                                onChange={(e) =>
                                                  handleUpdateColumn(colIdx, 'description', e.target.value || undefined)
                                                }
                                                placeholder="Column description"
                                                rows={3}
                                                className="rag-column-description rag-column-description-primary rag-kb-col-edit-textarea"
                                                aria-label={`Column description for ${columnName || 'column'}`}
                                              />
                                            </td>
                                            <td className="rag-kb-col-edit-mode">
                                              <input
                                                type="text"
                                                value={columnMode}
                                                onChange={(e) => handleUpdateColumn(colIdx, 'mode', e.target.value)}
                                                placeholder="e.g. NULLABLE"
                                                className="rag-column-input-small rag-kb-col-edit-input"
                                                title="BigQuery mode (e.g. NULLABLE, REQUIRED)"
                                              />
                                            </td>
                                            <td className="rag-kb-col-edit-null">
                                              <label className="rag-checkbox-label rag-column-nullable-label">
                                                <input
                                                  type="checkbox"
                                                  checked={columnNullable}
                                                  onChange={(e) => handleUpdateColumn(colIdx, 'nullable', e.target.checked)}
                                                />
                                                Null
                                              </label>
                                            </td>
                                            <td className="rag-kb-col-edit-actions">
                                              <button
                                                type="button"
                                                className="btn-remove-column"
                                                onClick={() => handleRemoveColumn(colIdx)}
                                                title="Remove column"
                                              >
                                                ×
                                              </button>
                                            </td>
                                          </tr>
                                        )
                                      })}
                                      {normalizedColumns.length === 0 && (
                                        <tr>
                                          <td colSpan={6} className="rag-no-columns-cell">
                                            No columns. Click &quot;Add Column&quot; to add one.
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              <div className="rag-edit-actions">
                                <button className="btn-save" onClick={() => handleSaveTable(table.id)}>💾 Save</button>
                                <button className="btn-cancel" onClick={() => { setEditingTable(null); setTableEditValues({}) }}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="rag-item-content">
                              <div className="rag-item-main">
                                <div className="rag-item-name">{displayName}</div>
                                {(table.description || table.summary) && (
                                  <div className="rag-item-meta rag-item-description">
                                    <strong>Description:</strong> {table.description || table.summary}
                                  </div>
                                )}
                                {table.purpose && (
                                  <div className="rag-item-meta rag-item-purpose">
                                    <strong>Purpose:</strong> {table.purpose}
                                  </div>
                                )}
                                {table.columns && table.columns.length > 0 && (
                                  <div className="rag-item-columns rag-kb-columns-wrap">
                                    <div className="rag-columns-header-small rag-kb-columns-header-row">
                                      <strong>Columns</strong>
                                      {table.columns.length > 8 && (
                                        <button
                                          type="button"
                                          className="btn-show-columns"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setExpandedColumns((prev) => {
                                              const next = new Set(prev)
                                              if (next.has(table.id)) next.delete(table.id)
                                              else next.add(table.id)
                                              return next
                                            })
                                          }}
                                        >
                                          {expandedColumns.has(table.id)
                                            ? 'Show less'
                                            : `Show all ${table.columns.length} columns`}
                                        </button>
                                      )}
                                    </div>
                                    <table className="rag-kb-columns-table">
                                      <thead>
                                        <tr>
                                          <th scope="col">Column name</th>
                                          <th scope="col">Data type</th>
                                          <th scope="col">Column description</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {(() => {
                                          const isExpanded = expandedColumns.has(table.id)
                                          const cols = isExpanded
                                            ? [...table.columns].sort((a, b) =>
                                                a.name.localeCompare(b.name)
                                              )
                                            : table.columns.slice(0, 8)
                                          return cols.map((col, idx) => {
                                            const desc =
                                              col.description ||
                                              col.ragDescription ||
                                              ''
                                            return (
                                              <tr key={`${table.id}-col-${idx}`}>
                                                <td className="rag-kb-col-name">{col.name}</td>
                                                <td className="rag-kb-col-type">
                                                  <code>{col.type}</code>
                                                </td>
                                                <td className="rag-kb-col-desc">
                                                  {desc ? desc : <span className="rag-kb-col-empty">—</span>}
                                                </td>
                                              </tr>
                                            )
                                          })
                                        })()}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                              {canConfigure && (
                                <button 
                                  className="btn-edit-item" 
                                  onClick={() => {
                                    setEditingTable(table.id)
                                    // Ensure we have columns - check both table.columns and try to get from currentIndex documents
                                    let columnsToUse: Column[] = []
                                    
                                    // First, try to use table.columns (which should have columns from backend enrichment)
                                    if (table.columns && Array.isArray(table.columns) && table.columns.length > 0) {
                                      // Deep clone columns to ensure we have fresh objects with all properties
                                      columnsToUse = table.columns.map((col: any) => {
                                        const normalized: Column = {
                                          name: String(col?.name || ''),
                                          type: String(col?.type || 'STRING'),
                                          mode: col?.mode ? String(col.mode) : undefined,
                                          description:
                                            (col?.description && String(col.description)) ||
                                            (col?.ragDescription && String(col.ragDescription)) ||
                                            undefined,
                                          ragDescription: col?.ragDescription
                                            ? String(col.ragDescription)
                                            : undefined,
                                          nullable: Boolean(col?.nullable ?? false)
                                        }
                                        return normalized
                                      })
                                      console.log('Using table.columns, normalized:', columnsToUse)
                                    } else if (currentIndex?.documents) {
                                      // Fallback: try to get from documents
                                      const doc = currentIndex.documents.find(d => {
                                        if (!d.metadata) return false
                                        const dataSourceType = d.metadata.dataSourceType || currentIndex.dataSourceType
                                        
                                        if (dataSourceType === 'airtable') {
                                          return d.metadata.tableId === table.id || d.metadata.tableId === table.name
                                        } else if (dataSourceType === 'bigquery') {
                                          const docId = `${d.metadata.datasetId || ''}.${d.metadata.tableId || ''}`
                                          return docId === table.id || d.metadata.tableId === table.name
                                        } else if (dataSourceType === 'databricks') {
                                          const docId = d.metadata.schemaName 
                                            ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                                            : d.metadata.tableId
                                          return docId === table.id || d.metadata.tableId === table.name
                                        } else if (dataSourceType === 'postgres' || dataSourceType === 'postgresql') {
                                          const docId = d.metadata.schemaName 
                                            ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                                            : d.metadata.tableId
                                          return docId === table.id || d.metadata.tableId === table.name
                                        } else if (dataSourceType === 'redshift') {
                                          const docId = d.metadata.schemaName 
                                            ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                                            : d.metadata.tableId
                                          return docId === table.id || d.metadata.tableId === table.name
                                        } else if (dataSourceType === 'azure' || dataSourceType === 'sqlserver') {
                                          const docId = d.metadata.schemaName 
                                            ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                                            : d.metadata.tableId
                                          return docId === table.id || d.metadata.tableId === table.name
                                        } else if (dataSourceType === 'snowflake') {
                                          const docId = d.metadata.schemaName 
                                            ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                                            : d.metadata.tableId
                                          return docId === table.id || d.metadata.tableId === table.name
                                        } else if (dataSourceType === 'mysql') {
                                          const docId = d.metadata.schemaName 
                                            ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                                            : d.metadata.tableId
                                          return docId === table.id || d.metadata.tableId === table.name
                                        } else {
                                          // Fallback for unknown data source types
                                          const docId = d.metadata.schemaName 
                                            ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                                            : d.metadata.tableId
                                          return docId === table.id || d.metadata.tableId === table.name
                                        }
                                      })
                                      if (doc?.metadata?.schema && Array.isArray(doc.metadata.schema)) {
                                        columnsToUse = doc.metadata.schema.map((col: any) => {
                                          const normalized: Column = {
                                            name: String(col?.name || ''),
                                            type: String(col?.type || 'STRING'),
                                            mode: col?.mode ? String(col.mode) : undefined,
                                            description: col?.description ? String(col.description) : undefined,
                                            nullable: Boolean(col?.nullable ?? false)
                                          }
                                          console.log('Normalizing column from doc.metadata.schema:', col, '->', normalized)
                                          return normalized
                                        })
                                        console.log('Using doc.metadata.schema, normalized:', columnsToUse)
                                      }
                                    }
                                    
                                    console.log('Final columnsToUse for edit:', columnsToUse)
                                    console.log('First column:', columnsToUse[0])
                                    
                                    setTableEditValues({ 
                                      name: table.name, 
                                      dataset: table.dataset, 
                                      summary: table.summary,
                                      description: table.description ?? table.summary,
                                      purpose: table.purpose,
                                      columns: columnsToUse
                                    })
                                  }}
                                  title="Edit table"
                                >
                                  ✏️ Edit
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              )}
            </div>
            )}

            {/* Right Column: Q&A Pairs */}
            {!fewShotClosed && (maximizedSection === null || maximizedSection === 'fewShot') && (
            <div className={`rag-column-panel ${fewShotCollapsed ? 'rag-panel-collapsed' : ''} ${maximizedSection === 'fewShot' ? 'rag-panel-maximized' : ''}`}>
              <div className="rag-panel-header">
                <div className="rag-panel-header-top">
                  <h3>Few-Shot Prompt ({currentIndex.questions?.length || 0})</h3>
                  <div className="rag-panel-window-controls">
                    <button
                      type="button"
                      className="rag-panel-collapse-btn"
                      onClick={() => setFewShotCollapsed(v => !v)}
                      aria-label={fewShotCollapsed ? 'Expand Few-Shot Prompt section' : 'Collapse Few-Shot Prompt section'}
                      title={fewShotCollapsed ? 'Expand' : 'Collapse'}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        {fewShotCollapsed ? (
                          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        ) : (
                          <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        )}
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="rag-panel-icon-btn"
                      onClick={() => toggleMaximizeSection('fewShot')}
                      aria-label={maximizedSection === 'fewShot' ? 'Restore Few-Shot Prompt section' : 'Maximize Few-Shot Prompt section'}
                      title={maximizedSection === 'fewShot' ? 'Restore' : 'Maximize'}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        {maximizedSection === 'fewShot' ? (
                          <>
                            <path d="M6 4h6v6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                            <path d="M4 6h6v6H4z" fill="none" stroke="currentColor" strokeWidth="1.4" />
                          </>
                        ) : (
                          <path d="M4 4h8v8H4z" fill="none" stroke="currentColor" strokeWidth="1.4" />
                        )}
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="rag-panel-icon-btn"
                      onClick={() => closeSection('fewShot')}
                      aria-label="Close Few-Shot Prompt section"
                      title="Close"
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              {!fewShotCollapsed && (
                <div className="rag-panel-toolbar">
                  <div className="rag-filter-container">
                    <input
                      type="text"
                      className="rag-filter-input"
                      placeholder="🔍 Filter Prompt"
                      value={questionFilter}
                      onChange={(e) => setQuestionFilter(e.target.value)}
                    />
                  </div>
                  <div className="rag-select-controls">
                    {canConfigure && (
                      <button 
                        className="btn-add-question" 
                        onClick={handleAddQuestion}
                        title="Add new prompt"
                      >
                        ➕ Add Prompt
                      </button>
                    )}
                    <button 
                      className="btn-select-all" 
                      onClick={handleSelectAllQuestions}
                      title={selectedQuestions.size === filteredQuestions.length ? 'Deselect All' : 'Select All'}
                    >
                      {selectedQuestions.size === filteredQuestions.length ? '☑' : '☐'} Select All
                    </button>
                    {selectedQuestions.size > 0 && (
                      <button className="btn-delete-selected" onClick={handleDeleteQuestions}>
                        🗑️ Delete Selected ({selectedQuestions.size})
                      </button>
                    )}
                  </div>
                </div>
              )}
              {!fewShotCollapsed && (
              <div className="rag-panel-content">
                {editingQuestion === 'new' && (
                  <div className="rag-list">
                    <div className="rag-item">
                      <div className="rag-edit-form" onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault()
                          handleSaveQuestion('new')
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          setEditingQuestion(null)
                          setQuestionEditValues({})
                        }
                      }}>
                        <label className="rag-edit-label">
                          User Question:
                          <input
                            type="text"
                            value={questionEditValues.question ?? ''}
                            onChange={(e) => setQuestionEditValues({ ...questionEditValues, question: e.target.value })}
                            placeholder="User Question (required)"
                            autoFocus
                          />
                        </label>
                        <label className="rag-edit-label">
                          Assistant SQL Query:
                          <textarea
                            value={questionEditValues.query ?? ''}
                            onChange={(e) => setQuestionEditValues({ ...questionEditValues, query: e.target.value })}
                            placeholder="Assistant SQL Query (optional)"
                            rows={3}
                          />
                        </label>
                        <label className="rag-edit-label">
                          Assistant Answer:
                          <textarea
                            value={questionEditValues.answer ?? ''}
                            onChange={(e) => setQuestionEditValues({ ...questionEditValues, answer: e.target.value })}
                            placeholder="Assistant Answer (optional)"
                            rows={3}
                          />
                        </label>
                        <div className="rag-edit-actions">
                          <button className="btn-save" onClick={() => handleSaveQuestion('new')}>💾 Save</button>
                          <button className="btn-cancel" onClick={() => {
                            setEditingQuestion(null)
                            setQuestionEditValues({})
                          }}>❌ Cancel</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {filteredQuestions.length === 0 && editingQuestion !== 'new' ? (
                  <div className="rag-empty-state">No Few-Shot Prompt found</div>
                ) : (
                  <div className="rag-list">
                    {filteredQuestions.map((qa, filteredIdx) => {
                      const originalIdx = currentIndex.questions?.indexOf(qa) ?? filteredIdx
                      const isEditing = editingQuestion === originalIdx
                      const isSelected = selectedQuestions.has(filteredIdx)
                      return (
                        <div key={originalIdx} className={`rag-item ${isSelected ? 'selected' : ''}`}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleQuestionToggle(filteredIdx)}
                            className="rag-checkbox"
                          />
                          {isEditing ? (
                            <div className="rag-edit-form" onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault()
                                handleSaveQuestion(originalIdx)
                              } else if (e.key === 'Escape') {
                                e.preventDefault()
                                setEditingQuestion(null)
                                setQuestionEditValues({})
                              }
                            }}>
                              <label className="rag-edit-label">
                                User Question:
                                <input
                                  type="text"
                                  value={questionEditValues.question ?? qa.question ?? ''}
                                  onChange={(e) => setQuestionEditValues({ ...questionEditValues, question: e.target.value })}
                                  placeholder="User Question (required)"
                                  autoFocus
                                />
                              </label>
                              <label className="rag-edit-label">
                                Assistant SQL Query:
                                <textarea
                                  value={questionEditValues.query ?? qa.query ?? ''}
                                  onChange={(e) => setQuestionEditValues({ ...questionEditValues, query: e.target.value })}
                                  placeholder="Assistant SQL Query (optional)"
                                  rows={3}
                                />
                              </label>
                              <label className="rag-edit-label">
                                Assistant Answer:
                                <textarea
                                  value={questionEditValues.answer ?? qa.answer ?? ''}
                                  onChange={(e) => setQuestionEditValues({ ...questionEditValues, answer: e.target.value })}
                                  placeholder="Assistant Answer (optional - will be generated if not provided)"
                                  rows={3}
                                />
                              </label>
                              <div className="rag-edit-actions">
                                <button className="btn-save" onClick={() => handleSaveQuestion(originalIdx)}>💾 Save</button>
                                <button className="btn-cancel" onClick={() => { setEditingQuestion(null); setQuestionEditValues({}) }}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="rag-item-content">
                              <div className="rag-item-main">
                                <div className="rag-question-text"><strong>Q:</strong> {qa.question}</div>
                                {qa.query && <div className="rag-query-text"><strong>Query:</strong> <code>{qa.query}</code></div>}
                                {qa.answer && <div className="rag-answer-text"><strong>A:</strong> {qa.answer}</div>}
                              </div>
                              {canConfigure && (
                                <button 
                                  className="btn-edit-item" 
                                  onClick={() => {
                                    setEditingQuestion(originalIdx)
                                    setQuestionEditValues({ question: qa.question, query: qa.query, answer: qa.answer })
                                  }}
                                  title="Edit Q&A pair"
                                >
                                  ✏️ Edit
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              )}
            </div>
            )}
          </div>
        ) : (
          <div className="rag-empty">
            <p>No Knowledge Bases found. Create one to get started!</p>
          </div>
        )}
      </div>
      <div className="resize-handle" onMouseDown={handleResizeStart}></div>
      </>
      )}
    </>
  )

  return (
    <>
      {modalPortal}
      {inline ? (
        <div className="rag-management-panel">
          <div 
            ref={modalRef}
            className="rag-management-content" 
            onClick={(e) => e.stopPropagation()}
            style={contentStyle}
          >
            {panelBody}
          </div>
        </div>
      ) : (
        <div className="rag-management-overlay" onClick={onClose}>
          <div 
            ref={modalRef}
            className="rag-management-content" 
            onClick={(e) => e.stopPropagation()}
            style={contentStyle}
          >
            {panelBody}
          </div>
        </div>
      )}
    </>
  )
}

export default RAGManagement