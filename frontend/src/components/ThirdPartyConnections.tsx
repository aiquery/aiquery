import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { useDraggableResizable } from '../hooks/useDraggableResizable'
import axios from 'axios'
import './ThirdPartyConnections.css'

interface ThirdPartyConnectionsProps {
  onClose?: () => void
  inline?: boolean
  isOpen?: boolean
}

const ThirdPartyConnections: React.FC<ThirdPartyConnectionsProps> = ({ onClose, inline = false, isOpen }) => {
  const { isAuthenticated } = useAuth()
  const { canConfigure } = usePermissions()
  const [showModal, setShowModal] = useState(false)
  const [slackApiToken, setSlackApiToken] = useState('')
  const [slackVerificationToken, setSlackVerificationToken] = useState('')
  const [slackSigningSecret, setSlackSigningSecret] = useState('')
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState('')
  const [teamsAppId, setTeamsAppId] = useState('')
  const [teamsClientSecret, setTeamsClientSecret] = useState('')
  const [teamsBotTokenEndpoint, setTeamsBotTokenEndpoint] = useState('')
  const [teamsTenantId, setTeamsTenantId] = useState('')
  const [slackConnected, setSlackConnected] = useState(false)
  const [teamsConnected, setTeamsConnected] = useState(false)
  const [showTeamsClientSecret, setShowTeamsClientSecret] = useState(false)
  const [slackSaving, setSlackSaving] = useState(false)
  const [slackCleaning, setSlackCleaning] = useState(false)
  const [slackCleanupDays, setSlackCleanupDays] = useState('3')
  const [teamsSaving, setTeamsSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [showApiToken, setShowApiToken] = useState(false)
  const [showVerificationToken, setShowVerificationToken] = useState(false)
  const [showSigningSecret, setShowSigningSecret] = useState(false)
  
  const { modalRef, position, modalSize, isDragging, handleMouseDown, handleResizeStart } = useDraggableResizable({
    initialWidth: 700,
    initialHeight: 600,
    minWidth: 500,
    minHeight: 400,
    storageKey: 'thirdPartyConnectionsModal'
  })

  // Load connection status on mount and when authentication changes
  useEffect(() => {
    if (isAuthenticated) {
      loadConnectionStatus()
    } else {
      setLoadingStatus(false)
    }
  }, [isAuthenticated])

  const panelOpen = inline ? (isOpen ?? true) : showModal

  // Load config when modal opens
  useEffect(() => {
    if (isAuthenticated && panelOpen) {
      loadSlackConfig()
      loadTeamsConfig()
    }
  }, [isAuthenticated, panelOpen])

  const loadConnectionStatus = async () => {
    if (!isAuthenticated) return
    
    setLoadingStatus(true)
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
      
      if (slackResponse.data.success && slackResponse.data.config) {
        const config = slackResponse.data.config
        setSlackConnected(!!(config.apiToken && config.signingSecret))
      } else {
        setSlackConnected(false)
      }
      
      if (teamsResponse.data.success && teamsResponse.data.config) {
        const config = teamsResponse.data.config
        setTeamsConnected(!!(config.appId && config.clientSecret))
      } else {
        setTeamsConnected(false)
      }
    } catch (error) {
      console.error('Error loading connection status:', error)
      setSlackConnected(false)
      setTeamsConnected(false)
    } finally {
      setLoadingStatus(false)
    }
  }

  const loadSlackConfig = async () => {
    if (!isAuthenticated) return
    
    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.get('/api/third-party/slack', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (response.data.success && response.data.config) {
        const config = response.data.config
        setSlackApiToken(config.apiToken || '')
        setSlackVerificationToken(config.verificationToken || '')
        setSlackSigningSecret(config.signingSecret || '')
        setSlackConnected(!!(config.apiToken && config.signingSecret))
      } else {
        setSlackApiToken('')
        setSlackVerificationToken('')
        setSlackSigningSecret('')
        setSlackConnected(false)
      }
    } catch (error) {
      console.error('Error loading Slack config:', error)
      setSlackConnected(false)
    }
  }

  const handleSlackSave = async () => {
    if (!isAuthenticated) {
      alert('Please log in to configure third-party connections')
      return
    }

    if (!slackApiToken.trim() || !slackSigningSecret.trim()) {
      alert('Please fill in Slack API Token and Signing Secret')
      return
    }

    setSlackSaving(true)
    try {
      const token = localStorage.getItem('aiquery_token')
      await axios.post('/api/third-party/slack', {
        apiToken: slackApiToken.trim(),
        verificationToken: slackVerificationToken.trim(),
        signingSecret: slackSigningSecret.trim()
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      setSlackConnected(true)
      await loadSlackConfig()
      await loadConnectionStatus()
      alert('Slack configuration saved successfully.')
    } catch (error: any) {
      console.error('Error saving Slack config:', error)
      alert(error.response?.data?.error || 'Failed to save Slack configuration')
    } finally {
      setSlackSaving(false)
    }
  }

  const handleSlackReset = async () => {
    if (!canConfigure) return
    await loadSlackConfig()
    await loadConnectionStatus()
  }

  const handleSlackCleanupOldFiles = async () => {
    if (!isAuthenticated || !canConfigure) return
    const days = parseInt(slackCleanupDays, 10)
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      alert('Please enter a valid day value between 1 and 365.')
      return
    }

    if (!confirm(`Delete old uploaded data files from Slack (older than ${days} day${days > 1 ? 's' : ''})?`)) {
      return
    }

    setSlackCleaning(true)
    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.post('/api/third-party/slack/cleanup-files', {
        olderThanDays: days
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.data?.success) {
        const found = response.data.foundCount ?? 0
        const deleted = response.data.deletedCount ?? 0
        const failed = response.data.failedCount ?? 0
        alert(`Slack cleanup completed (older than ${days} day${days > 1 ? 's' : ''}).\nFound: ${found}\nDeleted: ${deleted}\nFailed: ${failed}`)
      } else {
        alert(response.data?.error || 'Slack cleanup failed')
      }
    } catch (error: any) {
      console.error('Error cleaning old Slack files:', error)
      alert(error.response?.data?.error || 'Failed to clean old Slack files')
    } finally {
      setSlackCleaning(false)
    }
  }

  const loadTeamsConfig = async () => {
    if (!isAuthenticated) return
    
    try {
      const token = localStorage.getItem('aiquery_token')
      const response = await axios.get('/api/third-party/teams', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (response.data.success && response.data.config) {
        const config = response.data.config
        setTeamsAppId(config.appId || '')
        setTeamsClientSecret(config.clientSecret || '')
        setTeamsBotTokenEndpoint(config.botTokenEndpoint || '')
        setTeamsWebhookUrl(config.webhookUrl || '')
        setTeamsTenantId(config.tenantId || '')
        setTeamsConnected(!!(config.appId && config.clientSecret))
      } else {
        setTeamsAppId('')
        setTeamsClientSecret('')
        setTeamsBotTokenEndpoint('')
        setTeamsWebhookUrl('')
        setTeamsTenantId('')
        setTeamsConnected(false)
      }
    } catch (error) {
      console.error('Error loading Teams config:', error)
      setTeamsConnected(false)
    }
  }

  const handleTeamsSave = async () => {
    if (!isAuthenticated) {
      alert('Please log in to configure third-party connections')
      return
    }

    if (!teamsAppId.trim() || !teamsClientSecret.trim()) {
      alert('Please fill in Microsoft App ID and Client Secret')
      return
    }

    setTeamsSaving(true)
    try {
      const token = localStorage.getItem('aiquery_token')
      await axios.post('/api/third-party/teams', {
        appId: teamsAppId.trim(),
        clientSecret: teamsClientSecret.trim(),
        botTokenEndpoint: teamsBotTokenEndpoint.trim() || undefined,
        webhookUrl: teamsWebhookUrl.trim() || undefined,
        tenantId: teamsTenantId.trim() || undefined
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      setTeamsConnected(true)
      await loadTeamsConfig()
      await loadConnectionStatus()
      alert('Teams configuration saved successfully.')
    } catch (error: any) {
      console.error('Error saving Teams config:', error)
      alert(error.response?.data?.error || 'Failed to save Teams configuration')
    } finally {
      setTeamsSaving(false)
    }
  }

  const handleTeamsReset = async () => {
    if (!canConfigure) return
    await loadTeamsConfig()
    await loadConnectionStatus()
  }

  const handleTestConnection = async (service: 'slack' | 'teams') => {
    if (service === 'slack') {
      if (!isAuthenticated) {
        alert('Please log in to test connections')
        return
      }

      // Validate that all required fields are filled
      if (!slackApiToken.trim()) {
        alert('Please enter a Slack API Token')
        return
      }

      setTesting(true)
      try {
        const token = localStorage.getItem('aiquery_token')
        // Send API token in request body so it can be tested before saving
        const response = await axios.post('/api/third-party/slack/test', {
          apiToken: slackApiToken.trim()
        }, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })

        if (response.data.success) {
          alert(`Connection test successful! Connected to team: ${response.data.botInfo?.team || 'Unknown'}`)
        } else {
          alert(`Connection test failed: ${response.data.error || 'Unknown error'}`)
        }
      } catch (error: any) {
        console.error('Error testing Slack connection:', error)
        alert(`Connection test failed: ${error.response?.data?.error || error.message || 'Unknown error'}`)
      } finally {
        setTesting(false)
      }
    } else if (service === 'teams') {
      if (!isAuthenticated) {
        alert('Please log in to test connections')
        return
      }

      // Validate that required fields are filled
      if (!teamsAppId.trim() || !teamsClientSecret.trim()) {
        alert('Please enter Microsoft App ID and Client Secret')
        return
      }

      setTesting(true)
      try {
        const token = localStorage.getItem('aiquery_token')
        // Send credentials in request body so it can be tested before saving
        const response = await axios.post('/api/third-party/teams/test', {
          appId: teamsAppId.trim(),
          clientSecret: teamsClientSecret.trim()
        }, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })

        if (response.data.success) {
          alert(`Connection test successful! Connected to Teams app: ${response.data.appInfo?.name || 'Unknown'}`)
        } else {
          alert(`Connection test failed: ${response.data.error || 'Unknown error'}`)
        }
      } catch (error: any) {
        console.error('Error testing Teams connection:', error)
        alert(`Connection test failed: ${error.response?.data?.error || error.message || 'Unknown error'}`)
      } finally {
        setTesting(false)
      }
    }
  }

  const handleDisconnect = async (service: 'slack' | 'teams') => {
    if (service === 'slack') {
      if (!isAuthenticated) {
        alert('Please log in to disconnect connections')
        return
      }

      if (!confirm('Are you sure you want to disconnect Slack? This will remove all Slack configuration.')) {
        return
      }

      try {
        const token = localStorage.getItem('aiquery_token')
        await axios.delete('/api/third-party/slack', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })
        setSlackConnected(false)
        setSlackApiToken('')
        setSlackVerificationToken('')
        setSlackSigningSecret('')
        await loadConnectionStatus() // Reload status
        alert('Slack connection disconnected successfully!')
      } catch (error: any) {
        console.error('Error disconnecting Slack:', error)
        alert(error.response?.data?.error || 'Failed to disconnect Slack')
      }
    } else if (service === 'teams') {
      if (!isAuthenticated) {
        alert('Please log in to disconnect connections')
        return
      }

      if (!confirm('Are you sure you want to disconnect Teams? This will remove all Teams configuration.')) {
        return
      }

      try {
        const token = localStorage.getItem('aiquery_token')
        await axios.delete('/api/third-party/teams', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })
        setTeamsConnected(false)
        setTeamsAppId('')
        setTeamsClientSecret('')
        setTeamsBotTokenEndpoint('')
        setTeamsWebhookUrl('')
        setTeamsTenantId('')
        await loadConnectionStatus() // Reload status
        alert('Teams connection disconnected successfully!')
      } catch (error: any) {
        console.error('Error disconnecting Teams:', error)
        alert(error.response?.data?.error || 'Failed to disconnect Teams')
      }
    }
  }

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
          className="third-party-connections-button"
          onClick={() => setShowModal(true)}
          title="Configure Community Channels"
        >
          <span className="connections-icon">
            <img src="/images/channel_logo.png" alt="" aria-hidden="true" />
          </span>
          <span className="connections-text">Community Channels</span>
          {!loadingStatus && (slackConnected || teamsConnected) && (
            <span className="connection-status connected" style={{ marginLeft: '10px' }}>● Connected</span>
          )}
          {!loadingStatus && !slackConnected && !teamsConnected && (
            <span className="connection-status not-connected" style={{ marginLeft: '10px' }}>Not Connected</span>
          )}
        </button>
      )}

      {panelOpen && (
        <div className={inline ? 'third-party-panel' : 'third-party-modal-overlay'} onClick={inline ? undefined : handleClose}>
          <div 
            ref={modalRef}
            className={`third-party-modal-content draggable-modal ${inline ? 'inline' : ''}`}
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
              className="third-party-modal-header"
              onMouseDown={handleMouseDown}
              style={{ cursor: inline ? 'default' : 'grab' }}
            >
              <h2>Community Channels</h2>
              <button 
                className="third-party-modal-close"
                onClick={handleClose}
              >
                ×
              </button>
            </div>

            <div className="third-party-connections-list">
              {/* Slack Connection */}
              <div className="connection-item">
                <div className="connection-header">
                  <div className="connection-icon-wrapper slack">
                    <svg className="connection-icon" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 5.042a2.528 2.528 0 0 1-2.52-2.52A2.528 2.528 0 0 1 18.956 0a2.528 2.528 0 0 1 2.522 2.522v2.52h-2.522zM18.956 6.313a2.528 2.528 0 0 1 2.522 2.521 2.528 2.528 0 0 1-2.522 2.521h-6.313A2.528 2.528 0 0 1 10.121 8.834a2.528 2.528 0 0 1 2.522-2.521h6.313zM15.165 18.956a2.528 2.528 0 0 1 2.521 2.522A2.528 2.528 0 0 1 15.165 24a2.528 2.528 0 0 1-2.52-2.522v-2.522h2.52zM13.895 18.956a2.528 2.528 0 0 1-2.521-2.522 2.528 2.528 0 0 1 2.521-2.52h6.313A2.528 2.528 0 0 1 22.688 16.434a2.528 2.528 0 0 1-2.522 2.522h-6.271z"/>
                    </svg>
                  </div>
                  <div className="connection-info">
                    <h3>Slack</h3>
                    <p>Query your data sources using natural language in Slack channels</p>
                  </div>
                  {slackConnected ? (
                    <span className="connection-status connected">● Connected</span>
                  ) : (
                    <span className="connection-status">Not Connected</span>
                  )}
                </div>
                <div className="connection-form">
                  <div className="connection-form-group">
                    <label className="connection-label">Slack API Token</label>
                    <div className="connection-input-wrapper">
                      <input
                        type={showApiToken ? 'text' : 'password'}
                        placeholder="xoxb-your-slack-api-token"
                        value={slackApiToken}
                        onChange={(e) => setSlackApiToken(e.target.value)}
                        className="connection-input"
                      />
                      <button
                        type="button"
                        className="connection-input-toggle"
                        onClick={() => setShowApiToken(!showApiToken)}
                        aria-label={showApiToken ? 'Hide token' : 'Show token'}
                      >
                        {showApiToken ? '👁️' : '👁️‍🗨️'}
                      </button>
                    </div>
                  </div>
                  <div className="connection-form-group">
                    <label className="connection-label">Verification Token</label>
                    <div className="connection-input-wrapper">
                      <input
                        type={showVerificationToken ? 'text' : 'password'}
                        placeholder="Your Slack verification token"
                        value={slackVerificationToken}
                        onChange={(e) => setSlackVerificationToken(e.target.value)}
                        className="connection-input"
                      />
                      <button
                        type="button"
                        className="connection-input-toggle"
                        onClick={() => setShowVerificationToken(!showVerificationToken)}
                        aria-label={showVerificationToken ? 'Hide token' : 'Show token'}
                      >
                        {showVerificationToken ? '👁️' : '👁️‍🗨️'}
                      </button>
                    </div>
                  </div>
                  <div className="connection-form-group">
                    <label className="connection-label">Signing Secret</label>
                    <div className="connection-input-wrapper">
                      <input
                        type={showSigningSecret ? 'text' : 'password'}
                        placeholder="Your Slack signing secret"
                        value={slackSigningSecret}
                        onChange={(e) => setSlackSigningSecret(e.target.value)}
                        className="connection-input"
                      />
                      <button
                        type="button"
                        className="connection-input-toggle"
                        onClick={() => setShowSigningSecret(!showSigningSecret)}
                        aria-label={showSigningSecret ? 'Hide secret' : 'Show secret'}
                      >
                        {showSigningSecret ? '👁️' : '👁️‍🗨️'}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {!canConfigure && (
                      <span style={{ fontSize: '12px', color: '#999', alignSelf: 'center' }}>
                        View Only - No Configuration Access
                      </span>
                    )}
                    {canConfigure && (
                      <>
                        <button
                          type="button"
                          className="connection-button save"
                          onClick={handleSlackSave}
                          disabled={slackSaving}
                        >
                          {slackSaving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="connection-button reset"
                          onClick={handleSlackReset}
                          disabled={slackSaving}
                        >
                          Reset
                        </button>
                        {slackApiToken && slackSigningSecret && (
                          <button
                            type="button"
                            className="connection-button test"
                            onClick={() => handleTestConnection('slack')}
                            disabled={testing || slackSaving}
                            style={{
                              backgroundColor: (testing || slackSaving) ? '#ccc' : '#667eea',
                              color: 'white'
                            }}
                          >
                            {testing ? 'Testing...' : 'Test Connection'}
                          </button>
                        )}
                        {slackConnected && (
                          <button
                            type="button"
                            className="connection-button disconnect"
                            onClick={() => handleDisconnect('slack')}
                          >
                            Disconnect
                          </button>
                        )}
                        {slackConnected && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <label style={{ fontSize: '12px', color: '#666' }}>Days:</label>
                            <input
                              type="number"
                              min={1}
                              max={365}
                              step={1}
                              value={slackCleanupDays}
                              onChange={(e) => setSlackCleanupDays(e.target.value)}
                              className="connection-input"
                              style={{ width: '90px', padding: '8px 10px' }}
                              disabled={slackCleaning || slackSaving || testing}
                              title="Delete files older than this many days"
                            />
                          </div>
                        )}
                        {slackConnected && (
                          <button
                            type="button"
                            className="connection-button"
                            onClick={handleSlackCleanupOldFiles}
                            disabled={slackCleaning || slackSaving || testing}
                            style={{
                              backgroundColor: (slackCleaning || slackSaving || testing) ? '#ccc' : '#b91c1c',
                              color: 'white'
                            }}
                          >
                            {slackCleaning ? 'Deleting Old Files...' : 'Delete Old Uploaded Files'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Teams Connection */}
              <div className="connection-item">
                <div className="connection-header">
                  <div className="connection-icon-wrapper teams">
                    <svg className="connection-icon" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.5 4.5h-15A1.5 1.5 0 0 0 3 6v12a1.5 1.5 0 0 0 1.5 1.5h15a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5zm-1.5 3.75v7.5h-12v-7.5h12zM6 6h12v1.5H6V6zm0 10.5v-1.5h12v1.5H6z"/>
                      <circle cx="9" cy="10.5" r="1.5"/>
                      <circle cx="15" cy="10.5" r="1.5"/>
                    </svg>
                  </div>
                  <div className="connection-info">
                    <h3>Microsoft Teams</h3>
                    <p>Send notifications and query results to Teams channels</p>
                  </div>
                  {teamsConnected ? (
                    <span className="connection-status connected">● Connected</span>
                  ) : (
                    <span className="connection-status">Not Connected</span>
                  )}
                </div>
                <div className="connection-form">
                  <div className="connection-form-group">
                    <label className="connection-label">Microsoft App ID</label>
                    <input
                      type="text"
                      placeholder="Enter Microsoft App ID"
                      value={teamsAppId}
                      onChange={(e) => setTeamsAppId(e.target.value)}
                      className="connection-input"
                      disabled={!canConfigure}
                    />
                  </div>
                  <div className="connection-form-group">
                    <label className="connection-label">Client Secret</label>
                    <div className="connection-input-wrapper">
                      <input
                        type={showTeamsClientSecret ? 'text' : 'password'}
                        placeholder="Enter Client Secret"
                        value={teamsClientSecret}
                        onChange={(e) => setTeamsClientSecret(e.target.value)}
                        className="connection-input"
                        disabled={!canConfigure}
                      />
                      {canConfigure && (
                        <button
                          type="button"
                          className="connection-input-toggle"
                          onClick={() => setShowTeamsClientSecret(!showTeamsClientSecret)}
                          aria-label={showTeamsClientSecret ? 'Hide secret' : 'Show secret'}
                        >
                          {showTeamsClientSecret ? '👁️' : '👁️‍🗨️'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="connection-form-group">
                    <label className="connection-label">Bot Token Endpoint</label>
                    <input
                      type="text"
                      placeholder="Enter Bot Token Endpoint"
                      value={teamsBotTokenEndpoint}
                      onChange={(e) => setTeamsBotTokenEndpoint(e.target.value)}
                      className="connection-input"
                      disabled={!canConfigure}
                    />
                  </div>
                  <div className="connection-form-group">
                    <label className="connection-label">Tenant ID <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#999' }}>(Optional)</span></label>
                    <input
                      type="text"
                      placeholder="Enter Azure Tenant ID (Optional)"
                      value={teamsTenantId}
                      onChange={(e) => setTeamsTenantId(e.target.value)}
                      className="connection-input"
                      disabled={!canConfigure}
                    />
                  </div>
                  <div className="connection-form-group">
                    <label className="connection-label">Webhook URL <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#999' }}>(Optional)</span></label>
                    <input
                      type="text"
                      placeholder="Enter Teams Webhook URL (Optional)"
                      value={teamsWebhookUrl}
                      onChange={(e) => setTeamsWebhookUrl(e.target.value)}
                      className="connection-input"
                      disabled={!canConfigure}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {!canConfigure && (
                      <span style={{ fontSize: '12px', color: '#999', alignSelf: 'center' }}>
                        View Only - No Configuration Access
                      </span>
                    )}
                    {canConfigure && (
                      <>
                        <button
                          type="button"
                          className="connection-button save"
                          onClick={handleTeamsSave}
                          disabled={teamsSaving}
                        >
                          {teamsSaving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="connection-button reset"
                          onClick={handleTeamsReset}
                          disabled={teamsSaving}
                        >
                          Reset
                        </button>
                        {teamsAppId && teamsClientSecret && (
                          <button
                            type="button"
                            className="connection-button test"
                            onClick={() => handleTestConnection('teams')}
                            disabled={testing || teamsSaving}
                            style={{
                              backgroundColor: (testing || teamsSaving) ? '#ccc' : '#667eea',
                              color: 'white'
                            }}
                          >
                            {testing ? 'Testing...' : 'Test Connection'}
                          </button>
                        )}
                        {teamsConnected && (
                          <button
                            type="button"
                            className="connection-button disconnect"
                            onClick={() => handleDisconnect('teams')}
                          >
                            Disconnect
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="resize-handle" onMouseDown={handleResizeStart}></div>
          </div>
        </div>
      )}
    </>
  )
}

export default ThirdPartyConnections

