import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { useDraggableResizable } from '../hooks/useDraggableResizable'
import './LLMConfig.css'

type LLMProvider = 'openai' | 'gemini' | 'anthropic'
type ModelType = 'full' | 'light' | 'custom'
type ConnectionStatus = 'connected' | 'failed' | 'untested'
type EnvLLMPreference = 'random' | 'openai' | 'gemini' | 'anthropic'

interface ProviderSettings {
  apiKey: string
  modelType: ModelType
  customModelName: string
  connectionStatus: ConnectionStatus
}

interface LLMConfigProps {
  inline?: boolean
  isOpen?: boolean
  onClose?: () => void
}

const LLMConfig: React.FC<LLMConfigProps> = ({ inline = false, isOpen, onClose }) => {
  const { isAuthenticated } = useAuth()
  const { canConfigure } = usePermissions()
  const [openaiSettings, setOpenaiSettings] = useState<ProviderSettings>({
    apiKey: '',
    modelType: 'full',
    customModelName: '',
    connectionStatus: 'untested'
  })
  const [geminiSettings, setGeminiSettings] = useState<ProviderSettings>({
    apiKey: '',
    modelType: 'full',
    customModelName: '',
    connectionStatus: 'untested'
  })
  const [anthropicSettings, setAnthropicSettings] = useState<ProviderSettings>({
    apiKey: '',
    modelType: 'full',
    customModelName: '',
    connectionStatus: 'untested'
  })
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider>('openai')
  const [envLlmPreference, setEnvLlmPreference] = useState<EnvLLMPreference>('random')
  const [envStatus, setEnvStatus] = useState<{ openai: boolean; gemini: boolean; anthropic: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [testingOpenai, setTestingOpenai] = useState(false)
  const [testingGemini, setTestingGemini] = useState(false)
  const [testingAnthropic, setTestingAnthropic] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [showAnthropicKey, setShowAnthropicKey] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)
  
  const { modalRef, position, modalSize, isDragging, handleMouseDown, handleResizeStart } = useDraggableResizable({
    initialWidth: 800,
    initialHeight: 700,
    minWidth: 600,
    minHeight: 500,
    storageKey: 'llmConfigModal'
  })

  const getProviderStatusStorageKey = (provider: LLMProvider) => {
    const currentUserId = localStorage.getItem('aiquery_current_user_id')
    return currentUserId
      ? `aiquery_llm_connection_status_${provider}_${currentUserId}`
      : `aiquery_llm_connection_status_${provider}`
  }

  const getStoredProviderStatus = (provider: LLMProvider): ConnectionStatus => {
    const raw = localStorage.getItem(getProviderStatusStorageKey(provider))
    if (raw === 'connected' || raw === 'failed' || raw === 'untested') return raw
    return 'untested'
  }

  const setStoredProviderStatus = (provider: LLMProvider, status: ConnectionStatus) => {
    localStorage.setItem(getProviderStatusStorageKey(provider), status)
  }

  useEffect(() => {
    const loadEnv = async () => {
      try {
        const { data } = await axios.get('/api/settings/llm/env-status')
        if (data?.env) setEnvStatus(data.env)
      } catch {
        setEnvStatus(null)
      }
    }
    loadEnv()
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      loadSettings()
    } else {
      loadFromLocalStorage()
      setLoading(false)
    }
  }, [isAuthenticated])

  const panelOpen = inline ? (isOpen ?? true) : showModal

  // Load settings when modal opens
  useEffect(() => {
    if (isAuthenticated && panelOpen) {
      loadSettings()
    }
  }, [isAuthenticated, panelOpen])

  const loadSettings = async () => {
    try {
      const token = localStorage.getItem('aiquery_token')
      const currentUserId = localStorage.getItem('aiquery_current_user_id')
      const response = await axios.get('/api/settings/llm', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.data.success) {
        const responseProvider = (response.data.provider as LLMProvider) || 'openai'
        const hasOpenaiKey = response.data.hasOpenaiKey === true
        const hasGeminiKey = response.data.hasGeminiKey === true
        const hasAnthropicKey = response.data.hasAnthropicKey === true
        const savedProvider = currentUserId
          ? ((localStorage.getItem(`aiquery_llm_provider_${currentUserId}`) as LLMProvider) || null)
          : ((localStorage.getItem('aiquery_llm_provider') as LLMProvider) || null)

        const hasKeyForProvider = (p: LLMProvider) =>
          p === 'openai' ? hasOpenaiKey : p === 'gemini' ? hasGeminiKey : hasAnthropicKey

        let resolvedProvider: LLMProvider = responseProvider
        if (!hasKeyForProvider(responseProvider)) {
          if (hasAnthropicKey) resolvedProvider = 'anthropic'
          else if (hasGeminiKey) resolvedProvider = 'gemini'
          else if (hasOpenaiKey) resolvedProvider = 'openai'
          else if (savedProvider) resolvedProvider = savedProvider
        }

        setSelectedProvider(resolvedProvider)
        if (response.data.envLlmPreference) {
          setEnvLlmPreference(response.data.envLlmPreference as EnvLLMPreference)
        }
        
        // Load API keys from localStorage using user-specific keys
        if (currentUserId) {
          const savedOpenaiKey = localStorage.getItem(`aiquery_openai_api_key_${currentUserId}`) || ''
          const savedGeminiKey = localStorage.getItem(`aiquery_gemini_api_key_${currentUserId}`) || ''
          const savedAnthropicKey = localStorage.getItem(`aiquery_anthropic_api_key_${currentUserId}`) || ''
          const savedOpenaiModel = localStorage.getItem(`aiquery_openai_model_${currentUserId}`) || 'full'
          const savedGeminiModel = localStorage.getItem(`aiquery_gemini_model_${currentUserId}`) || 'full'
          const savedAnthropicModel = localStorage.getItem(`aiquery_anthropic_model_${currentUserId}`) || 'full'
          const savedOpenaiCustomModel = localStorage.getItem(`aiquery_openai_custom_model_${currentUserId}`) || ''
          const savedGeminiCustomModel = localStorage.getItem(`aiquery_gemini_custom_model_${currentUserId}`) || ''
          const savedAnthropicCustomModel = localStorage.getItem(`aiquery_anthropic_custom_model_${currentUserId}`) || ''
          
          // Determine connection status based on backend response
          // Check if API key exists in database (hasOpenaiKey/hasGeminiKey) and connectionStatus
          const hasOpenaiKeyInDb = hasOpenaiKey
          const hasGeminiKeyInDb = hasGeminiKey
          const hasAnthropicKeyInDb = hasAnthropicKey
          const dbConnectionStatus = response.data.connectionStatus || 'untested'
          const selectedProviderFromDb = resolvedProvider
          const localOpenaiStatus = getStoredProviderStatus('openai')
          const localGeminiStatus = getStoredProviderStatus('gemini')
          const localAnthropicStatus = getStoredProviderStatus('anthropic')
          
          // For OpenAI: show 'connected' if key exists in DB, provider is 'openai', and status is 'connected'
          // Otherwise, if key exists in localStorage, show 'untested' (key exists but not tested)
          // Otherwise, show 'untested' (no key)
          const openaiStatus = ((hasOpenaiKeyInDb && selectedProviderFromDb === 'openai' && dbConnectionStatus === 'connected') ||
            (savedOpenaiKey && localOpenaiStatus === 'connected'))
            ? 'connected'
            : (savedOpenaiKey || hasOpenaiKeyInDb)
            ? 'untested' // Key exists but status is not 'connected' or provider doesn't match
            : 'untested'
          
          // For Gemini: show 'connected' if key exists in DB, provider is 'gemini', and status is 'connected'
          // Otherwise, if key exists in localStorage, show 'untested' (key exists but not tested)
          // Otherwise, show 'untested' (no key)
          const geminiStatus = ((hasGeminiKeyInDb && selectedProviderFromDb === 'gemini' && dbConnectionStatus === 'connected') ||
            (savedGeminiKey && localGeminiStatus === 'connected'))
            ? 'connected'
            : (savedGeminiKey || hasGeminiKeyInDb)
            ? 'untested' // Key exists but status is not 'connected' or provider doesn't match
            : 'untested'

          const anthropicStatus = ((hasAnthropicKeyInDb && selectedProviderFromDb === 'anthropic' && dbConnectionStatus === 'connected') ||
            (savedAnthropicKey && localAnthropicStatus === 'connected'))
            ? 'connected'
            : (savedAnthropicKey || hasAnthropicKeyInDb)
            ? 'untested'
            : 'untested'
          
          setOpenaiSettings({
            apiKey: savedOpenaiKey,
            modelType: savedOpenaiModel as ModelType,
            customModelName: savedOpenaiCustomModel,
            connectionStatus: openaiStatus as ConnectionStatus
          })
          setGeminiSettings({
            apiKey: savedGeminiKey,
            modelType: savedGeminiModel as ModelType,
            customModelName: savedGeminiCustomModel,
            connectionStatus: geminiStatus as ConnectionStatus
          })
          setAnthropicSettings({
            apiKey: savedAnthropicKey,
            modelType: savedAnthropicModel as ModelType,
            customModelName: savedAnthropicCustomModel,
            connectionStatus: anthropicStatus as ConnectionStatus
          })
        }
      }
    } catch (error) {
      console.error('Error loading LLM settings:', error)
      loadFromLocalStorage()
    } finally {
      setLoading(false)
    }
  }

  const loadFromLocalStorage = () => {
    const currentUserId = localStorage.getItem('aiquery_current_user_id')
    
    // Use user-specific keys if authenticated, otherwise use generic keys
    if (currentUserId) {
      const savedProvider = localStorage.getItem(`aiquery_llm_provider_${currentUserId}`) as LLMProvider || 'openai'
      const savedOpenaiKey = localStorage.getItem(`aiquery_openai_api_key_${currentUserId}`) || ''
      const savedGeminiKey = localStorage.getItem(`aiquery_gemini_api_key_${currentUserId}`) || ''
      const savedOpenaiModel = localStorage.getItem(`aiquery_openai_model_${currentUserId}`) || 'full'
      const savedGeminiModel = localStorage.getItem(`aiquery_gemini_model_${currentUserId}`) || 'full'
      const savedOpenaiCustomModel = localStorage.getItem(`aiquery_openai_custom_model_${currentUserId}`) || ''
      const savedGeminiCustomModel = localStorage.getItem(`aiquery_gemini_custom_model_${currentUserId}`) || ''
      const savedAnthropicKey = localStorage.getItem(`aiquery_anthropic_api_key_${currentUserId}`) || ''
      const savedAnthropicModel = localStorage.getItem(`aiquery_anthropic_model_${currentUserId}`) || 'full'
      const savedAnthropicCustomModel = localStorage.getItem(`aiquery_anthropic_custom_model_${currentUserId}`) || ''
      const savedEnvPref = localStorage.getItem(`aiquery_env_llm_preference_${currentUserId}`) as EnvLLMPreference | null
      if (savedEnvPref && ['random', 'openai', 'gemini', 'anthropic'].includes(savedEnvPref)) {
        setEnvLlmPreference(savedEnvPref)
      }
      
      setSelectedProvider(savedProvider)
      setOpenaiSettings({
        apiKey: savedOpenaiKey,
        modelType: savedOpenaiModel as ModelType,
        customModelName: savedOpenaiCustomModel,
        connectionStatus: savedOpenaiKey && getStoredProviderStatus('openai') === 'connected' ? 'connected' : 'untested'
      })
      setGeminiSettings({
        apiKey: savedGeminiKey,
        modelType: savedGeminiModel as ModelType,
        customModelName: savedGeminiCustomModel,
        connectionStatus: savedGeminiKey && getStoredProviderStatus('gemini') === 'connected' ? 'connected' : 'untested'
      })
      setAnthropicSettings({
        apiKey: savedAnthropicKey,
        modelType: savedAnthropicModel as ModelType,
        customModelName: savedAnthropicCustomModel,
        connectionStatus: savedAnthropicKey && getStoredProviderStatus('anthropic') === 'connected' ? 'connected' : 'untested'
      })
    } else {
      // No user logged in - use generic keys (for backward compatibility)
      const savedProvider = localStorage.getItem('aiquery_llm_provider') as LLMProvider || 'openai'
      const savedOpenaiKey = localStorage.getItem('aiquery_openai_api_key') || ''
      const savedGeminiKey = localStorage.getItem('aiquery_gemini_api_key') || ''
      const savedOpenaiModel = localStorage.getItem('aiquery_openai_model') || 'full'
      const savedGeminiModel = localStorage.getItem('aiquery_gemini_model') || 'full'
      const savedOpenaiCustomModel = localStorage.getItem('aiquery_openai_custom_model') || ''
      const savedGeminiCustomModel = localStorage.getItem('aiquery_gemini_custom_model') || ''
      const savedAnthropicKey = localStorage.getItem('aiquery_anthropic_api_key') || ''
      const savedAnthropicModel = localStorage.getItem('aiquery_anthropic_model') || 'full'
      const savedAnthropicCustomModel = localStorage.getItem('aiquery_anthropic_custom_model') || ''
      
      setSelectedProvider(savedProvider)
      setOpenaiSettings({
        apiKey: savedOpenaiKey,
        modelType: savedOpenaiModel as ModelType,
        customModelName: savedOpenaiCustomModel,
        connectionStatus: savedOpenaiKey && getStoredProviderStatus('openai') === 'connected' ? 'connected' : 'untested'
      })
      setGeminiSettings({
        apiKey: savedGeminiKey,
        modelType: savedGeminiModel as ModelType,
        customModelName: savedGeminiCustomModel,
        connectionStatus: savedGeminiKey && getStoredProviderStatus('gemini') === 'connected' ? 'connected' : 'untested'
      })
      setAnthropicSettings({
        apiKey: savedAnthropicKey,
        modelType: savedAnthropicModel as ModelType,
        customModelName: savedAnthropicCustomModel,
        connectionStatus: savedAnthropicKey && getStoredProviderStatus('anthropic') === 'connected' ? 'connected' : 'untested'
      })
    }
  }

  const handleTestConnection = async (provider: LLMProvider) => {
    const settings =
      provider === 'openai' ? openaiSettings : provider === 'gemini' ? geminiSettings : anthropicSettings

    if (!settings.apiKey.trim()) {
      alert('Please enter an API key first')
      return
    }

    if (provider === 'openai') setTestingOpenai(true)
    else if (provider === 'gemini') setTestingGemini(true)
    else setTestingAnthropic(true)

    try {
      const token = localStorage.getItem('aiquery_token')
      let modelName: string

      if (provider === 'openai') {
        modelName =
          settings.modelType === 'custom' && settings.customModelName
            ? settings.customModelName.trim()
            : settings.modelType === 'full'
              ? 'gpt-4o'
              : 'gpt-4o-mini'
      } else if (provider === 'gemini') {
        modelName =
          settings.modelType === 'custom' && settings.customModelName
            ? settings.customModelName.trim()
            : settings.modelType === 'full'
              ? 'gemini-2.5-flash'
              : 'gemini-2.5-flash-lite'
      } else {
        modelName =
          settings.modelType === 'custom' && settings.customModelName
            ? settings.customModelName.trim()
            : settings.modelType === 'full'
              ? 'claude-sonnet-4-6'
              : 'claude-haiku-4-5-20251001'
      }

      const response = await axios.post(
        '/api/settings/llm/test',
        {
          provider,
          openaiApiKey: provider === 'openai' ? settings.apiKey.trim() : undefined,
          geminiApiKey: provider === 'gemini' ? settings.apiKey.trim() : undefined,
          anthropicApiKey: provider === 'anthropic' ? settings.apiKey.trim() : undefined,
          modelName,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )

      if (response.data.success) {
        setStoredProviderStatus(provider, 'connected')
        const currentUserId = localStorage.getItem('aiquery_current_user_id')
        if (currentUserId) {
          if (provider === 'openai') {
            localStorage.setItem(`aiquery_openai_api_key_${currentUserId}`, settings.apiKey.trim())
            localStorage.setItem(`aiquery_openai_model_${currentUserId}`, settings.modelType)
            if (settings.modelType === 'custom') {
              localStorage.setItem(`aiquery_openai_custom_model_${currentUserId}`, settings.customModelName.trim())
            }
            setOpenaiSettings((prev) => ({ ...prev, connectionStatus: 'connected' }))
          } else if (provider === 'gemini') {
            localStorage.setItem(`aiquery_gemini_api_key_${currentUserId}`, settings.apiKey.trim())
            localStorage.setItem(`aiquery_gemini_model_${currentUserId}`, settings.modelType)
            if (settings.modelType === 'custom') {
              localStorage.setItem(`aiquery_gemini_custom_model_${currentUserId}`, settings.customModelName.trim())
            }
            setGeminiSettings((prev) => ({ ...prev, connectionStatus: 'connected' }))
          } else {
            localStorage.setItem(`aiquery_anthropic_api_key_${currentUserId}`, settings.apiKey.trim())
            localStorage.setItem(`aiquery_anthropic_model_${currentUserId}`, settings.modelType)
            if (settings.modelType === 'custom') {
              localStorage.setItem(`aiquery_anthropic_custom_model_${currentUserId}`, settings.customModelName.trim())
            }
            setAnthropicSettings((prev) => ({ ...prev, connectionStatus: 'connected' }))
          }
        }
        alert('Connection test successful!')
      } else {
        setStoredProviderStatus(provider, 'failed')
        if (provider === 'openai') setOpenaiSettings((prev) => ({ ...prev, connectionStatus: 'failed' }))
        else if (provider === 'gemini') setGeminiSettings((prev) => ({ ...prev, connectionStatus: 'failed' }))
        else setAnthropicSettings((prev) => ({ ...prev, connectionStatus: 'failed' }))
        alert(`Connection test failed: ${response.data.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      setStoredProviderStatus(provider, 'failed')
      if (provider === 'openai') setOpenaiSettings((prev) => ({ ...prev, connectionStatus: 'failed' }))
      else if (provider === 'gemini') setGeminiSettings((prev) => ({ ...prev, connectionStatus: 'failed' }))
      else setAnthropicSettings((prev) => ({ ...prev, connectionStatus: 'failed' }))
      alert(`Connection test failed: ${error.response?.data?.error || error.message || 'Unknown error'}`)
    } finally {
      if (provider === 'openai') setTestingOpenai(false)
      else if (provider === 'gemini') setTestingGemini(false)
      else setTestingAnthropic(false)
    }
  }

  const handleDisconnect = async (provider: LLMProvider) => {
    const providerName = provider === 'openai' ? 'OpenAI' : provider === 'gemini' ? 'Gemini' : 'Anthropic'

    if (!confirm(`Are you sure you want to disconnect ${providerName}? This will clear the API key and reset the connection.`)) {
      return
    }

    try {
      const currentUserId = localStorage.getItem('aiquery_current_user_id')

      if (currentUserId) {
        if (provider === 'openai') {
          localStorage.removeItem(`aiquery_openai_api_key_${currentUserId}`)
          setStoredProviderStatus('openai', 'untested')
          setOpenaiSettings((prev) => ({ ...prev, apiKey: '', connectionStatus: 'untested' }))
        } else if (provider === 'gemini') {
          localStorage.removeItem(`aiquery_gemini_api_key_${currentUserId}`)
          setStoredProviderStatus('gemini', 'untested')
          setGeminiSettings((prev) => ({ ...prev, apiKey: '', connectionStatus: 'untested' }))
        } else {
          localStorage.removeItem(`aiquery_anthropic_api_key_${currentUserId}`)
          setStoredProviderStatus('anthropic', 'untested')
          setAnthropicSettings((prev) => ({ ...prev, apiKey: '', connectionStatus: 'untested' }))
        }
      } else {
        if (provider === 'openai') {
          localStorage.removeItem('aiquery_openai_api_key')
          setStoredProviderStatus('openai', 'untested')
          setOpenaiSettings((prev) => ({ ...prev, apiKey: '', connectionStatus: 'untested' }))
        } else if (provider === 'gemini') {
          localStorage.removeItem('aiquery_gemini_api_key')
          setStoredProviderStatus('gemini', 'untested')
          setGeminiSettings((prev) => ({ ...prev, apiKey: '', connectionStatus: 'untested' }))
        } else {
          localStorage.removeItem('aiquery_anthropic_api_key')
          setStoredProviderStatus('anthropic', 'untested')
          setAnthropicSettings((prev) => ({ ...prev, apiKey: '', connectionStatus: 'untested' }))
        }
      }

      if (isAuthenticated) {
        const token = localStorage.getItem('aiquery_token')

        const requestBody: Record<string, unknown> = {
          provider: selectedProvider,
          modelType:
            selectedProvider === 'openai'
              ? openaiSettings.modelType
              : selectedProvider === 'gemini'
                ? geminiSettings.modelType
                : anthropicSettings.modelType,
          openaiApiKey: provider === 'openai' ? '' : openaiSettings.apiKey.trim() || '',
          geminiApiKey: provider === 'gemini' ? '' : geminiSettings.apiKey.trim() || '',
          anthropicApiKey: provider === 'anthropic' ? '' : anthropicSettings.apiKey.trim() || '',
          envLlmPreference,
        }

        if (openaiSettings.modelType === 'custom') {
          requestBody.openaiModelName = openaiSettings.customModelName.trim() || undefined
        }
        if (geminiSettings.modelType === 'custom') {
          requestBody.geminiModelName = geminiSettings.customModelName.trim() || undefined
        }
        if (anthropicSettings.modelType === 'custom') {
          requestBody.anthropicModelName = anthropicSettings.customModelName.trim() || undefined
        }

        try {
          await axios.post('/api/settings/llm', requestBody, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          })
        } catch (backendError: any) {
          console.error('Error updating backend:', backendError)
        }
      }

      alert(`${providerName} disconnected successfully!`)
    } catch (error: any) {
      console.error(`Error disconnecting ${providerName}:`, error)
      alert(error.response?.data?.error || `Failed to disconnect ${providerName}. Please try again.`)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (isAuthenticated) {
        const token = localStorage.getItem('aiquery_token')
        const currentUserId = localStorage.getItem('aiquery_current_user_id')
        
        // Save both providers' settings
        // Send empty strings (not undefined) when keys are cleared so backend knows to clear them
        // The backend will normalize empty strings to null to clear old keys
        await axios.post('/api/settings/llm', {
          provider: selectedProvider,
          modelType:
            selectedProvider === 'openai'
              ? openaiSettings.modelType
              : selectedProvider === 'gemini'
                ? geminiSettings.modelType
                : anthropicSettings.modelType,
          openaiApiKey: openaiSettings.apiKey.trim() || '',
          geminiApiKey: geminiSettings.apiKey.trim() || '',
          anthropicApiKey: anthropicSettings.apiKey.trim() || '',
          openaiModelName: openaiSettings.modelType === 'custom' ? openaiSettings.customModelName.trim() : undefined,
          geminiModelName: geminiSettings.modelType === 'custom' ? geminiSettings.customModelName.trim() : undefined,
          anthropicModelName: anthropicSettings.modelType === 'custom' ? anthropicSettings.customModelName.trim() : undefined,
          envLlmPreference,
        }, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })
        
        if (currentUserId) {
          localStorage.setItem(`aiquery_openai_api_key_${currentUserId}`, openaiSettings.apiKey.trim())
          localStorage.setItem(`aiquery_gemini_api_key_${currentUserId}`, geminiSettings.apiKey.trim())
          localStorage.setItem(`aiquery_anthropic_api_key_${currentUserId}`, anthropicSettings.apiKey.trim())
          localStorage.setItem(`aiquery_openai_model_${currentUserId}`, openaiSettings.modelType)
          localStorage.setItem(`aiquery_gemini_model_${currentUserId}`, geminiSettings.modelType)
          localStorage.setItem(`aiquery_anthropic_model_${currentUserId}`, anthropicSettings.modelType)
          localStorage.setItem(`aiquery_llm_provider_${currentUserId}`, selectedProvider)
          localStorage.setItem(`aiquery_env_llm_preference_${currentUserId}`, envLlmPreference)
          if (openaiSettings.modelType === 'custom') {
            localStorage.setItem(`aiquery_openai_custom_model_${currentUserId}`, openaiSettings.customModelName.trim())
          }
          if (geminiSettings.modelType === 'custom') {
            localStorage.setItem(`aiquery_gemini_custom_model_${currentUserId}`, geminiSettings.customModelName.trim())
          }
          if (anthropicSettings.modelType === 'custom') {
            localStorage.setItem(`aiquery_anthropic_custom_model_${currentUserId}`, anthropicSettings.customModelName.trim())
          }
        }
        
        alert('Settings saved successfully!')
      } else {
        // Not authenticated - use generic keys
        localStorage.setItem('aiquery_llm_provider', selectedProvider)
        localStorage.setItem('aiquery_openai_api_key', openaiSettings.apiKey)
        localStorage.setItem('aiquery_gemini_api_key', geminiSettings.apiKey)
        localStorage.setItem('aiquery_anthropic_api_key', anthropicSettings.apiKey)
        localStorage.setItem('aiquery_openai_model', openaiSettings.modelType)
        localStorage.setItem('aiquery_gemini_model', geminiSettings.modelType)
        localStorage.setItem('aiquery_anthropic_model', anthropicSettings.modelType)
        if (openaiSettings.modelType === 'custom') {
          localStorage.setItem('aiquery_openai_custom_model', openaiSettings.customModelName)
        }
        if (geminiSettings.modelType === 'custom') {
          localStorage.setItem('aiquery_gemini_custom_model', geminiSettings.customModelName)
        }
        if (anthropicSettings.modelType === 'custom') {
          localStorage.setItem('aiquery_anthropic_custom_model', anthropicSettings.customModelName)
        }
        alert('Settings saved successfully!')
      }
    } catch (error: any) {
      console.error('Error saving settings:', error)
      alert(error.response?.data?.error || 'Failed to save settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const getOverallConnectionStatus = (): ConnectionStatus => {
    const s =
      selectedProvider === 'openai'
        ? openaiSettings
        : selectedProvider === 'gemini'
          ? geminiSettings
          : anthropicSettings
    if (s.apiKey.trim() && s.connectionStatus === 'connected') {
      return 'connected'
    }
    return s.connectionStatus
  }

  const overallStatus = getOverallConnectionStatus()

  const handleClose = () => {
    if (inline) {
      if (onClose) onClose()
    } else {
      setShowModal(false)
    }
  }

  return (
    <>
      {!inline && (
        <button 
          className="llm-config-button"
          onClick={() => setShowModal(true)}
          title="Configure LLM Settings"
        >
          <span className="llm-config-icon">
            <img src="/images/llm_logo.png" alt="" aria-hidden="true" />
          </span>
          <span className="llm-config-text">LLM Configuration</span>
          {!loading && overallStatus === 'connected' && (
            <span className="connection-status connected" style={{ marginLeft: '10px' }}>● Connected</span>
          )}
          {!loading && overallStatus === 'failed' && (
            <span className="connection-status failed" style={{ marginLeft: '10px' }}>● Connection Failed</span>
          )}
          {!loading && overallStatus === 'untested' && (
            <span className="connection-status not-connected" style={{ marginLeft: '10px' }}>Not Connected</span>
          )}
        </button>
      )}

      {panelOpen && (
        <div className={inline ? 'llm-config-panel' : 'llm-config-modal-overlay'} onClick={inline ? undefined : handleClose}>
          <div 
            ref={modalRef}
            className={`llm-config-modal-content draggable-modal ${inline ? 'inline' : ''}`}
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
              className="llm-config-modal-header"
              onMouseDown={handleMouseDown}
              style={{ cursor: inline ? 'default' : 'grab' }}
            >
              <h2>LLM Configuration</h2>
              <button 
                className="llm-config-modal-close"
                onClick={handleClose}
              >
                ×
              </button>
            </div>
            <div className="llm-config-content">
          {envStatus && (
            <div className="llm-env-banner" style={{ marginBottom: '1rem', padding: '12px', background: 'rgba(0,200,100,0.08)', borderRadius: '8px', border: '1px solid rgba(0,200,100,0.25)' }}>
              <strong>Server API keys (environment)</strong>
              <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#ccc' }}>
                When you don&apos;t save your own keys below, the app uses these. Green = key present in server <code>.env</code>.
              </p>
              <div style={{ display: 'flex', gap: '16px', marginTop: '10px', flexWrap: 'wrap' }}>
                <span>OpenAI {envStatus.openai ? <span style={{ color: '#3dff7a' }}>●</span> : <span style={{ color: '#666' }}>○</span>}</span>
                <span>Gemini {envStatus.gemini ? <span style={{ color: '#3dff7a' }}>●</span> : <span style={{ color: '#666' }}>○</span>}</span>
                <span>Anthropic {envStatus.anthropic ? <span style={{ color: '#3dff7a' }}>●</span> : <span style={{ color: '#666' }}>○</span>}</span>
              </div>
              <div style={{ marginTop: '12px' }}>
                <strong style={{ fontSize: '13px' }}>When using server keys</strong>
                <div className="llm-active-provider-options" style={{ marginTop: '8px' }}>
                  {(['random', 'openai', 'gemini', 'anthropic'] as const).map((k) => (
                    <label key={k} className="llm-active-provider-option" style={{ marginRight: '12px' }}>
                      <input
                        type="radio"
                        name="env-llm-pref"
                        checked={envLlmPreference === k}
                        onChange={() => setEnvLlmPreference(k)}
                      />
                      <span>{k === 'random' ? 'Random among available' : k.charAt(0).toUpperCase() + k.slice(1)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* OpenAI Section */}
          <div className="llm-provider-section">
            <div className="connection-header llm-provider-header">
              <div className="connection-icon-wrapper openai">
                <img
                  src="/images/openai_logo.png"
                  alt="OpenAI"
                  className="connection-icon llm-provider-icon"
                />
              </div>
              <div className="connection-info">
                <h3>OpenAI</h3>
                <p>Configure OpenAI models and credentials</p>
              </div>
            </div>
            
            <div className="llm-api-key-group">
              <label className="llm-api-key-label">
                OpenAI API Key
              </label>
              <div className="llm-api-key-input-wrapper">
                <input
                  type={showOpenaiKey ? 'text' : 'password'}
                  className="llm-api-key-input"
                  value={openaiSettings.apiKey}
                  onChange={(e) => setOpenaiSettings(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="sk-..."
                />
                <button
                  type="button"
                  className="llm-api-key-toggle"
                  onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                  aria-label={showOpenaiKey ? 'Hide key' : 'Show key'}
                >
                  {showOpenaiKey ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
            </div>

            <div className="llm-model-selection">
              <h5 className="llm-model-selection-title">Model Selection</h5>
              <div className="llm-model-options">
                <label className="llm-model-option">
                  <input
                    type="radio"
                    name="openai-model"
                    value="full"
                    checked={openaiSettings.modelType === 'full'}
                    onChange={() => setOpenaiSettings(prev => ({ ...prev, modelType: 'full' }))}
                  />
                  <span>GPT-4o (Full)</span>
                </label>
                <label className="llm-model-option">
                  <input
                    type="radio"
                    name="openai-model"
                    value="light"
                    checked={openaiSettings.modelType === 'light'}
                    onChange={() => setOpenaiSettings(prev => ({ ...prev, modelType: 'light' }))}
                  />
                  <span>GPT-4o Mini (Light)</span>
                </label>
                <label className="llm-model-option">
                  <input
                    type="radio"
                    name="openai-model"
                    value="custom"
                    checked={openaiSettings.modelType === 'custom'}
                    onChange={() => setOpenaiSettings(prev => ({ ...prev, modelType: 'custom' }))}
                  />
                  <span>Custom Model</span>
                </label>
              </div>
              
              {openaiSettings.modelType === 'custom' && (
                <div className="llm-custom-model-input">
                  <label>Custom Model Name</label>
                  <input
                    type="text"
                    value={openaiSettings.customModelName}
                    onChange={(e) => setOpenaiSettings(prev => ({ ...prev, customModelName: e.target.value }))}
                    placeholder="e.g., gpt-4-turbo, gpt-3.5-turbo"
                  />
                </div>
              )}
            </div>

            <div className="llm-provider-actions">
              <button
                className="llm-test-button"
                onClick={() => handleTestConnection('openai')}
                disabled={testingOpenai || !isAuthenticated || !openaiSettings.apiKey.trim() || !canConfigure}
                title={!canConfigure ? 'View members cannot configure LLM settings' : ''}
              >
                {testingOpenai ? 'Testing...' : 'Test OpenAI Connection'}
              </button>
              {(openaiSettings.apiKey.trim() || openaiSettings.connectionStatus === 'connected') && (
                <button
                  className="llm-disconnect-button"
                  onClick={() => handleDisconnect('openai')}
                >
                  Disconnect
                </button>
              )}
              {openaiSettings.connectionStatus === 'connected' && (
                <span className="llm-connection-status connected">● Connected</span>
              )}
              {openaiSettings.connectionStatus === 'failed' && (
                <span className="llm-connection-status failed">● Connection Failed</span>
              )}
            </div>
          </div>

          {/* Gemini Section */}
          <div className="llm-provider-section">
            <div className="connection-header llm-provider-header">
              <div className="connection-icon-wrapper gemini">
                <img
                  src="/images/Gemini_logo.png"
                  alt="Gemini"
                  className="connection-icon llm-provider-icon"
                />
              </div>
              <div className="connection-info">
                <h3>Gemini (Google)</h3>
                <p>Configure Gemini models and credentials</p>
              </div>
            </div>
            
            <div className="llm-api-key-group">
              <label className="llm-api-key-label">
                Gemini API Key
              </label>
              <div className="llm-api-key-input-wrapper">
                <input
                  type={showGeminiKey ? 'text' : 'password'}
                  className="llm-api-key-input"
                  value={geminiSettings.apiKey}
                  onChange={(e) => setGeminiSettings(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="AIza..."
                />
                <button
                  type="button"
                  className="llm-api-key-toggle"
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  aria-label={showGeminiKey ? 'Hide key' : 'Show key'}
                >
                  {showGeminiKey ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
            </div>

            <div className="llm-model-selection">
              <h5 className="llm-model-selection-title">Model Selection</h5>
              <div className="llm-model-options">
                <label className="llm-model-option">
                  <input
                    type="radio"
                    name="gemini-model"
                    value="full"
                    checked={geminiSettings.modelType === 'full'}
                    onChange={() => setGeminiSettings(prev => ({ ...prev, modelType: 'full' }))}
                  />
                  <span>Gemini 2.0 Flash (Full)</span>
                </label>
                <label className="llm-model-option">
                  <input
                    type="radio"
                    name="gemini-model"
                    value="light"
                    checked={geminiSettings.modelType === 'light'}
                    onChange={() => setGeminiSettings(prev => ({ ...prev, modelType: 'light' }))}
                  />
                  <span>Gemini 2.0 Flash Lite (Light)</span>
                </label>
                <label className="llm-model-option">
                  <input
                    type="radio"
                    name="gemini-model"
                    value="custom"
                    checked={geminiSettings.modelType === 'custom'}
                    onChange={() => setGeminiSettings(prev => ({ ...prev, modelType: 'custom' }))}
                  />
                  <span>Custom Model</span>
                </label>
              </div>
              
              {geminiSettings.modelType === 'custom' && (
                <div className="llm-custom-model-input">
                  <label>Custom Model Name</label>
                  <input
                    type="text"
                    value={geminiSettings.customModelName}
                    onChange={(e) => setGeminiSettings(prev => ({ ...prev, customModelName: e.target.value }))}
                    placeholder="e.g., gemini-pro, gemini-1.5-pro"
                  />
                </div>
              )}
            </div>

            <div className="llm-provider-actions">
              <button
                className="llm-test-button"
                onClick={() => handleTestConnection('gemini')}
                disabled={testingGemini || !isAuthenticated || !geminiSettings.apiKey.trim() || !canConfigure}
                title={!canConfigure ? 'View members cannot configure LLM settings' : ''}
              >
                {testingGemini ? 'Testing...' : 'Test Gemini Connection'}
              </button>
              {(geminiSettings.apiKey.trim() || geminiSettings.connectionStatus === 'connected') && (
                <button
                  className="llm-disconnect-button"
                  onClick={() => handleDisconnect('gemini')}
                >
                  Disconnect
                </button>
              )}
              {geminiSettings.connectionStatus === 'connected' && (
                <span className="llm-connection-status connected">● Connected</span>
              )}
              {geminiSettings.connectionStatus === 'failed' && (
                <span className="llm-connection-status failed">● Connection Failed</span>
              )}
            </div>
          </div>

          {/* Anthropic Section */}
          <div className="llm-provider-section">
            <div className="connection-header llm-provider-header">
              <div className="connection-icon-wrapper anthropic">
                <img
                  src="/images/claude.png"
                  alt="Anthropic"
                  className="connection-icon llm-provider-icon"
                />
              </div>
              <div className="connection-info">
                <h3>Anthropic (Claude)</h3>
                <p>Configure Claude models and API key</p>
              </div>
            </div>

            <div className="llm-api-key-group">
              <label className="llm-api-key-label">Anthropic API Key</label>
              <div className="llm-api-key-input-wrapper">
                <input
                  type={showAnthropicKey ? 'text' : 'password'}
                  className="llm-api-key-input"
                  value={anthropicSettings.apiKey}
                  onChange={(e) => setAnthropicSettings((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="sk-ant-..."
                />
                <button
                  type="button"
                  className="llm-api-key-toggle"
                  onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                  aria-label={showAnthropicKey ? 'Hide key' : 'Show key'}
                >
                  {showAnthropicKey ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
            </div>

            <div className="llm-model-selection">
              <h5 className="llm-model-selection-title">Model Selection</h5>
              <div className="llm-model-options">
                <label className="llm-model-option">
                  <input
                    type="radio"
                    name="anthropic-model"
                    value="full"
                    checked={anthropicSettings.modelType === 'full'}
                    onChange={() => setAnthropicSettings((prev) => ({ ...prev, modelType: 'full' }))}
                  />
                  <span>Claude Sonnet (Full)</span>
                </label>
                <label className="llm-model-option">
                  <input
                    type="radio"
                    name="anthropic-model"
                    value="light"
                    checked={anthropicSettings.modelType === 'light'}
                    onChange={() => setAnthropicSettings((prev) => ({ ...prev, modelType: 'light' }))}
                  />
                  <span>Claude Haiku (Light)</span>
                </label>
                <label className="llm-model-option">
                  <input
                    type="radio"
                    name="anthropic-model"
                    value="custom"
                    checked={anthropicSettings.modelType === 'custom'}
                    onChange={() => setAnthropicSettings((prev) => ({ ...prev, modelType: 'custom' }))}
                  />
                  <span>Custom Model</span>
                </label>
              </div>

              {anthropicSettings.modelType === 'custom' && (
                <div className="llm-custom-model-input">
                  <label>Custom Model Name</label>
                  <input
                    type="text"
                    value={anthropicSettings.customModelName}
                    onChange={(e) => setAnthropicSettings((prev) => ({ ...prev, customModelName: e.target.value }))}
                    placeholder="e.g., claude-sonnet-4-6"
                  />
                </div>
              )}
            </div>

            <div className="llm-provider-actions">
              <button
                className="llm-test-button"
                onClick={() => handleTestConnection('anthropic')}
                disabled={testingAnthropic || !isAuthenticated || !anthropicSettings.apiKey.trim() || !canConfigure}
                title={!canConfigure ? 'View members cannot configure LLM settings' : ''}
              >
                {testingAnthropic ? 'Testing...' : 'Test Anthropic Connection'}
              </button>
              {(anthropicSettings.apiKey.trim() || anthropicSettings.connectionStatus === 'connected') && (
                <button className="llm-disconnect-button" onClick={() => handleDisconnect('anthropic')}>
                  Disconnect
                </button>
              )}
              {anthropicSettings.connectionStatus === 'connected' && (
                <span className="llm-connection-status connected">● Connected</span>
              )}
              {anthropicSettings.connectionStatus === 'failed' && (
                <span className="llm-connection-status failed">● Connection Failed</span>
              )}
            </div>
          </div>

          <p style={{ fontSize: '13px', color: '#aaa', marginBottom: '12px' }}>
            <strong>Your API keys:</strong> If you save at least one key below, the app uses <strong>only</strong> your chosen <em>Active provider</em> — server environment keys are not mixed in.
          </p>

          {/* Active Provider Selection */}
          <div className="llm-active-provider-section">
            <h5 className="llm-active-provider-title">Active provider (for your saved keys)</h5>
            <div className="llm-active-provider-options">
              <label className="llm-active-provider-option">
                <input
                  type="radio"
                  name="active-provider"
                  value="openai"
                  checked={selectedProvider === 'openai'}
                  onChange={() => setSelectedProvider('openai')}
                />
                <span>OpenAI</span>
              </label>
              <label className="llm-active-provider-option">
                <input
                  type="radio"
                  name="active-provider"
                  value="gemini"
                  checked={selectedProvider === 'gemini'}
                  onChange={() => setSelectedProvider('gemini')}
                />
                <span>Gemini</span>
              </label>
              <label className="llm-active-provider-option">
                <input
                  type="radio"
                  name="active-provider"
                  value="anthropic"
                  checked={selectedProvider === 'anthropic'}
                  onChange={() => setSelectedProvider('anthropic')}
                />
                <span>Anthropic</span>
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button
              className="llm-config-save-button"
              onClick={handleSave}
              disabled={saving || !canConfigure}
              title={!canConfigure ? 'View members cannot save LLM settings' : ''}
            >
              {saving ? 'Saving...' : 'Save LLM Settings'}
            </button>
            {!canConfigure && (
              <span style={{ fontSize: '12px', color: '#999', alignSelf: 'center' }}>
                View Only - No Configuration Access
              </span>
            )}
          </div>
            </div>
            <div className="resize-handle" onMouseDown={handleResizeStart}></div>
          </div>
        </div>
      )}
    </>
  )
}

export default LLMConfig
