import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './AuthModal.css'

interface SignInModalProps {
  onClose: () => void
  onSwitchToSignUp: () => void
}

const SignInModal: React.FC<SignInModalProps> = ({ onClose, onSwitchToSignUp }) => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const success = await signIn(email, password)
      if (success) {
        onClose()
        navigate('/app_admin')
      } else {
        setError('Invalid email or password')
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
        <h2>Sign In</h2>
        <form onSubmit={handleSubmit}>
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
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Enter your password"
            />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="auth-submit-button" disabled={loading}>
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
        <div className="auth-switch">
          <p>Don't have an account? <button onClick={() => { onClose(); navigate('/signup'); }} className="auth-switch-link">Sign Up</button></p>
        </div>
      </div>
    </div>
  )
}

export default SignInModal

