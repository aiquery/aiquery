import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import axios from 'axios'
import './SubscriptionManagement.css'

interface SubscriptionManagementProps {
  onClose: () => void
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
  maxQueriesPerMonth: number
  maxTablesPerDataSource: number
  hasDataSourceCustomization: boolean
  hasBusinessCustomization: boolean
  hasAccountPermissions: boolean
  supportLevel: string
}

const SubscriptionManagement: React.FC<SubscriptionManagementProps> = ({ onClose }) => {
  const { token } = useAuth()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [limits, setLimits] = useState<PlanLimits | null>(null)
  const [payments, setPayments] = useState<any[]>([])
  const [usage, setUsage] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [selectedPlan, setSelectedPlan] = useState<{ name: string; type: string } | null>(null)
  const [isAnnual, setIsAnnual] = useState(false)

  useEffect(() => {
    loadSubscriptionData()
  }, [])

  const loadSubscriptionData = async () => {
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
      console.error('Error loading subscription data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleUpgrade = async (planName: string, planType: string) => {
    try {
      const response = await axios.post('/api/subscription', {
        planName,
        planType
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.data.success) {
        alert('Subscription updated successfully!')
        loadSubscriptionData()
      }
    } catch (error: any) {
      console.error('Error updating subscription:', error)
      alert(error.response?.data?.error || 'Failed to update subscription')
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
        loadSubscriptionData()
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
        loadSubscriptionData()
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

  const plans = [
    {
      name: 'free',
      displayName: 'Free Try',
      icon: '🆓',
      monthlyPrice: 0,
      annualPrice: 0,
      features: [
        'Up to 1 users',
        'Up to 200 queries/month',
        'Unlimited Slack/Teams connections',
        'Up to 2 tables per data source'
      ]
    },
    {
      name: 'startpro',
      displayName: 'StartPro',
      icon: '🚀',
      monthlyPrice: 40,
      annualPrice: 388,
      features: [
        'Up to 3 users',
        'Up to 300 queries/month',
        'Unlimited Slack/Teams connections',
        'Up to 5 tables per data source',
        'Data source customization',
        'Business customization',
        'Account permissions management',
        'Standard customer support'
      ]
    },
    {
      name: 'smartpro',
      displayName: 'SmartPro',
      icon: '⭐',
      monthlyPrice: 68,
      annualPrice: 668,
      features: [
        'Up to 6 users',
        'Up to 800 queries/month',
        'Unlimited Slack/Teams connections',
        'Up to 10 tables per data source',
        'Data source customization',
        'Business customization',
        'Account permissions management',
        'Priority customer support'
      ]
    },
    {
      name: 'enterprise',
      displayName: 'Enterprise',
      icon: '🏢',
      monthlyPrice: null,
      annualPrice: null,
      features: [
        'Custom number of users',
        'Custom number of queries',
        'Unlimited Slack/Teams connections',
        'Custom number of tables per data source',
        'Data source customization',
        'Business customization',
        'Account permissions management',
        'Dedicated customer support'
      ]
    }
  ]

  if (loading) {
    return (
      <div className="subscription-modal-overlay" onClick={onClose}>
        <div className="subscription-modal" onClick={(e) => e.stopPropagation()}>
          <div className="subscription-modal-header">
            <h2>Subscription & Billing</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
          <div className="subscription-modal-content">
            <div className="loading">Loading...</div>
          </div>
        </div>
      </div>
    )
  }

  const currentPlan = subscription ? plans.find(p => p.name === subscription.planName) : plans[0]

  return (
    <div className="subscription-modal-overlay" onClick={onClose}>
      <div className="subscription-modal" onClick={(e) => e.stopPropagation()}>
        <div className="subscription-modal-header">
          <h2>Subscription & Billing</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="subscription-modal-content">
          {/* Current Plan Section */}
          <div className="current-plan-section">
            <h3>Current Plan</h3>
            {subscription ? (
              <div className="current-plan-card">
                <div className="plan-icon-large">{currentPlan?.icon}</div>
                <div className="plan-info">
                  <h4>{currentPlan?.displayName}</h4>
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
                    <span className="limit-label">Queries/Month:</span>
                    <span className="limit-value">
                      {usage?.queryLimit ? (
                        <>
                          {usage.queryLimit.current} / {usage.queryLimit.limit === -1 ? 'Unlimited' : usage.queryLimit.limit}
                          {usage.queryLimit.remaining >= 0 && (
                            <span className="remaining-queries"> ({usage.queryLimit.remaining} remaining)</span>
                          )}
                        </>
                      ) : (
                        limits.maxQueriesPerMonth === -1 ? 'Unlimited' : limits.maxQueriesPerMonth
                      )}
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
                {usage && (
                  <div className="usage-stats">
                    <h5>Usage Statistics</h5>
                    <div className="usage-grid">
                      <div className="usage-item">
                        <span className="usage-label">This Month:</span>
                        <span className="usage-value">{usage.usage?.currentMonth || 0} queries</span>
                      </div>
                      <div className="usage-item">
                        <span className="usage-label">Last Month:</span>
                        <span className="usage-value">{usage.usage?.lastMonth || 0} queries</span>
                      </div>
                      <div className="usage-item">
                        <span className="usage-label">Total:</span>
                        <span className="usage-value">{usage.usage?.total || 0} queries</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Upgrade Plans Section */}
          <div className="upgrade-plans-section">
            <h3>Upgrade Plan</h3>
            <div className="billing-toggle">
              <span className={`toggle-label ${!isAnnual ? 'active' : ''}`}>Monthly</span>
              <div className="toggle-switch" onClick={() => setIsAnnual(!isAnnual)}>
                <div className={`toggle-slider ${isAnnual ? 'annual' : 'monthly'}`}></div>
              </div>
              <span className={`toggle-label ${isAnnual ? 'active' : ''}`}>
                Annual (20% Off)
              </span>
            </div>

            <div className="plans-grid">
              {plans
                .filter(plan => plan.name !== 'free' || !subscription)
                .map((plan) => {
                  const price = isAnnual ? plan.annualPrice : plan.monthlyPrice
                  const isCurrentPlan = subscription?.planName === plan.name && 
                                       subscription?.planType === (isAnnual ? 'annual' : 'monthly')
                  
                  return (
                    <div key={plan.name} className={`plan-card ${isCurrentPlan ? 'current' : ''}`}>
                      <div className="plan-icon">{plan.icon}</div>
                      <h4>{plan.displayName}</h4>
                      <div className="plan-price">
                        {price === null ? (
                          <span className="price-amount">Custom</span>
                        ) : (
                          <>
                            <span className="price-amount">${price}</span>
                            <span className="price-period">/{isAnnual ? 'year' : 'month'}</span>
                          </>
                        )}
                      </div>
                      <ul className="plan-features">
                        {plan.features.map((feature, idx) => (
                          <li key={idx}>
                            <span className="feature-check">✓</span>
                            {feature}
                          </li>
                        ))}
                      </ul>
                      {plan.name === 'enterprise' ? (
                        <a className="plan-button" href="/contact" title="Contact Sales">
                          Contact Sales
                        </a>
                      ) : (
                        <button 
                          className={`plan-button ${isCurrentPlan ? 'current' : ''}`}
                          onClick={() => handleUpgrade(plan.name, isAnnual ? 'annual' : 'monthly')}
                          disabled={isCurrentPlan}
                          title={isCurrentPlan ? 'Current Plan' : 'Upgrade'}
                        >
                          {isCurrentPlan ? 'Current Plan' : 'Upgrade'}
                        </button>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>

          {/* Payment History */}
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
                        <td>{payment.planName} ({payment.planType})</td>
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
      </div>
    </div>
  )
}

export default SubscriptionManagement
