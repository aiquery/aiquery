import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Logo from './Logo'
import LandingHeader from './LandingHeader'
import LandingFooter from './LandingFooter'
import { X, Send, Search, ChevronDown } from 'lucide-react'
import GetInTouchSection from './GetInTouchSection'
import './LandingPage.css'
import './FAQPage.css'

type FAQItem = {
  id: string
  category: string
  question: string
  answer: string
}

const FAQPage: React.FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated, signOut } = useAuth()

  // Contact section (reuse Landing styles/behavior)
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactMessage, setContactMessage] = useState('')

  // Kira chatbot (reuse Landing styles/behavior)
  const [isChatbotOpen, setIsChatbotOpen] = useState(false)
  const [landingChatMessages, setLandingChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    { role: 'assistant', content: "Hi there! 👋 I'm Kira.Very happy to answer your questions about AIquery services." }
  ])
  const [landingChatInput, setLandingChatInput] = useState('')
  const [landingChatLoading, setLandingChatLoading] = useState(false)

  const [activeCategory, setActiveCategory] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

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

  const faqItems: FAQItem[] = useMemo(() => ([
    {
      id: 'what-is-aiquery',
      category: 'Getting started',
      question: 'What is AIquery?',
      answer:
        'AIquery is a workspace-first product that lets you ask questions in natural language and get results (and SQL) from your connected data sources. You keep visibility into the SQL and can refine it when needed.'
    },
    {
      id: 'workspace-first',
      category: 'Workspaces',
      question: 'Why is AIquery “workspace-first”?',
      answer:
        'Workspaces separate configuration + collaboration. Each workspace can have its own data source connections, LLM settings, Knowledge Base (RAG), and members—so teams can switch context cleanly.'
    },
    {
      id: 'supported-data-sources',
      category: 'Data sources',
      question: 'Which data sources are supported?',
      answer:
        'AIquery supports common warehouses and databases such as BigQuery, Airtable, Databricks, PostgreSQL, MySQL, Snowflake, Redshift, and Azure SQL.\n\nYou can connect and test before saving.'
    },
    {
      id: 'knowledge-base',
      category: 'Knowledge Base',
      question: 'What is the Knowledge Base (RAG) and why should I use it?',
      answer:
        'The Knowledge Base grounds the model in your schema (tables/columns) and your metadata so it generates more accurate SQL. You can also add Few‑Shot prompts (example Q → SQL → answer) to steer results.'
    },
    {
      id: 'few-shot',
      category: 'Knowledge Base',
      question: 'What are Few‑Shot prompts?',
      answer:
        'Few‑Shot prompts are curated examples in your workspace that teach the model your preferred query patterns. Each example includes a User Question, Assistant SQL Query, and Assistant Answer.'
    },
    {
      id: 'sql-transparency',
      category: 'Querying',
      question: 'Can I see and edit the SQL before it runs?',
      answer:
        'Yes. AIquery shows generated SQL, and you can edit and rerun it when you need full control.'
    },
    {
      id: 'slack',
      category: 'Integrations',
      question: 'Can I query data from Slack?',
      answer:
        'Yes. AIquery supports Slack integration so teams can ask questions in channels and receive results back in Slack.'
    },
    {
      id: 'billing',
      category: 'Billing',
      question: 'How do plans, usage, and limits work?',
      answer:
        'Plans determine the number of users, monthly query limits, and Knowledge Base sizing. You can monitor usage and upgrade when needed.'
    },
    {
      id: 'security',
      category: 'Security',
      question: 'Do you enforce permissions?',
      answer:
        'AIquery is designed to work with your existing data source permissions and workspace access controls. Make sure each connection uses credentials scoped to the appropriate access level.'
    }
  ]), [])

  const categories = useMemo(() => {
    const set = new Set<string>()
    faqItems.forEach(i => set.add(i.category))
    return ['All', ...Array.from(set).sort()]
  }, [faqItems])

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return faqItems
      .filter(i => (activeCategory === 'All' ? true : i.category === activeCategory))
      .filter(i => {
        if (!q) return true
        return (
          i.question.toLowerCase().includes(q) ||
          i.answer.toLowerCase().includes(q) ||
          i.category.toLowerCase().includes(q)
        )
      })
  }, [faqItems, activeCategory, searchQuery])

  const nav = (
    <LandingHeader
      activePath="/faq"
      primaryButtonLabel="Get Started Free"
    />
  )

  const footer = <LandingFooter />

  const contactSection = <GetInTouchSection subtitle="If you can't find what you're looking for, send us a note and we'll help you out." />

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

  return (
    <div className="faq-page">
      {nav}
      <main className="faq-main">
        <header className="faq-hero">
          <h1>Frequently asked questions</h1>
          <p>
            Quick answers about workspaces, connections, Knowledge Bases, Slack integration, and billing.
          </p>

          <div className="faq-toolbar">
            <div className="faq-search">
              <Search size={16} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search questions…"
                aria-label="Search FAQs"
              />
            </div>

            <div className="faq-categories" role="tablist" aria-label="FAQ categories">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`faq-category-chip ${activeCategory === cat ? 'active' : ''}`}
                  onClick={() => { setActiveCategory(cat); setOpenId(null) }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="faq-content">
          <section className="faq-list" aria-label="FAQ list">
            {filteredItems.length === 0 ? (
              <div className="faq-empty">
                No results. Try a different keyword or choose another category.
              </div>
            ) : (
              filteredItems.map((item) => {
                const isOpen = openId === item.id
                return (
                  <div key={item.id} className={`faq-item ${isOpen ? 'open' : ''}`}>
                    <button
                      type="button"
                      className="faq-question"
                      onClick={() => setOpenId(prev => (prev === item.id ? null : item.id))}
                      aria-expanded={isOpen}
                    >
                      <div>
                        <div className="faq-question-title">{item.question}</div>
                        <div className="faq-question-meta">{item.category}</div>
                      </div>
                      <ChevronDown className="faq-chevron" size={18} />
                    </button>
                    {isOpen && (
                      <div className="faq-answer">
                        {item.answer}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </section>

          <aside className="faq-side">
            <h3>Need more help?</h3>
            <p>
              If your question is about setup in your workspace, the docs may have the step-by-step flow.
            </p>
            <div className="faq-side-actions">
              <button type="button" className="faq-side-action" onClick={() => navigate('/docs')}>
                Read documentation
              </button>
              <button type="button" className="faq-side-action" onClick={() => navigate('/contact')}>
                Contact sales / request demo
              </button>
            </div>
          </aside>
        </div>
      </main>

      {contactSection}
      {footer}
      {kiraChatbot}

    </div>
  )
}

export default FAQPage

