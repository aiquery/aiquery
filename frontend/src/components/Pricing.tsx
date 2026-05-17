import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Logo from './Logo'
import LandingHeader from './LandingHeader'
import LandingFooter from './LandingFooter'
import { X, Send } from 'lucide-react'
import GetInTouchSection from './GetInTouchSection'
import './Pricing.css'
import './PricingPlans.css'
import './LandingPage.css'

const Pricing: React.FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated, signOut } = useAuth()

  // Kira chatbot (reuse Landing styles/behavior)
  const [isChatbotOpen, setIsChatbotOpen] = useState(false)
  const [landingChatMessages, setLandingChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    { role: 'assistant', content: "Hi there! 👋 I'm Kira.Very happy to answer your questions about AIquery services." }
  ])
  const [landingChatInput, setLandingChatInput] = useState('')
  const [landingChatLoading, setLandingChatLoading] = useState(false)

  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly')

  const handleGetStarted = (e?: React.MouseEvent) => {
    e?.preventDefault()
    navigate('/signup')
  }

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

  return (
    <div className="pricing-page">
      <LandingHeader
        wrapperClassName="pricing-nav"
        activePath="/pricing"
        primaryButtonLabel="Get Started Free"
      />

      <main className="pricing-main">
        <div className="pricing-landing-wrap">
          <header className="pricing-landing-header">
            <h1 className="pricing-title">Simple, Transparent Pricing</h1>
            <p className="pricing-subtitle">
              Choose the plan that fits your team. Start free, upgrade when you’re ready.
            </p>
          </header>

          <div className="pricing-landing-billing">
            <button
              type="button"
              className={`pricing-landing-toggle-btn ${billingPeriod === 'monthly' ? 'active' : ''}`}
              onClick={() => setBillingPeriod('monthly')}
            >
              Monthly
            </button>
            <button
              type="button"
              className={`pricing-landing-toggle-btn ${billingPeriod === 'yearly' ? 'active' : ''}`}
              onClick={() => setBillingPeriod('yearly')}
            >
              Yearly
              <span className="pricing-landing-save">20% Off</span>
            </button>
          </div>

          <div className="pricing-plans-container pricing-four-plans">
            {/* Free Try */}
            <div className="pricing-plan-card">
              <h3 className="plan-name">Free Try</h3>
              <div className="plan-price">
                <span className="price-amount">$0</span>
                <span className="price-period">30-day free trial</span>
              </div>
              <ul className="plan-features">
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">30 days free trial</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text"><strong>Unlimited connections to Slack</strong> or MS Teams (Under Development)</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text"><strong>Unlimited knowledge base</strong></span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Up to 1 users</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Up to 1 workspace</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Up to 200 queries/month totally</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Up to 2 tables per data source</span></li>
              </ul>
              <button type="button" className="plan-button free" onClick={() => navigate('/signup')}>
                Start Free Trial
              </button>
            </div>

            {/* StartPro */}
            <div className="pricing-plan-card">
              <h3 className="plan-name">StartPro</h3>
              <div className="plan-price">
                <span className="price-amount">
                  {billingPeriod === 'monthly' ? '$40' : '$388'}
                </span>
                <span className="price-period">
                  {billingPeriod === 'monthly' ? '/month' : '/year'}
                </span>
              </div>
              <ul className="plan-features">
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text"><strong>Unlimited connections to Slack</strong> or MS Teams (Under Development)</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text"><strong>Unlimited knowledge base</strong></span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Up to 3 users</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Up to 3 workspace</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Up to 300 queries/month totally</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Up to 5 tables per data source</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Data source customization</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Business customization</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Account permissions management</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Standard customer support</span></li>
              </ul>
              <button type="button" className="plan-button" onClick={() => navigate('/signup', { state: { from: 'pricing', plan: 'startpro', billingPeriod } })}>
                Get Started
              </button>
            </div>

            {/* SmartPro */}
            <div className="pricing-plan-card smartpro">
              <div className="plan-popular-badge">Most Popular</div>
              <h3 className="plan-name">SmartPro</h3>
              <div className="plan-price">
                <span className="price-amount">
                  {billingPeriod === 'monthly' ? '$68' : '$668'}
                </span>
                <span className="price-period">
                  {billingPeriod === 'monthly' ? '/month' : '/year'}
                </span>
              </div>
              <ul className="plan-features">
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text"><strong>Unlimited connections to Slack</strong> or MS Teams (Under Development)</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text"><strong>Unlimited knowledge base</strong></span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Up to 6 users</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Up to 6 workspace</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Up to 800 queries/month totally</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Up to 10 tables per data source</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Data source customization</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Business customization</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Account permissions management</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Priority customer support</span></li>
              </ul>
              <button type="button" className="plan-button smartpro" onClick={() => navigate('/signup', { state: { from: 'pricing', plan: 'smartpro', billingPeriod } })}>
                Get Started
              </button>
            </div>

            {/* Enterprise */}
            <div className="pricing-plan-card">
              <h3 className="plan-name">Enterprise</h3>
              <div className="plan-price">
                <span className="price-amount">Custom</span>
                <span className="price-period">Contact us for pricing</span>
              </div>
              <ul className="plan-features">
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text"><strong>Unlimited connections to Slack</strong> or MS Teams (Under Development)</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text"><strong>Unlimited knowledge base</strong></span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Custom number of users</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Custom number of workspace</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Custom number of queries</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Custom number of tables per data source</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Data source customization</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Business customization</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Account permissions management</span></li>
                <li className="plan-feature"><span className="feature-check">✓</span><span className="feature-text">Dedicated customer support</span></li>
              </ul>
              <button type="button" className="plan-button" onClick={() => navigate('/contact')}>
                Contact Sales
              </button>
            </div>
          </div>

          <p className="pricing-stripe-notice-landing">
            StartPro and SmartPro payments are securely processed by Stripe. We accept Visa, Mastercard, and American Express.
          </p>

          {/* FAQ */}
          <div className="pricing-faq pricing-faq-landing">
            <h3>Frequently asked questions</h3>
            <div className="faq-items">
              <div className="faq-item">
                <h4>Can I change my plan anytime?</h4>
                <p>Yes. You can upgrade or downgrade at any time. Changes apply at the start of your next billing cycle.</p>
              </div>
              <div className="faq-item">
                <h4>What payment methods do you accept?</h4>
                <p>We accept Visa, Mastercard, and American Express through Stripe. All payments are secure.</p>
              </div>
              <div className="faq-item">
                <h4>Is there a free trial?</h4>
                <p>Yes. New accounts get a 30-day free trial. No credit card required to start.</p>
              </div>
              <div className="faq-item">
                <h4>Do you offer discounts for annual billing?</h4>
                <p>Yes. Annual plans save 20% compared to monthly billing.</p>
              </div>
              <div className="faq-item">
                <h4>What about team users?</h4>
                <p>StartPro includes up to 3 users; SmartPro up to 6. Additional users are $10/month each (or $96/year).</p>
              </div>
              <div className="faq-item">
                <h4>Can I cancel anytime?</h4>
                <p>Yes. You can cancel anytime. Access continues until the end of your current billing period.</p>
              </div>
            </div>
          </div>

          {/* Need a custom plan? */}
          <div className="enterprise-section enterprise-section-landing">
            <h3>Need a custom plan?</h3>
            <p>For enterprise customers with specific requirements, we offer custom pricing and dedicated support.</p>
            <button type="button" className="contact-btn" onClick={() => navigate('/contact')}>
              Contact sales
            </button>
          </div>
        </div>
      </main>

      <GetInTouchSection />

      <LandingFooter wrapperClassName="pricing-footer" />

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

    </div>
  )
}

export default Pricing
