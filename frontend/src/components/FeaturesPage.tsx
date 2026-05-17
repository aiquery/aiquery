import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Logo from './Logo'
import LandingHeader from './LandingHeader'
import LandingFooter from './LandingFooter'
import { X, Send } from 'lucide-react'
import GetInTouchSection from './GetInTouchSection'
import './LandingPage.css'
import './FeaturesPage.css'

type LandingChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type FeatureDetail = {
  id: string
  eyebrow: string
  title: string
  description: string
  bullets: string[]
  imageSrc?: string
  imageAlt?: string
  accentClass: 'purple' | 'teal' | 'blue' | 'amber' | 'green'
}

const FeaturesPage: React.FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated, signOut } = useAuth()

  const handleGetStarted = (e?: React.MouseEvent) => {
    e?.preventDefault()
    navigate('/signup')
  }

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const subject = `AIquery Contact: ${contactName || 'New message'}`
    const bodyLines = [
      `Name: ${contactName || '-'}`,
      `Email: ${contactEmail || '-'}`,
      '',
      contactMessage || ''
    ]
    const body = bodyLines.join('\n')
    const mailto = `mailto:support@aiquery.ai?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    window.location.href = mailto
  }

  // Kira chatbot (reuse Landing styles/behavior)
  const [isChatbotOpen, setIsChatbotOpen] = useState(false)
  const [landingChatMessages, setLandingChatMessages] = useState<LandingChatMessage[]>([
    { role: 'assistant', content: "Hi there! 👋 I'm Kira.Very happy to answer your questions about AIquery services." }
  ])
  const [landingChatInput, setLandingChatInput] = useState('')
  const [landingChatLoading, setLandingChatLoading] = useState(false)

  const handleLandingChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!landingChatInput.trim() || landingChatLoading) return

    const fallbackMessage = 'Sorry, it is not relative to AIquery service, I can not answer your question.'
    const userMessage: LandingChatMessage = { role: 'user', content: landingChatInput.trim() }
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

  const featureDetails: FeatureDetail[] = useMemo(() => ([
    {
      id: 'workspaces',
      eyebrow: 'Workspace-first',
      title: 'Workspaces for configuration + collaboration',
      description: 'Organize your setup per workspace so you can switch context cleanly between projects, teams, or clients.',
      bullets: [
        'Create, edit, and open workspaces from Workspace Admin',
        'Configure Data + LLM + Community settings in Workspace Setup',
        'Share workspaces with teammates and control access with roles'
      ],
      imageSrc: '/images/workspace.png',
      imageAlt: 'Workspace',
      accentClass: 'blue'
    },
    {
      id: 'connections',
      eyebrow: 'Connect once',
      title: 'Connect to your data sources',
      description: 'Set up connections to modern warehouses and databases with test + save workflows.',
      bullets: [
        'Supported: BigQuery, Airtable, Databricks, PostgreSQL, MySQL, Snowflake, Redshift, Azure SQL',
        'Test connection before saving to avoid surprises',
        'Inline cards support collapse and maximize for focused setup'
      ],
      imageSrc: '/images/data_sources.png',
      imageAlt: 'Data sources',
      accentClass: 'green'
    },
    {
      id: 'knowledge-base',
      eyebrow: 'Accuracy booster',
      title: 'Knowledge Base (RAG) + Few‑Shot Prompt',
      description: 'Improve SQL generation by grounding the model in your schema and examples.',
      bullets: [
        'Generate a Knowledge Base from selected tables',
        'Edit table metadata and manage included tables',
        'Add Few‑Shot prompts (User Question, Assistant SQL Query, Assistant Answer) to steer results'
      ],
      imageSrc: '/images/workspace.png',
      imageAlt: 'Knowledge Base',
      accentClass: 'purple'
    },
    {
      id: 'querying',
      eyebrow: 'From question → SQL',
      title: 'Natural language querying with SQL transparency',
      description: 'Ask questions in plain English and keep full visibility into what runs on your data.',
      bullets: [
        'See the generated SQL and explanations',
        'Edit and rerun SQL when you need full control',
        'Export results for downstream analysis'
      ],
      imageSrc: '/images/accuracy.png',
      imageAlt: 'Accuracy',
      accentClass: 'amber'
    },
    {
      id: 'visuals',
      eyebrow: 'Instant clarity',
      title: 'Interactive visualizations',
      description: 'Turn results into charts quickly so you can spot trends and outliers without extra tooling.',
      bullets: [
        'Auto-generated charts from query results',
        'Switch chart types and download images',
        'Share insights with your team'
      ],
      imageSrc: '/images/instant.png',
      imageAlt: 'Instant clarity',
      accentClass: 'teal'
    },
    {
      id: 'chat-history',
      eyebrow: 'Stay organized',
      title: 'Chat history and session management',
      description: 'Pick up where you left off with saved sessions.',
      bullets: [
        'Search and rename sessions',
        'Bulk delete sessions when cleaning up',
        'Use sessions to keep threads of analysis separate'
      ],
      imageSrc: '/images/chat_history.png',
      imageAlt: 'Chat history',
      accentClass: 'blue'
    },
    {
      id: 'community',
      eyebrow: 'Query data in Slack Channel',
      title: 'Slack integration',
      description: 'Bring AIquery into your collaboration tools for fast answers and sharing.',
      bullets: [
        'Slack configuration in Community Channels',
        'Teams configuration in Community Channels',
        'Send results, charts, and follow-ups from chats'
      ],
      imageSrc: '/images/Slack_query.png',
      imageAlt: 'Slack integration',
      accentClass: 'purple'
    },
    {
      id: 'billing',
      eyebrow: 'Scale responsibly',
      title: 'Plans, usage, and limits',
      description: 'Track your usage and upgrade when needed.',
      bullets: [
        'View plan and billing period',
        'Monitor monthly usage vs limits',
        'Upgrade for more users, queries, and larger Knowledge Bases'
      ],
      imageSrc: '/images/plans.png',
      imageAlt: 'Plans',
      accentClass: 'teal'
    }
  ]), [])

  return (
    <div className="features-page">
      <LandingHeader
        activePath="/features"
        primaryButtonLabel="Get Started Free"
      />

      <main className="features-main">
        <header className="features-hero">
          <div className="features-hero-inner">
            <h1 className="features-hero-title">
              Detailed features that help you
              <span className="features-hero-accent"> query data anywhere, anytime</span>
            </h1>
            <p className="features-hero-subtitle">
              Workspaces, data source connections, Knowledge Bases, Few‑Shot prompts, collaboration,
              chat history, and integrations—built for real teams.
            </p>
            <div className="features-hero-actions">
              <button className="cta-button primary" onClick={handleGetStarted} title="Get Started Free">
                Get Started Free
              </button>
              <a className="cta-button secondary" href="/contact" title="Request Demo">
                Request Demo
              </a>
            </div>
            <div className="features-toc">
              {featureDetails.map((f) => (
                <a key={f.id} className="features-toc-link" href={`#${f.id}`} title={f.title}>
                  {f.eyebrow}
                </a>
              ))}
            </div>
          </div>
        </header>

        <section className="features-details">
          <div className="features-details-inner">
            {featureDetails.map((feature, idx) => (
              <section
                key={feature.id}
                id={feature.id}
                className={`feature-detail ${idx % 2 === 1 ? 'reverse' : ''}`}
              >
                <div className="feature-detail-text">
                  <div className={`feature-detail-pill ${feature.accentClass}`}>{feature.eyebrow}</div>
                  <h2 className="feature-detail-title">{feature.title}</h2>
                  <p className="feature-detail-description">{feature.description}</p>
                  <ul className="feature-detail-list">
                    {feature.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                  <div className="feature-detail-cta">
                    <a className="feature-detail-link" href="#contact">Talk to us</a>
                    <button
                      type="button"
                      className="feature-detail-link secondary"
                      onClick={() => navigate('/docs')}
                    >
                      Read docs
                    </button>
                  </div>
                </div>
                <div className="feature-detail-media">
                  {feature.imageSrc ? (
                    <div className={`feature-detail-media-card ${feature.accentClass}`}>
                      <img src={feature.imageSrc} alt={feature.imageAlt || feature.title} />
                    </div>
                  ) : (
                    <div className={`feature-detail-media-card ${feature.accentClass}`}>
                      <div className="feature-detail-media-placeholder" />
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </section>

        <GetInTouchSection />
      </main>

      <LandingFooter />

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

export default FeaturesPage

