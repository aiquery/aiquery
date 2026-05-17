import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import './RAGCreationModal.css'
import { DataSource } from './DataSourceSidebar'

interface RAGCreationModalProps {
  source: DataSource
  connectionConfig: any
  onClose: () => void
  onSuccess: () => void
  existingIndex?: {
    projectId: string
    datasets: string[]
    tables: Array<{
      id: string
      name: string
      dataset: string
      summary: string
    }>
  } | null
}

interface Table {
  id: string
  name: string
  dataset: string
  table: string
  fieldCount: number
  rowCount?: number
}

interface Dataset {
  id: string
  name: string
  location?: string
}

interface Column {
  name: string
  type: string
  mode?: string
  description?: string
  nullable?: boolean
  default?: string
}

const RAGCreationModal: React.FC<RAGCreationModalProps> = ({
  source,
  connectionConfig,
  onClose,
  onSuccess,
  existingIndex
}) => {
  // Log component mount/unmount
  useEffect(() => {
    console.log('✅ RAGCreationModal component MOUNTED', {
      sourceId: source.id,
      sourceType: source.type,
      hasConnectionConfig: !!connectionConfig
    })
    return () => {
      console.log('❌ RAGCreationModal component UNMOUNTED (actual unmount)')
    }
  }, []) // Empty deps = only on mount/unmount
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [selectedDatasets, setSelectedDatasets] = useState<Set<string>>(new Set())
  const [schemas, setSchemas] = useState<string[]>([])
  const [selectedSchemas, setSelectedSchemas] = useState<Set<string>>(new Set())
  const [tables, setTables] = useState<Table[]>([])
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set())
  
  // Debug: Log when tables state changes
  useEffect(() => {
    console.log('[Frontend] Tables state changed:', tables.length, 'tables:', tables.map(t => t.id || t.name))
  }, [tables])
  const [columns, setColumns] = useState<{ [tableId: string]: Column[] }>({})
  const [selectedColumns, setSelectedColumns] = useState<{ [tableId: string]: Set<string> }>({})
  const [loadingDatasets, setLoadingDatasets] = useState(false)
  const [loadingSchemas, setLoadingSchemas] = useState(false)
  const [loadingTables, setLoadingTables] = useState(false)
  const [loadingColumns, setLoadingColumns] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [manualTableInput, setManualTableInput] = useState('')
  const [conflicts, setConflicts] = useState<any>(null)
  const [mergeMode, setMergeMode] = useState<'replace_all' | 'replace_columns' | 'add_columns' | null>(null)
  const [checkingConflicts, setCheckingConflicts] = useState(false)
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [columnDescriptionMode, setColumnDescriptionMode] = useState<'generate' | 'metadata' | null>(null)
  const [showColumnDescriptionModal, setShowColumnDescriptionModal] = useState(false)
  
  // Dragging and resizing state
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isResizing, setIsResizing] = useState(false)
  const [modalSize, setModalSize] = useState({ width: 1400, height: 700 })
  const modalRef = useRef<HTMLDivElement>(null)
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 })

  // Check if datasets field is empty and we need to show dataset selection
  const needsDatasetSelection = source.type === 'bigquery' && 
    (!connectionConfig.datasets || connectionConfig.datasets.trim() === '')
  
  // Check if schema is not provided for Snowflake and we need to show schema selection
  const needsSchemaSelection = (source.type === 'snowflake' || source.type === 'redshift') && 
    (!connectionConfig.schema || connectionConfig.schema.trim() === '') &&
    (!connectionConfig.schemas || connectionConfig.schemas.trim() === '')
  
  // For Databricks, always show catalog → schema → table hierarchy
  const needsCatalogSelection = source.type === 'databricks'
  const [catalogs, setCatalogs] = useState<Array<{ id: string; name: string }>>([])
  const [selectedCatalogs, setSelectedCatalogs] = useState<Set<string>>(new Set())
  const [loadingCatalogs, setLoadingCatalogs] = useState(false)

  // Auto-fetch tables when datasets are selected (only for BigQuery when datasets field is empty)
  useEffect(() => {
    if (needsDatasetSelection && selectedDatasets.size > 0 && !loadingTables) {
      const datasetsArray = Array.from(selectedDatasets)
      if (datasetsArray.length > 0) {
        fetchTables()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDatasets.size, needsDatasetSelection]) // Only depend on size to avoid infinite loops
  
  // Auto-fetch schemas when catalogs are selected (for Databricks)
  useEffect(() => {
    if (needsCatalogSelection && selectedCatalogs.size > 0 && !loadingSchemas) {
      console.log('[Frontend] Auto-fetching schemas for selected catalogs:', Array.from(selectedCatalogs))
      fetchSchemas()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCatalogs.size, needsCatalogSelection]) // Only depend on size to avoid infinite loops

  // Auto-fetch tables when schemas are selected (for Snowflake when schema field is empty, or Databricks)
  useEffect(() => {
    console.log('[Frontend] useEffect triggered for table fetching', {
      needsSchemaSelection,
      needsCatalogSelection,
      selectedSchemasSize: selectedSchemas.size,
      selectedCatalogsSize: selectedCatalogs.size,
      loadingTables,
      selectedSchemas: Array.from(selectedSchemas),
      selectedCatalogs: Array.from(selectedCatalogs)
    })
    
    if (needsSchemaSelection && selectedSchemas.size > 0 && !loadingTables) {
      const schemasArray = Array.from(selectedSchemas)
      if (schemasArray.length > 0) {
        console.log('[Frontend] Auto-fetching tables for schema selection (needsSchemaSelection)')
        fetchTables()
      }
    } else if (needsCatalogSelection && selectedSchemas.size > 0 && selectedCatalogs.size > 0 && !loadingTables) {
      // For Databricks, need both catalogs and schemas selected
      console.log('[Frontend] Auto-fetching tables for Databricks (catalog + schema selected)', {
        selectedCatalogs: Array.from(selectedCatalogs),
        selectedSchemas: Array.from(selectedSchemas),
        needsCatalogSelection,
        loadingTables
      })
      fetchTables()
    } else {
      console.log('[Frontend] Conditions not met for auto-fetching tables', {
        needsSchemaSelection,
        needsCatalogSelection,
        selectedSchemasSize: selectedSchemas.size,
        selectedCatalogsSize: selectedCatalogs.size,
        loadingTables
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSchemas.size, needsSchemaSelection, needsCatalogSelection, selectedCatalogs.size]) // Only depend on size to avoid infinite loops

  // Auto-fetch columns when tables are selected
  useEffect(() => {
    if (selectedTables.size > 0 && !loadingColumns) {
      fetchColumns()
    } else if (selectedTables.size === 0) {
      // Clear columns when no tables selected
      setColumns({})
      setSelectedColumns({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTables.size]) // Only depend on size to avoid infinite loops

  // Update fieldCount in tables when columns are fetched
  useEffect(() => {
    if (Object.keys(columns).length > 0) {
      setTables(prevTables => {
        return prevTables.map(table => {
          const tableColumns = columns[table.id]
          if (tableColumns && tableColumns.length > 0) {
            // Update fieldCount if columns are available and different from current
            if (table.fieldCount !== tableColumns.length) {
              console.log(`[Frontend] Updating fieldCount for ${table.id}: ${table.fieldCount} -> ${tableColumns.length}`)
              return { ...table, fieldCount: tableColumns.length }
            }
          }
          return table
        })
      })
    }
  }, [columns])

  const fetchDatasets = useCallback(async () => {
    if (source.type !== 'bigquery') return
    
    setLoadingDatasets(true)
    setError(null)
    try {
      if (!connectionConfig.projectId || !connectionConfig.serviceAccountKey) {
        setError('Project ID and Service Account Key are required')
        setLoadingDatasets(false)
        return
      }

      // Use /api/rag/tables without datasets parameter to get list of datasets
      const response = await fetch(
        `/api/rag/tables?dataSourceType=bigquery&projectId=${encodeURIComponent(connectionConfig.projectId || '')}&serviceAccountKey=${encodeURIComponent(connectionConfig.serviceAccountKey || '')}`
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch datasets')
      }

      const data = await response.json()
      if (data.datasets && Array.isArray(data.datasets)) {
        setDatasets(data.datasets)
        // Pre-select existing datasets if editing
        if (existingIndex && existingIndex.datasets) {
          setSelectedDatasets(new Set(existingIndex.datasets))
        }
      } else {
        setDatasets([])
        setError('No datasets found or invalid response format')
      }
    } catch (err) {
      console.error('Error fetching datasets:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch datasets')
      setDatasets([])
    } finally {
      setLoadingDatasets(false)
    }
  }, [source.type, connectionConfig, existingIndex])
  
  const fetchCatalogs = useCallback(async () => {
    if (source.type !== 'databricks') return
    
    setLoadingCatalogs(true)
    setError(null)
    try {
      const connectionMethod = connectionConfig.connectionMethod || 'url';
      if (connectionMethod === 'host') {
        if (!connectionConfig.clientId || !connectionConfig.clientSecret) {
          setError('Client ID and Client Secret are required for Databricks Client connection')
          setLoadingCatalogs(false)
          return
        }
      } else {
        if (!connectionConfig.jdbcUrl || !connectionConfig.tokenName || (!connectionConfig.token && !connectionConfig.accessToken)) {
          setError('JDBC URL, Token Name, and Token are required for Databricks URL connection')
          setLoadingCatalogs(false)
          return
        }
      }

      const params = new URLSearchParams({
        dataSourceType: 'databricks'
      })
      
      // Database is optional for fetching catalogs
      if (connectionConfig.database) {
        params.append('database', connectionConfig.database)
      }
      
      params.append('connectionMethod', connectionConfig.connectionMethod || 'url')
      if (connectionConfig.connectionMethod === 'host') {
        if (connectionConfig.serverHostname) params.append('serverHostname', connectionConfig.serverHostname)
        if (connectionConfig.host) params.append('host', connectionConfig.host)
        if (connectionConfig.server) params.append('server', connectionConfig.server)
        if (connectionConfig.clientId) params.append('clientId', connectionConfig.clientId)
        if (connectionConfig.clientSecret) params.append('clientSecret', connectionConfig.clientSecret)
      } else {
        if (connectionConfig.jdbcUrl) params.append('jdbcUrl', connectionConfig.jdbcUrl)
        if (connectionConfig.tokenName) params.append('tokenName', connectionConfig.tokenName)
        if (connectionConfig.token) params.append('token', connectionConfig.token)
        if (connectionConfig.accessToken) params.append('accessToken', connectionConfig.accessToken)
      }
      
      if (connectionConfig.host) params.append('host', connectionConfig.host)
      if (connectionConfig.server) params.append('server', connectionConfig.server)
      if (connectionConfig.port) params.append('port', String(connectionConfig.port))

      const response = await fetch(`/api/rag/tables?${params.toString()}`)
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch catalogs')
      }

      const data = await response.json()
      if (data.catalogs && Array.isArray(data.catalogs)) {
        setCatalogs(data.catalogs)
      } else {
        setCatalogs([])
        setError('No catalogs found or invalid response format')
      }
    } catch (err) {
      console.error('Error fetching catalogs:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch catalogs')
      setCatalogs([])
    } finally {
      setLoadingCatalogs(false)
    }
  }, [source.type, connectionConfig])

  const fetchSchemas = useCallback(async () => {
    if (source.type === 'snowflake') {
      // Snowflake schema fetching (existing logic)
      setLoadingSchemas(true)
      setError(null)
      try {
      if (!connectionConfig.account && !connectionConfig.host && !connectionConfig.server) {
        setError('Account (or Host) is required')
        setLoadingSchemas(false)
        return
      }
      if (!connectionConfig.warehouse || !connectionConfig.database || !connectionConfig.username || !connectionConfig.password) {
        setError('Warehouse, Database, Username, and Password are required')
        setLoadingSchemas(false)
        return
      }

      const params = new URLSearchParams()
      params.append('dataSourceType', 'snowflake')
      if (connectionConfig.account) params.append('account', connectionConfig.account)
      if (connectionConfig.host) params.append('host', connectionConfig.host)
      if (connectionConfig.server) params.append('server', connectionConfig.server)
      if (connectionConfig.warehouse) params.append('warehouse', connectionConfig.warehouse)
      if (connectionConfig.database) params.append('database', connectionConfig.database)
      if (connectionConfig.username) params.append('username', connectionConfig.username)
      if (connectionConfig.password) params.append('password', connectionConfig.password)
      // Don't include schema parameter - this will make the endpoint return schemas list

      // Use /api/rag/tables without schema parameter to get list of schemas
      const response = await fetch(`/api/rag/tables?${params.toString()}`)

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch schemas')
      }

      const data = await response.json()
      if (data.schemas && Array.isArray(data.schemas)) {
        setSchemas(data.schemas)
      } else {
        setSchemas([])
        setError('No schemas found or invalid response format')
      }
    } catch (err) {
      console.error('Error fetching schemas:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch schemas')
      setSchemas([])
    } finally {
      setLoadingSchemas(false)
    }
    } else if (source.type === 'redshift') {
      // Redshift schema fetching
      setLoadingSchemas(true)
      setError(null)
      try {
        const redshiftUsesPgPass = String(connectionConfig.authMethod || '').toLowerCase() === 'pgpass'
        if (!connectionConfig.database || !connectionConfig.username || (!redshiftUsesPgPass && !connectionConfig.password)) {
          setError(redshiftUsesPgPass
            ? 'Database and Username are required for Redshift'
            : 'Database, Username, and Password are required for Redshift')
          setLoadingSchemas(false)
          return
        }

        const params = new URLSearchParams()
        params.append('dataSourceType', 'redshift')
        params.append('database', connectionConfig.database)
        params.append('username', connectionConfig.username)
        if (connectionConfig.password) params.append('password', connectionConfig.password)
        if (connectionConfig.authMethod) params.append('authMethod', connectionConfig.authMethod)
        
        if (connectionConfig.host) params.append('host', connectionConfig.host)
        if (connectionConfig.server) params.append('server', connectionConfig.server)
        if (connectionConfig.serverUrl) params.append('serverUrl', connectionConfig.serverUrl)
        if (connectionConfig.port) params.append('port', String(connectionConfig.port))
        if (connectionConfig.jdbcUrl) params.append('jdbcUrl', connectionConfig.jdbcUrl)
        if (connectionConfig.connectionMethod) params.append('connectionMethod', connectionConfig.connectionMethod)
        // Don't include schema parameter - this will make the endpoint return schemas list

        // Use /api/rag/tables without schema parameter to get list of schemas
        const response = await fetch(`/api/rag/tables?${params.toString()}`)

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to fetch schemas')
        }

        const data = await response.json()
        if (data.schemas && Array.isArray(data.schemas)) {
          // If schemas are configured in connection config, filter to only show those
          let schemasToShow = data.schemas
          if (connectionConfig.schemas && connectionConfig.schemas.trim()) {
            const configuredSchemas = connectionConfig.schemas.split(',').map((s: string) => s.trim().toLowerCase())
            schemasToShow = data.schemas.filter((schema: string) => 
              configuredSchemas.includes(schema.toLowerCase())
            )
            console.log('[Redshift] Filtering schemas based on connection config:', {
              configured: configuredSchemas,
              available: data.schemas,
              filtered: schemasToShow
            })
          } else if (connectionConfig.schema && connectionConfig.schema.trim()) {
            // Support single schema field as well
            const configuredSchema = connectionConfig.schema.trim().toLowerCase()
            schemasToShow = data.schemas.filter((schema: string) => 
              schema.toLowerCase() === configuredSchema
            )
            console.log('[Redshift] Filtering schemas based on single schema config:', {
              configured: configuredSchema,
              available: data.schemas,
              filtered: schemasToShow
            })
          }
          setSchemas(schemasToShow)
        } else {
          setSchemas([])
          setError('No schemas found or invalid response format')
        }
      } catch (err) {
        console.error('Error fetching Redshift schemas:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch schemas')
        setSchemas([])
      } finally {
        setLoadingSchemas(false)
      }
    } else if (source.type === 'databricks') {
      // Databricks schema fetching - requires selected catalog
      if (selectedCatalogs.size === 0) {
        setSchemas([])
        return
      }
      
      setLoadingSchemas(true)
      setError(null)
      try {
        const connectionMethod = connectionConfig.connectionMethod || 'url';
        if (connectionMethod === 'host') {
          if (!connectionConfig.database || !connectionConfig.clientId || !connectionConfig.clientSecret) {
            setError('Database, Client ID, and Client Secret are required for Databricks Client connection')
            setLoadingSchemas(false)
            return
          }
        } else {
          if (!connectionConfig.database || !connectionConfig.jdbcUrl || !connectionConfig.tokenName || (!connectionConfig.token && !connectionConfig.accessToken)) {
            setError('Database, JDBC URL, Token Name, and Token are required for Databricks URL connection')
            setLoadingSchemas(false)
            return
          }
        }

        // Fetch schemas for each selected catalog
        const catalogArray = Array.from(selectedCatalogs)
        const schemaPromises = catalogArray.map(async (catalogName) => {
          const params = new URLSearchParams({
            dataSourceType: 'databricks',
            database: connectionConfig.database || '',
            catalog: catalogName
          })
          
          params.append('connectionMethod', connectionConfig.connectionMethod || 'url')
          if (connectionConfig.connectionMethod === 'host') {
            if (connectionConfig.serverHostname) params.append('serverHostname', connectionConfig.serverHostname)
            if (connectionConfig.host) params.append('host', connectionConfig.host)
            if (connectionConfig.server) params.append('server', connectionConfig.server)
            if (connectionConfig.clientId) params.append('clientId', connectionConfig.clientId)
            if (connectionConfig.clientSecret) params.append('clientSecret', connectionConfig.clientSecret)
          } else {
            if (connectionConfig.jdbcUrl) params.append('jdbcUrl', connectionConfig.jdbcUrl)
            if (connectionConfig.tokenName) params.append('tokenName', connectionConfig.tokenName)
            if (connectionConfig.token) params.append('token', connectionConfig.token)
            if (connectionConfig.accessToken) params.append('accessToken', connectionConfig.accessToken)
          }
          
          if (connectionConfig.host) params.append('host', connectionConfig.host)
          if (connectionConfig.server) params.append('server', connectionConfig.server)
          if (connectionConfig.port) params.append('port', String(connectionConfig.port))

          const response = await fetch(`/api/rag/tables?${params.toString()}`)
          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || `Failed to fetch schemas for catalog ${catalogName}`)
          }
          const data = await response.json()
          return (data.schemas || []).map((sch: any) => ({ ...sch, catalog: catalogName }))
        })
        
        const schemaArrays = await Promise.all(schemaPromises)
        const allSchemas = schemaArrays.flat()
        setSchemas(allSchemas.map((sch: any) => sch.name || sch.id))
      } catch (err) {
        console.error('Error fetching schemas:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch schemas')
        setSchemas([])
      } finally {
        setLoadingSchemas(false)
      }
    }
  }, [source.type, connectionConfig, selectedCatalogs])

  const fetchTables = useCallback(async () => {
    setLoadingTables(true)
    setError(null)
    try {
      let response: Response;
      
      if (source.type === 'bigquery') {
        if (!connectionConfig.projectId || !connectionConfig.serviceAccountKey) {
          setError('Project ID and Service Account Key are required')
          setLoadingTables(false)
          return
        }

        // Use selected datasets if we went through dataset selection, otherwise use configured datasets
        const datasetsToUse = selectedDatasets.size > 0 
          ? Array.from(selectedDatasets).join(',')
          : (connectionConfig.datasets 
              ? connectionConfig.datasets.split(',').map((d: string) => d.trim()).filter((d: string) => d.length > 0).join(',')
              : '')
        
        if (!datasetsToUse) {
          setLoadingTables(false)
          return // Don't show error, just wait for dataset selection
        }

        response = await fetch(
          `/api/rag/tables?dataSourceType=bigquery&projectId=${encodeURIComponent(connectionConfig.projectId || '')}&serviceAccountKey=${encodeURIComponent(connectionConfig.serviceAccountKey || '')}&datasets=${encodeURIComponent(datasetsToUse)}`
        )
      } else if (source.type === 'airtable') {
        if (!connectionConfig.apiKey || !connectionConfig.baseId) {
          setError('API Key and Base ID are required')
          setLoadingTables(false)
          return
        }

        response = await fetch(
          `/api/rag/tables?dataSourceType=airtable&apiKey=${encodeURIComponent(connectionConfig.apiKey || '')}&baseId=${encodeURIComponent(connectionConfig.baseId || '')}`
        )
      } else if (source.type === 'databricks') {
        // Databricks - requires selected catalogs and schemas
        console.log('[Frontend] fetchTables called for Databricks', {
          selectedCatalogs: Array.from(selectedCatalogs),
          selectedSchemas: Array.from(selectedSchemas),
          selectedCatalogsSize: selectedCatalogs.size,
          selectedSchemasSize: selectedSchemas.size
        })
        if (selectedCatalogs.size === 0 || selectedSchemas.size === 0) {
          console.log('[Frontend] Skipping table fetch - waiting for catalog/schema selection')
          setLoadingTables(false)
          return // Don't show error, just wait for catalog/schema selection
        }

        const connectionMethod = connectionConfig.connectionMethod || 'url';
        if (connectionMethod === 'host') {
          // Client connection
          if (!connectionConfig.database || !connectionConfig.clientId || !connectionConfig.clientSecret) {
            setError('Database, Client ID, and Client Secret are required for Databricks Client connection')
            setLoadingTables(false)
            return
          }
        } else {
          // URL connection
          if (!connectionConfig.database || !connectionConfig.jdbcUrl || !connectionConfig.tokenName || (!connectionConfig.token && !connectionConfig.accessToken)) {
            setError('Database, JDBC URL, Token Name, and Token are required for Databricks URL connection')
            setLoadingTables(false)
            return
          }
        }

        // Fetch tables for each selected catalog and schema combination
        const catalogArray = Array.from(selectedCatalogs)
        const schemaArray = Array.from(selectedSchemas)
        
        // Build catalog.schema pairs
        const catalogSchemaPairs: Array<{ catalog: string; schema: string }> = []
        schemaArray.forEach(schemaName => {
          catalogArray.forEach(catalogName => {
            catalogSchemaPairs.push({ catalog: catalogName, schema: schemaName })
          })
        })

        try {
          const tablePromises = catalogSchemaPairs.map(async ({ catalog, schema }) => {
            const params = new URLSearchParams({
              dataSourceType: 'databricks',
              database: connectionConfig.database || '',
              catalog: catalog,
              schemas: schema
            })
            
            params.append('connectionMethod', connectionConfig.connectionMethod || 'url')
            if (connectionConfig.connectionMethod === 'host') {
              if (connectionConfig.serverHostname) params.append('serverHostname', connectionConfig.serverHostname)
              if (connectionConfig.host) params.append('host', connectionConfig.host)
              if (connectionConfig.server) params.append('server', connectionConfig.server)
              if (connectionConfig.clientId) params.append('clientId', connectionConfig.clientId)
              if (connectionConfig.clientSecret) params.append('clientSecret', connectionConfig.clientSecret)
            } else {
              if (connectionConfig.jdbcUrl) params.append('jdbcUrl', connectionConfig.jdbcUrl)
              if (connectionConfig.tokenName) params.append('tokenName', connectionConfig.tokenName)
              if (connectionConfig.token) params.append('token', connectionConfig.token)
              if (connectionConfig.accessToken) params.append('accessToken', connectionConfig.accessToken)
            }
            
            if (connectionConfig.host) params.append('host', connectionConfig.host)
            if (connectionConfig.server) params.append('server', connectionConfig.server)
            if (connectionConfig.port) params.append('port', String(connectionConfig.port))

            console.log(`[Frontend] Fetching tables for catalog: ${catalog}, schema: ${schema}`)
            const schemaResponse = await fetch(`/api/rag/tables?${params.toString()}`)
            if (!schemaResponse.ok) {
              const errorData = await schemaResponse.json()
              console.error(`[Frontend] Failed to fetch tables for ${catalog}.${schema}:`, errorData)
              throw new Error(errorData.error || `Failed to fetch tables for ${catalog}.${schema}`)
            }
            const data = await schemaResponse.json()
            console.log(`[Frontend] Fetched tables for ${catalog}.${schema}:`, data.tables?.length || 0, 'tables')
            console.log(`[Frontend] Response data structure:`, {
              hasTables: !!data.tables,
              tablesType: Array.isArray(data.tables) ? 'array' : typeof data.tables,
              tablesLength: data.tables?.length,
              firstTable: data.tables?.[0]
            })
            return data.tables || []
          })
          
          const tableArrays = await Promise.all(tablePromises)
          const allTables: Table[] = tableArrays.flat()
          
          console.log(`[Frontend] Total tables fetched: ${allTables.length}`, allTables)
          
          if (allTables && allTables.length > 0) {
            console.log(`[Frontend] Setting ${allTables.length} tables in state:`, allTables.map(t => t.id || t.name))
            setTables(allTables)
            // Pre-select existing tables if editing
            if (existingIndex) {
              const existingTableIds = existingIndex.tables
                .map(t => t.id || (t.dataset && t.name ? `${t.dataset}.${t.name}` : ''))
                .filter(id => id)
              setSelectedTables(new Set(existingTableIds))
            }
          } else {
            console.warn(`[Frontend] No tables found or empty array. allTables:`, allTables)
            setTables([])
            setError('No tables found in the selected catalog and schemas. Please check your selection.')
          }
        } catch (err) {
          console.error('Error fetching Databricks tables:', err)
          setError(err instanceof Error ? err.message : 'Failed to fetch tables')
          setTables([])
        }
        setLoadingTables(false)
        return
      } else if (source.type === 'postgres' || source.type === 'postgresql') {
        // PostgreSQL
        if (!connectionConfig.database || !connectionConfig.username || !connectionConfig.password) {
          setError('Database, username, and password are required for PostgreSQL')
          setLoadingTables(false)
          return
        }

        const params = new URLSearchParams({
          dataSourceType: source.type,
          database: connectionConfig.database || '',
          username: connectionConfig.username || '',
          password: connectionConfig.password || ''
        })
        
        if (connectionConfig.host) params.append('host', connectionConfig.host)
        if (connectionConfig.server) params.append('server', connectionConfig.server)
        if (connectionConfig.port) params.append('port', String(connectionConfig.port))
        if (connectionConfig.schema) params.append('schema', connectionConfig.schema)
        if (connectionConfig.schemas) params.append('schemas', connectionConfig.schemas)

        response = await fetch(`/api/rag/tables?${params.toString()}`)
      } else if (source.type === 'redshift') {
        // Redshift
        const redshiftUsesPgPass = String(connectionConfig.authMethod || '').toLowerCase() === 'pgpass'
        if (!connectionConfig.database || !connectionConfig.username || (!redshiftUsesPgPass && !connectionConfig.password)) {
          setError(redshiftUsesPgPass
            ? 'Database and username are required for Redshift'
            : 'Database, username, and password are required for Redshift')
          setLoadingTables(false)
          return
        }

        // If schema selection is needed, require selected schemas
        if (needsSchemaSelection && selectedSchemas.size === 0) {
          console.log('[Frontend] Skipping table fetch - waiting for schema selection')
          setLoadingTables(false)
          return // Don't show error, just wait for schema selection
        }

        const params = new URLSearchParams({
          dataSourceType: 'redshift',
          database: connectionConfig.database || '',
          username: connectionConfig.username || ''
        })
        if (connectionConfig.password) params.append('password', connectionConfig.password)
        if (connectionConfig.authMethod) params.append('authMethod', connectionConfig.authMethod)
        
        if (connectionConfig.host) params.append('host', connectionConfig.host)
        if (connectionConfig.server) params.append('server', connectionConfig.server)
        if (connectionConfig.serverUrl) params.append('serverUrl', connectionConfig.serverUrl)
        if (connectionConfig.port) params.append('port', String(connectionConfig.port))
        if (connectionConfig.jdbcUrl) params.append('jdbcUrl', connectionConfig.jdbcUrl)
        if (connectionConfig.connectionMethod) params.append('connectionMethod', connectionConfig.connectionMethod)
        
        // If schemas are selected, use them; otherwise use single schema if provided
        if (needsSchemaSelection && selectedSchemas.size > 0) {
          // When multiple schemas are selected, fetch tables from each schema and combine results
          const schemasArray = Array.from(selectedSchemas)
          if (schemasArray.length > 0) {
            // Fetch tables from each selected schema
            const tablePromises = schemasArray.map(async (schemaName) => {
              const schemaParams = new URLSearchParams(params)
              schemaParams.set('schema', schemaName)
              const schemaResponse = await fetch(`/api/rag/tables?${schemaParams.toString()}`)
              if (!schemaResponse.ok) {
                const data = await schemaResponse.json()
                throw new Error(data.error || `Failed to fetch tables for schema ${schemaName}`)
              }
              const schemaData = await schemaResponse.json()
              return schemaData.tables || []
            })
            
            const tablesArrays = await Promise.all(tablePromises)
            const allTables = tablesArrays.flat()
            
            // Remove duplicates based on table id
            const uniqueTables = Array.from(
              new Map(allTables.map((table: any) => [table.id, table])).values()
            )
            
            setTables(uniqueTables)
            setLoadingTables(false)
            return
          }
        } else if (connectionConfig.schema) {
          params.append('schema', connectionConfig.schema)
        }
        if (connectionConfig.schemas) params.append('schemas', connectionConfig.schemas)

        response = await fetch(`/api/rag/tables?${params.toString()}`)
      } else if (source.type === 'azure' || source.type === 'sqlserver') {
        // Azure SQL Server / SQL Server
        if (!connectionConfig.database || !connectionConfig.username || !connectionConfig.password) {
          setError('Database, username, and password are required for Azure SQL Server / SQL Server')
          setLoadingTables(false)
          return
        }

        const params = new URLSearchParams({
          dataSourceType: source.type,
          database: connectionConfig.database || '',
          username: connectionConfig.username || '',
          password: connectionConfig.password || ''
        })
        
        if (connectionConfig.host) params.append('host', connectionConfig.host)
        if (connectionConfig.server) params.append('server', connectionConfig.server)
        if (connectionConfig.serverUrl) params.append('serverUrl', connectionConfig.serverUrl)
        if (connectionConfig.port) params.append('port', String(connectionConfig.port))
        if (connectionConfig.schema) params.append('schema', connectionConfig.schema)
        if (connectionConfig.schemas) params.append('schemas', connectionConfig.schemas)
        if (connectionConfig.authMethod) params.append('authMethod', connectionConfig.authMethod)
        if (connectionConfig.connectionMethod) params.append('connectionMethod', connectionConfig.connectionMethod)

        response = await fetch(`/api/rag/tables?${params.toString()}`)
      } else if (source.type === 'snowflake') {
        // Snowflake
        if (!connectionConfig.database || !connectionConfig.username || !connectionConfig.password || !connectionConfig.account || !connectionConfig.warehouse) {
          setError('Database, username, password, account, and warehouse are required for Snowflake')
          setLoadingTables(false)
          return
        }

        const params = new URLSearchParams({
          dataSourceType: 'snowflake',
          database: connectionConfig.database || '',
          username: connectionConfig.username || '',
          password: connectionConfig.password || '',
          account: connectionConfig.account || '',
          warehouse: connectionConfig.warehouse || ''
        })
        
        if (connectionConfig.host) params.append('host', connectionConfig.host)
        if (connectionConfig.server) params.append('server', connectionConfig.server)
        if (connectionConfig.port) params.append('port', String(connectionConfig.port))
        
        // For Snowflake, use selected schemas if schema selection was used, otherwise use configured schema
        if (needsSchemaSelection && selectedSchemas.size > 0) {
          // When multiple schemas are selected, fetch tables from each schema and combine results
          const schemasArray = Array.from(selectedSchemas)
          if (schemasArray.length > 0) {
            // Fetch tables from each selected schema
            const tablePromises = schemasArray.map(async (schemaName) => {
              const schemaParams = new URLSearchParams(params)
              schemaParams.set('schema', schemaName)
              const schemaResponse = await fetch(`/api/rag/tables?${schemaParams.toString()}`)
              if (!schemaResponse.ok) {
                const data = await schemaResponse.json()
                throw new Error(data.error || `Failed to fetch tables from schema ${schemaName}`)
              }
              const schemaData = await schemaResponse.json()
              return schemaData.tables || []
            })
            
            const tableArrays = await Promise.all(tablePromises)
            const allTables = tableArrays.flat()
            
            if (allTables && Array.isArray(allTables)) {
              setTables(allTables)
              // Pre-select existing tables if editing
              if (existingIndex) {
                const existingTableIds = existingIndex.tables
                  .map(t => t.id || (t.dataset && t.name ? `${t.dataset}.${t.name}` : ''))
                  .filter(id => id)
                setSelectedTables(new Set(existingTableIds))
              }
            } else {
              setTables([])
              setError('No tables found or invalid response format')
            }
            setLoadingTables(false)
            return
          }
        } else if (connectionConfig.schema) {
          params.append('schema', connectionConfig.schema)
        }

        response = await fetch(`/api/rag/tables?${params.toString()}`)
      } else if (source.type === 'mysql') {
        // MySQL
        if (!connectionConfig.database || !connectionConfig.username || !connectionConfig.password) {
          setError('Database, username, and password are required for MySQL')
          setLoadingTables(false)
          return
        }

        const params = new URLSearchParams({
          dataSourceType: 'mysql',
          database: connectionConfig.database || '',
          username: connectionConfig.username || '',
          password: connectionConfig.password || ''
        })
        
        if (connectionConfig.host) params.append('host', connectionConfig.host)
        if (connectionConfig.server) params.append('server', connectionConfig.server)
        if (connectionConfig.serverUrl) params.append('serverUrl', connectionConfig.serverUrl)
        if (connectionConfig.port) params.append('port', String(connectionConfig.port))
        if (connectionConfig.schema) params.append('schema', connectionConfig.schema)
        if (connectionConfig.connectionMethod) params.append('connectionMethod', connectionConfig.connectionMethod)
        if (connectionConfig.authMethod) params.append('authMethod', connectionConfig.authMethod)

        response = await fetch(`/api/rag/tables?${params.toString()}`)
      } else {
        // Unknown data source type
        setError(`Unsupported data source type: ${source.type}`)
        setLoadingTables(false)
        return
      }

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch tables')
      }

      const data = await response.json()
      if (data.tables && Array.isArray(data.tables)) {
        setTables(data.tables)
        // Pre-select existing tables if editing
        if (existingIndex) {
          const existingTableIds = existingIndex.tables
            .map(t => t.id || (t.dataset && t.name ? `${t.dataset}.${t.name}` : ''))
            .filter(id => id)
          setSelectedTables(new Set(existingTableIds))
        }
      } else {
        setTables([])
        setError('No tables found or invalid response format')
      }
    } catch (err) {
      console.error('Error fetching tables:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch tables')
      setTables([])
    } finally {
      setLoadingTables(false)
    }
  }, [source.type, connectionConfig, selectedDatasets, selectedCatalogs, selectedSchemas, needsSchemaSelection, existingIndex])

  const fetchColumns = useCallback(async () => {
    if (selectedTables.size === 0) {
      setColumns({})
      setSelectedColumns({})
      return
    }

    setLoadingColumns(true)
    setError(null)
    try {
      const tableList = Array.from(selectedTables).join(',')
      let url = `/api/rag/columns?selectedTables=${encodeURIComponent(tableList)}`

      if (source.type === 'bigquery') {
        const datasetsToUse = selectedDatasets.size > 0 
          ? Array.from(selectedDatasets).join(',')
          : (connectionConfig.datasets 
              ? connectionConfig.datasets.split(',').map((d: string) => d.trim()).filter((d: string) => d.length > 0).join(',')
              : '')
        url += `&dataSourceType=bigquery&projectId=${encodeURIComponent(connectionConfig.projectId || '')}&serviceAccountKey=${encodeURIComponent(connectionConfig.serviceAccountKey || '')}&datasets=${encodeURIComponent(datasetsToUse)}`
      } else if (source.type === 'airtable') {
        url += `&dataSourceType=airtable&apiKey=${encodeURIComponent(connectionConfig.apiKey || '')}&baseId=${encodeURIComponent(connectionConfig.baseId || '')}`
      } else if (source.type === 'databricks') {
        // Databricks
        const params = new URLSearchParams({
          dataSourceType: 'databricks',
          database: connectionConfig.database || ''
        })
        
        if (connectionConfig.connectionMethod) params.append('connectionMethod', connectionConfig.connectionMethod)
        if (connectionConfig.jdbcUrl) params.append('jdbcUrl', connectionConfig.jdbcUrl)
        if (connectionConfig.tokenName) params.append('tokenName', connectionConfig.tokenName)
        if (connectionConfig.token) params.append('token', connectionConfig.token)
        if (connectionConfig.accessToken) params.append('accessToken', connectionConfig.accessToken)
        if (connectionConfig.clientId) params.append('clientId', connectionConfig.clientId)
        if (connectionConfig.clientSecret) params.append('clientSecret', connectionConfig.clientSecret)
        if (connectionConfig.serverHostname) params.append('serverHostname', connectionConfig.serverHostname)
        if (connectionConfig.host) params.append('host', connectionConfig.host)
        if (connectionConfig.server) params.append('server', connectionConfig.server)
        if (connectionConfig.port) params.append('port', String(connectionConfig.port))
        if (connectionConfig.schema) params.append('schema', connectionConfig.schema)
        if (connectionConfig.httpPath) params.append('httpPath', connectionConfig.httpPath)
        
        url += `&${params.toString()}`
      } else if (source.type === 'postgres' || source.type === 'postgresql') {
        // PostgreSQL
        const params = new URLSearchParams({
          dataSourceType: source.type,
          database: connectionConfig.database || '',
          username: connectionConfig.username || '',
          password: connectionConfig.password || ''
        })
        
        if (connectionConfig.host) params.append('host', connectionConfig.host)
        if (connectionConfig.server) params.append('server', connectionConfig.server)
        if (connectionConfig.port) params.append('port', String(connectionConfig.port))
        if (connectionConfig.schema) params.append('schema', connectionConfig.schema)
        
        url += `&${params.toString()}`
      } else if (source.type === 'redshift') {
        // Redshift
        const params = new URLSearchParams({
          dataSourceType: 'redshift',
          database: connectionConfig.database || '',
          username: connectionConfig.username || ''
        })
        if (connectionConfig.password) params.append('password', connectionConfig.password)
        if (connectionConfig.authMethod) params.append('authMethod', connectionConfig.authMethod)
        
        if (connectionConfig.host) params.append('host', connectionConfig.host)
        if (connectionConfig.server) params.append('server', connectionConfig.server)
        if (connectionConfig.serverUrl) params.append('serverUrl', connectionConfig.serverUrl)
        if (connectionConfig.jdbcUrl) params.append('jdbcUrl', connectionConfig.jdbcUrl)
        if (connectionConfig.connectionMethod) params.append('connectionMethod', connectionConfig.connectionMethod)
        if (connectionConfig.port) params.append('port', String(connectionConfig.port))
        if (connectionConfig.schema) params.append('schema', connectionConfig.schema)
        
        url += `&${params.toString()}`
      } else if (source.type === 'azure' || source.type === 'sqlserver') {
        // Azure SQL Server / SQL Server
        const params = new URLSearchParams({
          dataSourceType: source.type,
          database: connectionConfig.database || '',
          username: connectionConfig.username || '',
          password: connectionConfig.password || ''
        })
        
        if (connectionConfig.host) params.append('host', connectionConfig.host)
        if (connectionConfig.server) params.append('server', connectionConfig.server)
        if (connectionConfig.serverUrl) params.append('serverUrl', connectionConfig.serverUrl)
        if (connectionConfig.port) params.append('port', String(connectionConfig.port))
        if (connectionConfig.schema) params.append('schema', connectionConfig.schema)
        if (connectionConfig.schemas) params.append('schemas', connectionConfig.schemas)
        if (connectionConfig.authMethod) params.append('authMethod', connectionConfig.authMethod)
        if (connectionConfig.connectionMethod) params.append('connectionMethod', connectionConfig.connectionMethod)
        
        url += `&${params.toString()}`
      } else if (source.type === 'snowflake') {
        // Snowflake
        const params = new URLSearchParams({
          dataSourceType: 'snowflake',
          database: connectionConfig.database || '',
          username: connectionConfig.username || '',
          password: connectionConfig.password || ''
        })
        
        if (connectionConfig.host) params.append('host', connectionConfig.host)
        if (connectionConfig.server) params.append('server', connectionConfig.server)
        if (connectionConfig.account) params.append('account', connectionConfig.account)
        if (connectionConfig.warehouse) params.append('warehouse', connectionConfig.warehouse)
        if (connectionConfig.schema) params.append('schema', connectionConfig.schema)
        
        url += `&${params.toString()}`
      } else if (source.type === 'mysql') {
        // MySQL
        const params = new URLSearchParams({
          dataSourceType: 'mysql',
          database: connectionConfig.database || '',
          username: connectionConfig.username || '',
          password: connectionConfig.password || ''
        })
        
        if (connectionConfig.host) params.append('host', connectionConfig.host)
        if (connectionConfig.server) params.append('server', connectionConfig.server)
        if (connectionConfig.serverUrl) params.append('serverUrl', connectionConfig.serverUrl)
        if (connectionConfig.port) params.append('port', String(connectionConfig.port))
        if (connectionConfig.schema) params.append('schema', connectionConfig.schema)
        if (connectionConfig.connectionMethod) params.append('connectionMethod', connectionConfig.connectionMethod)
        if (connectionConfig.authMethod) params.append('authMethod', connectionConfig.authMethod)
        
        url += `&${params.toString()}`
      } else {
        // Unknown data source type
        setError(`Unsupported data source type: ${source.type}`)
        setLoadingColumns(false)
        return
      }

      const response = await fetch(url)

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch columns')
      }

      const data = await response.json()
      if (data.columns) {
        setColumns(data.columns)
        // Initialize selected columns - select all by default
        const initialSelected: { [tableId: string]: Set<string> } = {}
        for (const tableId of selectedTables) {
          if (data.columns[tableId]) {
            initialSelected[tableId] = new Set(data.columns[tableId].map((col: Column) => col.name))
          }
        }
        setSelectedColumns(initialSelected)
      } else {
        setError('No columns found or invalid response format')
      }
    } catch (err) {
      console.error('Error fetching columns:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch columns')
    } finally {
      setLoadingColumns(false)
    }
  }, [source.type, connectionConfig, selectedTables, selectedDatasets])

  // Initialize: fetch catalogs/datasets/schemas if needed
  // This must be after all fetch functions are defined to avoid "Cannot access before initialization" error
  useEffect(() => {
    console.log('[Frontend] Initialization useEffect triggered', {
      needsCatalogSelection,
      needsDatasetSelection,
      needsSchemaSelection,
      hasConnectionConfig: !!connectionConfig,
      connectionConfigKeys: connectionConfig ? Object.keys(connectionConfig) : []
    })
    
    // Don't run if connectionConfig is not available yet
    if (!connectionConfig) {
      console.log('[Frontend] Skipping initialization - connectionConfig not available yet')
      return
    }
    
    if (needsCatalogSelection) {
      console.log('[Frontend] Calling fetchCatalogs()')
      fetchCatalogs()
    } else if (needsDatasetSelection) {
      console.log('[Frontend] Calling fetchDatasets()')
      fetchDatasets()
    } else if (needsSchemaSelection) {
      console.log('[Frontend] Calling fetchSchemas()')
      fetchSchemas()
    } else {
      // If catalogs/datasets/schemas are configured, fetch tables directly
      console.log('[Frontend] Calling fetchTables() directly')
      fetchTables()
    }
  }, [needsCatalogSelection, needsDatasetSelection, needsSchemaSelection, connectionConfig, fetchCatalogs, fetchDatasets, fetchSchemas, fetchTables])

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => {
      window.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

  // Dragging handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (modalRef.current) {
      const rect = modalRef.current.getBoundingClientRect()
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      })
      setIsDragging(true)
    }
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && modalRef.current) {
        const newX = e.clientX - dragOffset.x
        const newY = e.clientY - dragOffset.y
        
        // Keep modal within viewport
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
        const newWidth = Math.max(800, Math.min(window.innerWidth - 20, resizeStartRef.current.width + deltaX))
        const newHeight = Math.max(500, Math.min(window.innerHeight - 20, resizeStartRef.current.height + deltaY))
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

  const handleDatasetToggle = (datasetId: string) => {
    setSelectedDatasets(prev => {
      const newSet = new Set(prev)
      if (newSet.has(datasetId)) {
        newSet.delete(datasetId)
      } else {
        newSet.add(datasetId)
      }
      return newSet
    })
  }

  const handleTableToggle = (tableId: string) => {
    setSelectedTables(prev => {
      const newSet = new Set(prev)
      if (newSet.has(tableId)) {
        newSet.delete(tableId)
        // Remove columns for this table when deselected
        setSelectedColumns(prevCols => {
          const newCols = { ...prevCols }
          delete newCols[tableId]
          return newCols
        })
        setColumns(prevCols => {
          const newCols = { ...prevCols }
          delete newCols[tableId]
          return newCols
        })
      } else {
        newSet.add(tableId)
      }
      return newSet
    })
  }

  const handleColumnToggle = (tableId: string, columnName: string) => {
    setSelectedColumns(prev => {
      const newCols = { ...prev }
      if (!newCols[tableId]) {
        newCols[tableId] = new Set()
      }
      const tableCols = new Set(newCols[tableId])
      if (tableCols.has(columnName)) {
        tableCols.delete(columnName)
      } else {
        tableCols.add(columnName)
      }
      newCols[tableId] = tableCols
      return newCols
    })
  }

  const handleSelectAllDatasets = () => {
    if (selectedDatasets.size === datasets.length) {
      setSelectedDatasets(new Set())
    } else {
      setSelectedDatasets(new Set(datasets.map(d => d.id)))
    }
  }
  
  const handleSchemaToggle = (schemaName: string) => {
    console.log('[Frontend] handleSchemaToggle called with:', schemaName)
    setSelectedSchemas(prev => {
      const newSet = new Set(prev)
      if (newSet.has(schemaName)) {
        newSet.delete(schemaName)
        console.log('[Frontend] Removed schema:', schemaName, 'New set:', Array.from(newSet))
      } else {
        newSet.add(schemaName)
        console.log('[Frontend] Added schema:', schemaName, 'New set:', Array.from(newSet))
      }
      
      // Don't call fetchTables here - let the useEffect handle it when state updates
      // The useEffect watching selectedSchemas.size will trigger fetchTables automatically
      
      return newSet
    })
  }
  
  const handleSelectAllSchemas = () => {
    if (selectedSchemas.size === schemas.length) {
      setSelectedSchemas(new Set())
    } else {
      setSelectedSchemas(new Set(schemas))
    }
  }

  const handleSelectAllTables = () => {
    if (selectedTables.size === tables.length) {
      setSelectedTables(new Set())
      setSelectedColumns({})
      setColumns({})
    } else {
      setSelectedTables(new Set(tables.map(t => t.id)))
    }
  }

  const handleSelectAllColumns = (tableId: string) => {
    setSelectedColumns(prev => {
      const newCols = { ...prev }
      const tableCols = columns[tableId] || []
      if (newCols[tableId] && newCols[tableId].size === tableCols.length) {
        delete newCols[tableId]
      } else {
        newCols[tableId] = new Set(tableCols.map(col => col.name))
      }
      return newCols
    })
  }

  const checkConflicts = async (): Promise<boolean> => {
    setCheckingConflicts(true)
    setError(null)
    
    try {
      const token = localStorage.getItem('aiquery_token')
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      let requestBody: any;
      if (source.type === 'airtable') {
        requestBody = {
          dataSourceType: 'airtable',
          baseId: connectionConfig.baseId,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          )
        }
      } else if (source.type === 'bigquery') {
        requestBody = {
          dataSourceType: 'bigquery',
          projectId: connectionConfig.projectId,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          )
        }
      } else if (source.type === 'databricks') {
        requestBody = {
          dataSourceType: 'databricks',
          database: connectionConfig.database,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          )
        }
      } else if (source.type === 'postgres' || source.type === 'postgresql') {
        requestBody = {
          dataSourceType: source.type,
          database: connectionConfig.database,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          )
        }
      } else if (source.type === 'redshift') {
        requestBody = {
          dataSourceType: 'redshift',
          database: connectionConfig.database,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          )
        }
      } else if (source.type === 'azure' || source.type === 'sqlserver') {
        requestBody = {
          dataSourceType: source.type,
          database: connectionConfig.database,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          )
        }
      } else if (source.type === 'snowflake') {
        requestBody = {
          dataSourceType: 'snowflake',
          database: connectionConfig.database,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          )
        }
      } else if (source.type === 'mysql') {
        requestBody = {
          dataSourceType: 'mysql',
          database: connectionConfig.database,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          )
        }
      } else {
        setError(`Unsupported data source type: ${source.type}`)
        setCheckingConflicts(false)
        return false
      }

      const response = await fetch('/api/rag/check-conflicts', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        throw new Error('Failed to check conflicts')
      }

      const data = await response.json()
      setConflicts(data)
      
      if (data.hasConflicts) {
        setShowConflictModal(true)
        setMergeMode(null) // Reset merge mode when showing conflicts
      }
      
      return data.hasConflicts
    } catch (err) {
      console.error('Error checking conflicts:', err)
      setError(err instanceof Error ? err.message : 'Failed to check conflicts')
      return false
    } finally {
      setCheckingConflicts(false)
    }
  }

  const executeCreateRAG = async (selectedMergeMode?: 'replace_all' | 'replace_columns' | 'add_columns', descriptionMode?: 'generate' | 'metadata') => {
    // Only use mergeMode if explicitly set (from conflict resolution)
    // If no conflicts, don't send mergeMode - backend will add new tables automatically
    const mergeModeToUse = selectedMergeMode || mergeMode || undefined
    const columnDescriptionModeToUse = descriptionMode || columnDescriptionMode || 'generate' // Default to generate
    
    try {
      // Get LLM provider (use user-specific key if authenticated, otherwise generic)
      // API keys are no longer sent from frontend - backend will get from user settings or env
      const currentUserId = localStorage.getItem('aiquery_current_user_id')
      const llmProvider = currentUserId 
        ? (localStorage.getItem(`aiquery_llm_provider_${currentUserId}`) || 'openai')
        : (localStorage.getItem('aiquery_llm_provider') || 'openai')
      let llmModelType = 'full'
      if (currentUserId) {
        if (llmProvider === 'openai') {
          llmModelType = localStorage.getItem(`aiquery_openai_model_${currentUserId}`) || 'full'
        } else if (llmProvider === 'gemini') {
          llmModelType = localStorage.getItem(`aiquery_gemini_model_${currentUserId}`) || 'full'
        } else {
          llmModelType = localStorage.getItem(`aiquery_anthropic_model_${currentUserId}`) || 'full'
        }
      } else {
        llmModelType = localStorage.getItem('aiquery_llm_model_type') || 'full'
      }
      const llmApiKey = currentUserId
        ? (llmProvider === 'openai'
            ? localStorage.getItem(`aiquery_openai_api_key_${currentUserId}`) || ''
            : llmProvider === 'gemini'
              ? localStorage.getItem(`aiquery_gemini_api_key_${currentUserId}`) || ''
              : localStorage.getItem(`aiquery_anthropic_api_key_${currentUserId}`) || '')
        : (llmProvider === 'openai'
            ? localStorage.getItem('aiquery_openai_api_key') || ''
            : llmProvider === 'gemini'
              ? localStorage.getItem('aiquery_gemini_api_key') || ''
              : localStorage.getItem('aiquery_anthropic_api_key') || '')
      const llmCustomModel = currentUserId
        ? (llmProvider === 'openai'
            ? localStorage.getItem(`aiquery_openai_custom_model_${currentUserId}`) || ''
            : llmProvider === 'gemini'
              ? localStorage.getItem(`aiquery_gemini_custom_model_${currentUserId}`) || ''
              : localStorage.getItem(`aiquery_anthropic_custom_model_${currentUserId}`) || '')
        : (llmProvider === 'openai'
            ? localStorage.getItem('aiquery_openai_custom_model') || ''
            : llmProvider === 'gemini'
              ? localStorage.getItem('aiquery_gemini_custom_model') || ''
              : localStorage.getItem('aiquery_anthropic_custom_model') || '')
      const llmModel =
        llmModelType === 'custom' && llmCustomModel.trim()
          ? llmCustomModel.trim()
          : llmProvider === 'openai'
            ? (llmModelType === 'light' ? 'gpt-4o-mini' : 'gpt-4o')
            : llmProvider === 'gemini'
              ? (llmModelType === 'light' ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash')
              : (llmModelType === 'light' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6')

      // Get authentication token
      const token = localStorage.getItem('aiquery_token')
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }
      
      // Add Authorization header if token exists
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      // Prepare request body based on data source type
      const activeWs =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem('aiquery_active_workspace_name')
          : null
      let requestBody: any;
      if (source.type === 'airtable') {
        requestBody = {
          dataSourceType: 'airtable',
          apiKey: connectionConfig.apiKey,
          baseId: connectionConfig.baseId,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          ),
          llmProvider: llmProvider,
          // API keys are no longer sent - backend will get from user settings or env
          ...(mergeModeToUse && { mergeMode: mergeModeToUse }),
          columnDescriptionMode: columnDescriptionModeToUse
        }
      } else if (source.type === 'bigquery') {
        const datasetsToUse = selectedDatasets.size > 0 
          ? Array.from(selectedDatasets)
          : (connectionConfig.datasets 
              ? connectionConfig.datasets.split(',').map((d: string) => d.trim()).filter((d: string) => d.length > 0)
              : [])
        requestBody = {
          dataSourceType: 'bigquery',
          projectId: connectionConfig.projectId,
          serviceAccountKey: connectionConfig.serviceAccountKey,
          datasets: datasetsToUse,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          ),
          llmProvider: llmProvider,
          // API keys are no longer sent - backend will get from user settings or env
          ...(mergeModeToUse && { mergeMode: mergeModeToUse }),
          columnDescriptionMode: columnDescriptionModeToUse
        }
      } else if (source.type === 'databricks') {
        // Databricks
        const selectedCatalogArray = Array.from(selectedCatalogs).map((c) => c.trim()).filter(Boolean)
        const selectedSchemaArray = Array.from(selectedSchemas).map((s) => s.trim()).filter(Boolean)
        requestBody = {
          dataSourceType: 'databricks',
          database: connectionConfig.database,
          ...(selectedCatalogArray.length > 0 ? { catalog: selectedCatalogArray[0] } : (connectionConfig.catalog ? { catalog: connectionConfig.catalog } : {})),
          ...(selectedSchemaArray.length > 0 ? { schemas: selectedSchemaArray.join(',') } : (connectionConfig.schemas ? { schemas: connectionConfig.schemas } : {})),
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          ),
          llmProvider: llmProvider,
          ...(mergeModeToUse && { mergeMode: mergeModeToUse }),
          columnDescriptionMode: columnDescriptionModeToUse,
          connectionMethod: connectionConfig.connectionMethod || 'url'
        }
        
        if (connectionConfig.connectionMethod === 'host') {
          // Client connection
          if (connectionConfig.serverHostname) requestBody.serverHostname = connectionConfig.serverHostname
          if (connectionConfig.host) requestBody.host = connectionConfig.host
          if (connectionConfig.server) requestBody.server = connectionConfig.server
          if (connectionConfig.clientId) requestBody.clientId = connectionConfig.clientId
          if (connectionConfig.clientSecret) requestBody.clientSecret = connectionConfig.clientSecret
        } else {
          // URL connection
          if (connectionConfig.jdbcUrl) requestBody.jdbcUrl = connectionConfig.jdbcUrl
          if (connectionConfig.tokenName) requestBody.tokenName = connectionConfig.tokenName
          if (connectionConfig.token) requestBody.token = connectionConfig.token
          if (connectionConfig.accessToken) requestBody.accessToken = connectionConfig.accessToken
        }
        
        if (connectionConfig.host) requestBody.host = connectionConfig.host
        if (connectionConfig.server) requestBody.server = connectionConfig.server
        if (connectionConfig.port) requestBody.port = connectionConfig.port
        if (connectionConfig.schema) requestBody.schema = connectionConfig.schema
        if (connectionConfig.httpPath) requestBody.httpPath = connectionConfig.httpPath
      } else if (source.type === 'postgres' || source.type === 'postgresql') {
        // PostgreSQL
        requestBody = {
          dataSourceType: source.type,
          database: connectionConfig.database,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          ),
          llmProvider: llmProvider,
          ...(mergeModeToUse && { mergeMode: mergeModeToUse }),
          columnDescriptionMode: columnDescriptionModeToUse,
          username: connectionConfig.username,
          password: connectionConfig.password,
          authMethod: connectionConfig.authMethod || 'native',
          connectionMethod: connectionConfig.connectionMethod || 'host'
        }
        
        if (connectionConfig.host) requestBody.host = connectionConfig.host
        if (connectionConfig.server) requestBody.server = connectionConfig.server
        if (connectionConfig.serverUrl) requestBody.serverUrl = connectionConfig.serverUrl
        if (connectionConfig.port) requestBody.port = connectionConfig.port
        if (connectionConfig.schema) requestBody.schema = connectionConfig.schema
        if (connectionConfig.schemas) requestBody.schemas = connectionConfig.schemas
      } else if (source.type === 'redshift') {
        // Redshift
        requestBody = {
          dataSourceType: 'redshift',
          database: connectionConfig.database,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          ),
          llmProvider: llmProvider,
          ...(mergeModeToUse && { mergeMode: mergeModeToUse }),
          columnDescriptionMode: columnDescriptionModeToUse,
          username: connectionConfig.username,
          password: connectionConfig.password,
          authMethod: connectionConfig.authMethod || 'native',
          connectionMethod: connectionConfig.connectionMethod || 'host'
        }
        
        if (connectionConfig.host) requestBody.host = connectionConfig.host
        if (connectionConfig.server) requestBody.server = connectionConfig.server
        if (connectionConfig.serverUrl) requestBody.serverUrl = connectionConfig.serverUrl
        if (connectionConfig.port) requestBody.port = connectionConfig.port
        if (connectionConfig.jdbcUrl) requestBody.jdbcUrl = connectionConfig.jdbcUrl
        if (connectionConfig.schema) requestBody.schema = connectionConfig.schema
        if (connectionConfig.schemas) requestBody.schemas = connectionConfig.schemas
      } else if (source.type === 'azure' || source.type === 'sqlserver') {
        // Azure SQL Server / SQL Server
        requestBody = {
          dataSourceType: source.type,
          database: connectionConfig.database,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          ),
          llmProvider: llmProvider,
          ...(mergeModeToUse && { mergeMode: mergeModeToUse }),
          columnDescriptionMode: columnDescriptionModeToUse,
          username: connectionConfig.username,
          password: connectionConfig.password,
          authMethod: connectionConfig.authMethod || 'sql',
          connectionMethod: connectionConfig.connectionMethod || 'host'
        }
        
        if (connectionConfig.host) requestBody.host = connectionConfig.host
        if (connectionConfig.server) requestBody.server = connectionConfig.server
        if (connectionConfig.serverUrl) requestBody.serverUrl = connectionConfig.serverUrl
        if (connectionConfig.port) requestBody.port = connectionConfig.port
        if (connectionConfig.schema) requestBody.schema = connectionConfig.schema
        if (connectionConfig.schemas) requestBody.schemas = connectionConfig.schemas
      } else if (source.type === 'snowflake') {
        // Snowflake
        requestBody = {
          dataSourceType: 'snowflake',
          database: connectionConfig.database,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          ),
          llmProvider: llmProvider,
          ...(mergeModeToUse && { mergeMode: mergeModeToUse }),
          columnDescriptionMode: columnDescriptionModeToUse,
          username: connectionConfig.username,
          password: connectionConfig.password,
          account: connectionConfig.account,
          warehouse: connectionConfig.warehouse,
          authMethod: connectionConfig.authMethod || 'snowflake'
        }
        
        if (connectionConfig.host) requestBody.host = connectionConfig.host
        if (connectionConfig.server) requestBody.server = connectionConfig.server
        const selectedSnowflakeSchemas = Array.from(selectedSchemas)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
        if (selectedSnowflakeSchemas.length > 0) {
          requestBody.schemas = selectedSnowflakeSchemas.join(',')
          requestBody.schema = selectedSnowflakeSchemas[0]
        } else {
          if (connectionConfig.schemas) requestBody.schemas = connectionConfig.schemas
          if (connectionConfig.schema) requestBody.schema = connectionConfig.schema
        }
      } else if (source.type === 'mysql') {
        // MySQL
        requestBody = {
          dataSourceType: 'mysql',
          database: connectionConfig.database,
          selectedTables: Array.from(selectedTables),
          selectedColumns: Object.fromEntries(
            Object.entries(selectedColumns).map(([tableId, colSet]) => [tableId, Array.from(colSet)])
          ),
          llmProvider: llmProvider,
          ...(mergeModeToUse && { mergeMode: mergeModeToUse }),
          columnDescriptionMode: columnDescriptionModeToUse,
          username: connectionConfig.username,
          password: connectionConfig.password,
          authMethod: connectionConfig.authMethod || 'native',
          connectionMethod: connectionConfig.connectionMethod || 'host'
        }
        
        if (connectionConfig.host) requestBody.host = connectionConfig.host
        if (connectionConfig.server) requestBody.server = connectionConfig.server
        if (connectionConfig.serverUrl) requestBody.serverUrl = connectionConfig.serverUrl
        if (connectionConfig.port) requestBody.port = connectionConfig.port
        if (connectionConfig.schema) requestBody.schema = connectionConfig.schema
      } else {
        // Unknown data source type
        setError(`Unsupported data source type: ${source.type}`)
        setCreating(false)
        return
      }

      // Ensure RAG create uses the same active user LLM selection as chat.
      requestBody.llmProvider = llmProvider
      if (activeWs && activeWs.trim()) requestBody.workspaceName = activeWs.trim()
      if (llmApiKey.trim()) requestBody.llmApiKey = llmApiKey.trim()
      if (llmModel) requestBody.llmModel = llmModel

      const response = await fetch('/api/rag/create', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create Knowledge Base')
      }

      const data = await response.json()
      if (data.success) {
        setSuccess(true)
        setConflicts(null)
        setMergeMode(null)
        setShowConflictModal(false)
        setTimeout(() => {
          onSuccess()
          onClose()
        }, 2000)
      } else {
        throw new Error(data.error || 'Failed to create Knowledge Base')
      }
    } catch (err) {
      console.error('Error creating Knowledge Base:', err)
      setError(err instanceof Error ? err.message : 'Failed to create Knowledge Base')
      setSuccess(false)
    } finally {
      setCreating(false)
    }
  }

  const handleCreateRAG = async () => {
    // Validate that at least one column is selected across all tables
    const totalSelectedColumns = Object.values(selectedColumns).reduce((sum, cols) => sum + cols.size, 0)
    if (totalSelectedColumns === 0) {
      setError('Please select at least one column')
      return
    }

    if (selectedTables.size === 0) {
      setError('Please select at least one table')
      return
    }

    if (source.type === 'bigquery') {
      if (!connectionConfig.projectId || !connectionConfig.serviceAccountKey) {
        setError('Project ID and Service Account Key are required')
        return
      }
    } else if (source.type === 'airtable') {
      if (!connectionConfig.apiKey) {
        setError('Airtable Token is required for RAG creation')
        return
      }
      if (!connectionConfig.baseId) {
        setError('Base ID is required for RAG creation. Please provide a Base ID in your Airtable connection configuration.')
        return
      }
    }

    // Check for conflicts first
    const hasConflicts = await checkConflicts()
    
    // If conflicts exist and no merge mode selected, show conflict popup modal
    if (hasConflicts && !mergeMode) {
      return // Don't proceed, user needs to select merge mode in popup
    }

    // Show column description mode popup (for both new and existing tables)
    if (!columnDescriptionMode) {
      setShowColumnDescriptionModal(true)
      return // Don't proceed, user needs to select column description mode
    }

    // No conflicts or merge mode already selected, and column description mode selected, proceed
    setCreating(true)
    setError(null)
    await executeCreateRAG()
  }

  useEffect(() => {
    console.log('✅ RAGCreationModal component mounted/updated')
    console.log('Source:', source.id, 'Type:', source.type)
    console.log('Connection config exists:', !!connectionConfig)
    console.log('Modal ref:', modalRef.current)
    
    // Check if modal is actually in the DOM and visible
    if (modalRef.current) {
      const rect = modalRef.current.getBoundingClientRect()
      const computedStyle = window.getComputedStyle(modalRef.current)
      console.log('Modal position:', { top: rect.top, left: rect.left, width: rect.width, height: rect.height })
      console.log('Modal visibility:', computedStyle.visibility, 'display:', computedStyle.display, 'opacity:', computedStyle.opacity, 'zIndex:', computedStyle.zIndex)
      
      // Check parent overlay
      const overlay = modalRef.current.parentElement
      if (overlay) {
        const overlayStyle = window.getComputedStyle(overlay)
        console.log('Overlay zIndex:', overlayStyle.zIndex, 'position:', overlayStyle.position)
      }
    }
    
    return () => {
      console.log('❌ RAGCreationModal useEffect cleanup running (dependencies changed or component unmounting)', {
        sourceId: source.id,
        sourceType: source.type,
        hasConnectionConfig: !!connectionConfig
      })
    }
  }, [source.id, source.type, connectionConfig])

  console.log('🔄 RAGCreationModal render called - Component is rendering!', {
    sourceId: source.id,
    sourceType: source.type,
    hasConnectionConfig: !!connectionConfig,
    connectionConfigKeys: connectionConfig ? Object.keys(connectionConfig) : []
  })

  if (!connectionConfig) {
    console.error('❌ RAGCreationModal: connectionConfig is missing! Returning null.')
    return null
  }

  console.log('✅ About to render modal overlay')

  const subModalOverlayStyle: React.CSSProperties = {
    zIndex: 10050,
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0
  }

  const conflictModalPortal =
    typeof document !== 'undefined' &&
    showConflictModal &&
    conflicts &&
    conflicts.hasConflicts
      ? createPortal(
          <div
            className="rag-conflict-modal-overlay"
            style={subModalOverlayStyle}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                // keep open until user picks an option
              }
            }}
          >
            <div className="rag-conflict-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="rag-conflict-modal-header">
                <h2>⚠️ Existing Knowledge Base Found</h2>
                <button
                  className="rag-conflict-modal-close-btn"
                  onClick={() => {
                    setShowConflictModal(false)
                    setConflicts(null)
                    setMergeMode(null)
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="rag-conflict-modal-body">
                <p className="rag-conflict-intro">
                  The following tables already exist in your Knowledge Base. How would you like to proceed?
                </p>

                <div className="rag-conflicts-list">
                  {conflicts.conflicts.map((conflict: any, idx: number) => (
                    <div key={idx} className="rag-conflict-item">
                      <div className="rag-conflict-table-name">
                        <strong>📊 {conflict.tableName}</strong>
                      </div>
                      {conflict.hasExistingColumns && (
                        <div className="rag-conflict-details">
                          <span className="rag-conflict-label">Existing columns:</span>
                          <span className="rag-conflict-columns">{conflict.existingColumns.join(', ')}</span>
                        </div>
                      )}
                      {conflict.hasNewColumns && (
                        <div className="rag-conflict-details">
                          <span className="rag-conflict-label">New columns:</span>
                          <span className="rag-conflict-columns">{conflict.newColumns.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="rag-merge-options">
                  <h3>Select Merge Option:</h3>
                  <div className="rag-merge-option">
                    <input
                      type="radio"
                      id="merge-replace-all"
                      name="mergeMode"
                      value="replace_all"
                      checked={mergeMode === 'replace_all'}
                      onChange={() => setMergeMode('replace_all')}
                    />
                    <label htmlFor="merge-replace-all">
                      <strong>🔄 Replace All</strong>
                      <span className="rag-merge-description">
                        Completely overwrite existing tables and columns. This will replace all existing data.
                      </span>
                    </label>
                  </div>
                  <div className="rag-merge-option">
                    <input
                      type="radio"
                      id="merge-replace-columns"
                      name="mergeMode"
                      value="replace_columns"
                      checked={mergeMode === 'replace_columns'}
                      onChange={() => setMergeMode('replace_columns')}
                    />
                    <label htmlFor="merge-replace-columns">
                      <strong>📝 Replace Columns Only</strong>
                      <span className="rag-merge-description">
                        Replace columns but keep the existing table summary/description.
                      </span>
                    </label>
                  </div>
                  <div className="rag-merge-option">
                    <input
                      type="radio"
                      id="merge-add-columns"
                      name="mergeMode"
                      value="add_columns"
                      checked={mergeMode === 'add_columns'}
                      onChange={() => setMergeMode('add_columns')}
                    />
                    <label htmlFor="merge-add-columns">
                      <strong>➕ Add Columns Only</strong>
                      <span className="rag-merge-description">
                        Add new columns to existing tables. Keep all existing columns and summary.
                      </span>
                    </label>
                  </div>
                </div>
              </div>
              <div className="rag-conflict-modal-footer">
                <button
                  className="btn-conflict-cancel"
                  onClick={() => {
                    setShowConflictModal(false)
                    setConflicts(null)
                    setMergeMode(null)
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn-conflict-continue"
                  onClick={async () => {
                    if (mergeMode) {
                      const selectedMergeMode = mergeMode
                      setShowConflictModal(false)
                      setConflicts(null)
                      setTimeout(() => {
                        if (!columnDescriptionMode) {
                          setShowColumnDescriptionModal(true)
                        } else {
                          setCreating(true)
                          setError(null)
                          void executeCreateRAG(selectedMergeMode, columnDescriptionMode)
                        }
                      }, 100)
                    } else {
                      setError('Please select a merge option to continue')
                    }
                  }}
                  disabled={!mergeMode}
                >
                  Continue with Selected Option
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null

  const columnDescriptionModalPortal =
    typeof document !== 'undefined' && showColumnDescriptionModal
      ? createPortal(
          <div
            className="rag-conflict-modal-overlay"
            style={subModalOverlayStyle}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                // keep open until user picks an option
              }
            }}
          >
            <div className="rag-conflict-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="rag-conflict-modal-header">
                <h2>📝 Column Description Options</h2>
                <button
                  className="rag-conflict-modal-close-btn"
                  onClick={() => {
                    setShowColumnDescriptionModal(false)
                    setColumnDescriptionMode(null)
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="rag-conflict-modal-body">
                <p className="rag-conflict-intro">
                  How would you like to handle column descriptions for the selected columns?
                </p>

                <div className="rag-merge-options">
                  <div className="rag-merge-option">
                    <input
                      type="radio"
                      id="desc-generate"
                      name="columnDescriptionMode"
                      value="generate"
                      checked={columnDescriptionMode === 'generate'}
                      onChange={() => setColumnDescriptionMode('generate')}
                    />
                    <label htmlFor="desc-generate">
                      <strong>🤖 Create new descriptions for the selected columns</strong>
                      <span className="rag-merge-description">
                        Use AI to generate new column descriptions based on column names, types, and table context. This will create descriptions even if metadata already has descriptions.
                      </span>
                    </label>
                  </div>
                  <div className="rag-merge-option">
                    <input
                      type="radio"
                      id="desc-metadata"
                      name="columnDescriptionMode"
                      value="metadata"
                      checked={columnDescriptionMode === 'metadata'}
                      onChange={() => setColumnDescriptionMode('metadata')}
                    />
                    <label htmlFor="desc-metadata">
                      <strong>📋 Ingest column descriptions from the metadata</strong>
                      <span className="rag-merge-description">
                        Use existing column descriptions from BigQuery metadata. If a column doesn&apos;t have a description in metadata, it will be generated using AI.
                      </span>
                    </label>
                  </div>
                </div>
              </div>
              <div className="rag-conflict-modal-footer">
                <button
                  className="btn-conflict-cancel"
                  onClick={() => {
                    setShowColumnDescriptionModal(false)
                    setColumnDescriptionMode(null)
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn-conflict-continue"
                  onClick={async () => {
                    if (columnDescriptionMode) {
                      const selectedDescriptionMode = columnDescriptionMode
                      setShowColumnDescriptionModal(false)
                      setTimeout(async () => {
                        setCreating(true)
                        setError(null)
                        await executeCreateRAG(mergeMode || undefined, selectedDescriptionMode)
                      }, 100)
                    } else {
                      setError('Please select a column description option to continue')
                    }
                  }}
                  disabled={!columnDescriptionMode}
                >
                  Continue with Selected Option
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      {conflictModalPortal}
      {columnDescriptionModalPortal}
      <div 
      className="rag-modal-overlay" 
      onClick={onClose} 
      style={{ 
        zIndex: 10000,
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'block',
        visibility: 'visible',
        opacity: 1
      }}
    >
      <div 
        ref={modalRef}
        className="rag-modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ 
          position: 'fixed',
          left: isDragging ? undefined : '50%',
          top: isDragging ? undefined : '50%',
          transform: isDragging ? 'none' : 'translate(-50%, -50%)',
          width: `${modalSize.width}px`,
          height: `${modalSize.height}px`,
          cursor: isDragging ? 'grabbing' : 'default' 
        }}
      >
        <div 
          className="rag-modal-header"
          onMouseDown={handleMouseDown}
          style={{ cursor: 'grab' }}
        >
          <h2>{existingIndex ? 'Edit Knowledge Base' : 'Generate Knowledge Base'} - {source.name}</h2>
          <button className="rag-modal-close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="rag-modal-body">
          {success ? (
            <div className="rag-success">
              <span className="success-icon">✓</span>
              <p>Knowledge Base created successfully!</p>
              <p className="success-detail">The system will now use RAG for query generation.</p>
            </div>
          ) : (
            <div className="rag-three-column-layout">
              {/* Left Column: Datasets (only for BigQuery when datasets field is empty) or Schemas (only for Snowflake when schema field is empty) */}
              {needsDatasetSelection && (
                <div className="rag-column-panel">
                  <div className="rag-panel-header">
                    <h3>Datasets ({datasets.length})</h3>
                    <button className="btn-select-all" onClick={handleSelectAllDatasets}>
                      {selectedDatasets.size === datasets.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  <div className="rag-panel-content">
                    {loadingDatasets ? (
                      <div className="rag-loading-small">
                        <div className="rag-spinner-small"></div>
                        <p>Loading datasets...</p>
                      </div>
                    ) : datasets.length === 0 ? (
                      <div className="rag-empty-state">
                        <p>No datasets found</p>
                      </div>
                    ) : (
                      <div className="rag-list">
                        {datasets.map(dataset => (
                          <label
                            key={dataset.id}
                            className={`rag-item ${selectedDatasets.has(dataset.id) ? 'selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedDatasets.has(dataset.id)}
                              onChange={() => handleDatasetToggle(dataset.id)}
                            />
                            <div className="rag-item-info">
                              <span className="rag-item-name">{dataset.name}</span>
                              {dataset.location && (
                                <span className="rag-item-meta">Location: {dataset.location}</span>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {needsCatalogSelection && (
                <div className="rag-column-panel">
                  <div className="rag-panel-header">
                    <h3>Catalogs ({catalogs.length})</h3>
                    <button className="btn-select-all" onClick={() => {
                      if (selectedCatalogs.size === catalogs.length) {
                        setSelectedCatalogs(new Set())
                      } else {
                        setSelectedCatalogs(new Set(catalogs.map(c => c.id)))
                      }
                    }}>
                      {selectedCatalogs.size === catalogs.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  <div className="rag-panel-content">
                    {loadingCatalogs ? (
                      <div className="rag-loading-small">
                        <div className="rag-spinner-small"></div>
                        <p>Loading catalogs...</p>
                      </div>
                    ) : catalogs.length === 0 ? (
                      <div className="rag-empty-state">
                        <p>No catalogs found</p>
                      </div>
                    ) : (
                      <div className="rag-list">
                        {catalogs.map(catalog => (
                          <label
                            key={catalog.id}
                            className={`rag-item ${selectedCatalogs.has(catalog.id) ? 'selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedCatalogs.has(catalog.id)}
                              onChange={() => {
                                const newSelected = new Set(selectedCatalogs)
                                if (newSelected.has(catalog.id)) {
                                  newSelected.delete(catalog.id)
                                } else {
                                  newSelected.add(catalog.id)
                                }
                                setSelectedCatalogs(newSelected)
                              }}
                            />
                            <div className="rag-item-info">
                              <span className="rag-item-name">{catalog.name}</span>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {(needsSchemaSelection || needsCatalogSelection) && (
                <div className="rag-column-panel">
                  <div className="rag-panel-header">
                    <h3>Schemas ({schemas.length})</h3>
                    <button className="btn-select-all" onClick={handleSelectAllSchemas}>
                      {selectedSchemas.size === schemas.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  <div className="rag-panel-content">
                    {loadingSchemas ? (
                      <div className="rag-loading-small">
                        <div className="rag-spinner-small"></div>
                        <p>Loading schemas...</p>
                      </div>
                    ) : schemas.length === 0 ? (
                      <div className="rag-empty-state">
                        <p>No schemas found</p>
                      </div>
                    ) : (
                      <div className="rag-list">
                        {schemas.map(schemaName => (
                          <label
                            key={schemaName}
                            className={`rag-item ${selectedSchemas.has(schemaName) ? 'selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedSchemas.has(schemaName)}
                              onChange={() => handleSchemaToggle(schemaName)}
                            />
                            <div className="rag-item-info">
                              <span className="rag-item-name">{schemaName}</span>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Middle Column: Tables */}
              <div className="rag-column-panel">
                <div className="rag-panel-header">
                  <h3>Tables ({tables.length})</h3>
                  <button className="btn-select-all" onClick={handleSelectAllTables}>
                    {selectedTables.size === tables.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="rag-panel-content">
                  {loadingTables ? (
                    <div className="rag-loading-small">
                      <div className="rag-spinner-small"></div>
                      <p>Loading tables...</p>
                    </div>
                  ) : tables.length === 0 ? (
                    <div className="rag-empty-state">
                      {needsDatasetSelection && selectedDatasets.size === 0 ? (
                        <p>Select datasets to see tables</p>
                      ) : needsCatalogSelection && selectedCatalogs.size === 0 ? (
                        <p>Select catalogs to see schemas</p>
                      ) : needsCatalogSelection && selectedSchemas.size === 0 ? (
                        <p>Select schemas to see tables</p>
                      ) : needsSchemaSelection && selectedSchemas.size === 0 ? (
                        <p>Select schemas to see tables</p>
                      ) : source.type === 'airtable' ? (
                        <>
                          <p>No tables found automatically.</p>
                          <input
                            type="text"
                            className="rag-manual-input"
                            placeholder="e.g., Epics, Capabilities, Features"
                            value={manualTableInput}
                            onChange={(e) => {
                              setManualTableInput(e.target.value)
                              const tableNames = e.target.value.split(',').map(t => t.trim()).filter(t => t.length > 0)
                              setSelectedTables(new Set(tableNames))
                            }}
                          />
                        </>
                      ) : (
                        <p>No tables found</p>
                      )}
                    </div>
                  ) : (
                    <div className="rag-list">
                      {tables.map(table => (
                        <label
                          key={table.id}
                          className={`rag-item ${selectedTables.has(table.id) ? 'selected' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedTables.has(table.id)}
                            onChange={() => handleTableToggle(table.id)}
                          />
                          <div className="rag-item-info">
                            <span className="rag-item-name">{table.name || table.id}</span>
                            <span className="rag-item-meta">
                              {table.fieldCount} fields
                              {table.rowCount && ` • ${table.rowCount.toLocaleString()} rows`}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Columns */}
              <div className="rag-column-panel">
                <div className="rag-panel-header">
                  <h3>Columns</h3>
                </div>
                <div className="rag-panel-content">
                  {loadingColumns ? (
                    <div className="rag-loading-small">
                      <div className="rag-spinner-small"></div>
                      <p>Loading columns...</p>
                    </div>
                  ) : selectedTables.size === 0 ? (
                    <div className="rag-empty-state">
                      <p>Select tables to see columns</p>
                    </div>
                  ) : (
                    <div className="rag-columns-container">
                      {Array.from(selectedTables).map(tableId => {
                        const tableCols = columns[tableId] || []
                        const selectedCols = selectedColumns[tableId] || new Set()
                        const table = tables.find(t => t.id === tableId)
                        
                        if (tableCols.length === 0 && !loadingColumns) {
                          return null // Don't show empty groups
                        }
                        
                        return (
                          <div key={tableId} className="rag-column-group">
                            <div className="rag-column-group-header">
                              <h4>{table?.name || tableId}</h4>
                              {tableCols.length > 0 && (
                                <button 
                                  className="btn-select-all-columns"
                                  onClick={() => handleSelectAllColumns(tableId)}
                                >
                                  {selectedCols.size === tableCols.length ? 'Deselect All' : 'Select All'}
                                </button>
                              )}
                            </div>
                            {tableCols.length > 0 && (
                              <div className="rag-column-list">
                                {tableCols.map(column => (
                                  <label
                                    key={column.name}
                                    className={`rag-column-item ${selectedCols.has(column.name) ? 'selected' : ''}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedCols.has(column.name)}
                                      onChange={() => handleColumnToggle(tableId, column.name)}
                                    />
                                    <div className="rag-column-info">
                                      <span className="rag-column-name">{column.name}</span>
                                      <span className="rag-column-meta">
                                        {column.type}
                                        {column.mode && ` (${column.mode})`}
                                        {column.description && ` • ${column.description}`}
                                      </span>
                                    </div>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rag-error-inline">
              <p>{error}</p>
            </div>
          )}
        </div>

        {!success && (
          <div className="rag-modal-footer">
            <button className="btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-create"
              onClick={handleCreateRAG}
              disabled={creating || checkingConflicts || selectedTables.size === 0 || Object.values(selectedColumns).reduce((sum, cols) => sum + cols.size, 0) === 0}
            >
              {checkingConflicts
                ? 'Checking conflicts...'
                : creating 
                ? (existingIndex ? 'Updating Knowledge Base...' : 'Creating Knowledge Base...') 
                : (existingIndex 
                  ? `Update Knowledge Base` 
                  : `Generate Knowledge Base`)
              }
            </button>
          </div>
        )}
        <div className="resize-handle" onMouseDown={handleResizeStart}></div>
      </div>
    </div>
    </>
  )
}

export default RAGCreationModal
