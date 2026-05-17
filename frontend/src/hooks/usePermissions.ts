import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../contexts/AuthContext'

export const usePermissions = () => {
  const { isAuthenticated } = useAuth()
  const [canConfigure, setCanConfigure] = useState(false)
  const [canQuery, setCanQuery] = useState(true) // Default to true for query
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isAuthenticated) {
      checkPermissions()
    } else {
      // Not authenticated - allow query but not configure
      setCanConfigure(false)
      setCanQuery(true)
      setLoading(false)
    }
  }, [isAuthenticated])

  const checkPermissions = async () => {
    try {
      const token = localStorage.getItem('aiquery_token')
      
      // Check configure permission
      const configureResponse = await axios.get('/api/members/permissions?action=configure', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      // Check query permission
      const queryResponse = await axios.get('/api/members/permissions?action=query', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (configureResponse.data.success) {
        setCanConfigure(configureResponse.data.hasPermission)
      }
      if (queryResponse.data.success) {
        setCanQuery(queryResponse.data.hasPermission)
      }
    } catch (error) {
      console.error('Error checking permissions:', error)
      // Default to allowing query but not configure on error
      setCanConfigure(false)
      setCanQuery(true)
    } finally {
      setLoading(false)
    }
  }

  return { canConfigure, canQuery, loading, refreshPermissions: checkPermissions }
}

