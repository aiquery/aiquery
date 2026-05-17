import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import axios from 'axios'
import { useDraggableResizable } from '../hooks/useDraggableResizable'
import './UsageModal.css'

interface UsageModalProps {
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

const UsageModal: React.FC<UsageModalProps> = ({ onClose, inline = false }) => {
  const { token } = useAuth()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [payments, setPayments] = useState<any[]>([])
  const [usage, setUsage] = useState<any>(null)
  const [limits, setLimits] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [alerts, setAlerts] = useState<string[]>([])
  
  const { modalRef, position, modalSize, isDragging, handleMouseDown, handleResizeStart } = useDraggableResizable({
    initialWidth: 900,
    initialHeight: 700,
    minWidth: 600,
    minHeight: 500,
    storageKey: 'usageModal'
  })

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    checkAlerts()
  }, [usage, subscription, limits])

  const loadData = async () => {
    try {
      const [subResponse, paymentsResponse, usageResponse] = await Promise.all([
        axios.get('/api/subscription', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        axios.get('/api/payments', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        axios.get('/api/subscription/usage', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ])

      if (subResponse.data.success) {
        setSubscription(subResponse.data.subscription)
        setLimits(subResponse.data.limits)
      }

      if (paymentsResponse.data.success) {
        setPayments(paymentsResponse.data.payments)
      }

      if (usageResponse.data.success) {
        setUsage(usageResponse.data)
      }
    } catch (error) {
      console.error('Error loading usage data:', error)
    } finally {
      setLoading(false)
    }
  }

  const checkAlerts = () => {
    const newAlerts: string[] = []

    // Check query usage alerts
    if (usage?.queryLimit && limits?.maxQueriesPerMonth && limits.maxQueriesPerMonth > 0) {
      const current = usage.queryLimit.current || 0
      const limit = usage.queryLimit.limit
      const percentage = (current / limit) * 100

      if (percentage >= 100) {
        newAlerts.push(`⚠️ You have reached 100% of your monthly query limit (${current}/${limit}). Please upgrade your plan to continue.`)
      } else if (percentage >= 90) {
        newAlerts.push(`⚠️ You have used 90% of your monthly query limit (${current}/${limit}). Consider upgrading your plan.`)
      } else if (percentage >= 75) {
        newAlerts.push(`⚠️ You have used 75% of your monthly query limit (${current}/${limit}).`)
      }
    }

    // Check payment due date alerts
    if (subscription && subscription.status === 'active') {
      const periodEnd = new Date(subscription.currentPeriodEnd)
      const now = new Date()
      const daysUntilDue = Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

      if (subscription.planType === 'monthly') {
        // Alert 1 week (7 days) before due date for monthly plans
        if (daysUntilDue <= 7 && daysUntilDue > 0) {
          newAlerts.push(`💳 Your monthly subscription will renew in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}. Please ensure your payment method is up to date.`)
        } else if (daysUntilDue <= 0) {
          newAlerts.push(`⚠️ Your monthly subscription payment is due. Please update your payment method.`)
        }
      } else if (subscription.planType === 'annual') {
        // Alert 1 month (30 days) before due date for annual plans
        if (daysUntilDue <= 30 && daysUntilDue > 0) {
          newAlerts.push(`💳 Your annual subscription will renew in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}. Please ensure your payment method is up to date.`)
        } else if (daysUntilDue <= 0) {
          newAlerts.push(`⚠️ Your annual subscription payment is due. Please update your payment method.`)
        }
      }
    }

    setAlerts(newAlerts)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
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

  if (loading) {
    if (inline) {
      return (
        <div className="usage-panel">
          <div className="usage-panel-header">
            <h2>Usage & Payment History</h2>
          </div>
          <div className="usage-modal-content">
            <div className="loading">Loading...</div>
          </div>
        </div>
      )
    }

    return (
      <div className="usage-modal-overlay" onClick={onClose}>
        <div 
          ref={modalRef}
          className="usage-modal draggable-modal"
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
            className="usage-modal-header"
            onMouseDown={handleMouseDown}
            style={{ cursor: 'grab' }}
          >
            <h2>Usage & Payment History</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
          <div className="usage-modal-content">
            <div className="loading">Loading...</div>
          </div>
          <div className="resize-handle" onMouseDown={handleResizeStart}></div>
        </div>
      </div>
    )
  }

  const modalContent = (
    <div className="usage-modal-content">
          {/* Alerts Section */}
          {alerts.length > 0 && (
            <div className="alerts-section">
              <h3>⚠️ Important Alerts</h3>
              {alerts.map((alert, index) => (
                <div key={index} className="alert-item">
                  {alert}
                </div>
              ))}
            </div>
          )}

          {/* Usage Statistics Section */}
          <div className="usage-statistics-section">
            <h3>Usage Statistics</h3>
            {usage ? (
              <div className="usage-stats-grid">
                <div className="usage-stat-card">
                  <div className="usage-stat-label">This Month</div>
                  <div className="usage-stat-value">{usage.usage?.currentMonth || 0}</div>
                  <div className="usage-stat-unit">queries</div>
                  {usage.queryLimit && usage.queryLimit.limit > 0 && (
                    <div className="usage-stat-progress">
                      <div className="progress-bar">
                        <div 
                          className="progress-fill"
                          style={{ 
                            width: `${Math.min(100, ((usage.queryLimit.current || 0) / usage.queryLimit.limit) * 100)}%`,
                            backgroundColor: 
                              (usage.queryLimit.current || 0) >= usage.queryLimit.limit ? '#e74c3c' :
                              ((usage.queryLimit.current || 0) / usage.queryLimit.limit) >= 0.9 ? '#f39c12' :
                              ((usage.queryLimit.current || 0) / usage.queryLimit.limit) >= 0.75 ? '#f1c40f' : '#28a745'
                          }}
                        ></div>
                      </div>
                      <div className="progress-text">
                        {usage.queryLimit.current || 0} / {usage.queryLimit.limit}
                        {usage.queryLimit.remaining >= 0 && (
                          <span className="remaining-text"> ({usage.queryLimit.remaining} remaining)</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="usage-stat-card">
                  <div className="usage-stat-label">Last Month</div>
                  <div className="usage-stat-value">{usage.usage?.lastMonth || 0}</div>
                  <div className="usage-stat-unit">queries</div>
                </div>
                <div className="usage-stat-card">
                  <div className="usage-stat-label">Total</div>
                  <div className="usage-stat-value">{usage.usage?.total || 0}</div>
                  <div className="usage-stat-unit">queries</div>
                </div>
              </div>
            ) : (
              <p className="no-usage-data">No usage data available</p>
            )}
          </div>

          {/* Payment History Section */}
          <div className="payment-history-section">
            <h3>Payment History</h3>
            {payments.length === 0 ? (
              <p className="no-payments">No payment history available</p>
            ) : (
              <div className="payments-table">
                <table>
                  <thead>
                    <tr>
                      <th>Datetime</th>
                      <th>Item</th>
                      <th>Plan</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>{formatDateTime(payment.createdAt)}</td>
                        <td>{payment.itemType === 'add_users' ? 'Additional Users' : 'Plan'}</td>
                        <td>{getPlanDisplayName(payment.planName)} ({payment.planType})</td>
                        <td>{formatCurrency(payment.amount)}</td>
                        <td>
                          <span className={`payment-status ${payment.status}`}>
                            {payment.status}
                          </span>
                        </td>
                        <td>
                          {payment.billingPeriodStart && payment.billingPeriodEnd
                            ? `${formatDate(payment.billingPeriodStart)} - ${formatDate(payment.billingPeriodEnd)}`
                            : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
    </div>
  )

  if (inline) {
    return (
      <div className="usage-panel">
        <div className="usage-panel-header">
          <h2>Usage & Payment History</h2>
        </div>
        {modalContent}
      </div>
    )
  }

  return (
    <div className="usage-modal-overlay" onClick={onClose}>
      <div 
        ref={modalRef}
        className="usage-modal draggable-modal"
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
          className="usage-modal-header"
          onMouseDown={handleMouseDown}
          style={{ cursor: 'grab' }}
        >
          <h2>Usage & Payment History</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {modalContent}
        <div className="resize-handle" onMouseDown={handleResizeStart}></div>
      </div>
    </div>
  )
}

export default UsageModal
