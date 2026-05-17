import React from 'react'
import { useNavigate } from 'react-router-dom'
import './Logo.css'

interface LogoProps {
  linkToAdmin?: boolean
  /** Use only on landing pages (outside account). Uses aiquery_logo2.png, Azeret Mono, links to /. */
  variant?: 'default' | 'landing'
  /** Optional image path override (e.g. footer uses aiquery_logo4.png). */
  imageSrc?: string
  /** When true, render only the image (no "AIquery" text). Used for footer. */
  imageOnly?: boolean
}

const Logo: React.FC<LogoProps> = ({ linkToAdmin = true, variant = 'default', imageSrc, imageOnly = false }) => {
  const navigate = useNavigate()

  if (variant === 'landing') {
    const logoImg = imageSrc ?? '/images/aiquery_logo2.png'
    return (
      <a
        className={`aiquery-logo aiquery-logo-landing${imageOnly ? ' aiquery-logo-image-only' : ''}`}
        href="/"
        onClick={(e) => { e.preventDefault(); navigate('/') }}
        title="AIquery Home"
        aria-label="AIquery Home"
      >
        <div className="logo-icon">
          <img src={logoImg} alt="AIquery logo" />
        </div>
        {!imageOnly && (
          <div className="logo-text">
            <span className="logo-primary">AIquery</span>
          </div>
        )}
      </a>
    )
  }

  if (!linkToAdmin) {
    const logoImg = imageSrc ?? '/images/aiquery-logo1.png'
    return (
      <div className={`aiquery-logo${imageOnly ? ' aiquery-logo-image-only' : ''}`}>
        <div className="logo-icon">
          <img src={logoImg} alt="AIquery logo" />
        </div>
        {!imageOnly && (
          <div className="logo-text">
            <span className="logo-primary">AIquery</span>
          </div>
        )}
      </div>
    )
  }

  const logoImg = imageSrc ?? '/images/aiquery-logo1.png'
  return (
    <a
      className={`aiquery-logo${imageOnly ? ' aiquery-logo-image-only' : ''}`}
      href="/app_admin"
      title="Workspace Admin"
      aria-label="Workspace Admin"
    >
      <div className="logo-icon">
        <img src={logoImg} alt="AIquery logo" />
      </div>
      {!imageOnly && (
        <div className="logo-text">
          <span className="logo-primary">AIquery</span>
        </div>
      )}
    </a>
  )
}

export default Logo

