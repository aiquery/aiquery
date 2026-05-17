import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import LandingHeader from './LandingHeader'
import LandingFooter from './LandingFooter'
import { Mail, X, Send } from 'lucide-react'
import './DemoRequest.css'
import './LandingPage.css'

const DemoRequest: React.FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated, signOut } = useAuth()
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    companyName: '',
    jobTitle: '',
    phoneNumber: '',
    timeZone: '',
    projectDescription: '',
    isNotRobot: false,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  // Kira chatbot (reuse Landing styles/behavior)
  const [isChatbotOpen, setIsChatbotOpen] = useState(false)
  const [landingChatMessages, setLandingChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    { role: 'assistant', content: "Hi there! 👋 I'm Kira.Very happy to answer your questions about AIquery services." }
  ])
  const [landingChatInput, setLandingChatInput] = useState('')
  const [landingChatLoading, setLandingChatLoading] = useState(false)

  const handleLandingChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!landingChatInput.trim() || landingChatLoading) return

    const fallbackMessage = 'Sorry, it is not relative to AIquery service, I can not answer your question.'
    const userMessage = { role: 'user' as const, content: landingChatInput.trim() }
    setLandingChatMessages(prev => [...prev, userMessage])
    setLandingChatInput('')
    setLandingChatLoading(true)

    try {
      const response = await fetch('/api/chat/grounded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMessage.content })
      })
      const data = await response.json()
      const assistantContent = response.ok ? (data.answer || fallbackMessage) : (data.error || fallbackMessage)
      setLandingChatMessages(prev => [...prev, { role: 'assistant', content: assistantContent }])
    } catch (_error) {
      setLandingChatMessages(prev => [...prev, { role: 'assistant', content: fallbackMessage }])
    } finally {
      setLandingChatLoading(false)
    }
  }

  const kiraChatbot = (
    <div className="floating-chatbot">
      {isChatbotOpen && (
        <div className="chatbot-window">
          <div className="chatbot-header">
            <div className="chatbot-header-left">
              <div className="chatbot-avatar">
                <img src="/images/kira-avatar.png" alt="Kira" />
                <span className="chatbot-status" />
              </div>
              <div>
                <div className="chatbot-name">Kira</div>
                <div className="chatbot-subtitle">AI Assistant • Online</div>
              </div>
            </div>
            <button
              type="button"
              className="chatbot-close"
              onClick={() => setIsChatbotOpen(false)}
              aria-label="Close chatbot"
            >
              <X size={20} />
            </button>
          </div>

          <div className="chatbot-messages">
            {landingChatMessages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`chatbot-message ${message.role === 'user' ? 'user' : 'assistant'}`}
              >
                {message.role === 'assistant' && (
                  <div className="chatbot-message-avatar">
                    <img src="/images/kira-avatar.png" alt="Kira" />
                  </div>
                )}
                <div className="chatbot-message-bubble">
                  {message.content}
                </div>
              </div>
            ))}
            {landingChatLoading && (
              <div className="chatbot-message assistant">
                <div className="chatbot-message-avatar">
                  <img src="/images/kira-avatar.png" alt="Kira" />
                </div>
                <div className="chatbot-message-bubble">Thinking...</div>
              </div>
            )}
          </div>

          <div className="chatbot-input-area">
            <form className="chatbot-input-form" onSubmit={handleLandingChatSubmit}>
              <input
                type="text"
                placeholder="Type a message..."
                className="chatbot-input"
                value={landingChatInput}
                onChange={(e) => setLandingChatInput(e.target.value)}
                disabled={landingChatLoading}
              />
              <button type="submit" className="chatbot-send" aria-label="Send message" disabled={landingChatLoading}>
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      )}

      <button
        type="button"
        className={`chatbot-toggle ${isChatbotOpen ? 'open' : ''}`}
        onClick={() => setIsChatbotOpen(!isChatbotOpen)}
        aria-label="Toggle chatbot"
      >
        <img src="/images/kira-avatar.png" alt="Chat" />
      </button>
    </div>
  )

  const timeZones = [
    'UTC-12:00 (Baker Island Time)',
    'UTC-11:00 (Hawaii-Aleutian Standard Time)',
    'UTC-10:00 (Alaska Standard Time)',
    'UTC-09:00 (Pacific Standard Time)',
    'UTC-08:00 (Mountain Standard Time)',
    'UTC-07:00 (Central Standard Time)',
    'UTC-06:00 (Eastern Standard Time)',
    'UTC-05:00 (Atlantic Standard Time)',
    'UTC-04:00 (Venezuela Time)',
    'UTC-03:00 (Argentina Time)',
    'UTC-02:00 (Mid-Atlantic Time)',
    'UTC-01:00 (Azores Time)',
    'UTC+00:00 (Greenwich Mean Time)',
    'UTC+01:00 (Central European Time)',
    'UTC+02:00 (Eastern European Time)',
    'UTC+03:00 (Moscow Time)',
    'UTC+04:00 (Gulf Standard Time)',
    'UTC+05:00 (Pakistan Standard Time)',
    'UTC+05:30 (India Standard Time)',
    'UTC+06:00 (Bangladesh Standard Time)',
    'UTC+07:00 (Indochina Time)',
    'UTC+08:00 (China Standard Time)',
    'UTC+09:00 (Japan Standard Time)',
    'UTC+10:00 (Australian Eastern Standard Time)',
    'UTC+11:00 (Solomon Islands Time)',
    'UTC+12:00 (New Zealand Standard Time)',
  ]

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked
    
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[name]
        return newErrors
      })
    }
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First name is required'
    }
    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last name is required'
    }
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address'
    }
    if (!formData.companyName.trim()) {
      newErrors.companyName = 'Company name is required'
    }
    if (!formData.jobTitle.trim()) {
      newErrors.jobTitle = 'Job title is required'
    }
    if (!formData.phoneNumber.trim()) {
      newErrors.phoneNumber = 'Phone number is required'
    }
    if (!formData.timeZone) {
      newErrors.timeZone = 'Please select your time zone'
    }
    if (!formData.projectDescription.trim()) {
      newErrors.projectDescription = 'Project description is required'
    }
    if (!formData.isNotRobot) {
      newErrors.isNotRobot = 'Please confirm you are not a robot'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)
    setErrors({})

    try {
      const res = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          email: formData.email.trim(),
          companyName: formData.companyName.trim(),
          jobTitle: formData.jobTitle.trim(),
          phoneNumber: formData.phoneNumber.trim(),
          timeZone: formData.timeZone,
          projectDescription: formData.projectDescription.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit')
      }
      setIsSubmitted(true)
      setFormData({
        firstName: '',
        lastName: '',
        email: '',
        companyName: '',
        jobTitle: '',
        phoneNumber: '',
        timeZone: '',
        projectDescription: '',
        isNotRobot: false,
      })
    } catch (error) {
      console.error('Error submitting form:', error)
      setErrors({ submit: error instanceof Error ? error.message : 'Failed to submit form. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isSubmitted) {
    return (
      <div className="demo-request-page">
        <LandingHeader activePath="/contact" primaryButtonLabel="Get Started Free" />
        <div className="demo-request-container">
          <div className="demo-success">
            <div className="success-icon">✓</div>
            <h1>Thank You!</h1>
            <p>Your message has been submitted successfully.</p>
            <p>We’ll reply within 1–2 business days.</p>
            <div className="contact-success-actions">
              <button className="cta-button primary" onClick={() => navigate('/')} title="Return to Home">
                Return to Home
              </button>
              <button className="cta-button secondary" onClick={() => setIsSubmitted(false)} title="Send another message">
                Send Another Message
              </button>
            </div>
          </div>
        </div>
        <LandingFooter />
        {kiraChatbot}
      </div>
    )
  }

  return (
    <div className="demo-request-page">
      <LandingHeader activePath="/contact" primaryButtonLabel="Get Started Free" />
      <div className="demo-request-container">
        <div className="contact-hero">
          <h1>Talk to us about AIquery</h1>
          <p>
            Request a demo, ask about enterprise plans, or discuss an integration. We’ll get back to you quickly.
          </p>
          <div className="contact-hero-cards">
            <div className="contact-hero-card">
              <div className="contact-hero-card-icon">
                <Mail size={18} />
              </div>
              <div>
                <div className="contact-hero-card-title">Email</div>
                <a className="contact-hero-card-link" href="mailto:support@aiquery.ai">support@aiquery.ai</a>
              </div>
            </div>
            <div className="contact-hero-card">
              <div className="contact-hero-card-icon">⏱</div>
              <div>
                <div className="contact-hero-card-title">Response time</div>
                <div className="contact-hero-card-text">1–2 business days</div>
              </div>
            </div>
            <div className="contact-hero-card">
              <div className="contact-hero-card-icon">✅</div>
              <div>
                <div className="contact-hero-card-title">What you’ll get</div>
                <div className="contact-hero-card-text">A tailored walkthrough + next steps</div>
              </div>
            </div>
          </div>
        </div>

        <div className="demo-content">
          <div className="demo-form-section">
            <h2>Send us a message</h2>
            <form onSubmit={handleSubmit} className="demo-form">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="firstName">First Name *</label>
                  <input
                    type="text"
                    id="firstName"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    className={errors.firstName ? 'error' : ''}
                    placeholder="John"
                  />
                  {errors.firstName && <span className="error-message">{errors.firstName}</span>}
                </div>

                <div className="form-group">
                  <label htmlFor="lastName">Last Name *</label>
                  <input
                    type="text"
                    id="lastName"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    className={errors.lastName ? 'error' : ''}
                    placeholder="Doe"
                  />
                  {errors.lastName && <span className="error-message">{errors.lastName}</span>}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="email">Email *</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className={errors.email ? 'error' : ''}
                  placeholder="john.doe@company.com"
                />
                {errors.email && <span className="error-message">{errors.email}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="companyName">Company Name *</label>
                <input
                  type="text"
                  id="companyName"
                  name="companyName"
                  value={formData.companyName}
                  onChange={handleChange}
                  className={errors.companyName ? 'error' : ''}
                  placeholder="Acme Inc."
                />
                {errors.companyName && <span className="error-message">{errors.companyName}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="jobTitle">Job Title *</label>
                <input
                  type="text"
                  id="jobTitle"
                  name="jobTitle"
                  value={formData.jobTitle}
                  onChange={handleChange}
                  className={errors.jobTitle ? 'error' : ''}
                  placeholder="Data Analyst"
                />
                {errors.jobTitle && <span className="error-message">{errors.jobTitle}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="phoneNumber">Phone Number *</label>
                <input
                  type="tel"
                  id="phoneNumber"
                  name="phoneNumber"
                  value={formData.phoneNumber}
                  onChange={handleChange}
                  className={errors.phoneNumber ? 'error' : ''}
                  placeholder="+1 (555) 123-4567"
                />
                {errors.phoneNumber && <span className="error-message">{errors.phoneNumber}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="timeZone">Your Time Zone *</label>
                <select
                  id="timeZone"
                  name="timeZone"
                  value={formData.timeZone}
                  onChange={handleChange}
                  className={errors.timeZone ? 'error' : ''}
                >
                  <option value="">Select your time zone</option>
                  {timeZones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
                {errors.timeZone && <span className="error-message">{errors.timeZone}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="projectDescription">Project Description *</label>
                <textarea
                  id="projectDescription"
                  name="projectDescription"
                  value={formData.projectDescription}
                  onChange={handleChange}
                  className={errors.projectDescription ? 'error' : ''}
                  placeholder="Tell us about your project and how AIquery can help..."
                  rows={5}
                />
                {errors.projectDescription && <span className="error-message">{errors.projectDescription}</span>}
              </div>

              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="isNotRobot"
                    checked={formData.isNotRobot}
                    onChange={handleChange}
                    className={errors.isNotRobot ? 'error' : ''}
                  />
                  <span>I'm not a robot *</span>
                </label>
                {errors.isNotRobot && <span className="error-message">{errors.isNotRobot}</span>}
              </div>

              {errors.submit && <div className="error-message submit-error">{errors.submit}</div>}

              <button type="submit" className="submit-button" disabled={isSubmitting}>
                {isSubmitting ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          </div>

          <div className="calendly-section">
            <h2>Schedule a 30‑minute call</h2>
            <p>Prefer a live walkthrough? Pick a time that works best for you.</p>
            <div className="calendly-widget">
              {/* TODO: Replace with your actual Calendly embed URL */}
              <iframe
                src="https://calendly.com/your-username/30min"
                width="100%"
                height="600"
                frameBorder="0"
                title="Calendly Scheduling"
              ></iframe>
              <p className="calendly-note">
                Don’t see a time that works? <a href="mailto:support@aiquery.ai">Email us</a> and we’ll find a time that fits your schedule.
              </p>
            </div>
          </div>
        </div>
      </div>
      <LandingFooter />
      {kiraChatbot}
    </div>
  )
}

export default DemoRequest

