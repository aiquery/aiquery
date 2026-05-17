import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Logo from './Logo'
import './SignInPage.css'

const SignInPage: React.FC = () => {
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const success = await signIn(email, password)
      if (success) {
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
    <div className="signin-page">
      <div className="signin-header-logo">
        <Logo variant="landing" imageSrc="/images/aiquery_logo5.png" imageOnly />
      </div>
      <div className="signin-container">
        <div className="signin-content">
          <h2 className="signin-subtitle">Sign in or sign up</h2>
          <p className="signin-description">Ask data with AIquery</p>

          <form onSubmit={handleSubmit} className="signin-form">
            <div className="form-group">
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

            <div className="form-group">
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

            {error && <div className="error-message">{error}</div>}

            <button type="submit" className="signin-button" disabled={loading}>
              {loading ? 'Signing In...' : 'Sign In'}
            </button>

            <div className="forgot-password-link">
              <Link to="/forgot-password">Forgot Your Password?</Link>
            </div>
          </form>

          <div className="signup-link">
            Don't have an account? <Link to="/signup">Sign Up</Link>
          </div>
        </div>

        <div className="signin-footer">
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

export default SignInPage
