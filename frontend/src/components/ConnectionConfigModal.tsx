import React, { useState, useEffect, useId } from 'react'
import { useDraggableResizable } from '../hooks/useDraggableResizable'
import './ConnectionConfigModal.css'
import { DataSource } from './DataSourceSidebar'
import BigQueryIcon from './icons/BigQueryIcon'
import AzureSQLIcon from './icons/AzureSQLIcon'
import RedshiftIcon from './icons/RedshiftIcon'
import SnowflakeIcon from './icons/SnowflakeIcon'
import MySQLIcon from './icons/MySQLIcon'
import PostgreSQLIcon from './icons/PostgreSQLIcon'
import AirtableIcon from './icons/AirtableIcon'
import DatabricksIcon from './icons/DatabricksIcon'

interface ConnectionConfigModalProps {
  source: DataSource
  existingConfig: any
  onSave: (config: any) => void | Promise<void>
  onClose: () => void
  onDisconnect?: () => void
  onTestResult?: (success: boolean, config?: any) => void
  onSaveAndCreateRAG?: () => void // Callback to open RAG creation after saving
  onToggleMaximize?: () => void
  isMaximized?: boolean
  inline?: boolean
}

const ConnectionConfigModal: React.FC<ConnectionConfigModalProps> = ({
  source,
  existingConfig,
  onSave,
  onClose,
  onDisconnect,
  onTestResult,
  onSaveAndCreateRAG,
  onToggleMaximize,
  isMaximized,
  inline = false
}) => {
  const { modalRef, position, modalSize, isDragging, handleMouseDown, handleResizeStart } = useDraggableResizable({
    initialWidth: 700,
    initialHeight: 600,
    minWidth: 500,
    minHeight: 400,
    storageKey: `connectionConfigModal_${source.id}`
  })

  /** Unique per modal instance — avoids duplicate id + getElementById targeting wrong node when multiple modals exist */
  const bigqueryServiceAccountFileInputId = useId()
  
  const [config, setConfig] = useState<any>(existingConfig || {})
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [savePassword, setSavePassword] = useState(false)
  const [saveApiKey, setSaveApiKey] = useState<boolean>(existingConfig?.saveApiKey || false)
  const [saveBaseId, setSaveBaseId] = useState<boolean>(existingConfig?.saveBaseId || false)
  const [airtableTables, setAirtableTables] = useState<string[]>([])
  const [loadingTables, setLoadingTables] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null)
  const [connectionMethod, setConnectionMethod] = useState<'host' | 'url'>((existingConfig?.connectionMethod as 'host' | 'url') || 'host')
  const [authMethod, setAuthMethod] = useState<'sql' | 'windows'>((existingConfig?.authMethod as 'sql' | 'windows') || 'sql')
  const [redshiftAuthMethod, setRedshiftAuthMethod] = useState<'native' | 'pgpass'>((existingConfig?.authMethod as 'native' | 'pgpass') || 'native')
  const [redshiftSslMode, setRedshiftSslMode] = useState<'disable' | 'require' | 'verify-ca' | 'verify-full'>((existingConfig?.sslMode as 'disable' | 'require' | 'verify-ca' | 'verify-full') || 'require')
  const [postgresConnectionMethod, setPostgresConnectionMethod] = useState<'host' | 'url'>((existingConfig?.connectionMethod as 'host' | 'url') || 'host')
  const [postgresAuthMethod, setPostgresAuthMethod] = useState<'native' | 'pgpass'>((existingConfig?.authMethod as 'native' | 'pgpass') || 'native')
  const [overrideHost, setOverrideHost] = useState<boolean>(existingConfig?.overrideHost || false)
  const [snowflakeAuthMethod, setSnowflakeAuthMethod] = useState<'snowflake' | 'externalbrowser'>((existingConfig?.authMethod as 'snowflake' | 'externalbrowser') || 'snowflake')
  const [bigqueryAuthMethod, setBigqueryAuthMethod] = useState<'service-account-key' | 'user'>((existingConfig?.authMethod as 'service-account-key' | 'user') || 'service-account-key')
  const [databricksConnectionMethod, setDatabricksConnectionMethod] = useState<'host' | 'url'>((existingConfig?.connectionMethod as 'host' | 'url') || 'host')
  const [showConnectionDetails, setShowConnectionDetails] = useState(false)
  
  // State for Snowflake dropdown options (to be populated from backend/test connection)
  const [snowflakeDatabases, setSnowflakeDatabases] = useState<string[]>([])
  const [snowflakeWarehouses, setSnowflakeWarehouses] = useState<string[]>([])
  const [snowflakeSchemas, setSnowflakeSchemas] = useState<string[]>([])
  const [snowflakeRoles, setSnowflakeRoles] = useState<string[]>([])

  const normalizeSnowflakeAccountInput = (value?: string) => {
    if (!value) return ''
    let normalized = value.trim()
    normalized = normalized.replace(/^https?:\/\//i, '')
    normalized = normalized.replace(/\/.*$/, '')
    while (/\.snowflakecomputing\.com$/i.test(normalized)) {
      normalized = normalized.replace(/\.snowflakecomputing\.com$/i, '')
    }
    return normalized
  }

  useEffect(() => {
    if (isMaximized) setIsCollapsed(false)
  }, [isMaximized])

  useEffect(() => {
    const existing = existingConfig || {}
    // Set default values for BigQuery if not present
    if (source.type === 'bigquery') {
      if (!existing.host) {
        existing.host = 'https://www.googleapis.com/bigquery/v2'
      }
      if (!existing.port) {
        existing.port = 443
      }
      if (!existing.authMethod) {
        existing.authMethod = 'service-account-key'
      }
      // Set BigQuery auth method state
      setBigqueryAuthMethod(existing.authMethod as 'service-account-key' | 'user')
    }
    // For Snowflake, map account back to host for display (since we store account but display as host)
    if (source.type === 'snowflake' && existing.account && !existing.host) {
      existing.host = existing.account
    }
    setConfig(existing)
    // Set connection method and auth method from existing config
    if (existing.connectionMethod) {
      setConnectionMethod(existing.connectionMethod as 'host' | 'url')
    }
    // For Databricks, set its own connection method state
    if (source.type === 'databricks' && existing.connectionMethod) {
      setDatabricksConnectionMethod(existing.connectionMethod as 'host' | 'url')
    }
    if (existing.authMethod && source.type !== 'bigquery') {
      setAuthMethod(existing.authMethod as 'sql' | 'windows')
      // For Redshift, authMethod can be 'native' or 'pgpass'
      if (source.type === 'redshift' && (existing.authMethod === 'native' || existing.authMethod === 'pgpass')) {
        setRedshiftAuthMethod(existing.authMethod as 'native' | 'pgpass')
      }
      // For Snowflake, authMethod can be 'snowflake' or 'externalbrowser'
      if (source.type === 'snowflake' && (existing.authMethod === 'snowflake' || existing.authMethod === 'externalbrowser')) {
        setSnowflakeAuthMethod(existing.authMethod as 'snowflake' | 'externalbrowser')
      }
    }
    if (existing.savePassword !== undefined) {
      setSavePassword(existing.savePassword)
    }
    if (existing.saveApiKey !== undefined) {
      setSaveApiKey(existing.saveApiKey)
    }
    if (existing.saveBaseId !== undefined) {
      setSaveBaseId(existing.saveBaseId)
    }
    // Load existing connection status if available
    const statusesSaved = localStorage.getItem('aiquery_connection_statuses')
    if (statusesSaved) {
      const statuses = JSON.parse(statusesSaved)
      if (statuses[source.id] && existingConfig) {
        // Status will be shown in the sidebar, but we can also show it in the modal if needed
      }
    }
  }, [existingConfig, source.id])

  // Fetch Airtable tables when API key and Base ID are provided
  useEffect(() => {
    if (source.type === 'airtable' && config.apiKey && config.baseId) {
      fetchAirtableTables(config.apiKey, config.baseId)
    } else {
      setAirtableTables([])
    }
  }, [source.type, config.apiKey, config.baseId])

  const fetchAirtableTables = async (apiKey: string, baseId: string) => {
    setLoadingTables(true)
    try {
      // Note: Airtable doesn't have a direct API to list all tables
      // We'll need to use the meta API or try to fetch schema
      // For now, we'll make it optional - users can specify table names
      // In a real implementation, you might want to call a backend endpoint
      // that uses the Airtable meta API to get table information
      setAirtableTables([])
    } catch (error) {
      console.error('Error fetching Airtable tables:', error)
      setAirtableTables([])
    } finally {
      setLoadingTables(false)
    }
  }

  const handleInputChange = (field: string, value: any) => {
    setConfig({ ...config, [field]: value })
    // Clear test result when user changes input
    if (testResult) {
      setTestResult(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Normalize config for Azure SQL, PostgreSQL, and Redshift before saving
    let normalizedConfig = { ...config }
    if (source.type === 'azure') {
      // Ensure server field is set based on connection method
      if (connectionMethod === 'host') {
        normalizedConfig.server = config.host || config.server
        delete normalizedConfig.serverUrl
      } else {
        normalizedConfig.server = config.serverUrl || config.server
        delete normalizedConfig.host
      }
      // Include connectionMethod and authMethod
      normalizedConfig.connectionMethod = connectionMethod
      normalizedConfig.authMethod = authMethod
      normalizedConfig.savePassword = savePassword
      // Always save schemas if it exists (like BigQuery datasets) - no conditional deletion
    } else if (source.type === 'airtable') {
      // Include saveApiKey and saveBaseId
      normalizedConfig.saveApiKey = saveApiKey
      normalizedConfig.saveBaseId = saveBaseId
    } else if (source.type === 'postgres') {
      // Ensure server field is set based on connection method
      if (postgresConnectionMethod === 'host') {
        normalizedConfig.host = config.host || config.server
        delete normalizedConfig.serverUrl
      } else {
        normalizedConfig.host = config.serverUrl || config.host || config.server
        delete normalizedConfig.server
      }
      // Include connectionMethod and authMethod
      normalizedConfig.connectionMethod = postgresConnectionMethod
      normalizedConfig.authMethod = postgresAuthMethod
      normalizedConfig.savePassword = savePassword
      normalizedConfig.overrideHost = overrideHost
    } else if (source.type === 'redshift') {
      // Ensure host/server field is set based on connection method
      if (connectionMethod === 'host') {
        normalizedConfig.host = config.host || config.server
        delete normalizedConfig.serverUrl
      } else {
        normalizedConfig.host = config.serverUrl || config.host || config.server
        delete normalizedConfig.server
      }
      // Include connectionMethod and authMethod
      normalizedConfig.connectionMethod = connectionMethod
      normalizedConfig.authMethod = redshiftAuthMethod
      normalizedConfig.sslMode = redshiftSslMode
      normalizedConfig.savePassword = savePassword
      // Always save schemas if it exists - no conditional deletion
    } else if (source.type === 'snowflake') {
      // Map host to account for Snowflake (Snowflake uses 'account' field)
      normalizedConfig.account = normalizeSnowflakeAccountInput(config.host || config.account)
      normalizedConfig.warehouse = config.warehouse
      normalizedConfig.database = config.database
      normalizedConfig.schema = config.schema
      normalizedConfig.username = config.username
      normalizedConfig.password = config.password
      normalizedConfig.role = config.role
      normalizedConfig.authMethod = snowflakeAuthMethod
      normalizedConfig.savePassword = savePassword
      // Remove host field to avoid confusion (use account instead)
      delete normalizedConfig.host
    } else if (source.type === 'bigquery') {
      // Include all BigQuery config fields
      normalizedConfig.projectId = config.projectId
      normalizedConfig.host = config.host || 'https://www.googleapis.com/bigquery/v2'
      normalizedConfig.port = config.port || 443
      normalizedConfig.authMethod = bigqueryAuthMethod
      // Only include serviceAccountKey if auth method is service-account-key
      if (bigqueryAuthMethod === 'service-account-key') {
        normalizedConfig.serviceAccountKey = config.serviceAccountKey
      } else {
        delete normalizedConfig.serviceAccountKey
      }
      // Always save datasets if it exists (optional field)
      if (config.datasets !== undefined) {
        normalizedConfig.datasets = config.datasets
      }
    } else if (source.type === 'mysql') {
      // Ensure host/server field is set based on connection method
      if (connectionMethod === 'host') {
        normalizedConfig.host = config.host || config.server
        delete normalizedConfig.serverUrl
      } else {
        normalizedConfig.host = config.serverUrl || config.host || config.server
        delete normalizedConfig.server
      }
      // Include connectionMethod
      normalizedConfig.connectionMethod = connectionMethod
      normalizedConfig.savePassword = savePassword
      // Always save datasets/schemas if it exists - no conditional deletion
      if (config.datasets !== undefined) {
        normalizedConfig.datasets = config.datasets
      }
    }
    
    try {
      // Save the connection (await if it's async)
      const saveResult = onSave(normalizedConfig)
      if (saveResult instanceof Promise) {
        await saveResult
      }
      
      // If onSaveAndCreateRAG callback is provided, call it to open RAG creation
      if (onSaveAndCreateRAG) {
        console.log('[ConnectionConfigModal] Save successful, opening RAG creation...')
        // Don't call onClose() here - let the callback handle closing the modal
        // This ensures selectedSource is preserved for RAG creation
        // Small delay to ensure save completes
        setTimeout(() => {
          // Call the callback which will close connection modal and open RAG modal
          console.log('[ConnectionConfigModal] Calling onSaveAndCreateRAG callback')
          onSaveAndCreateRAG!()
        }, 50)
      } else {
        // If no RAG callback, just close the modal
        onClose()
      }
    } catch (error) {
      // If save fails, don't close modal or open RAG creation
      console.error('Error saving connection:', error)
      // Error is already handled in handleSaveConnection
    }
  }

  const handleTestConnection = async () => {
    setTestingConnection(true)
    setTestResult(null)

    try {
      // Validate required fields based on data source type
      if (source.type === 'azure') {
        // Custom validation for Azure SQL
        const missingFields: string[] = []
        if (connectionMethod === 'host') {
          if (!config.host && !config.server) missingFields.push('Host/Server name')
          if (!config.database) missingFields.push('Database/Schema')
        } else {
          if (!config.serverUrl && !config.server) missingFields.push('Server URL')
          if (!config.database) missingFields.push('Database/Schema') // Database is also needed for URL mode
        }
        if (authMethod === 'sql') {
          if (!config.username) missingFields.push('Username/Server admin')
          if (!config.password) missingFields.push('Password')
        }
        
        if (missingFields.length > 0) {
          setTestResult({
            success: false,
            error: `Please fill in all required fields: ${missingFields.join(', ')}`
          })
          setTestingConnection(false)
          return
        }
      } else if (source.type === 'postgres') {
        // Custom validation for PostgreSQL
        const missingFields: string[] = []
        if (postgresConnectionMethod === 'host') {
          if (!config.host && !config.server) missingFields.push('Server Host')
          if (!config.port) missingFields.push('Port')
          if (!config.database) missingFields.push('Database')
        } else {
          if (!config.serverUrl && !config.server) missingFields.push('Server URL')
          if (!config.database) missingFields.push('Database')
        }
        if (!config.username) missingFields.push('Username')
        if (postgresAuthMethod === 'native' && !config.password) missingFields.push('Password')
        
        if (missingFields.length > 0) {
          setTestResult({
            success: false,
            error: `Please fill in all required fields: ${missingFields.join(', ')}`
          })
          setTestingConnection(false)
          return
        }
      } else if (source.type === 'redshift') {
        // Custom validation for Redshift
        const missingFields: string[] = []
        if (connectionMethod === 'host') {
          if (!config.host && !config.server) missingFields.push('Host/Instance')
          if (!config.port) missingFields.push('Port')
          if (!config.database) missingFields.push('Database')
        } else {
          if (!config.serverUrl && !config.host && !config.server) missingFields.push('Server URL')
          if (!config.database) missingFields.push('Database')
        }
        if (redshiftAuthMethod === 'native') {
          if (!config.username) missingFields.push('Username')
          if (!config.password) missingFields.push('Password')
        }
        
        if (missingFields.length > 0) {
          setTestResult({
            success: false,
            error: `Please fill in all required fields: ${missingFields.join(', ')}`
          })
          setTestingConnection(false)
          return
        }
      } else if (source.type === 'snowflake') {
        // Custom validation for Snowflake
        const missingFields: string[] = []
        if (!config.host) missingFields.push('Host')
        if (!config.database) missingFields.push('Database')
        if (!config.warehouse) missingFields.push('Warehouse')
        // Schema is optional - not required
        if (snowflakeAuthMethod === 'snowflake') {
          if (!config.username) missingFields.push('Username')
          if (!config.password) missingFields.push('Password')
        }
        
        if (missingFields.length > 0) {
          setTestResult({
            success: false,
            error: `Please fill in all required fields: ${missingFields.join(', ')}`
          })
          setTestingConnection(false)
          return
        }
      } else if (source.type === 'bigquery') {
        // Custom validation for BigQuery
        const missingFields: string[] = []
        if (!config.projectId) missingFields.push('Project ID')
        if (!config.host) missingFields.push('Host')
        if (!config.port) missingFields.push('Port')
        if (bigqueryAuthMethod === 'service-account-key' && !config.serviceAccountKey) {
          missingFields.push('Service Account Key')
        }
        
        if (missingFields.length > 0) {
          setTestResult({
            success: false,
            error: `Please fill in all required fields: ${missingFields.join(', ')}`
          })
          setTestingConnection(false)
          return
        }
      } else if (source.type === 'mysql') {
        // Custom validation for MySQL
        const missingFields: string[] = []
        if (connectionMethod === 'host') {
          if (!config.host && !config.server) missingFields.push('Server Host')
          if (!config.database) missingFields.push('Database')
        } else {
          if (!config.serverUrl && !config.host && !config.server) missingFields.push('Server URL')
          if (!config.database) missingFields.push('Database')
        }
        if (!config.username) missingFields.push('Username')
        if (!config.password) missingFields.push('Password')
        
        if (missingFields.length > 0) {
          setTestResult({
            success: false,
            error: `Please fill in all required fields: ${missingFields.join(', ')}`
          })
          setTestingConnection(false)
          return
        }
      } else if (source.type === 'databricks') {
        // Custom validation for Databricks
        const missingFields: string[] = []
        if (databricksConnectionMethod === 'host') {
          if (!config.serverHostname && !config.host && !config.server) missingFields.push('Host')
          if (!config.clientId) missingFields.push('Client ID')
          if (!config.clientSecret) missingFields.push('Client Secret')
        } else {
          if (!config.jdbcUrl) missingFields.push('JDBC URL')
          if (!config.tokenName) missingFields.push('Token Name')
          if (!config.token && !config.accessToken) missingFields.push('Token')
        }
        
        if (missingFields.length > 0) {
          setTestResult({
            success: false,
            error: `Please fill in all required fields: ${missingFields.join(', ')}`
          })
          setTestingConnection(false)
          return
        }
      } else {
        const requiredFields = getFieldsForSource().filter(f => f.required)
        const missingFields = requiredFields.filter(f => !config[f.key] || (typeof config[f.key] === 'string' && config[f.key].trim() === ''))
        
        if (missingFields.length > 0) {
          setTestResult({
            success: false,
            error: `Please fill in all required fields: ${missingFields.map(f => f.label).join(', ')}`
          })
          setTestingConnection(false)
          return
        }
      }

      // Normalize config for Azure SQL, Redshift, Snowflake, and MySQL to ensure fields are set correctly
      let normalizedConfig = { ...config }
      if (source.type === 'azure') {
        // Ensure server field is set based on connection method
        if (connectionMethod === 'host') {
          normalizedConfig.server = config.host || config.server
          // Remove serverUrl if it exists
          delete normalizedConfig.serverUrl
        } else {
          // For URL method, server should be the URL
          normalizedConfig.server = config.serverUrl || config.server
          // Remove host if it exists
          delete normalizedConfig.host
        }
        // Ensure connectionMethod and authMethod are included
        normalizedConfig.connectionMethod = connectionMethod
        normalizedConfig.authMethod = authMethod
        // Preserve schema field if it exists (it's optional)
        if (config.schema !== undefined) {
          normalizedConfig.schema = config.schema
        }
        // Preserve schemas field if it exists (it's optional, so don't delete if undefined)
        if (config.schemas !== undefined) {
          normalizedConfig.schemas = config.schemas
        }
      } else if (source.type === 'mysql') {
        // Ensure host/server field is set based on connection method
        if (connectionMethod === 'host') {
          normalizedConfig.host = config.host || config.server
          delete normalizedConfig.serverUrl
        } else {
          normalizedConfig.host = config.serverUrl || config.host || config.server
          delete normalizedConfig.server
        }
        // Include connectionMethod and savePassword
        normalizedConfig.connectionMethod = connectionMethod
        normalizedConfig.savePassword = savePassword
        // Preserve datasets field if it exists (it's optional, so don't delete if undefined)
        if (config.datasets !== undefined) {
          normalizedConfig.datasets = config.datasets
        }
      } else if (source.type === 'databricks') {
        // Ensure server field is set based on connection method
        if (databricksConnectionMethod === 'host') {
          normalizedConfig.serverHostname = config.serverHostname || config.host || config.server
          normalizedConfig.clientId = config.clientId
          normalizedConfig.clientSecret = config.clientSecret
          // For Client connection, database should be provided separately
          if (config.database) {
            normalizedConfig.database = config.database
          }
          delete normalizedConfig.jdbcUrl
          delete normalizedConfig.tokenName
          delete normalizedConfig.token
          delete normalizedConfig.accessToken
        } else {
          normalizedConfig.jdbcUrl = config.jdbcUrl
          normalizedConfig.tokenName = config.tokenName
          normalizedConfig.token = config.token || config.accessToken
          normalizedConfig.accessToken = config.token || config.accessToken
          // Extract database from JDBC URL if not explicitly provided
          // Format: jdbc:databricks://host:port/database;params
          if (config.database) {
            normalizedConfig.database = config.database
          } else if (config.jdbcUrl) {
            const jdbcMatch = config.jdbcUrl.match(/jdbc:databricks:\/\/[^:]+:\d+\/([^;]+)/);
            if (jdbcMatch && jdbcMatch[1]) {
              normalizedConfig.database = jdbcMatch[1];
            }
          }
          delete normalizedConfig.serverHostname
          delete normalizedConfig.host
          delete normalizedConfig.server
          delete normalizedConfig.clientId
          delete normalizedConfig.clientSecret
        }
        // Include connectionMethod and savePassword
        normalizedConfig.connectionMethod = databricksConnectionMethod
        normalizedConfig.savePassword = savePassword
        // Preserve schema field if it exists (it's optional)
        if (config.schema !== undefined) {
          normalizedConfig.schema = config.schema
        }
      } else if (source.type === 'redshift') {
        // Ensure host field is set based on connection method
        if (connectionMethod === 'host') {
          normalizedConfig.host = config.host || config.server
          // Remove serverUrl if it exists
          delete normalizedConfig.serverUrl
        } else {
          // For URL method, host should be the URL
          normalizedConfig.host = config.serverUrl || config.host || config.server
          // Remove server if it exists
          delete normalizedConfig.server
        }
        // Ensure connectionMethod and authMethod are included
        normalizedConfig.connectionMethod = connectionMethod
        normalizedConfig.authMethod = redshiftAuthMethod
        // Preserve schemas field if it exists (it's optional, so don't delete if undefined)
        if (config.schemas !== undefined) {
          normalizedConfig.schemas = config.schemas
        }
      } else if (source.type === 'snowflake') {
        // Map host to account for Snowflake (Snowflake uses 'account' field)
        normalizedConfig.account = normalizeSnowflakeAccountInput(config.host || config.account)
        normalizedConfig.warehouse = config.warehouse
        normalizedConfig.database = config.database
        normalizedConfig.schema = config.schema
        normalizedConfig.username = config.username
        normalizedConfig.password = config.password
        normalizedConfig.role = config.role
        normalizedConfig.authMethod = snowflakeAuthMethod
        normalizedConfig.savePassword = savePassword
        // Remove host field to avoid confusion (use account instead)
        delete normalizedConfig.host
      }

      const response = await fetch('/api/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dataSourceType: source.type,
          connectionConfig: normalizedConfig
        })
      })

      const data = await response.json()

      if (data.success) {
        setTestResult({
          success: true,
          message: data.message || 'Connection successful!'
        })
        // Update local config state with normalized config to preserve schemas field
        // For Azure SQL, Redshift, Snowflake, and MySQL, update with normalized config
        if (source.type === 'azure' || source.type === 'redshift' || source.type === 'snowflake' || source.type === 'mysql') {
          setConfig({ ...config, ...normalizedConfig })
        }
        // Notify parent component of successful test with normalized config (include schemas)
        const configToPass = (source.type === 'azure' || source.type === 'redshift' || source.type === 'snowflake' || source.type === 'mysql') ? { ...normalizedConfig } : config
        if (onTestResult) {
          onTestResult(true, configToPass)
        }
      } else {
        setTestResult({
          success: false,
          error: data.error || 'Connection test failed'
        })
        // Update local config state with normalized config to preserve schemas field
        // For Azure SQL, Redshift, Snowflake, and MySQL, update with normalized config
        if (source.type === 'azure' || source.type === 'redshift' || source.type === 'snowflake' || source.type === 'mysql') {
          setConfig({ ...config, ...normalizedConfig })
        }
        // Notify parent component of failed test with normalized config (include schemas)
        const configToPass = (source.type === 'azure' || source.type === 'redshift' || source.type === 'snowflake' || source.type === 'mysql') ? { ...normalizedConfig } : config
        if (onTestResult) {
          onTestResult(false, configToPass)
        }
      }
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to test connection'
      })
    } finally {
      setTestingConnection(false)
    }
  }

  const getFieldsForSource = () => {
    switch (source.type) {
      case 'bigquery':
        // BigQuery uses custom rendering, so return empty array
        return []
      case 'redshift':
        // Redshift uses custom rendering, so return empty array
        return []
      case 'azure':
        // Azure SQL uses custom rendering, so return empty array
        return []
      case 'snowflake':
        // Snowflake uses custom rendering, so return empty array
        return []
      case 'mysql':
        // MySQL uses custom rendering, so return empty array
        return []
      case 'postgres':
        // PostgreSQL uses custom rendering, so return empty array
        return []
      case 'airtable':
        // Airtable uses custom rendering, so return empty array
        return []
      case 'databricks':
        // Databricks uses custom rendering, so return empty array
        return []
      default:
        return [
          { key: 'connectionString', label: 'Connection String', type: 'textarea', required: true },
        ]
    }
  }

  const fields = getFieldsForSource()

  const modalBody = (
    <div 
      ref={modalRef}
      className={`connection-modal-content draggable-modal ${inline ? 'inline' : ''}`}
      onClick={(e) => e.stopPropagation()}
      style={inline ? undefined : {
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${modalSize.width}px`,
        height: `${modalSize.height}px`,
        cursor: isDragging ? 'grabbing' : 'default'
      }}
    >
        <div 
          className="connection-modal-header"
          onMouseDown={handleMouseDown}
          style={{ cursor: 'grab' }}
        >
          <div className="modal-header-left">
            <div className="modal-source-icon" style={{ backgroundColor: `${source.color}15` }}>
              {source.icon === 'bigquery' ? (
                <BigQueryIcon size={32} />
              ) : source.icon === 'azure' ? (
                <AzureSQLIcon size={32} />
              ) : source.icon === 'redshift' ? (
                <RedshiftIcon size={32} />
              ) : source.icon === 'snowflake' ? (
                <SnowflakeIcon size={32} />
              ) : source.icon === 'mysql' ? (
                <MySQLIcon size={32} />
              ) : source.icon === 'postgres' ? (
                <PostgreSQLIcon size={32} />
              ) : source.icon === 'airtable' ? (
                <AirtableIcon size={32} />
              ) : source.icon === 'databricks' ? (
                <DatabricksIcon size={32} />
              ) : (
                <span style={{ fontSize: '32px' }}>{source.icon}</span>
              )}
            </div>
            <div>
              <h2>{source.name} Connection</h2>
              <p className="modal-subtitle">
                Configure your data warehouse connection.
                <br />
                <span style={{ color: 'red' }}>**</span> <strong>Reminder:</strong> Please click the button "Save Connection" to create Knowledge Base for your database before you request data.
              </p>
            </div>
          </div>
          <div className="modal-header-actions">
            {inline && (
              <button
                className="modal-collapse-btn"
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
                className="modal-maximize-btn"
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
            <button className="modal-close-btn" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {!isCollapsed && (
        <form onSubmit={handleSubmit} className="connection-form">
          <div className="form-fields">
            {source.type === 'azure' ? (
              <>
                {/* Server Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Server</h3>
                  <div className="config-section-content">
                    <div className="radio-group">
                      <label className="radio-option">
                        <input
                          type="radio"
                          name="connectionMethod"
                          value="host"
                          checked={connectionMethod === 'host'}
                          onChange={(e) => {
                            setConnectionMethod('host')
                            handleInputChange('connectionMethod', 'host')
                          }}
                        />
                        <span>Connected by Host</span>
                      </label>
                      <label className="radio-option">
                        <input
                          type="radio"
                          name="connectionMethod"
                          value="url"
                          checked={connectionMethod === 'url'}
                          onChange={(e) => {
                            setConnectionMethod('url')
                            handleInputChange('connectionMethod', 'url')
                          }}
                        />
                        <span>Connected by URL</span>
                      </label>
                    </div>
                    
                    {connectionMethod === 'host' ? (
                      <>
                        <div className="form-field">
                          <label htmlFor="host">
                            Host/Server name
                            <span className="required">*</span>
                          </label>
                          <input
                            id="host"
                            type="text"
                            value={config.host || config.server || ''}
                            onChange={(e) => {
                              const value = e.target.value
                              handleInputChange('host', value)
                              handleInputChange('server', value)
                            }}
                            placeholder="Enter host/server name"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="database">
                            Database
                            <span className="required">*</span>
                          </label>
                          <input
                            id="database"
                            type="text"
                            value={config.database || ''}
                            onChange={(e) => handleInputChange('database', e.target.value)}
                            placeholder="Enter database name"
                            required
                            className="form-input"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="form-field">
                          <label htmlFor="serverUrl">
                            Server URL
                            <span className="required">*</span>
                          </label>
                          <input
                            id="serverUrl"
                            type="text"
                            value={config.serverUrl || config.server || ''}
                            onChange={(e) => {
                              const value = e.target.value
                              handleInputChange('serverUrl', value)
                              handleInputChange('server', value)
                            }}
                            placeholder="Enter server URL (e.g., server.database.windows.net)"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="database-url">
                            Database
                            <span className="required">*</span>
                          </label>
                          <input
                            id="database-url"
                            type="text"
                            value={config.database || ''}
                            onChange={(e) => handleInputChange('database', e.target.value)}
                            placeholder="Enter database name"
                            required
                            className="form-input"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Authentication Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Authentication</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="authMethod">
                        Authentication Method
                        <span className="required">*</span>
                      </label>
                      <select
                        id="authMethod"
                        value={authMethod}
                        onChange={(e) => {
                          const value = e.target.value as 'sql' | 'windows'
                          setAuthMethod(value)
                          handleInputChange('authMethod', value)
                        }}
                        required
                        className="form-input"
                      >
                        <option value="sql">SQL Server Authentication</option>
                        <option value="windows">Windows Authentication</option>
                      </select>
                    </div>

                    {authMethod === 'sql' && (
                      <>
                        <div className="form-field">
                          <label htmlFor="username">
                            Username/Server admin
                            <span className="required">*</span>
                          </label>
                          <input
                            id="username"
                            type="text"
                            value={config.username || ''}
                            onChange={(e) => handleInputChange('username', e.target.value)}
                            placeholder="Enter username/server admin"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="password">
                            Password
                            <span className="required">*</span>
                          </label>
                          <div className="password-input-wrapper">
                            <input
                              id="password"
                              type={showPassword ? 'text' : 'password'}
                              value={config.password || ''}
                              onChange={(e) => handleInputChange('password', e.target.value)}
                              placeholder="Enter password"
                              required
                              className="form-input"
                            />
                            <button
                              type="button"
                              className="password-toggle"
                              onClick={() => setShowPassword(!showPassword)}
                            >
                              {showPassword ? '👁️' : '👁️‍🗨️'}
                            </button>
                          </div>
                          <label className="checkbox-option" style={{ marginTop: '8px' }}>
                            <input
                              type="checkbox"
                              checked={savePassword}
                              onChange={(e) => {
                                setSavePassword(e.target.checked)
                                handleInputChange('savePassword', e.target.checked)
                              }}
                            />
                            <span>Save password</span>
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Schemas Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Schemas (Optional)</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="schemas">
                        Schemas
                      </label>
                      <textarea
                        id="schemas"
                        value={config.schemas || ''}
                        onChange={(e) => handleInputChange('schemas', e.target.value)}
                        placeholder="Enter schema names separated by commas (e.g., dbo, SalesLT, Production)
Leave empty to query any schema in the database"
                        rows={4}
                        className="form-input"
                      />
                      <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '4px' }}>
                        Optional: Specify schema names to help the AI understand your database structure. 
                        You can still query any schema even if not listed here.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Connection Details Button */}
                <div className="form-field">
                  <button
                    type="button"
                    className="btn-connection-details"
                    onClick={() => setShowConnectionDetails(!showConnectionDetails)}
                  >
                    {showConnectionDetails ? '▼' : '▶'} Connection details
                  </button>
                  {showConnectionDetails && (
                    <div className="connection-details-box">
                      <div className="connection-detail-item">
                        <strong>Connection Method:</strong> {connectionMethod === 'host' ? 'Host' : 'URL'}
                      </div>
                      {connectionMethod === 'host' && (
                        <>
                          <div className="connection-detail-item">
                            <strong>Host/Server:</strong> {config.host || config.server || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Database/Schema:</strong> {config.database || 'Not set'}
                          </div>
                        </>
                      )}
                      {connectionMethod === 'url' && (
                        <div className="connection-detail-item">
                          <strong>Server URL:</strong> {config.serverUrl || config.server || 'Not set'}
                        </div>
                      )}
                      {connectionMethod === 'url' && (
                        <div className="connection-detail-item">
                          <strong>Database/Schema:</strong> {config.database || 'Not set'}
                        </div>
                      )}
                      <div className="connection-detail-item">
                        <strong>Authentication Method:</strong> {authMethod === 'sql' ? 'SQL Server Authentication' : 'Windows Authentication'}
                      </div>
                      {config.schemas && (
                        <div className="connection-detail-item">
                          <strong>Schemas:</strong> {config.schemas || 'Not set'}
                        </div>
                      )}
                      {authMethod === 'sql' && (
                        <>
                          <div className="connection-detail-item">
                            <strong>Username:</strong> {config.username || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Password:</strong> {config.password ? '••••••••' : 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Save Password:</strong> {savePassword ? 'Yes' : 'No'}
                          </div>
                        </>
                      )}
                      <div className="connection-detail-item">
                        <strong>Driver:</strong> Microsoft SQL Server Driver 12.2.0 for SQL Server
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : source.type === 'postgres' ? (
              <>
                {/* Server Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Server</h3>
                  <div className="config-section-content">
                    <div className="radio-group">
                      <label className="radio-option">
                        <input
                          type="radio"
                          name="postgresConnectionMethod"
                          value="host"
                          checked={postgresConnectionMethod === 'host'}
                          onChange={(e) => {
                            setPostgresConnectionMethod('host')
                            handleInputChange('connectionMethod', 'host')
                          }}
                        />
                        <span>Connected by Host</span>
                      </label>
                      <label className="radio-option">
                        <input
                          type="radio"
                          name="postgresConnectionMethod"
                          value="url"
                          checked={postgresConnectionMethod === 'url'}
                          onChange={(e) => {
                            setPostgresConnectionMethod('url')
                            handleInputChange('connectionMethod', 'url')
                          }}
                        />
                        <span>Connected by URL</span>
                      </label>
                    </div>
                    
                    {postgresConnectionMethod === 'host' ? (
                      <>
                        <div className="form-field">
                          <label htmlFor="postgres-host">
                            Server Host
                            <span className="required">*</span>
                          </label>
                          <input
                            id="postgres-host"
                            type="text"
                            value={config.host || config.server || ''}
                            onChange={(e) => {
                              const value = e.target.value
                              handleInputChange('host', value)
                              handleInputChange('server', value)
                            }}
                            placeholder="Enter server host"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="postgres-port">
                            Port
                            <span className="required">*</span>
                          </label>
                          <input
                            id="postgres-port"
                            type="number"
                            value={config.port || ''}
                            onChange={(e) => handleInputChange('port', e.target.value ? parseInt(e.target.value, 10) : '')}
                            placeholder="Enter port (default: 5432)"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="postgres-database">
                            Database
                            <span className="required">*</span>
                          </label>
                          <input
                            id="postgres-database"
                            type="text"
                            value={config.database || ''}
                            onChange={(e) => handleInputChange('database', e.target.value)}
                            placeholder="Enter database name"
                            required
                            className="form-input"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="form-field">
                          <label htmlFor="postgres-serverUrl">
                            Server URL
                            <span className="required">*</span>
                          </label>
                          <input
                            id="postgres-serverUrl"
                            type="text"
                            value={config.serverUrl || config.server || ''}
                            onChange={(e) => {
                              const value = e.target.value
                              handleInputChange('serverUrl', value)
                              handleInputChange('server', value)
                            }}
                            placeholder="Enter server URL"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="postgres-database-url">
                            Database
                            <span className="required">*</span>
                          </label>
                          <input
                            id="postgres-database-url"
                            type="text"
                            value={config.database || ''}
                            onChange={(e) => handleInputChange('database', e.target.value)}
                            placeholder="Enter database name"
                            required
                            className="form-input"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Authentication Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Authentication</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="postgres-authMethod">
                        Authentication Method
                        <span className="required">*</span>
                      </label>
                      <select
                        id="postgres-authMethod"
                        value={postgresAuthMethod}
                        onChange={(e) => {
                          const value = e.target.value as 'native' | 'pgpass'
                          setPostgresAuthMethod(value)
                          handleInputChange('authMethod', value)
                        }}
                        required
                        className="form-input"
                      >
                        <option value="native">Database Native</option>
                        <option value="pgpass">PostgreSQL PgPass</option>
                      </select>
                    </div>

                    {postgresAuthMethod === 'native' && (
                      <>
                        <div className="form-field">
                          <label htmlFor="postgres-username">
                            Username
                            <span className="required">*</span>
                          </label>
                          <input
                            id="postgres-username"
                            type="text"
                            value={config.username || ''}
                            onChange={(e) => handleInputChange('username', e.target.value)}
                            placeholder="Enter username"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="postgres-password">
                            Password
                            <span className="required">*</span>
                          </label>
                          <div className="password-input-wrapper">
                            <input
                              id="postgres-password"
                              type={showPassword ? 'text' : 'password'}
                              value={config.password || ''}
                              onChange={(e) => handleInputChange('password', e.target.value)}
                              placeholder="Enter password"
                              required
                              className="form-input"
                            />
                            <button
                              type="button"
                              className="password-toggle"
                              onClick={() => setShowPassword(!showPassword)}
                            >
                              {showPassword ? '👁️' : '👁️‍🗨️'}
                            </button>
                          </div>
                          <label className="checkbox-option" style={{ marginTop: '8px' }}>
                            <input
                              type="checkbox"
                              checked={savePassword}
                              onChange={(e) => {
                                setSavePassword(e.target.checked)
                                handleInputChange('savePassword', e.target.checked)
                              }}
                            />
                            <span>Save password</span>
                          </label>
                        </div>
                      </>
                    )}

                    {postgresAuthMethod === 'pgpass' && (
                      <>
                        <div className="form-field">
                          <label htmlFor="postgres-username-pgpass">
                            Username
                            <span className="required">*</span>
                          </label>
                          <input
                            id="postgres-username-pgpass"
                            type="text"
                            value={config.username || ''}
                            onChange={(e) => handleInputChange('username', e.target.value)}
                            placeholder="Enter username"
                            required
                            className="form-input"
                          />
                        </div>
                        <label className="checkbox-option" style={{ marginTop: '8px' }}>
                          <input
                            type="checkbox"
                            checked={overrideHost}
                            onChange={(e) => {
                              setOverrideHost(e.target.checked)
                              handleInputChange('overrideHost', e.target.checked)
                            }}
                          />
                          <span>Override Host</span>
                        </label>
                      </>
                    )}
                  </div>
                </div>

                {/* Connection Details Button */}
                <div className="form-field">
                  <button
                    type="button"
                    className="btn-connection-details"
                    onClick={() => setShowConnectionDetails(!showConnectionDetails)}
                  >
                    {showConnectionDetails ? '▼' : '▶'} Connection details
                  </button>
                  {showConnectionDetails && (
                    <div className="connection-details-box">
                      <div className="connection-detail-item">
                        <strong>Connection Method:</strong> {postgresConnectionMethod === 'host' ? 'Host' : 'URL'}
                      </div>
                      {postgresConnectionMethod === 'host' && (
                        <>
                          <div className="connection-detail-item">
                            <strong>Server Host:</strong> {config.host || config.server || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Port:</strong> {config.port || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Database:</strong> {config.database || 'Not set'}
                          </div>
                        </>
                      )}
                      {postgresConnectionMethod === 'url' && (
                        <>
                          <div className="connection-detail-item">
                            <strong>Server URL:</strong> {config.serverUrl || config.server || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Database:</strong> {config.database || 'Not set'}
                          </div>
                        </>
                      )}
                      <div className="connection-detail-item">
                        <strong>Authentication Method:</strong> {postgresAuthMethod === 'native' ? 'Database Native' : 'PostgreSQL PgPass'}
                      </div>
                      {postgresAuthMethod === 'native' && (
                        <>
                          <div className="connection-detail-item">
                            <strong>Username:</strong> {config.username || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Password:</strong> {config.password ? '••••••••' : 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Save Password:</strong> {savePassword ? 'Yes' : 'No'}
                          </div>
                        </>
                      )}
                      {postgresAuthMethod === 'pgpass' && (
                        <>
                          <div className="connection-detail-item">
                            <strong>Username:</strong> {config.username || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Override Host:</strong> {overrideHost ? 'Yes' : 'No'}
                          </div>
                        </>
                      )}
                      <div className="connection-detail-item">
                        <strong>Server:</strong> PostgreSQL 18.1
                      </div>
                      <div className="connection-detail-item">
                        <strong>Driver:</strong> PostgreSQL JDBC Driver 42.7.2
                      </div>                      
                    </div>
                  )}
                </div>
              </>
            ) : source.type === 'bigquery' ? (
              <>
                {/* Connection Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Connection</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="projectId">
                        Project ID
                        <span className="required">*</span>
                      </label>
                      <input
                        id="projectId"
                        type="text"
                        value={config.projectId || ''}
                        onChange={(e) => handleInputChange('projectId', e.target.value)}
                        placeholder="Enter Google Cloud Project ID"
                        required
                        className="form-input"
                      />
                    </div>
                  </div>
                </div>

                {/* Server Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Server</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="host">
                        Host
                        <span className="required">*</span>
                      </label>
                      <input
                        id="host"
                        type="text"
                        value={config.host || 'https://www.googleapis.com/bigquery/v2'}
                        onChange={(e) => handleInputChange('host', e.target.value)}
                        placeholder="https://www.googleapis.com/bigquery/v2"
                        required
                        className="form-input"
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="port">
                        Port
                        <span className="required">*</span>
                      </label>
                      <input
                        id="port"
                        type="number"
                        value={config.port || 443}
                        onChange={(e) => handleInputChange('port', parseInt(e.target.value) || 443)}
                        placeholder="443"
                        required
                        className="form-input"
                      />
                    </div>
                  </div>
                </div>

                {/* Authentication Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Authentication (Google Cloud Authentication)</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="bigqueryAuthMethod">
                        Authentication Method
                        <span className="required">*</span>
                      </label>
                      <select
                        id="bigqueryAuthMethod"
                        value={bigqueryAuthMethod}
                        onChange={(e) => {
                          const value = e.target.value as 'service-account-key' | 'user'
                          setBigqueryAuthMethod(value)
                          handleInputChange('authMethod', value)
                          if (value === 'user') {
                            // Clear service account key when switching to user auth
                            handleInputChange('serviceAccountKey', '')
                          }
                        }}
                        required
                        className="form-input"
                      >
                        <option value="service-account-key">Service-Account-Key</option>
                        <option value="user">User</option>
                      </select>
                    </div>

                    {bigqueryAuthMethod === 'service-account-key' && (
                      <div className="form-field">
                        <label htmlFor="serviceAccountKey">
                          Key Path
                          <span className="required">*</span>
                        </label>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', position: 'relative' }}>
                          <input
                            id="serviceAccountKey"
                            type="text"
                            value={config.serviceAccountKey || ''}
                            onChange={(e) => handleInputChange('serviceAccountKey', e.target.value)}
                            placeholder="Enter service account key JSON or upload file"
                            required
                            className="form-input"
                            style={{ flex: 1 }}
                          />
                          {/* Visually hidden but not display:none — browsers block programmatic .click() on display:none file inputs */}
                          <input
                            type="file"
                            id={bigqueryServiceAccountFileInputId}
                            accept=".json,.JSON,application/json"
                            className="connection-config-file-input-hidden"
                            aria-label="Upload service account JSON file"
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) {
                                const reader = new FileReader()
                                reader.onload = (event) => {
                                  const content = event.target?.result as string
                                  try {
                                    JSON.parse(content)
                                    handleInputChange('serviceAccountKey', content)
                                  } catch {
                                    alert('Invalid JSON file. Please select a valid service account key JSON file.')
                                  }
                                }
                                reader.readAsText(file)
                              }
                              e.target.value = ''
                            }}
                          />
                          <label
                            htmlFor={bigqueryServiceAccountFileInputId}
                            className="btn-file-upload"
                            style={{
                              padding: '8px 12px',
                              backgroundColor: '#f0f0f0',
                              border: '1px solid #ccc',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              margin: 0,
                              flexShrink: 0
                            }}
                          >
                            <span>📁</span>
                            <span>Upload</span>
                          </label>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '4px' }}>
                          Upload a JSON service account key file from Google Cloud Console
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Connection Details Button */}
                <div className="form-field">
                  <button
                    type="button"
                    className="btn-connection-details"
                    onClick={() => setShowConnectionDetails(!showConnectionDetails)}
                  >
                    {showConnectionDetails ? '▼' : '▶'} Connection details
                  </button>
                  {showConnectionDetails && (
                    <div className="connection-details-box">
                      <div className="connection-detail-item">
                        <strong>Project ID:</strong> {config.projectId || 'Not set'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Host:</strong> {config.host || 'https://www.googleapis.com/bigquery/v2'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Port:</strong> {config.port || 443}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Authentication Method:</strong> {bigqueryAuthMethod === 'service-account-key' ? 'Service-Account-Key' : 'User'}
                      </div>
                      {bigqueryAuthMethod === 'service-account-key' && (
                        <div className="connection-detail-item">
                          <strong>Service Account Key:</strong> {config.serviceAccountKey ? '✓ Configured' : 'Not set'}
                        </div>
                      )}
                      <div className="connection-detail-item">
                        <strong>Driver:</strong> Google BigQuery Client Library 7.9.3 for BigQuery
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : source.type === 'redshift' ? (
              <>
                {/* Server Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Server</h3>
                  <div className="config-section-content">
                    <div className="radio-group">
                      <label className="radio-option">
                        <input
                          type="radio"
                          name="redshiftConnectionMethod"
                          value="host"
                          checked={connectionMethod === 'host'}
                          onChange={(e) => {
                            setConnectionMethod('host')
                            handleInputChange('connectionMethod', 'host')
                          }}
                        />
                        <span>Connected by Host</span>
                      </label>
                      <label className="radio-option">
                        <input
                          type="radio"
                          name="redshiftConnectionMethod"
                          value="url"
                          checked={connectionMethod === 'url'}
                          onChange={(e) => {
                            setConnectionMethod('url')
                            handleInputChange('connectionMethod', 'url')
                          }}
                        />
                        <span>Connected by URL</span>
                      </label>
                    </div>
                    
                    {connectionMethod === 'host' ? (
                      <>
                        <div className="form-field">
                          <label htmlFor="redshift-host">
                            Host/Instance
                            <span className="required">*</span>
                          </label>
                          <input
                            id="redshift-host"
                            type="text"
                            value={config.host || config.server || ''}
                            onChange={(e) => {
                              const value = e.target.value
                              handleInputChange('host', value)
                              handleInputChange('server', value)
                            }}
                            placeholder="Enter host/instance name"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="redshift-port">
                            Port
                            <span className="required">*</span>
                          </label>
                          <input
                            id="redshift-port"
                            type="number"
                            value={config.port || ''}
                            onChange={(e) => handleInputChange('port', e.target.value ? parseInt(e.target.value, 10) : '')}
                            placeholder="Enter port (default: 5439)"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="redshift-database">
                            Database
                            <span className="required">*</span>
                          </label>
                          <input
                            id="redshift-database"
                            type="text"
                            value={config.database || ''}
                            onChange={(e) => handleInputChange('database', e.target.value)}
                            placeholder="Enter database name"
                            required
                            className="form-input"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="form-field">
                          <label htmlFor="redshift-serverUrl">
                            Server URL
                            <span className="required">*</span>
                          </label>
                          <input
                            id="redshift-serverUrl"
                            type="text"
                            value={config.serverUrl || config.host || config.server || ''}
                            onChange={(e) => {
                              const value = e.target.value
                              handleInputChange('serverUrl', value)
                              handleInputChange('host', value)
                              handleInputChange('server', value)
                            }}
                            placeholder="Enter server URL"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="redshift-database-url">
                            Database
                            <span className="required">*</span>
                          </label>
                          <input
                            id="redshift-database-url"
                            type="text"
                            value={config.database || ''}
                            onChange={(e) => handleInputChange('database', e.target.value)}
                            placeholder="Enter database name"
                            required
                            className="form-input"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Authentication Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Authentication</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="redshift-authMethod">
                        Authentication Method
                        <span className="required">*</span>
                      </label>
                      <select
                        id="redshift-authMethod"
                        value={redshiftAuthMethod}
                        onChange={(e) => {
                          const value = e.target.value as 'native' | 'pgpass'
                          setRedshiftAuthMethod(value)
                          handleInputChange('authMethod', value)
                        }}
                        required
                        className="form-input"
                      >
                        <option value="native">Database Native</option>
                        <option value="pgpass">PostgreSQL pgPass</option>
                      </select>
                    </div>

                    {redshiftAuthMethod === 'native' && (
                      <>
                        <div className="form-field">
                          <label htmlFor="redshift-username">
                            Username
                            <span className="required">*</span>
                          </label>
                          <input
                            id="redshift-username"
                            type="text"
                            value={config.username || ''}
                            onChange={(e) => handleInputChange('username', e.target.value)}
                            placeholder="Enter username"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="redshift-password">
                            Password
                            <span className="required">*</span>
                          </label>
                          <div className="password-input-wrapper">
                            <input
                              id="redshift-password"
                              type={showPassword ? 'text' : 'password'}
                              value={config.password || ''}
                              onChange={(e) => handleInputChange('password', e.target.value)}
                              placeholder="Enter password"
                              required
                              className="form-input"
                            />
                            <button
                              type="button"
                              className="password-toggle"
                              onClick={() => setShowPassword(!showPassword)}
                            >
                              {showPassword ? '👁️' : '👁️‍🗨️'}
                            </button>
                          </div>
                          <label className="checkbox-option" style={{ marginTop: '8px' }}>
                            <input
                              type="checkbox"
                              checked={savePassword}
                              onChange={(e) => {
                                setSavePassword(e.target.checked)
                                handleInputChange('savePassword', e.target.checked)
                              }}
                            />
                            <span>Save password</span>
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* SSL Configuration Section */}
                <div className="config-section">
                  <h3 className="config-section-title">SSL Configuration (Optional)</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="redshift-sslMode">
                        SSL Mode
                      </label>
                      <select
                        id="redshift-sslMode"
                        value={redshiftSslMode}
                        onChange={(e) => {
                          const value = e.target.value as 'disable' | 'require' | 'verify-ca' | 'verify-full'
                          setRedshiftSslMode(value)
                          handleInputChange('sslMode', value)
                        }}
                        className="form-input"
                      >
                        <option value="require">Require SSL (Default)</option>
                        <option value="disable">Disable SSL</option>
                        <option value="verify-ca">Verify CA</option>
                        <option value="verify-full">Verify Full</option>
                      </select>
                      <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '4px' }}>
                        Choose SSL mode for secure connection. Use Disable SSL if you encounter SSL errors.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Schemas Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Schemas (Optional)</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="redshift-schemas">
                        Schemas
                      </label>
                      <textarea
                        id="redshift-schemas"
                        value={config.schemas || ''}
                        onChange={(e) => handleInputChange('schemas', e.target.value)}
                        placeholder="Enter schema names separated by commas (e.g., public, schema1, schema2)
Leave empty to query any schema in the database"
                        rows={4}
                        className="form-input"
                      />
                      <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '4px' }}>
                        Optional: Specify schema names to help the AI understand your database structure. 
                        You can still query any schema even if not listed here.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Connection Details Button */}
                <div className="form-field">
                  <button
                    type="button"
                    className="btn-connection-details"
                    onClick={() => setShowConnectionDetails(!showConnectionDetails)}
                  >
                    {showConnectionDetails ? '▼' : '▶'} Connection details
                  </button>
                  {showConnectionDetails && (
                    <div className="connection-details-box">
                      <div className="connection-detail-item">
                        <strong>Connection Method:</strong> {connectionMethod === 'host' ? 'Host' : 'URL'}
                      </div>
                      {connectionMethod === 'host' && (
                        <>
                          <div className="connection-detail-item">
                            <strong>Host/Instance:</strong> {config.host || config.server || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Port:</strong> {config.port || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Database:</strong> {config.database || 'Not set'}
                          </div>
                        </>
                      )}
                      {connectionMethod === 'url' && (
                        <>
                          <div className="connection-detail-item">
                            <strong>Server URL:</strong> {config.serverUrl || config.host || config.server || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Database:</strong> {config.database || 'Not set'}
                          </div>
                        </>
                      )}
                      <div className="connection-detail-item">
                        <strong>Authentication Method:</strong> {redshiftAuthMethod === 'native' ? 'Database Native' : 'PostgreSQL pgPass'}
                      </div>
                      {redshiftAuthMethod === 'native' && (
                        <>
                          <div className="connection-detail-item">
                            <strong>Username:</strong> {config.username || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Password:</strong> {config.password ? '••••••••' : 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Save Password:</strong> {savePassword ? 'Yes' : 'No'}
                          </div>
                        </>
                      )}
                      {config.schemas && (
                        <div className="connection-detail-item">
                          <strong>Schemas:</strong> {config.schemas || 'Not set'}
                        </div>
                      )}
                      <div className="connection-detail-item">
                        <strong>Server:</strong> Redshift 8.0.2
                      </div>
                      <div className="connection-detail-item">
                        <strong>Driver:</strong> Redshift JDBC Driver 2.2.0
                      </div>                      
                    </div>
                  )}
                </div>
              </>
            ) : source.type === 'snowflake' ? (
              <>
                {/* Connection Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Connection</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="snowflake-host">
                        Host
                        <span className="required">*</span>
                      </label>
                      <input
                        id="snowflake-host"
                        type="text"
                        value={config.host || ''}
                        onChange={(e) => handleInputChange('host', e.target.value)}
                        placeholder="Enter host name"
                        required
                        className="form-input"
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="snowflake-port">
                        Port
                      </label>
                      <input
                        id="snowflake-port"
                        type="number"
                        value={config.port || ''}
                        onChange={(e) => handleInputChange('port', e.target.value ? parseInt(e.target.value, 10) : '')}
                        placeholder="Enter port (default: 443)"
                        className="form-input"
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="snowflake-database">
                        Database
                        <span className="required">*</span>
                      </label>
                      <input
                        id="snowflake-database"
                        type="text"
                        list="snowflake-database-list"
                        value={config.database || ''}
                        onChange={(e) => handleInputChange('database', e.target.value)}
                        placeholder="Enter database name"
                        required
                        className="form-input"
                      />
                      <datalist id="snowflake-database-list">
                        {snowflakeDatabases.map((db) => (
                          <option key={db} value={db} />
                        ))}
                      </datalist>
                    </div>
                    <div className="form-field">
                      <label htmlFor="snowflake-warehouse">
                        Warehouse
                        <span className="required">*</span>
                      </label>
                      <input
                        id="snowflake-warehouse"
                        type="text"
                        list="snowflake-warehouse-list"
                        value={config.warehouse || ''}
                        onChange={(e) => handleInputChange('warehouse', e.target.value)}
                        placeholder="Enter warehouse name"
                        required
                        className="form-input"
                      />
                      <datalist id="snowflake-warehouse-list">
                        {snowflakeWarehouses.map((wh) => (
                          <option key={wh} value={wh} />
                        ))}
                      </datalist>
                    </div>
                    <div className="form-field">
                      <label htmlFor="snowflake-schema">
                        Schemas (Optional)
                      </label>
                      <input
                        id="snowflake-schema"
                        type="text"
                        list="snowflake-schema-list"
                        value={config.schema || ''}
                        onChange={(e) => handleInputChange('schema', e.target.value)}
                        placeholder="Enter schema name (optional - leave empty to select in RAG card)"
                        className="form-input"
                      />
                      <datalist id="snowflake-schema-list">
                        {snowflakeSchemas.map((sch) => (
                          <option key={sch} value={sch} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                </div>

                {/* Authentication Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Authentication (Database Native)</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="snowflake-username">
                        Username
                        <span className="required">*</span>
                      </label>
                      <input
                        id="snowflake-username"
                        type="text"
                        value={config.username || ''}
                        onChange={(e) => handleInputChange('username', e.target.value)}
                        placeholder="Enter username"
                        required
                        className="form-input"
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="snowflake-password">
                        Password
                        <span className="required">*</span>
                      </label>
                      <div className="password-input-wrapper">
                        <input
                          id="snowflake-password"
                          type={showPassword ? 'text' : 'password'}
                          value={config.password || ''}
                          onChange={(e) => handleInputChange('password', e.target.value)}
                          placeholder="Enter password"
                          required
                          className="form-input"
                        />
                        <button
                          type="button"
                          className="password-toggle"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? '👁️' : '👁️‍🗨️'}
                        </button>
                      </div>
                      <label className="checkbox-option" style={{ marginTop: '8px' }}>
                        <input
                          type="checkbox"
                          checked={savePassword}
                          onChange={(e) => {
                            setSavePassword(e.target.checked)
                            handleInputChange('savePassword', e.target.checked)
                          }}
                        />
                        <span>Save password</span>
                      </label>
                    </div>
                    <div className="form-field">
                      <label htmlFor="snowflake-role">
                        Role
                      </label>
                      <input
                        id="snowflake-role"
                        type="text"
                        list="snowflake-role-list"
                        value={config.role || ''}
                        onChange={(e) => handleInputChange('role', e.target.value)}
                        placeholder="Enter role name (optional)"
                        className="form-input"
                      />
                      <datalist id="snowflake-role-list">
                        {snowflakeRoles.map((role) => (
                          <option key={role} value={role} />
                        ))}
                      </datalist>
                    </div>
                    <div className="form-field">
                      <label htmlFor="snowflake-authMethod">
                        Authentication
                        <span className="required">*</span>
                      </label>
                      <select
                        id="snowflake-authMethod"
                        value={snowflakeAuthMethod}
                        onChange={(e) => {
                          const value = e.target.value as 'snowflake' | 'externalbrowser'
                          setSnowflakeAuthMethod(value)
                          handleInputChange('authMethod', value)
                        }}
                        required
                        className="form-input"
                      >
                        <option value="snowflake">Snowflake</option>
                        <option value="externalbrowser">External Browser</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Connection Details Button */}
                <div className="form-field">
                  <button
                    type="button"
                    className="btn-connection-details"
                    onClick={() => setShowConnectionDetails(!showConnectionDetails)}
                  >
                    {showConnectionDetails ? '▼' : '▶'} Connection details
                  </button>
                  {showConnectionDetails && (
                    <div className="connection-details-box">
                      <div className="connection-detail-item">
                        <strong>Host:</strong> {config.host || 'Not set'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Port:</strong> {config.port || 'Not set'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Database:</strong> {config.database || 'Not set'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Warehouse:</strong> {config.warehouse || 'Not set'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Schema:</strong> {config.schema || 'Not set'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Authentication Method:</strong> {snowflakeAuthMethod === 'snowflake' ? 'Snowflake' : 'External Browser'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Username:</strong> {config.username || 'Not set'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Password:</strong> {config.password ? '••••••••' : 'Not set'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Save Password:</strong> {savePassword ? 'Yes' : 'No'}
                      </div>
                      {config.role && (
                        <div className="connection-detail-item">
                          <strong>Role:</strong> {config.role || 'Not set'}
                        </div>
                      )}
                      <div className="connection-detail-item">
                        <strong>Server:</strong> Snowflake 9.40.7
                      </div>
                      <div className="connection-detail-item">
                        <strong>Driver:</strong> Snowflake 3.27.0
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : source.type === 'mysql' ? (
              <>
                {/* Server Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Server</h3>
                  <div className="config-section-content">
                    <div className="radio-group">
                      <label className="radio-option">
                        <input
                          type="radio"
                          name="mysqlConnectionMethod"
                          value="host"
                          checked={connectionMethod === 'host'}
                          onChange={(e) => {
                            setConnectionMethod('host')
                            handleInputChange('connectionMethod', 'host')
                          }}
                        />
                        <span>Connected by Host</span>
                      </label>
                      <label className="radio-option">
                        <input
                          type="radio"
                          name="mysqlConnectionMethod"
                          value="url"
                          checked={connectionMethod === 'url'}
                          onChange={(e) => {
                            setConnectionMethod('url')
                            handleInputChange('connectionMethod', 'url')
                          }}
                        />
                        <span>Connected by URL</span>
                      </label>
                    </div>
                    
                    {connectionMethod === 'host' ? (
                      <>
                        <div className="form-field">
                          <label htmlFor="mysql-server-host">
                            Server Host
                            <span className="required">*</span>
                          </label>
                          <input
                            id="mysql-server-host"
                            type="text"
                            value={config.host || config.server || ''}
                            onChange={(e) => {
                              const value = e.target.value
                              handleInputChange('host', value)
                              handleInputChange('server', value)
                            }}
                            placeholder="Enter server host"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="mysql-port">
                            Port
                          </label>
                          <input
                            id="mysql-port"
                            type="number"
                            value={config.port || ''}
                            onChange={(e) => handleInputChange('port', e.target.value ? parseInt(e.target.value, 10) : '')}
                            placeholder="Enter port (default: 3306)"
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="mysql-database">
                            Database
                            <span className="required">*</span>
                          </label>
                          <input
                            id="mysql-database"
                            type="text"
                            value={config.database || ''}
                            onChange={(e) => handleInputChange('database', e.target.value)}
                            placeholder="Enter database name"
                            required
                            className="form-input"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="form-field">
                          <label htmlFor="mysql-server-url">
                            Server URL
                            <span className="required">*</span>
                          </label>
                          <input
                            id="mysql-server-url"
                            type="text"
                            value={config.serverUrl || config.host || config.server || ''}
                            onChange={(e) => {
                              const value = e.target.value
                              handleInputChange('serverUrl', value)
                              handleInputChange('host', value)
                              handleInputChange('server', value)
                            }}
                            placeholder="Enter server URL"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="mysql-database-url">
                            Database
                            <span className="required">*</span>
                          </label>
                          <input
                            id="mysql-database-url"
                            type="text"
                            value={config.database || ''}
                            onChange={(e) => handleInputChange('database', e.target.value)}
                            placeholder="Enter database name"
                            required
                            className="form-input"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Authentication Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Authentication (Database Native)</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="mysql-username">
                        Username
                        <span className="required">*</span>
                      </label>
                      <input
                        id="mysql-username"
                        type="text"
                        value={config.username || ''}
                        onChange={(e) => handleInputChange('username', e.target.value)}
                        placeholder="Enter username"
                        required
                        className="form-input"
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="mysql-password">
                        Password
                        <span className="required">*</span>
                      </label>
                      <div className="password-input-wrapper">
                        <input
                          id="mysql-password"
                          type={showPassword ? 'text' : 'password'}
                          value={config.password || ''}
                          onChange={(e) => handleInputChange('password', e.target.value)}
                          placeholder="Enter password"
                          required
                          className="form-input"
                        />
                        <button
                          type="button"
                          className="password-toggle"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? '👁️' : '👁️‍🗨️'}
                        </button>
                      </div>
                      <label className="checkbox-option" style={{ marginTop: '8px' }}>
                        <input
                          type="checkbox"
                          checked={savePassword}
                          onChange={(e) => {
                            setSavePassword(e.target.checked)
                            handleInputChange('savePassword', e.target.checked)
                          }}
                        />
                        <span>Save password</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Datasets (Optional) Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Datasets (Optional)</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="mysql-datasets">
                        Datasets
                      </label>
                      <textarea
                        id="mysql-datasets"
                        value={config.datasets || ''}
                        onChange={(e) => handleInputChange('datasets', e.target.value)}
                        placeholder="Enter dataset names separated by commas (e.g., dataset1, dataset2)"
                        rows={3}
                        className="form-input"
                      />
                      <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '4px' }}>
                        Optional: Specify dataset names to help the AI understand your database structure. 
                        You can still query any dataset even if not listed here.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Connection Details Button */}
                <div className="form-field">
                  <button
                    type="button"
                    className="btn-connection-details"
                    onClick={() => setShowConnectionDetails(!showConnectionDetails)}
                  >
                    {showConnectionDetails ? '▼' : '▶'} Connection details
                  </button>
                  {showConnectionDetails && (
                    <div className="connection-details-box">
                      <div className="connection-detail-item">
                        <strong>Connection Method:</strong> {connectionMethod === 'host' ? 'Connected by Host' : 'Connected by URL'}
                      </div>
                      {connectionMethod === 'host' ? (
                        <>
                          <div className="connection-detail-item">
                            <strong>Server Host:</strong> {config.host || config.server || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Port:</strong> {config.port || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Database:</strong> {config.database || 'Not set'}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="connection-detail-item">
                            <strong>Server URL:</strong> {config.serverUrl || config.host || config.server || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Database:</strong> {config.database || 'Not set'}
                          </div>
                        </>
                      )}
                      <div className="connection-detail-item">
                        <strong>Username:</strong> {config.username || 'Not set'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Password:</strong> {config.password ? '••••••••' : 'Not set'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Save Password:</strong> {savePassword ? 'Yes' : 'No'}
                      </div>
                      {config.datasets && (
                        <div className="connection-detail-item">
                          <strong>Datasets:</strong> {config.datasets || 'Not set'}
                        </div>
                      )}
                      <div className="connection-detail-item">
                        <strong>Server:</strong> MySQL 8.0.44
                      </div>
                      <div className="connection-detail-item">
                        <strong>Driver:</strong> MySQL Connector/J mysql-connector-j-8.2.0
                      </div>                      
                    </div>
                  )}
                </div>
              </>
            ) : source.type === 'airtable' ? (
              <>
                {/* Authentication Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Authentication</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="airtable-apiKey">
                        Airtable Token
                        <span className="required">*</span>
                      </label>
                      <div className="password-input-wrapper">
                        <input
                          id="airtable-apiKey"
                          type={showPassword ? 'text' : 'password'}
                          value={config.apiKey || ''}
                          onChange={(e) => handleInputChange('apiKey', e.target.value)}
                          placeholder="Enter Airtable Token"
                          required
                          className="form-input"
                        />
                        <button
                          type="button"
                          className="password-toggle"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? '👁️' : '👁️‍🗨️'}
                        </button>
                      </div>
                      <label className="checkbox-option" style={{ marginTop: '8px' }}>
                        <input
                          type="checkbox"
                          checked={saveApiKey}
                          onChange={(e) => {
                            setSaveApiKey(e.target.checked)
                            handleInputChange('saveApiKey', e.target.checked)
                          }}
                        />
                        <span>Save</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Database Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Database</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="airtable-baseId">
                        Base ID
                        <span className="required">*</span>
                      </label>
                      <input
                        id="airtable-baseId"
                        type="text"
                        value={config.baseId || ''}
                        onChange={(e) => handleInputChange('baseId', e.target.value)}
                        placeholder="Enter Base ID"
                        required
                        className="form-input"
                      />
                      <label className="checkbox-option" style={{ marginTop: '8px' }}>
                        <input
                          type="checkbox"
                          checked={saveBaseId}
                          onChange={(e) => {
                            setSaveBaseId(e.target.checked)
                            handleInputChange('saveBaseId', e.target.checked)
                          }}
                        />
                        <span>Save</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Table Names Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Table Names (Optional)</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="airtable-tables">
                        Table Names
                      </label>
                      <textarea
                        id="airtable-tables"
                        value={config.tables || ''}
                        onChange={(e) => handleInputChange('tables', e.target.value)}
                        placeholder="Enter table names separated by commas (e.g., Table1, Table2, Table3)
Leave empty to query any table in the base"
                        rows={4}
                        className="form-input"
                      />
                      <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '4px' }}>
                        Optional: Specify table names to help the AI understand your base structure. 
                        You can still query any table even if not listed here.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Connection Details Button */}
                <div className="form-field">
                  <button
                    type="button"
                    className="btn-connection-details"
                    onClick={() => setShowConnectionDetails(!showConnectionDetails)}
                  >
                    {showConnectionDetails ? '▼' : '▶'} Connection details
                  </button>
                  {showConnectionDetails && (
                    <div className="connection-details-box">
                      <div className="connection-detail-item">
                        <strong>API Key:</strong> {config.apiKey ? '✓ Configured' : 'Not set'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Save API Key:</strong> {saveApiKey ? 'Yes' : 'No'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Base ID:</strong> {config.baseId || 'Not set'}
                      </div>
                      <div className="connection-detail-item">
                        <strong>Save Base ID:</strong> {saveBaseId ? 'Yes' : 'No'}
                      </div>
                      {config.tables && (
                        <div className="connection-detail-item">
                          <strong>Table Names:</strong> {config.tables || 'Not set'}
                        </div>
                      )}
                      <div className="connection-detail-item">
                        <strong>Server:</strong> https://api.airtable.com
                      </div>
                      <div className="connection-detail-item">
                        <strong>Driver:</strong> Airtable REST API Client (axios) 1.13.2 for Airtable
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : source.type === 'databricks' ? (
              <>
                {/* Server Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Server</h3>
                  <div className="config-section-content">
                    <div className="radio-group">
                      <label className="radio-option">
                        <input
                          type="radio"
                          name="databricksConnectionMethod"
                          value="host"
                          checked={databricksConnectionMethod === 'host'}
                          onChange={(e) => {
                            setDatabricksConnectionMethod('host')
                            handleInputChange('connectionMethod', 'host')
                          }}
                        />
                        <span>Client</span>
                      </label>
                      <label className="radio-option">
                        <input
                          type="radio"
                          name="databricksConnectionMethod"
                          value="url"
                          checked={databricksConnectionMethod === 'url'}
                          onChange={(e) => {
                            setDatabricksConnectionMethod('url')
                            handleInputChange('connectionMethod', 'url')
                          }}
                        />
                        <span>URL</span>
                      </label>
                    </div>

                    {databricksConnectionMethod === 'host' ? (
                      <>
                        <div className="form-field">
                          <label htmlFor="databricks-host">
                            Host
                            <span className="required">*</span>
                          </label>
                          <input
                            id="databricks-host"
                            type="text"
                            value={config.serverHostname || config.host || config.server || ''}
                            onChange={(e) => {
                              const value = e.target.value
                              handleInputChange('serverHostname', value)
                              handleInputChange('host', value)
                              handleInputChange('server', value)
                            }}
                            placeholder="https://dbc-a1b2345c-d6e7.cloud.databricks.com"
                            required
                            className="form-input"
                          />
                          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '4px' }}>
                            Enter your Databricks workspace URL (e.g., https://dbc-a1b2345c-d6e7.cloud.databricks.com)
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="form-field">
                          <label htmlFor="databricks-jdbc-url">
                            JDBC URL
                            <span className="required">*</span>
                          </label>
                          <input
                            id="databricks-jdbc-url"
                            type="text"
                            value={config.jdbcUrl || ''}
                            onChange={(e) => handleInputChange('jdbcUrl', e.target.value)}
                            placeholder="jdbc:databricks://dbc-xxxxx.cloud.databricks.com:443/default;transportMode=http;ssl=1;AuthMech=3;httpPath=/sql/1.0/warehouses/xxxxx"
                            required
                            className="form-input"
                          />
                          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '4px' }}>
                            Enter the JDBC URL for your Databricks connection (e.g., jdbc:databricks://dbc-xxxxx.cloud.databricks.com:443/default;transportMode=http;ssl=1;AuthMech=3;httpPath=/sql/1.0/warehouses/xxxxx)
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Authentication Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Authentication</h3>
                  <div className="config-section-content">
                    {databricksConnectionMethod === 'host' ? (
                      <>
                        {/* Client Authentication: Client ID and Client Secret */}
                        <div className="form-field">
                          <label htmlFor="databricks-client-id">
                            Client ID
                            <span className="required">*</span>
                          </label>
                          <input
                            id="databricks-client-id"
                            type="text"
                            value={config.clientId || ''}
                            onChange={(e) => handleInputChange('clientId', e.target.value)}
                            placeholder="Enter Client ID (Service Principal Application ID)"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="databricks-client-secret">
                            Client Secret
                            <span className="required">*</span>
                          </label>
                          <div className="password-input-wrapper">
                            <input
                              id="databricks-client-secret"
                              type={showPassword ? 'text' : 'password'}
                              value={config.clientSecret || ''}
                              onChange={(e) => handleInputChange('clientSecret', e.target.value)}
                              placeholder="Enter Client Secret (Service Principal OAuth Secret)"
                              required
                              className="form-input"
                            />
                            <button
                              type="button"
                              className="password-toggle"
                              onClick={() => setShowPassword(!showPassword)}
                            >
                              {showPassword ? '👁️' : '👁️‍🗨️'}
                            </button>
                          </div>
                          <label className="checkbox-option" style={{ marginTop: '8px' }}>
                            <input
                              type="checkbox"
                              checked={savePassword}
                              onChange={(e) => {
                                setSavePassword(e.target.checked)
                                handleInputChange('savePassword', e.target.checked)
                              }}
                            />
                            <span>Save</span>
                          </label>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* URL Authentication: Token Name and Token */}
                        <div className="form-field">
                          <label htmlFor="databricks-token-name">
                            Token Name
                            <span className="required">*</span>
                          </label>
                          <input
                            id="databricks-token-name"
                            type="text"
                            value={config.tokenName || ''}
                            onChange={(e) => handleInputChange('tokenName', e.target.value)}
                            placeholder="Enter Token Name"
                            required
                            className="form-input"
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor="databricks-token">
                            Token
                            <span className="required">*</span>
                          </label>
                          <div className="password-input-wrapper">
                            <input
                              id="databricks-token"
                              type={showPassword ? 'text' : 'password'}
                              value={config.token || config.accessToken || ''}
                              onChange={(e) => {
                                const value = e.target.value
                                handleInputChange('token', value)
                                handleInputChange('accessToken', value)
                              }}
                              placeholder="Enter Token"
                              required
                              className="form-input"
                            />
                            <button
                              type="button"
                              className="password-toggle"
                              onClick={() => setShowPassword(!showPassword)}
                            >
                              {showPassword ? '👁️' : '👁️‍🗨️'}
                            </button>
                          </div>
                          <label className="checkbox-option" style={{ marginTop: '8px' }}>
                            <input
                              type="checkbox"
                              checked={savePassword}
                              onChange={(e) => {
                                setSavePassword(e.target.checked)
                                handleInputChange('savePassword', e.target.checked)
                              }}
                            />
                            <span>Save</span>
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Schema Section */}
                <div className="config-section">
                  <h3 className="config-section-title">Schemas (Optional)</h3>
                  <div className="config-section-content">
                    <div className="form-field">
                      <label htmlFor="databricks-schema">
                        Schemas
                      </label>
                      <input
                        id="databricks-schema"
                        type="text"
                        value={config.schema || ''}
                        onChange={(e) => handleInputChange('schema', e.target.value)}
                        placeholder="Enter schema name (optional)"
                        className="form-input"
                      />
                    </div>
                  </div>
                </div>

                {/* Connection Details Button */}
                <div className="form-field">
                  <button
                    type="button"
                    className="btn-connection-details"
                    onClick={() => setShowConnectionDetails(!showConnectionDetails)}
                  >
                    {showConnectionDetails ? '▼' : '▶'} Connection details
                  </button>
                  {showConnectionDetails && (
                    <div className="connection-details-box">
                      <div className="connection-detail-item">
                        <strong>Connection Method:</strong> {databricksConnectionMethod === 'host' ? 'Client' : 'URL'}
                      </div>
                      {databricksConnectionMethod === 'host' ? (
                        <>
                          <div className="connection-detail-item">
                            <strong>Host:</strong> {config.serverHostname || config.host || config.server || 'Not set'}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="connection-detail-item">
                            <strong>JDBC URL:</strong> {config.jdbcUrl || 'Not set'}
                          </div>
                        </>
                      )}
                      {databricksConnectionMethod === 'host' ? (
                        <>
                          <div className="connection-detail-item">
                            <strong>Client ID:</strong> {config.clientId || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Client Secret:</strong> {config.clientSecret ? '••••••••' : 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Save Client Secret:</strong> {savePassword ? 'Yes' : 'No'}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="connection-detail-item">
                            <strong>Token Name:</strong> {config.tokenName || 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Token:</strong> {config.token || config.accessToken ? '••••••••' : 'Not set'}
                          </div>
                          <div className="connection-detail-item">
                            <strong>Save Token:</strong> {savePassword ? 'Yes' : 'No'}
                          </div>
                        </>
                      )}
                      {config.schema && (
                        <div className="connection-detail-item">
                          <strong>Schema:</strong> {config.schema || 'Not set'}
                        </div>
                      )}
                      <div className="connection-detail-item">
                        <strong>Server:</strong> SparkSQL 3.1.1
                      </div>
                      <div className="connection-detail-item">
                        <strong>Driver:</strong> DatabricksJDBC 3.0.7
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {fields.map((field) => (
              <div key={field.key} className="form-field">
                <label htmlFor={field.key}>
                  {field.label}
                  {field.required && <span className="required">*</span>}
                </label>
                {field.type === 'textarea' ? (
                  <div>
                    <textarea
                      id={field.key}
                      value={config[field.key] || ''}
                      onChange={(e) => handleInputChange(field.key, e.target.value)}
                      placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                      required={field.required}
                      rows={field.key === 'tables' ? 3 : 4}
                      className="form-input"
                    />
                    {field.key === 'tables' && (
                      <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '4px' }}>
                        Optional: Specify table names to help the AI understand your base structure. 
                        You can still query any table even if not listed here.
                      </p>
                    )}
                    {field.key === 'datasets' && (
                      <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '4px' }}>
                        Optional: Specify dataset names to help the AI understand your project structure. 
                        You can still query any dataset even if not listed here.
                      </p>
                    )}
                  </div>
                ) : field.type === 'password' ? (
                  <div className="password-input-wrapper">
                    <input
                      id={field.key}
                      type={showPassword ? 'text' : 'password'}
                      value={config[field.key] || ''}
                      onChange={(e) => handleInputChange(field.key, e.target.value)}
                      placeholder={`Enter ${field.label.toLowerCase()}`}
                      required={field.required}
                      className="form-input"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? '👁️' : '👁️‍🗨️'}
                    </button>
                  </div>
                ) : (
                  <input
                    id={field.key}
                    type={field.type}
                    value={config[field.key] || (field.default || '')}
                    onChange={(e) => handleInputChange(field.key, field.type === 'number' ? parseInt(e.target.value) || 0 : e.target.value)}
                    placeholder={`Enter ${field.label.toLowerCase()}`}
                    required={field.required}
                    className="form-input"
                  />
                )}
              </div>
            ))}
              </>
            )}
          </div>

          {testResult && (
            <div className={`test-result ${testResult.success ? 'test-success' : 'test-error'}`}>
              {testResult.success ? (
                <div>
                  <span style={{ marginRight: '8px' }}>✓</span>
                  {testResult.message || 'Connection successful!'}
                </div>
              ) : (
                <div>
                  <span style={{ marginRight: '8px' }}>✗</span>
                  {testResult.error || 'Connection test failed'}
                </div>
              )}
            </div>
          )}

          <div className="form-actions">
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <div>
                {onDisconnect && Object.keys(existingConfig || {}).length > 0 && (
                  <button 
                    type="button" 
                    className="btn-disconnect" 
                    onClick={() => {
                      if (window.confirm(`Are you sure you want to disconnect ${source.name}?`)) {
                        onDisconnect()
                        onClose()
                      }
                    }}
                  >
                    Disconnect
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button 
                  type="button" 
                  className="btn-test" 
                  onClick={handleTestConnection}
                  disabled={testingConnection}
                >
                  {testingConnection ? (
                    <>
                      <span className="btn-test-spinner">⟳</span>
                      Testing...
                    </>
                  ) : (
                    <>
                      <span style={{ marginRight: '6px' }}>✓</span>
                      Test Connection
                    </>
                  )}
                </button>
                <button type="button" className="btn-cancel" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn-save">
                  Save Connection
                </button>
              </div>
            </div>
          </div>
        </form>
        )}
        {!isCollapsed && <div className="resize-handle" onMouseDown={handleResizeStart}></div>}
    </div>
  )

  if (inline) {
    return (
      <div className="connection-panel">
        {modalBody}
      </div>
    )
  }

  return (
    <div className="connection-modal-overlay" onClick={onClose}>
      {modalBody}
    </div>
  )
}

export default ConnectionConfigModal

