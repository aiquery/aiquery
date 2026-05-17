import React, { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Logo from './Logo'
import './ResetPasswordPage.css'

const PASSWORD_RULES = {
  minLength: 12,
  hasLower: /[a-z]/,
  hasUpper: /[A-Z]/,
  hasNumber: /[0-9]/,
  hasSpecial: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/,
}

function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_RULES.minLength) return 'Password must be at least 12 characters.'
  if (!PASSWORD_RULES.hasLower.test(password)) return 'Password must contain at least one lowercase letter.'
  if (!PASSWORD_RULES.hasUpper.test(password)) return 'Password must contain at least one uppercase letter.'
  if (!PASSWORD_RULES.hasNumber.test(password)) return 'Password must contain at least one number.'
  if (!PASSWORD_RULES.hasSpecial.test(password)) return 'Password must contain at least one special character.'
  return null
}

const ResetPasswordPage: React.FC = () => {
  const { token } = useParams<{ token: string }>()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const passwordError = validatePassword(newPassword)
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (!token?.trim()) {
      setError('Invalid reset link. Please use the link from your email.')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), newPassword }),
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
      <div className="reset-password-page">
        <div className="reset-password-header-logo">
          <Logo linkToAdmin={false} imageSrc="/images/aiquery_logo5.png" imageOnly />
        </div>
        <div className="reset-password-container">
          <div className="reset-password-content">
            <h2 className="reset-password-subtitle">Password reset</h2>
            <p className="reset-password-description">Your password has been reset. You can now sign in with your new password.</p>
            <Link to="/signin" className="reset-password-signin-button">Sign In</Link>
          </div>
          <div className="reset-password-footer">
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

  if (!token?.trim()) {
    return (
      <div className="reset-password-page">
        <div className="reset-password-header-logo">
          <Logo linkToAdmin={false} imageSrc="/images/aiquery_logo5.png" imageOnly />
        </div>
        <div className="reset-password-container">
          <div className="reset-password-content">
            <h2 className="reset-password-subtitle">Invalid link</h2>
            <p className="reset-password-description">This reset link is invalid or missing. Please request a new password reset.</p>
            <Link to="/forgot-password" className="reset-password-signin-button">Request new link</Link>
            <div className="reset-password-signin-link">
              <Link to="/signin">Back to Sign In</Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="reset-password-page">
      <div className="reset-password-header-logo">
        <Logo linkToAdmin={false} imageSrc="/images/aiquery_logo5.png" imageOnly />
      </div>
      <div className="reset-password-container">
        <div className="reset-password-content">
          <h2 className="reset-password-subtitle">Set new password</h2>
          <p className="reset-password-description">Enter your new password below. Use at least 12 characters with uppercase, lowercase, a number, and a special character.</p>

          <form onSubmit={handleSubmit} className="reset-password-form">
            <div className="form-group">
              <label htmlFor="newPassword">New password</label>
              <input
                type="password"
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                placeholder="New password"
                autoComplete="new-password"
                minLength={12}
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm password</label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="Confirm new password"
                autoComplete="new-password"
                minLength={12}
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button type="submit" className="reset-password-button" disabled={loading}>
              {loading ? 'Resetting...' : 'Reset password'}
            </button>
          </form>

          <div className="reset-password-signin-link">
            <Link to="/signin">Back to Sign In</Link>
          </div>
        </div>

        <div className="reset-password-footer">
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

export default ResetPasswordPage
