import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../contexts/AuthContext'
import './InviteAccept.css'

const InviteAccept: React.FC = () => {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { isAuthenticated, signIn } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (token && isAuthenticated) {
      acceptInvite()
    } else if (token && !isAuthenticated) {
      setLoading(false)
      setError('Please sign in to accept the invitation')
    } else {
      setLoading(false)
      setError('Invalid invite link')
    }
  }, [token, isAuthenticated])

  const acceptInvite = async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const authToken = localStorage.getItem('aiquery_token')
      const response = await axios.post('/api/members/accept-invite', {
        token
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      })

      if (response.data.success) {
        setSuccess(true)
        setTimeout(() => {
          navigate('/app_admin')
        }, 2000)
      } else {
        setError(response.data.error || 'Failed to accept invitation')
      }
    } catch (error: any) {
      console.error('Error accepting invite:', error)
      setError(error.response?.data?.error || 'Failed to accept invitation')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="invite-accept-container">
        <div className="invite-accept-card">
          <div className="invite-accept-loading">
            <div className="spinner"></div>
            <p>Processing invitation...</p>
          </div>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="invite-accept-container">
        <div className="invite-accept-card">
          <div className="invite-accept-success">
            <div className="success-icon">✓</div>
            <h2>Invitation Accepted!</h2>
            <p>You have successfully joined the team.</p>
            <p className="redirect-message">Redirecting to the app...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="invite-accept-container">
      <div className="invite-accept-card">
        {error && (
          <div className="invite-accept-error">
            <div className="error-icon">✕</div>
            <h2>Unable to Accept Invitation</h2>
            <p>{error}</p>
            {!isAuthenticated && (
              <a className="invite-accept-button" href="/app_admin" title="Sign In">
                Sign In
              </a>
            )}
            {isAuthenticated && (
              <a className="invite-accept-button" href="/app_admin" title="Go to App">
                Go to App
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default InviteAccept

