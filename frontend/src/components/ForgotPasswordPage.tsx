import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from './Logo'
import './ForgotPasswordPage.css'

const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        return
      }

      setSuccess(true)
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="forgot-password-page">
        <div className="forgot-password-header-logo">
          <Logo variant="landing" imageSrc="/images/aiquery_logo5.png" imageOnly />
        </div>
        <div className="forgot-password-container">
          <div className="forgot-password-content">
            <h2 className="forgot-password-subtitle">Check your email</h2>
            <p className="forgot-password-description">
              If an account exists with <strong>{email}</strong>, you will receive a password reset link shortly.
            </p>
            <p className="forgot-password-hint">Didn’t receive it? Check spam or <button type="button" className="link-button" onClick={() => { setSuccess(false); setEmail(''); }}>try another email</button>.</p>
            <div className="forgot-password-actions">
              <Link to="/signin" className="forgot-password-back">Back to Sign In</Link>
            </div>
          </div>
          <div className="forgot-password-footer">
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

  return (
    <div className="forgot-password-page">
      <div className="forgot-password-header-logo">
        <Logo variant="landing" imageSrc="/images/aiquery_logo5.png" imageOnly />
      </div>
      <div className="forgot-password-container">
        <div className="forgot-password-content">
          <h2 className="forgot-password-subtitle">Forgot your password?</h2>
          <p className="forgot-password-description">Enter your email and we’ll send you a link to reset your password.</p>

          <form onSubmit={handleSubmit} className="forgot-password-form">
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="Enter your email"
                autoComplete="email"
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button type="submit" className="forgot-password-button" disabled={loading}>
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
          </form>

          <div className="forgot-password-signin-link">
            <Link to="/signin">Back to Sign In</Link>
          </div>
        </div>

        <div className="forgot-password-footer">
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

export default ForgotPasswordPage
