import React, { createContext, useContext, useState, useEffect } from 'react'
import axios from 'axios'

interface User {
  id: number
  email: string
  name?: string
  isSiteAdmin?: boolean
}

interface AuthContextType {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  signIn: (email: string, password: string) => Promise<boolean>
  signUp: (email: string, password: string, name?: string) => Promise<boolean>
  signOut: () => void
  loading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check if user is already logged in from localStorage
    const savedToken = localStorage.getItem('aiquery_token')
    const savedUser = localStorage.getItem('aiquery_user')
    
    if (savedToken && savedUser) {
      try {
        const user = JSON.parse(savedUser)
        setToken(savedToken)
        setUser(user)
        // Set current user ID for localStorage key isolation
        if (user.id) {
          localStorage.setItem('aiquery_current_user_id', user.id.toString())
        }
        // Verify token is still valid by calling /api/auth/me
        verifyToken(savedToken)
      } catch (e) {
        console.error('Error parsing saved user:', e)
        localStorage.removeItem('aiquery_token')
        localStorage.removeItem('aiquery_user')
        localStorage.removeItem('aiquery_current_user_id')
      }
    }
    setLoading(false)
  }, [])

  const verifyToken = async (tokenToVerify: string) => {
    try {
      const response = await axios.get('/api/auth/me', {
        headers: { Authorization: `Bearer ${tokenToVerify}` }
      })
      if (response.data.success && response.data.user) {
        setUser(response.data.user)
        setToken(tokenToVerify)
        // Set current user ID for localStorage key isolation
        if (response.data.user.id) {
          localStorage.setItem('aiquery_current_user_id', response.data.user.id.toString())
        }
      } else {
        throw new Error('Invalid token')
      }
    } catch (error) {
      console.error('Token verification failed:', error)
      localStorage.removeItem('aiquery_token')
      localStorage.removeItem('aiquery_user')
      localStorage.removeItem('aiquery_current_user_id')
      setUser(null)
      setToken(null)
    }
  }

  const signIn = async (email: string, password: string): Promise<boolean> => {
    try {
      const response = await axios.post('/api/auth/login', { email, password })
      if (response.data.success && response.data.user && response.data.token) {
        const newUserId = response.data.user.id.toString()
        
        // Clear connection configurations to prevent users from seeing cached values from other users
        // Connections are now stored per-user in the database, so localStorage cache should be cleared
        localStorage.removeItem('aiquery_connections')
        localStorage.removeItem('aiquery_connection_statuses')
        
        setUser(response.data.user)
        setToken(response.data.token)
        localStorage.setItem('aiquery_token', response.data.token)
        localStorage.setItem('aiquery_user', JSON.stringify(response.data.user))
        localStorage.setItem('aiquery_current_user_id', newUserId)
        // Set default axios authorization header
        axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`
        return true
      }
      return false
    } catch (error: any) {
      console.error('Sign in error:', error)
      return false
    }
  }

  const signUp = async (email: string, password: string, name?: string): Promise<boolean> => {
    try {
      const response = await axios.post('/api/auth/register', { email, password, name })
      if (response.data.success && response.data.user && response.data.token) {
        const newUserId = response.data.user.id.toString()
        
        // For new sign-ups, clear any old generic API keys (not user-specific ones)
        // User-specific keys (with userId suffix) are already isolated per user
        // Only clear generic keys that might exist from before user-specific keys were implemented
        localStorage.removeItem('aiquery_openai_api_key')
        localStorage.removeItem('aiquery_gemini_api_key')
        localStorage.removeItem('aiquery_openai_model')
        localStorage.removeItem('aiquery_gemini_model')
        localStorage.removeItem('aiquery_openai_custom_model')
        localStorage.removeItem('aiquery_gemini_custom_model')
        localStorage.removeItem('aiquery_llm_provider')
        localStorage.removeItem('aiquery_llm_model_type')
        localStorage.removeItem('aiquery_api_keys_user_id')
        
        // Clear connection configurations to prevent new users from seeing previous users' cached values
        localStorage.removeItem('aiquery_connections')
        localStorage.removeItem('aiquery_connection_statuses')
        
        setUser(response.data.user)
        setToken(response.data.token)
        localStorage.setItem('aiquery_token', response.data.token)
        localStorage.setItem('aiquery_user', JSON.stringify(response.data.user))
        localStorage.setItem('aiquery_current_user_id', newUserId)
        // Set default axios authorization header
        axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`
        return true
      }
      return false
    } catch (error: any) {
      console.error('Sign up error:', error)
      return false
    }
  }

  const signOut = () => {
    // Don't clear API keys or aiquery_api_keys_user_id on logout
    // They will be preserved for the same user when they log back in
    // They will only be cleared when a different user signs in/signs up
    setUser(null)
    setToken(null)
    localStorage.removeItem('aiquery_token')
    localStorage.removeItem('aiquery_user')
    localStorage.removeItem('aiquery_current_user_id')
    delete axios.defaults.headers.common['Authorization']
  }

  // Set axios default authorization header if token exists
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
    } else {
      delete axios.defaults.headers.common['Authorization']
    }
  }, [token])

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        signIn,
        signUp,
        signOut,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
