import React, { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './HelpDropdown.css'

export type HelpDropdownVariant = 'header' | 'sidebar'

interface HelpDropdownProps {
  /** Use 'header' for app_admin/workspace_creation (icon + "Help" text), 'sidebar' for chat (icon only) */
  variant?: HelpDropdownVariant
  /** Optional class for the trigger button to match page styles (e.g. workspace-icon-button) */
  triggerClassName?: string
}

const HelpDropdown: React.FC<HelpDropdownProps> = ({
  variant = 'header',
  triggerClassName = '',
}) => {
  const { user, token } = useAuth()
  const [open, setOpen] = useState(false)
  const [showContact, setShowContact] = useState(false)
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactSubject, setContactSubject] = useState('')
  const [contactMessage, setContactMessage] = useState('')
  const [isMaximized, setIsMaximized] = useState(false)
  const [modalPos, setModalPos] = useState<{ x: number; y: number } | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // When opening contact modal, pre-fill name and email from user (editable)
  useEffect(() => {
    if (showContact) {
      setContactName(user?.name ?? '')
      setContactEmail(user?.email ?? '')
      setContactSubject('')
      setContactMessage('')
      setIsMaximized(false)
      setModalPos(null)
    }
  }, [showContact, user?.name, user?.email])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  // Dragging: move modal when user drags the header
  useEffect(() => {
    if (!showContact) return
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current || !modalRef.current) return
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      setModalPos({
        x: dragRef.current.startLeft + dx,
        y: dragRef.current.startTop + dy,
      })
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [showContact])

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (isMaximized) return
    if ((e.target as HTMLElement).closest('button')) return
    if (!modalRef.current) return
    const rect = modalRef.current.getBoundingClientRect()
    const left = modalPos !== null ? modalPos.x : rect.left
    const top = modalPos !== null ? modalPos.y : rect.top
    dragRef.current = { startX: e.clientX, startY: e.clientY, startLeft: left, startTop: top }
    if (modalPos === null) setModalPos({ x: left, y: top })
  }

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSendError(null)
    if (!contactEmail?.trim()) {
      setSendError('Email is required.')
      return
    }
    if (!contactMessage?.trim()) {
      setSendError('Message is required.')
      return
    }
    setSending(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch('/api/contact-support', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: contactName.trim() || undefined,
          email: contactEmail.trim(),
          subject: contactSubject.trim() || undefined,
          message: contactMessage.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send message')
      }
      setShowContact(false)
      setContactMessage('')
      setContactSubject('')
      alert(data.message || 'We\'ve received your message and will reply at your email within 1–2 business days.')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send message'
      setSendError(msg)
      // Fallback: offer to open email client
      if (confirm(`${msg}\n\nOpen your email client to send manually?`)) {
        const subject = contactSubject.trim() || `AIquery Support: ${contactName || 'Support request'}`
        const body = [
          `Name: ${contactName || '-'}`,
          `Email: ${contactEmail || '-'}`,
          `Subject: ${contactSubject || '-'}`,
          '',
          contactMessage || '',
        ].join('\n')
        window.open(
          `mailto:support@aiquery.ai?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
          '_blank'
        )
      }
    } finally {
      setSending(false)
    }
  }

  const showLabel = variant === 'header'
  const triggerClass = [
    'help-dropdown-trigger',
    variant === 'sidebar' ? 'help-dropdown-trigger-sidebar' : '',
    triggerClassName,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <div className="help-dropdown" ref={dropdownRef}>
        <button
          type="button"
          className={triggerClass}
          onClick={() => setOpen(!open)}
          aria-label="Help"
          title="Help"
          aria-expanded={open}
          aria-haspopup="true"
        >
          <span className="help-dropdown-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.6-2 2-2 3.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="12" cy="17" r="1" fill="currentColor" />
            </svg>
          </span>
          {showLabel && <span>Help</span>}
        </button>

        {open && (
          <div
            className={`help-dropdown-menu ${variant === 'sidebar' ? 'help-dropdown-menu-sidebar' : ''}`}
            role="menu"
          >
            <Link
              className="help-dropdown-item"
              to="/docs"
              onClick={() => setOpen(false)}
              role="menuitem"
            >
              Documentation
            </Link>
            <button
              type="button"
              className="help-dropdown-item"
              onClick={() => {
                setOpen(false)
                setShowContact(true)
              }}
              role="menuitem"
            >
              Contact Support
            </button>
          </div>
        )}
      </div>

      {showContact && (
        <div
          className="help-contact-overlay"
          onClick={() => setShowContact(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-contact-title"
        >
          <div
            ref={modalRef}
            className={`help-contact-modal ${isMaximized ? 'help-contact-modal-maximized' : ''}`}
            onClick={(e) => e.stopPropagation()}
            style={
              isMaximized
                ? undefined
                : modalPos !== null
                  ? { left: modalPos.x, top: modalPos.y }
                  : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
            }
          >
            <div
              className="help-contact-header"
              onMouseDown={handleHeaderMouseDown}
              role="presentation"
            >
              <h2 id="help-contact-title">Contact Support</h2>
              <div className="help-contact-header-buttons">
                <button
                  type="button"
                  className="help-contact-btn-icon"
                  onClick={() => setIsMaximized(!isMaximized)}
                  aria-label={isMaximized ? 'Restore' : 'Maximize'}
                  title={isMaximized ? 'Restore' : 'Maximize'}
                >
                  {isMaximized ? (
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M4 8h4V4h12v12h-4v4H4V8zm4 10v-4H6v8h8v-2H8zm6-12h2v2h2v2h-2v6h-2V8h-2V6h4V4z"
                      />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M4 4h6v6H4V4zm0 10h6v6H4v-6zm10 0h6v6h-6v-6zm0-10h6v6h-6V4z"
                      />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  className="help-contact-close"
                  onClick={() => setShowContact(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>
            <p className="help-contact-intro">
              Send us a message and we&apos;ll get back to you as soon as we can.
            </p>
            <form className="help-contact-form" onSubmit={handleContactSubmit}>
              <div className="help-contact-row">
                <label htmlFor="help-contact-name">Name</label>
                <input
                  id="help-contact-name"
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div className="help-contact-row">
                <label htmlFor="help-contact-email">Email</label>
                <input
                  id="help-contact-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="your@email.com"
                />
              </div>
              <div className="help-contact-row">
                <label htmlFor="help-contact-subject">Subject</label>
                <input
                  id="help-contact-subject"
                  type="text"
                  value={contactSubject}
                  onChange={(e) => setContactSubject(e.target.value)}
                  placeholder="Subject of your message"
                />
              </div>
              <div className="help-contact-row">
                <label htmlFor="help-contact-message">Message</label>
                <textarea
                  id="help-contact-message"
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  placeholder="How can we help?"
                  rows={4}
                />
              </div>
              {sendError && (
                <p className="help-contact-error" role="alert">
                  {sendError}
                </p>
              )}
              <div className="help-contact-actions">
                <button type="button" className="help-contact-btn secondary" onClick={() => setShowContact(false)} disabled={sending}>
                  Cancel
                </button>
                <button type="submit" className="help-contact-btn primary" disabled={sending}>
                  {sending ? 'Sending…' : 'Send Message'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

export default HelpDropdown
