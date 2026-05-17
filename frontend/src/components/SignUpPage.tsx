import React, { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import Logo from './Logo'
import './SignUpPage.css'

// Country codes for phone numbers
const countryCodes = [
  { code: '+1', country: 'US/CA', flag: '🇺🇸' },
  { code: '+44', country: 'UK', flag: '🇬🇧' },
  { code: '+86', country: 'CN', flag: '🇨🇳' },
  { code: '+91', country: 'IN', flag: '🇮🇳' },
  { code: '+81', country: 'JP', flag: '🇯🇵' },
  { code: '+49', country: 'DE', flag: '🇩🇪' },
  { code: '+33', country: 'FR', flag: '🇫🇷' },
  { code: '+39', country: 'IT', flag: '🇮🇹' },
  { code: '+34', country: 'ES', flag: '🇪🇸' },
  { code: '+61', country: 'AU', flag: '🇦🇺' },
  { code: '+7', country: 'RU', flag: '🇷🇺' },
  { code: '+82', country: 'KR', flag: '🇰🇷' },
  { code: '+55', country: 'BR', flag: '🇧🇷' },
  { code: '+52', country: 'MX', flag: '🇲🇽' },
  { code: '+31', country: 'NL', flag: '🇳🇱' },
  { code: '+46', country: 'SE', flag: '🇸🇪' },
  { code: '+47', country: 'NO', flag: '🇳🇴' },
  { code: '+41', country: 'CH', flag: '🇨🇭' },
  { code: '+32', country: 'BE', flag: '🇧🇪' },
  { code: '+65', country: 'SG', flag: '🇸🇬' },
  { code: '+852', country: 'HK', flag: '🇭🇰' },
  { code: '+971', country: 'AE', flag: '🇦🇪' },
  { code: '+27', country: 'ZA', flag: '🇿🇦' },
  { code: '+20', country: 'EG', flag: '🇪🇬' },
  { code: '+234', country: 'NG', flag: '🇳🇬' },
]

// Global storage for Turnstile token (Cloudflare tutorial: callback enables submit; token survives React re-renders)
declare global {
  interface Window {
    __turnstileToken?: string | null
    __onTurnstileSuccess?: (token: string) => void
    __onTurnstileError?: () => void
    __onTurnstileExpired?: () => void
  }
}

const SignUpPage: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as { from?: string; plan?: string; billingPeriod?: 'monthly' | 'yearly' } | undefined
  const [name, setName] = useState('')
  const [selectedCountryCode, setSelectedCountryCode] = useState('+1')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [showCountryDropdown, setShowCountryDropdown] = useState(false)
  const countryDropdownRef = useRef<HTMLDivElement>(null)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const turnstileWidgetIdRef = useRef<string | null>(null)
  const turnstileTokenInputRef = useRef<HTMLInputElement>(null)
  const turnstileCancelledRef = useRef(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileError, setTurnstileError] = useState<string>('')
  const [turnstileLoaded, setTurnstileLoaded] = useState(false)

  // Listen for token from global callback (tutorial: data-callback enables submit; we use custom event to update React state)
  useEffect(() => {
    const onSuccess = (e: CustomEvent<string>) => {
      const token = e.detail
      if (token && turnstileTokenInputRef.current) {
        turnstileTokenInputRef.current.value = token
      }
      if (!turnstileCancelledRef.current) setTurnstileToken(token)
      if (!turnstileCancelledRef.current) setTurnstileError('')
    }
    const onError = () => {
      if (!turnstileCancelledRef.current) {
        setTurnstileToken(null)
        setTurnstileError('Cloudflare verification failed. Please try again.')
      }
    }
    const onExpired = () => {
      if (!turnstileCancelledRef.current) setTurnstileToken(null)
    }
    window.addEventListener('turnstile-success', onSuccess as EventListener)
    window.addEventListener('turnstile-error', onError)
    window.addEventListener('turnstile-expired', onExpired)
    return () => {
      window.removeEventListener('turnstile-success', onSuccess as EventListener)
      window.removeEventListener('turnstile-error', onError)
      window.removeEventListener('turnstile-expired', onExpired)
    }
  }, [])

  // Load Cloudflare Turnstile per https://developers.cloudflare.com/turnstile/tutorials/login-pages/
  useEffect(() => {
    turnstileCancelledRef.current = false
    window.__turnstileToken = null
    const siteKey = import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY

    if (!siteKey || siteKey === '1x00000000000000000000AA') {
      setTurnstileError('Cloudflare Turnstile site key not configured. Please add VITE_CLOUDFLARE_TURNSTILE_SITE_KEY to your .env file.')
      setTurnstileToken('dev-bypass')
      return () => { turnstileCancelledRef.current = true }
    }

    // Global callback so Turnstile always has a stable reference (tutorial: data-callback="enableSubmit")
    window.__onTurnstileSuccess = (token: string) => {
      if (!token) return
      window.__turnstileToken = token
      if (turnstileTokenInputRef.current) turnstileTokenInputRef.current.value = token
      window.dispatchEvent(new CustomEvent('turnstile-success', { detail: token }))
    }
    window.__onTurnstileError = () => {
      window.__turnstileToken = null
      window.dispatchEvent(new Event('turnstile-error'))
    }
    window.__onTurnstileExpired = () => {
      window.__turnstileToken = null
      window.dispatchEvent(new Event('turnstile-expired'))
    }

    const renderWidget = () => {
      if (turnstileCancelledRef.current) return
      const turnstile = (window as any).turnstile
      const container = turnstileRef.current
      if (!turnstile || !container) {
        if (!turnstileCancelledRef.current) setTurnstileError('Cloudflare Turnstile script failed to load. Please check your connection.')
        return
      }
      try {
        const existingId = turnstileWidgetIdRef.current
        if (existingId) {
          try { turnstile.remove(existingId) } catch (_) { /* ignore */ }
          turnstileWidgetIdRef.current = null
        }
        container.innerHTML = ''
        const widgetId = turnstile.render(container, {
          sitekey: siteKey,
          callback: (token: string) => {
            if (token && window.__onTurnstileSuccess) window.__onTurnstileSuccess(token)
          },
          'error-callback': () => {
            if (window.__onTurnstileError) window.__onTurnstileError()
          },
          'expired-callback': () => {
            if (window.__onTurnstileExpired) window.__onTurnstileExpired()
          },
        })
        turnstileWidgetIdRef.current = widgetId
        if (!turnstileCancelledRef.current) setTurnstileLoaded(true)
      } catch (error) {
        if (!turnstileCancelledRef.current) {
          console.error('Error rendering Turnstile:', error)
          setTurnstileError('Failed to load Cloudflare verification. Please refresh the page.')
        }
      }
    }

    if ((window as any).turnstile) {
      renderWidget()
      return () => {
        turnstileCancelledRef.current = true
        window.__turnstileToken = null
        const turnstile = (window as any).turnstile
        const widgetId = turnstileWidgetIdRef.current
        if (turnstile && widgetId) {
          try { turnstile.remove(widgetId) } catch (_) { /* ignore */ }
          turnstileWidgetIdRef.current = null
        }
      }
    }

    const script = document.createElement('script')
    script.id = 'turnstile-api-script'
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onerror = () => {
      if (!turnstileCancelledRef.current) setTurnstileError('Failed to load Cloudflare Turnstile script. Please check your connection.')
    }
    script.onload = () => renderWidget()

    if (!document.getElementById('turnstile-api-script')) {
      document.body.appendChild(script)
    } else {
      renderWidget()
    }

    return () => {
      turnstileCancelledRef.current = true
      window.__turnstileToken = null
      const existing = document.getElementById('turnstile-api-script')
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
      const turnstile = (window as any).turnstile
      const widgetId = turnstileWidgetIdRef.current
      if (turnstile && widgetId) {
        try { turnstile.remove(widgetId) } catch (_) { /* ignore */ }
        turnstileWidgetIdRef.current = null
      }
    }
  }, [])

  // Close country dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(event.target as Node)) {
        setShowCountryDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 12) {
      return 'Password must be at least 12 characters'
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
        return pwd.length >= 12
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

  const getPasswordStrength = (pwd: string): { strength: string; percentage: number } => {
    let score = 0
    const checks = [
      pwd.length >= 12,
      /[a-z]/.test(pwd),
      /[A-Z]/.test(pwd),
      /[0-9]/.test(pwd),
      /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd),
      pwd.length >= 16,
      /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?].*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd),
    ]

    score = checks.filter(Boolean).length
    const percentage = (score / checks.length) * 100

    if (percentage < 50) return { strength: 'Weak', percentage }
    if (percentage < 75) return { strength: 'Medium', percentage }
    if (percentage < 90) return { strength: 'Strong', percentage }
    return { strength: 'Very Strong', percentage }
  }

  const resetTurnstileWidget = () => {
    window.__turnstileToken = null
    if (turnstileTokenInputRef.current) turnstileTokenInputRef.current.value = ''
    setTurnstileToken(null)
    const turnstile = (window as any).turnstile
    const widgetId = turnstileWidgetIdRef.current
    if (turnstile && widgetId) {
      try { turnstile.reset(widgetId) } catch (_) { /* ignore */ }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const siteKey = import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY
    const isDevMode = !siteKey || siteKey === '1x00000000000000000000AA'

    // Token per Cloudflare tutorial: from global (callback) > hidden input > state > getResponse()
    let tokenToSend: string | null =
      (typeof window !== 'undefined' && window.__turnstileToken) ||
      turnstileTokenInputRef.current?.value ||
      turnstileToken ||
      null
    if (!tokenToSend && !isDevMode) {
      const turnstile = (window as any).turnstile
      const widgetId = turnstileWidgetIdRef.current
      if (turnstile && widgetId) {
        try {
          const widgetToken = turnstile.getResponse(widgetId)
          if (widgetToken) tokenToSend = widgetToken
        } catch (_) { /* ignore */ }
      }
      if (!tokenToSend) {
        const input = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')
        if (input?.value) tokenToSend = input.value
      }
    }

    // Require token unless dev bypass
    if (!tokenToSend) {
      setError('Please complete the security verification')
      resetTurnstileWidget()
      return
    }
    if (!isDevMode && tokenToSend === 'dev-bypass') {
      setError('Please complete the security verification')
      resetTurnstileWidget()
      return
    }

    if (!phoneNumber || phoneNumber.trim() === '') {
      setError('Phone number is required')
      resetTurnstileWidget()
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      resetTurnstileWidget()
      return
    }

    const passwordError = validatePassword(password)
    if (passwordError) {
      setError(passwordError)
      resetTurnstileWidget()
      return
    }

    setLoading(true)

    try {
      // Per Cloudflare tutorial: server reads req.body["cf-turnstile-response"]
      const body: Record<string, unknown> = {
        email: email.toLowerCase(),
        password,
        name: name || undefined,
        phoneNumber: `${selectedCountryCode}${phoneNumber}`,
        'cf-turnstile-response': tokenToSend,
      }
      const response = await fetch('/api/auth/send-verification-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send verification code')
      }

      // Navigate to verification page with email; pass plan/billingPeriod so after verify we can redirect to checkout
      navigate('/verify-email', {
        state: {
          email: email.toLowerCase(),
          plan: locationState?.plan,
          billingPeriod: locationState?.billingPeriod,
        },
      })
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err?.message || 'An error occurred. Please try again.'
      setError(errorMessage)
      if (errorMessage.includes('Security verification failed') || errorMessage.includes('Please complete the security verification')) {
        resetTurnstileWidget()
      }
    } finally {
      setLoading(false)
    }
  }

  const passwordStrength = getPasswordStrength(password)

  return (
    <div className="signup-page">
      <div className="signup-header-logo">
        <Logo variant="landing" imageSrc="/images/aiquery_logo5.png" imageOnly />
      </div>
      <div className="signup-container">
        <div className="signup-content">
          <h2 className="signup-subtitle">Sign in or sign up</h2>
          <p className="signup-description">Ask data with AIquery</p>

          <form onSubmit={handleSubmit} className="signup-form">
            <div className="form-group">
              <label htmlFor="name">Name (Optional)</label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
              />
            </div>

            <div className="form-group">
              <label htmlFor="phone">Phone Number <span className="required-mark">*</span></label>
              <div className="phone-input-wrapper">
                <div className="country-code-dropdown" ref={countryDropdownRef}>
                  <button
                    type="button"
                    className="country-code-button"
                    onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                  >
                    {countryCodes.find(c => c.code === selectedCountryCode)?.flag} {selectedCountryCode}
                    <span className="dropdown-arrow">▼</span>
                  </button>
                  {showCountryDropdown && (
                    <div className="country-code-list">
                      {countryCodes.map((country) => (
                        <button
                          key={country.code}
                          type="button"
                          className="country-code-option"
                          onClick={() => {
                            setSelectedCountryCode(country.code)
                            setShowCountryDropdown(false)
                          }}
                        >
                          {country.flag} {country.code} ({country.country})
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  type="tel"
                  id="phone"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter phone number"
                  className="phone-input"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="email">Email <span className="required-mark">*</span></label>
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
              <label htmlFor="password">Password <span className="required-mark">*</span></label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
              
              {password && (
                <div className="password-strength">
                  <div className="password-strength-bar">
                    <div
                      className={`password-strength-fill ${passwordStrength.strength.toLowerCase().replace(' ', '-')}`}
                      style={{ width: `${passwordStrength.percentage}%` }}
                    />
                  </div>
                  <div className="password-strength-text">
                    Password strength: <strong>{passwordStrength.strength}</strong>
                  </div>
                </div>
              )}

              <div className="password-requirements">
                <p className="requirements-title">Password must contain:</p>
                <ul className="requirements-list">
                  <li className={checkPasswordRequirement(password, 'length') ? 'requirement-met' : ''}>
                    {checkPasswordRequirement(password, 'length') ? '✓' : '○'} At least 12 characters
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

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password <span className="required-mark">*</span></label>
              <div className="password-input-wrapper">
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
                  className="password-toggle"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
              {confirmPassword && password !== confirmPassword && (
                <span className="error-text">Passwords do not match</span>
              )}
            </div>

            <div className="form-group">
              {turnstileError && (
                <div className="turnstile-error" style={{ 
                  padding: '0.5rem', 
                  background: '#fef3c7', 
                  border: '1px solid #fbbf24', 
                  borderRadius: '8px', 
                  fontSize: '0.875rem', 
                  color: '#92400e',
                  marginBottom: '0.5rem'
                }}>
                  {turnstileError}
                </div>
              )}
              <div ref={turnstileRef} className="turnstile-widget" />
              <input type="hidden" name="cf-turnstile-response" ref={turnstileTokenInputRef} />
              {!turnstileLoaded && !turnstileError && (
                <div style={{ 
                  padding: '0.5rem', 
                  fontSize: '0.875rem', 
                  color: '#6b7280',
                  textAlign: 'center'
                }}>
                  Loading security verification...
                </div>
              )}
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="terms-text">
              By selecting Continue, you agree to the{' '}
              <Link to="/terms" className="terms-link">Term of Services</Link> and{' '}
              <Link to="/privacy" className="terms-link">Privacy Policy</Link> of AIquery, and you represent that you are authorized to accept all of the items of the Agreement on behalf of your organisation.
            </div>

            <button 
              type="submit" 
              className="continue-button" 
              disabled={loading || !turnstileToken}
            >
              {loading ? 'Sending...' : 'Continue'}
            </button>
          </form>

          <div className="signin-link">
            Already have an account? <Link to="/signin">Sign In</Link>
          </div>
        </div>

        <div className="signup-footer">
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

// Extend Window interface for Turnstile API
declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: any) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
      getResponse: (widgetId: string) => string | null
    }
  }
}

// Note: For production, you need to:
// 1. Get a Cloudflare Turnstile site key from https://developers.cloudflare.com/turnstile/
// 2. Add VITE_CLOUDFLARE_TURNSTILE_SITE_KEY to your frontend/.env file (or root .env if using Vite's rootDir)
// 3. Add localhost to allowed domains in Cloudflare Turnstile settings for local testing
// 4. Verify the token on the backend using Cloudflare's API

export default SignUpPage