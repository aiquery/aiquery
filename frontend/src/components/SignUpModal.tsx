import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './AuthModal.css'

interface SignUpModalProps {
  onClose: () => void
  onSwitchToSignIn: () => void
}

const SignUpModal: React.FC<SignUpModalProps> = ({ onClose, onSwitchToSignIn }) => {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isNotRobot, setIsNotRobot] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 8) {
      return 'Password must be at least 8 characters'
    }
    if (!/[a-z]/.test(pwd)) {
      return 'Password must contain at least one lowercase letter'
    }
    if (!/[A-Z]/.test(pwd)) {
      return 'Password must contain at least one uppercase letter'
    }
    if (!/[0-9]/.test(pwd)) {
      return 'Password must contain at least one number'
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd)) {
      return 'Password must contain at least one special character'
    }
    return null
  }

  const checkPasswordRequirement = (pwd: string, requirement: string): boolean => {
    switch (requirement) {
      case 'length':
        return pwd.length >= 8
      case 'lowercase':
        return /[a-z]/.test(pwd)
      case 'uppercase':
        return /[A-Z]/.test(pwd)
      case 'number':
        return /[0-9]/.test(pwd)
      case 'special':
        return /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd)
      default:
        return false
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!isNotRobot) {
      setError('Please confirm you are not a robot')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    const passwordError = validatePassword(password)
    if (passwordError) {
      setError(passwordError)
      return
    }

    setLoading(true)

    try {
      const success = await signUp(email, password, name || undefined)
      if (success) {
        onClose()
        navigate('/app_admin')
      } else {
        setError('Email already registered or registration failed')
      }
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err?.message || 'An error occurred. Please try again.'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="auth-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="auth-modal-close" onClick={onClose}>×</button>
        <h2>Sign Up</h2>
        <form onSubmit={handleSubmit}>
          <div className="auth-form-group">
            <label htmlFor="name">Name (Optional)</label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
            />
          </div>
          <div className="auth-form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="Enter your email"
            />
          </div>
          <div className="auth-form-group">
            <label htmlFor="password">Password</label>
            <div className="auth-password-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Enter your password (min 8 chars, 1 upper, 1 lower, 1 number, 1 special)"
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
            <div className="auth-password-requirements">
              <p className="auth-requirements-title">Password must contain:</p>
              <ul className="auth-requirements-list">
                <li className={checkPasswordRequirement(password, 'length') ? 'requirement-met' : ''}>
                  {checkPasswordRequirement(password, 'length') ? '✓' : '○'} At least 8 characters
                </li>
                <li className={checkPasswordRequirement(password, 'lowercase') ? 'requirement-met' : ''}>
                  {checkPasswordRequirement(password, 'lowercase') ? '✓' : '○'} At least 1 lowercase letter
                </li>
                <li className={checkPasswordRequirement(password, 'uppercase') ? 'requirement-met' : ''}>
                  {checkPasswordRequirement(password, 'uppercase') ? '✓' : '○'} At least 1 uppercase letter
                </li>
                <li className={checkPasswordRequirement(password, 'number') ? 'requirement-met' : ''}>
                  {checkPasswordRequirement(password, 'number') ? '✓' : '○'} At least 1 number
                </li>
                <li className={checkPasswordRequirement(password, 'special') ? 'requirement-met' : ''}>
                  {checkPasswordRequirement(password, 'special') ? '✓' : '○'} At least 1 special character
                </li>
              </ul>
            </div>
          </div>
          <div className="auth-form-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <div className="auth-password-input-wrapper">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="Confirm your password"
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>
          <div className="auth-form-group">
            <label className="auth-checkbox-label">
              <input
                type="checkbox"
                checked={isNotRobot}
                onChange={(e) => setIsNotRobot(e.target.checked)}
                required
              />
              <span>I'm not a robot *</span>
            </label>
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="auth-submit-button" disabled={loading}>
            {loading ? 'Creating Account...' : 'Sign Up'}
          </button>
        </form>
        <div className="auth-switch">
          <p>Already have an account? <button onClick={onSwitchToSignIn} className="auth-switch-link">Sign In</button></p>
        </div>
      </div>
    </div>
  )
}

export default SignUpModal

