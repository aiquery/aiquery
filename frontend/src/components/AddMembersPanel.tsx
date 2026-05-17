import React, { useState } from 'react'
import axios from 'axios'
import { useAuth } from '../contexts/AuthContext'
import './AddMembersPanel.css'

interface AddMembersPanelProps {
  onClose: () => void
}

const PRICE_PER_USER_MONTHLY = 10   // $10/month per user
const PRICE_PER_USER_YEARLY = 96   // $96/year per user (20% off $120/year)

const AddMembersPanel: React.FC<AddMembersPanelProps> = ({ onClose }) => {
  const { token } = useAuth()
  const [numUsers, setNumUsers] = useState(1)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const baseMonthly = numUsers * PRICE_PER_USER_MONTHLY
  const baseYearly = numUsers * PRICE_PER_USER_YEARLY
  const gstMonthly = baseMonthly * 0.05
  const gstYearly = baseYearly * 0.05
  const totalMonthly = baseMonthly + gstMonthly
  const totalYearly = baseYearly + gstYearly

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // Create Stripe checkout session for additional users
      const res = await axios.post(
        '/api/stripe/create-checkout-session-add-users',
        { count: numUsers, billingPeriod },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.data.success && res.data.url) {
        // Redirect to Stripe checkout
        window.location.href = res.data.url
      } else {
        setError(res.data.error || 'Failed to create checkout session')
        setLoading(false)
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to create checkout session'
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <div className="add-members-panel">
      <div className="add-members-panel-header">
        <h2>Add Users</h2>
        <button
          type="button"
          className="add-members-panel-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="add-members-panel-content">
        <p className="add-members-description">
          Add extra user slots to your plan. Each additional user slot is billed separately and increases your account user limit. The new limit will appear in Current Plan.
        </p>

        <form onSubmit={handleSubmit} className="add-members-form">
          <div className="add-members-field">
            <label htmlFor="add-members-count">Number of users</label>
            <input
              id="add-members-count"
              type="number"
              min={1}
              max={99}
              value={numUsers}
              onChange={(e) => setNumUsers(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="add-members-input"
              disabled={loading}
            />
          </div>

          <div className="add-members-billing">
            <span className="add-members-billing-label">Billing</span>
            <div className="add-members-billing-options">
              <label className="add-members-option">
                <input
                  type="radio"
                  name="billing"
                  checked={billingPeriod === 'monthly'}
                  onChange={() => setBillingPeriod('monthly')}
                  disabled={loading}
                />
                <span>$10/Month/User</span>
              </label>
              <label className="add-members-option">
                <input
                  type="radio"
                  name="billing"
                  checked={billingPeriod === 'yearly'}
                  onChange={() => setBillingPeriod('yearly')}
                  disabled={loading}
                />
                <span>$96/Year/User (20% off)</span>
              </label>
            </div>
          </div>

          <div className="add-members-summary">
            <div className="add-members-price-breakdown">
              <div className="add-members-price-item">
                <span className="add-members-price-label">
                  {numUsers} additional user{numUsers !== 1 ? 's' : ''}:
                </span>
                <span className="add-members-price-amount">
                  ${billingPeriod === 'monthly' ? baseMonthly.toFixed(2) : baseYearly.toFixed(2)}
                </span>
              </div>
              <div className="add-members-price-item">
                <span className="add-members-price-label">GST (5%):</span>
                <span className="add-members-price-amount">
                  ${billingPeriod === 'monthly' ? gstMonthly.toFixed(2) : gstYearly.toFixed(2)}
                </span>
              </div>
              <div className="add-members-price-item add-members-price-total">
                <span className="add-members-price-label">Total:</span>
                <span className="add-members-price-amount">
                  ${billingPeriod === 'monthly' ? totalMonthly.toFixed(2) : totalYearly.toFixed(2)}
                </span>
              </div>
            </div>
            <p className="add-members-period">
              per {billingPeriod === 'monthly' ? 'month' : 'year'}
            </p>
          </div>

          {error && <div className="add-members-error">{error}</div>}

          <button type="submit" className="add-members-submit" disabled={loading}>
            {loading ? 'Adding…' : 'Add Users'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default AddMembersPanel
