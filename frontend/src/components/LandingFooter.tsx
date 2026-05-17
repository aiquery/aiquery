import React from 'react'
import { useNavigate } from 'react-router-dom'
import Logo from './Logo'
import './LandingPage.css'

interface LandingFooterProps {
  /** Optional extra class (e.g. "pricing-footer" for Pricing page styling). */
  wrapperClassName?: string
}

/**
 * Global footer for all landing/public pages.
 * Uses aiquery_logo5.png and tagline "Data-driven decisions with AI anywhere anytime."
 */
const LandingFooter: React.FC<LandingFooterProps> = ({ wrapperClassName }) => {
  const navigate = useNavigate()

  const handleLink = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    navigate(path)
  }

  const footerClass = wrapperClassName
    ? `landing-footer ${wrapperClassName}`.trim()
    : 'landing-footer'

  return (
    <footer className={footerClass}>
      <div className="footer-content">
        <div className="footer-section">
          <Logo variant="landing" imageSrc="/images/aiquery_logo5.png" imageOnly />
          <p>Data-driven decisions with AI anywhere anytime.</p>
        </div>
        <div className="footer-section">
          <h4>Product</h4>
          <a href="/features" onClick={handleLink('/features')} title="Features">Features</a>
          <a href="/docs" onClick={handleLink('/docs')} title="Documentation">Documentation</a>
          <a href="/pricing" onClick={handleLink('/pricing')} title="Pricing">Pricing</a>
          <a href="/faq" onClick={handleLink('/faq')} title="FAQ">FAQ</a>
          <a href="/contact" onClick={handleLink('/contact')} title="Contact">Contact</a>
        </div>
        <div className="footer-section">
          <h4>Resources</h4>
          <a href="/blog" onClick={handleLink('/blog')} title="Blog">Blog</a>
          <a href="/contact" onClick={handleLink('/contact')} title="Request Demo">Request Demo</a>
        </div>
        <div className="footer-section">
          <h4>Legal</h4>
          <a href="/privacy" onClick={handleLink('/privacy')} title="Privacy Policy">Privacy Policy</a>
          <a href="/terms" onClick={handleLink('/terms')} title="Terms of Service">Terms of Service</a>
        </div>
      </div>
      <div className="footer-bottom">
        <p>Copyright &copy; {new Date().getFullYear()} AIquery. All rights reserved.</p>
      </div>
    </footer>
  )
}

export default LandingFooter
