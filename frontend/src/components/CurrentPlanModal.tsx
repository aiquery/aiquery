import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import axios from 'axios'
import { useDraggableResizable } from '../hooks/useDraggableResizable'
import './CurrentPlanModal.css'

interface CurrentPlanModalProps {
  onClose: () => void
  inline?: boolean
}

interface Subscription {
  id: number
  planName: string
  planType: string
  status: string
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
}

interface PlanLimits {
  maxUsers: number
  maxWorkspaces: number
  maxQueriesPerMonth: number
  maxTablesPerDataSource: number
  hasDataSourceCustomization: boolean
  hasBusinessCustomization: boolean
  hasAccountPermissions: boolean
  supportLevel: string
}

const CurrentPlanModal: React.FC<CurrentPlanModalProps> = ({ onClose, inline = false }) => {
  const { token } = useAuth()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [limits, setLimits] = useState<PlanLimits | null>(null)
  const [loading, setLoading] = useState(true)
  
  const { modalRef, position, modalSize, isDragging, handleMouseDown, handleResizeStart } = useDraggableResizable({
    initialWidth: 700,
    initialHeight: 600,
    minWidth: 500,
    minHeight: 400,
    storageKey: 'currentPlanModal'
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const subResponse = await axios.get('/api/subscription', {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (subResponse.data.success) {
        setSubscription(subResponse.data.subscription)
        setLimits(subResponse.data.limits)
      }
    } catch (error) {
      console.error('Error loading subscription data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel your subscription? It will remain active until the end of the current billing period.')) {
      return
    }

    try {
      const response = await axios.post('/api/subscription/cancel', {
        cancelAtPeriodEnd: true
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.data.success) {
        alert('Subscription will be canceled at the end of the current period.')
        loadData()
      }
    } catch (error: any) {
      console.error('Error canceling subscription:', error)
      alert(error.response?.data?.error || 'Failed to cancel subscription')
    }
  }

  const handleReactivate = async () => {
    try {
      const response = await axios.post('/api/subscription/reactivate', {}, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.data.success) {
        alert('Subscription reactivated. It will continue to renew at the end of each period.')
        loadData()
      }
    } catch (error: any) {
      console.error('Error reactivating subscription:', error)
      alert(error.response?.data?.error || 'Failed to reactivate subscription')
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  const getPlanDisplayName = (planName: string) => {
    const names: Record<string, string> = {
      free: 'Free Try',
      startpro: 'StartPro',
      smartpro: 'SmartPro',
      enterprise: 'Enterprise'
    }
    return names[planName] || planName
  }

  const getPlanIcon = (planName: string) => {
    const icons: Record<string, string> = {
      free: '🆓',
      startpro: '🚀',
      smartpro: '⭐',
      enterprise: '🏢'
    }
    return icons[planName] || '💳'
  }

  if (loading) {
    if (inline) {
      return (
        <div className="current-plan-panel">
          <div className="current-plan-panel-header">
            <h2>Current Plan</h2>
          </div>
          <div className="current-plan-modal-content">
            <div className="loading">Loading...</div>
          </div>
        </div>
      )
    }

    return (
      <div className="current-plan-modal-overlay" onClick={onClose}>
        <div 
          ref={modalRef}
          className="current-plan-modal draggable-modal"
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
            className="current-plan-modal-header"
            onMouseDown={handleMouseDown}
            style={{ cursor: 'grab' }}
          >
            <h2>Current Plan</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
          <div className="current-plan-modal-content">
            <div className="loading">Loading...</div>
          </div>
          <div className="resize-handle" onMouseDown={handleResizeStart}></div>
        </div>
      </div>
    )
  }

  const currentPlan = subscription ? {
    name: getPlanDisplayName(subscription.planName),
    icon: getPlanIcon(subscription.planName)
  } : {
    name: 'Free Try',
    icon: '🆓'
  }

  const modalContent = (
    <div className="current-plan-modal-content">
      {/* Current Plan Section */}
      <div className="current-plan-section">
        <h3>Current Plan</h3>
        {subscription ? (
          <div className="current-plan-card">
            <div className="plan-icon-large">{currentPlan.icon}</div>
            <div className="plan-info">
              <h4>{currentPlan.name}</h4>
              <p className="plan-type">{subscription.planType === 'annual' ? 'Annual' : 'Monthly'} Plan</p>
              <p className="plan-status">Status: <span className={`status-badge ${subscription.status}`}>{subscription.status}</span></p>
              <p className="plan-period">
                Current Period: {formatDate(subscription.currentPeriodStart)} - {formatDate(subscription.currentPeriodEnd)}
              </p>
              {subscription.cancelAtPeriodEnd && (
                <p className="cancel-notice">⚠️ Subscription will cancel at period end</p>
              )}
            </div>
            {subscription.status === 'active' && subscription.cancelAtPeriodEnd && (
              <button className="reactivate-button" onClick={handleReactivate}>
                Keep subscription active
              </button>
            )}
            {subscription.status === 'active' && !subscription.cancelAtPeriodEnd && (
              <button className="cancel-button" onClick={handleCancel}>
                Cancel Subscription
              </button>
            )}
          </div>
        ) : (
          <div className="current-plan-card">
            <div className="plan-icon-large">🆓</div>
            <div className="plan-info">
              <h4>Free Try</h4>
              <p className="plan-type">Free Plan</p>
              <p className="plan-status">Status: <span className="status-badge active">Active</span></p>
            </div>
          </div>
        )}

        {/* Current Limits */}
        {limits && (
          <div className="limits-section">
            <h4>Current Plan Limits</h4>
            <div className="limits-grid">
              <div className="limit-item">
                <span className="limit-label">Users:</span>
                <span className="limit-value">{limits.maxUsers === -1 ? 'Unlimited' : limits.maxUsers}</span>
              </div>
              <div className="limit-item">
                <span className="limit-label">Workspaces:</span>
                <span className="limit-value">{limits.maxWorkspaces === -1 ? 'Unlimited' : limits.maxWorkspaces}</span>
              </div>
              <div className="limit-item">
                <span className="limit-label">Queries/Month:</span>
                <span className="limit-value">
                  {limits.maxQueriesPerMonth === -1 ? 'Unlimited' : limits.maxQueriesPerMonth}
                </span>
              </div>
              <div className="limit-item">
                <span className="limit-label">Tables/DataSource:</span>
                <span className="limit-value">{limits.maxTablesPerDataSource === -1 ? 'Unlimited' : limits.maxTablesPerDataSource}</span>
              </div>
              <div className="limit-item">
                <span className="limit-label">Support:</span>
                <span className="limit-value">{limits.supportLevel}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  if (inline) {
    return (
      <div className="current-plan-panel">
        <div className="current-plan-panel-header">
          <h2>Current Plan</h2>
        </div>
        {modalContent}
      </div>
    )
  }

  return (
    <div className="current-plan-modal-overlay" onClick={onClose}>
      <div 
        ref={modalRef}
        className="current-plan-modal draggable-modal"
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
          className="current-plan-modal-header"
          onMouseDown={handleMouseDown}
          style={{ cursor: 'grab' }}
        >
          <h2>Current Plan</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {modalContent}
        <div className="resize-handle" onMouseDown={handleResizeStart}></div>
      </div>
    </div>
  )
}

export default CurrentPlanModal
