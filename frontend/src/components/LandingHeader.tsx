import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Logo from './Logo'
import './LandingPage.css'

interface LandingHeaderProps {
  /** Optional extra class (e.g. "pricing-nav" for Pricing page styling). */
  wrapperClassName?: string
  /** Path to mark as active (e.g. "/pricing" adds active class to Pricing link). */
  activePath?: string
  /** Label for primary CTA when not authenticated (default "Sign Up"). */
  primaryButtonLabel?: string
  /** Optional ref for the nav element (e.g. Documentation uses it for layout). */
  navRef?: React.RefObject<HTMLElement | null>
}

const NAV_LINKS = [
  { path: '/', label: 'Home', title: 'Home' },
  { path: '/features', label: 'Features', title: 'Features' },
  { path: '/docs', label: 'Documentation', title: 'Documentation' },
  { path: '/blog', label: 'Blog', title: 'Blog' },
  { path: '/faq', label: 'FAQ', title: 'FAQ' },
  { path: '/pricing', label: 'Pricing', title: 'Pricing' },
  { path: '/contact', label: 'Contact', title: 'Contact' },
]

/**
 * Global header/nav for all landing/public pages.
 * Uses aiquery_logo5.png image only (no text), links to /.
 * Production: always shows Sign In / Sign Up (best practice for public landing).
 * Development: shows Sign Out / Go to App when logged in for local testing.
 */
const LandingHeader: React.FC<LandingHeaderProps> = ({
  wrapperClassName,
  activePath,
  primaryButtonLabel = 'Sign Up',
  navRef,
}) => {
  const navigate = useNavigate()
  const { isAuthenticated, signOut, user } = useAuth()

  const handleLink = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    navigate(path)
  }

  const navClass = wrapperClassName
    ? `landing-nav ${wrapperClassName}`.trim()
    : 'landing-nav'

  const isProduction = import.meta.env.PROD
  const showAuthButtons = !isProduction && isAuthenticated

  return (
    <nav className={navClass} ref={navRef}>
      <div className="nav-container">
        <Logo variant="landing" imageSrc="/images/aiquery_logo5.png" imageOnly />
        <div className="nav-menu">
          {NAV_LINKS.map(({ path, label, title }) => (
            <a
              key={path}
              href={path}
              className={`nav-link${activePath === path ? ' active' : ''}`}
              onClick={handleLink(path)}
              title={title}
            >
              {label}
            </a>
          ))}
        </div>
        <div className="nav-actions">
          {isAuthenticated && user?.isSiteAdmin && (
            <a className="nav-link" href="/admin" onClick={handleLink('/admin')} title="Admin Dashboard">
              Admin
            </a>
          )}
          {showAuthButtons ? (
            <>
              <button className="nav-button secondary" onClick={signOut} title="Sign Out">
                Sign Out
              </button>
              <a className="nav-button primary" href="/app_admin" title="Go to App">
                Go to App
              </a>
            </>
          ) : (
            <>
              <button className="nav-button secondary" onClick={() => navigate('/signin')} title="Sign In">
                Sign In
              </button>
              <button
                className="nav-button primary"
                onClick={() => navigate('/signup')}
                title={primaryButtonLabel}
              >
                {primaryButtonLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}

export default LandingHeader
