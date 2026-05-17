import React, { useState } from 'react'
import { Mail } from 'lucide-react'
import './GetInTouchSection.css'

interface GetInTouchSectionProps {
  /** Optional id for the section (e.g. "contact" for anchor links). */
  id?: string
  /** Subtitle under "Get in touch". */
  subtitle?: string
}

const DEFAULT_SUBTITLE = 'Have questions about enterprise plans or need a custom integration? Our team is ready to help.'

const GetInTouchSection: React.FC<GetInTouchSectionProps> = ({
  id = 'contact',
  subtitle = DEFAULT_SUBTITLE,
}) => {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email?.trim() || !message?.trim()) {
      setError('Email and message are required.')
      return
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      setError('Please enter a valid email address.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/contact-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim(),
          subject: undefined,
          message: message.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to send message')
      setSubmitted(true)
      setName('')
      setEmail('')
      setMessage('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section id={id} className="getintouch-section">
      <div className="getintouch-container">
        <div className="getintouch-grid">
          <div>
            <h2 className="getintouch-heading">Get in touch</h2>
            <p className="getintouch-subtitle">{subtitle}</p>
            <div className="getintouch-support">
              <div className="getintouch-support-icon">
                <Mail size={24} />
              </div>
              <div>
                <div className="getintouch-support-label">Email Support</div>
                <a href="mailto:support@aiquery.ai" className="getintouch-support-link">
                  support@aiquery.ai
                </a>
              </div>
            </div>
          </div>

          <div className="getintouch-card">
            {submitted ? (
              <div className="getintouch-success">
                <p className="getintouch-success-title">Thank you!</p>
                <p>We&apos;ve received your message and will reply at your email within 1–2 business days. A confirmation was sent to your email.</p>
                <button type="button" className="getintouch-submit" style={{ marginTop: '1rem' }} onClick={() => setSubmitted(false)}>
                  Send another message
                </button>
              </div>
            ) : (
              <form className="getintouch-form" onSubmit={handleSubmit}>
                {error && <p className="getintouch-form-error" role="alert">{error}</p>}
                <div className="getintouch-form-row">
                  <div className="getintouch-field">
                    <label htmlFor="getintouch-name" className="getintouch-label">Name</label>
                    <input
                      id="getintouch-name"
                      className="getintouch-input"
                      placeholder="John Doe"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="getintouch-field">
                    <label htmlFor="getintouch-email" className="getintouch-label">Email</label>
                    <input
                      id="getintouch-email"
                      className="getintouch-input"
                      type="email"
                      placeholder="john@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="getintouch-field">
                  <label htmlFor="getintouch-message" className="getintouch-label">Message</label>
                  <textarea
                    id="getintouch-message"
                    className="getintouch-textarea"
                    placeholder="How can we help you?"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="getintouch-submit" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send Message'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export default GetInTouchSection
