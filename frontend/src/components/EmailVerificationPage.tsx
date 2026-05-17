import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import axios from 'axios'
import Logo from './Logo'
import './EmailVerificationPage.css'

const EmailVerificationPage: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [verificationCode, setVerificationCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState<string>('')

  useEffect(() => {
    // Get email from location state or try to get from session
    const stateEmail = (location.state as any)?.email
    if (stateEmail) {
      setEmail(stateEmail)
    } else {
      // If no email in state, redirect back to signup
      navigate('/signup')
    }
  }, [location, navigate])

  const statePlan = (location.state as any)?.plan
  const stateBillingPeriod = (location.state as any)?.billingPeriod

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!verificationCode || verificationCode.length !== 6) {
      setError('Please enter a valid 6-digit verification code')
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email,
          code: verificationCode,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Verification failed')
      }

      // Store token and user data in AuthContext format
      if (data.token && data.user) {
        const newUserId = data.user.id.toString()
        
        // Clear connection configurations to prevent users from seeing cached values from other users
        localStorage.removeItem('aiquery_connections')
        localStorage.removeItem('aiquery_connection_statuses')
        
        // Store token and user in the format AuthContext expects
        localStorage.setItem('aiquery_token', data.token)
        localStorage.setItem('aiquery_user', JSON.stringify(data.user))
        localStorage.setItem('aiquery_current_user_id', newUserId)
        
        // Set axios default authorization header
        axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`
        
        // If user came from pricing (StartPro/SmartPro), send them to checkout page
        if (statePlan === 'startpro' || statePlan === 'smartpro') {
          const query = stateBillingPeriod ? `?billing=${stateBillingPeriod}` : ''
          window.location.href = `/pricing/${statePlan}${query}`
          return
        }
        // Check if user needs to pay (based on plan)
        if (data.planName && data.planName !== 'free') {
          navigate('/payment', { state: { planName: data.planName, userId: data.userId } })
        } else {
          // Navigate to workspace admin page for free plan
          window.location.href = '/app_admin'
        }
        return
      }

      // Fallback: if no token/user data, navigate to signup
      navigate('/signup')
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err?.message || 'Verification failed. Please try again.'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleBack = () => {
    navigate('/signup')
  }

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6)
    setVerificationCode(value)
  }

  return (
    <div className="verification-page">
      <div className="verification-header-logo">
        <Logo linkToAdmin={false} imageSrc="/images/aiquery_logo5.png" imageOnly />
      </div>
      <div className="verification-container">
        <div className="verification-content">
          <h2 className="verification-subtitle">Please Verify your email address</h2>
          <p className="verification-description">
            Please Enter the code sent to <strong>{email}</strong> to complete verification.
          </p>

          <form onSubmit={handleVerify} className="verification-form">
            <div className="form-group">
              <label htmlFor="code">Verification Code</label>
              <input
                type="text"
                id="code"
                value={verificationCode}
                onChange={handleCodeChange}
                placeholder="Enter 6-digit code"
                maxLength={6}
                required
                className="code-input"
                autoFocus
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="button-group">
              <button type="button" className="back-button" onClick={handleBack} disabled={loading}>
                Back
              </button>
              <button type="submit" className="verify-button" disabled={loading || verificationCode.length !== 6}>
                {loading ? 'Verifying...' : 'Verify'}
              </button>
            </div>
          </form>
        </div>

        <div className="verification-footer">
          <div className="footer-links">
            <Link to="/terms">Term of Services</Link>
            <Link to="/privacy">Privacy Policy</Link>
          </div>
          <p className="copyright">Copyright © {new Date().getFullYear()} AIquery</p>
        </div>
      </div>
    </div>
  )
}

export default EmailVerificationPage
