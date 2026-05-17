import React, { useState, useRef, useEffect, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Logo from './Logo'
import LandingHeader from './LandingHeader'
import LandingFooter from './LandingFooter'
import Scene3D from './Scene3D'
import TaglineDots3D from './TaglineDots3D'
import ErrorBoundary from './ErrorBoundary'
import BigQueryIcon from './icons/BigQueryIcon'
import AirtableIcon from './icons/AirtableIcon'
import PostgreSQLIcon from './icons/PostgreSQLIcon'
import MySQLIcon from './icons/MySQLIcon'
import RedshiftIcon from './icons/RedshiftIcon'
import AzureSQLIcon from './icons/AzureSQLIcon'
import SnowflakeIcon from './icons/SnowflakeIcon'
import DatabricksIcon from './icons/DatabricksIcon'
import CustomIcon from './icons/CustomIcon'
import {
  MessageSquare,
  Slack,
  Lightbulb,
  Database,
  BarChart3,
  Download,
  Search,
  Layers,
  Star,
  X,
  Send,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { blogPosts } from './Blog'
import GetInTouchSection from './GetInTouchSection'
import './LandingPage.css'

const landingFeatures = [
  {
    title: 'Natural Language Queries',
    description: 'Ask questions about your data in plain English. No SQL knowledge required.',
    colorClass: 'feature-icon-blue',
    icon: (
      <MessageSquare className="feature-icon-svg" />
    )
  },
  {
    title: 'Slack Integration',
    description: 'Query your data directly from Slack or Microsoft Teams (Under Development).',
    colorClass: 'feature-icon-purple',
    icon: (
      <Slack className="feature-icon-svg" />
    )
  },
  {
    title: 'AI Powered Insight',
    description: 'Get automated insights and recommendations to enhance your business decisions.',
    colorClass: 'feature-icon-amber',
    icon: (
      <Lightbulb className="feature-icon-svg" />
    )
  },
  {
    title: 'SQL Query Transparency',
    description: 'Create, explain, edit, and rerun queries in one place for different data sources.',
    colorClass: 'feature-icon-indigo',
    icon: (
      <Database className="feature-icon-svg" />
    )
  },
  {
    title: 'Interactive Visualizations',
    description: 'Automatic chart generation from query results for instant visual understanding.',
    colorClass: 'feature-icon-teal',
    icon: (
      <BarChart3 className="feature-icon-svg" />
    )
  },
  {
    title: 'Formatted Data Export',
    description: 'Download query results data as CSV for further analysis in other tools.',
    colorClass: 'feature-icon-green',
    icon: (
      <Download className="feature-icon-svg" />
    )
  },
  {
    title: 'RAG Powered Accuracy',
    description: 'Enhanced query accuracy with Retrieval-Augmented Generation at table/column level.',
    colorClass: 'feature-icon-rose',
    icon: (
      <Search className="feature-icon-svg" />
    )
  },
  {
    title: 'Multi Data Source',
    description: 'Connect to Airtable, Redshift, Azure, BigQuery, MySQL, PostgreSQL, Snowflake, and more.',
    colorClass: 'feature-icon-cyan',
    icon: (
      <Layers className="feature-icon-svg" />
    )
  }
]

const testimonials = [
  {
    quote: 'AIquery has completely transformed how our marketing team accesses data. We no longer have to wait days for SQL reports.',
    author: 'Sarah Jenkins',
    role: 'CMO at TechFlow',
    avatar: 'SJ'
  },
  {
    quote: 'The natural language processing is surprisingly accurate. It understands complex joins and filters that even our junior analysts struggle with.',
    author: 'Michael Chen',
    role: 'Data Lead at FinCorp',
    avatar: 'MC'
  },
  {
    quote: 'Setting up the Slack integration took literally 2 minutes. Now our CEO asks questions directly in the channel and gets charts instantly.',
    author: 'David Wilson',
    role: 'CTO at StartupX',
    avatar: 'DW'
  }
]

type LandingChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

const LandingPage: React.FC = () => {
  console.log('LandingPage rendering')
  const navigate = useNavigate()
  const { isAuthenticated, signOut } = useAuth()
  const [openFAQ, setOpenFAQ] = useState<string | null>(null)
  const dataSourcesScrollRef = useRef<HTMLDivElement>(null)
  const blogScrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)
  const [canBlogScrollLeft, setCanBlogScrollLeft] = useState(false)
  const [canBlogScrollRight, setCanBlogScrollRight] = useState(true)
  const [isChatbotOpen, setIsChatbotOpen] = useState(false)
  const [landingChatMessages, setLandingChatMessages] = useState<LandingChatMessage[]>([
    {
      role: 'assistant',
      content: "Hi there! 👋 I'm Kira.Very happy to answer your questions about AIquery services."
    }
  ])
  const [landingChatInput, setLandingChatInput] = useState('')
  const [landingChatLoading, setLandingChatLoading] = useState(false)

  const handleGetStarted = (e?: React.MouseEvent) => {
    e?.preventDefault()
    navigate('/signup')
  }

  const checkScrollButtons = () => {
    if (dataSourcesScrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = dataSourcesScrollRef.current
      setCanScrollLeft(scrollLeft > 0)
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10)
    }
    if (blogScrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = blogScrollRef.current
      setCanBlogScrollLeft(scrollLeft > 0)
      setCanBlogScrollRight(scrollLeft < scrollWidth - clientWidth - 10)
    }
  }

  useEffect(() => {
    checkScrollButtons()
    const scrollContainer = dataSourcesScrollRef.current
    const blogContainer = blogScrollRef.current
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', checkScrollButtons)
    }
    if (blogContainer) {
      blogContainer.addEventListener('scroll', checkScrollButtons)
    }
    window.addEventListener('resize', checkScrollButtons)
    return () => {
      scrollContainer?.removeEventListener('scroll', checkScrollButtons)
      blogContainer?.removeEventListener('scroll', checkScrollButtons)
      window.removeEventListener('resize', checkScrollButtons)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(checkScrollButtons, 150)
    return () => clearTimeout(t)
  }, [blogPosts.length])

  const scrollDataSources = (direction: 'left' | 'right') => {
    if (dataSourcesScrollRef.current) {
      const scrollAmount = 300
      const newScrollLeft = dataSourcesScrollRef.current.scrollLeft + (direction === 'left' ? -scrollAmount : scrollAmount)
      dataSourcesScrollRef.current.scrollTo({
        left: newScrollLeft,
        behavior: 'smooth'
      })
    }
  }

  const scrollBlog = (direction: 'left' | 'right') => {
    if (blogScrollRef.current) {
      const cardWidth = 360
      const scrollAmount = cardWidth + 24
      const newScrollLeft = blogScrollRef.current.scrollLeft + (direction === 'left' ? -scrollAmount : scrollAmount)
      blogScrollRef.current.scrollTo({
        left: newScrollLeft,
        behavior: 'smooth'
      })
    }
  }

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
    } catch (error) {
      setLandingChatMessages(prev => [...prev, { role: 'assistant', content: fallbackMessage }])
    } finally {
      setLandingChatLoading(false)
    }
  }

  return (
    <div className="landing-page">
      {/* Hero area: static gradient only, no 3D. Fixed, covers first viewport. */}
      <div className="landing-hero-bg" aria-hidden="true" />

      {/* 3D only below the fold so hero never sees stars/comet */}
      <div className="landing-background landing-background-below-fold">
        <ErrorBoundary fallback={<div style={{ width: '100%', height: '100%', background: '#000000' }} />}>
          <Suspense fallback={<div style={{ width: '100%', height: '100%', background: '#000000' }} />}>
            <Scene3D />
          </Suspense>
        </ErrorBoundary>
      </div>

      <LandingHeader activePath="/" />

      <main className="landing-main">
        <div className="landing-hero-zone">
          <div className="landing-tagline-wrap">
            <div className="landing-tagline-dots3d">
              <TaglineDots3D />
            </div>
            <div className="landing-tagline">
              <h2 className="landing-tagline-title">
                One Stop Data Driver: Connect Slack to Your Data Sources in Minutes
              </h2>
            </div>
          </div>
          <div className="landing-hero">
          <div className="hero-content">
            <div className="hero-eyebrow hero-animate hero-animate-1">
              <span className="hero-dot" aria-hidden="true" />
              RAG and sql query edit/run Support
            </div>
            <h1 className="hero-title hero-animate hero-animate-2">
              Query your data using <br />
              <span className="gradient-text">Natural Language Anywhere Anytime</span>
            </h1>
            <p className="hero-subtitle hero-animate hero-animate-3">
              Stop writing complex SQL. Simply ask questions in plain English and get instant results with interactive visualizations. Explore your data warehouse from Slack directly in seconds.
            </p>
            <div className="hero-actions hero-animate hero-animate-4">
              <button className="cta-button primary" onClick={handleGetStarted} title="Get Started Free">
                Get Started Free
              </button>
              <a className="cta-button secondary" href="/contact" onClick={(e) => { e.preventDefault(); navigate('/contact'); }} title="Request Demo">
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                  </svg>
                  Request Demo
                </span>
              </a>
            </div>
            <div className="hero-meta hero-animate hero-animate-5">
              <div className="hero-meta-item">
                <svg className="hero-meta-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"></path>
                </svg>
                <span>No credit card required</span>
              </div>
              <div className="hero-meta-item">
                <svg className="hero-meta-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"></path>
                </svg>
                <span>30-day free trial</span>
              </div>
            </div>
          </div>
          <div className="hero-image hero-animate hero-animate-6">
            <div className="hero-image-card">
              <img
                src="/images/hero-visualization.png"
                alt="AI Data Visualization"
              />
            </div>
            <div className="hero-floating-card">
              <div className="hero-floating-header">
                <span className="hero-floating-icon" aria-hidden="true">✓</span>
                <span className="hero-floating-title">Query Completed</span>
              </div>
              <div className="hero-floating-progress">
                <div className="hero-floating-progress-bar" />
              </div>
            </div>
            <div className="hero-glow" aria-hidden="true" />
            <div className="hero-orb hero-orb-top" aria-hidden="true" />
            <div className="hero-orb hero-orb-bottom" aria-hidden="true" />
            <div className="hero-dots hero-dots-top" aria-hidden="true" />
            <div className="hero-dots hero-dots-bottom" aria-hidden="true" />
          </div>
        </div>
        </div>

        <section id="features" className="features-section">
          <div className="features-container">
            <div className="features-header">
              <h2 className="features-title">
                Everything you need to <br />
                <span className="features-title-accent">unlock your data&apos;s potential</span>
              </h2>
              <p className="features-subtitle">
                AIquery combines the power of large language models with your business data to deliver instant answers and actionable insights.
              </p>
            </div>
            <div className="features-grid">
              {landingFeatures.map((feature) => (
                <div key={feature.title} className="feature-card">
                  <div className={`feature-icon-wrapper ${feature.colorClass}`}>
                    {feature.icon}
                  </div>
                  <h3 className="feature-card-title">{feature.title}</h3>
                  <p className="feature-card-text">{feature.description}</p>
                </div>
              ))}
            </div>
            <div className="feature-highlight">
              <div className="feature-highlight-text">
                <span className="feature-pill feature-pill-purple">Slack Integration</span>
                <h3 className="feature-highlight-title">
                  Slack to query data directly <span className="feature-highlight-accent purple">where you work</span>
                </h3>
                <p className="feature-highlight-body">
                  No need to switch tabs. Connect your data warehouse to Slack and ask questions in your Slack channels on any device anywhere anytime. Get answers and charts instantly without breaking your workflow.
                </p>
                <ul className="feature-highlight-list">
                  {['Ask questions in Slack channel', 'Share insights with one click', 'Collaborative data exploration'].map((item) => (
                    <li key={item}>
                      <span className="feature-check feature-check-purple">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="feature-highlight-media">
                <div className="feature-highlight-glow feature-highlight-glow-purple" aria-hidden="true" />
                <img
                  src="/images/feature-slack1.png"
                  alt="Slack Integration"
                  className="feature-highlight-image"
                />
              </div>
            </div>
            <div className="feature-highlight">
              <div className="feature-highlight-media">
                <div className="feature-highlight-glow feature-highlight-glow-teal" aria-hidden="true" />
                <img
                  src="/images/feature-analytics.png"
                  alt="Interactive Analytics"
                  className="feature-highlight-image"
                />
              </div>
              <div className="feature-highlight-text">
                <span className="feature-pill feature-pill-teal">Visual Intelligence</span>
                <h3 className="feature-highlight-title">
                  Turn answers into <span className="feature-highlight-accent teal">visual stories</span>
                </h3>
                <p className="feature-highlight-body">
                  Don&apos;t just get a table of numbers. AIquery automatically selects the best visualization for your data, helping you spot trends and outliers instantly.
                </p>
                <ul className="feature-highlight-list">
                  {['Auto-generated charts', 'Interactive dashboards', 'Exportable high-res images'].map((item) => (
                    <li key={item}>
                      <span className="feature-check feature-check-teal">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="data-sources" className="data-sources-section">
          <div className="data-sources-header">
            <h2 className="section-title">Supported Data Sources</h2>
            <p className="section-subtitle">Support to the most popular data platforms and your database is very welcome to be customized to connect.</p>
          </div>
          <div className="data-sources-container">
            <button 
              className="data-sources-scroll-btn data-sources-scroll-left"
              onClick={() => scrollDataSources('left')}
              disabled={!canScrollLeft}
              aria-label="Scroll left"
            >
              ←
            </button>
            <div className="data-sources-grid" ref={dataSourcesScrollRef}>
              <div className="data-source-card">
                <div className="data-source-icon">
                  <AirtableIcon size={48} />
                </div>
                <h3>Airtable</h3>
              </div>
              <div className="data-source-card">
                <div className="data-source-icon">
                  <RedshiftIcon size={48} />
                </div>
                <h3>AWS Redshift</h3>
              </div>
              <div className="data-source-card">
                <div className="data-source-icon">
                  <AzureSQLIcon size={48} />
                </div>
                <h3>Azure SQL</h3>
              </div>
              <div className="data-source-card">
                <div className="data-source-icon">
                  <BigQueryIcon size={48} />
                </div>
                <h3>BigQuery</h3>
              </div>
              <div className="data-source-card">
                <div className="data-source-icon">
                  <DatabricksIcon size={48} />
                </div>
                <h3>Databricks</h3>
              </div>
              <div className="data-source-card">
                <div className="data-source-icon">
                  <MySQLIcon size={48} />
                </div>
                <h3>MySQL</h3>
              </div>
              <div className="data-source-card">
                <div className="data-source-icon">
                  <PostgreSQLIcon size={48} />
                </div>
                <h3>PostgreSQL</h3>
              </div>
              <div className="data-source-card">
                <div className="data-source-icon">
                  <SnowflakeIcon size={48} />
                </div>
                <h3>Snowflake</h3>
              </div>
              <div className="data-source-card">
                <div className="data-source-icon">
                  <CustomIcon size={48} />
                </div>
                <h3>Custom</h3>
              </div>
            </div>
            <button 
              className="data-sources-scroll-btn data-sources-scroll-right"
              onClick={() => scrollDataSources('right')}
              disabled={!canScrollRight}
              aria-label="Scroll right"
            >
              →
            </button>
          </div>
        </section>

        <section className="testimonials-section">
          <div className="testimonials-container">
            <div className="testimonials-header">
              <h2 className="testimonials-title">Trusted by data-driven teams</h2>
            </div>
            <div className="testimonials-grid">
              {testimonials.map((item, index) => (
                <div key={index} className="testimonial-card">
                  <div className="testimonial-stars">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="testimonial-star" />
                    ))}
                  </div>
                  <p className="testimonial-quote">"{item.quote}"</p>
                  <div className="testimonial-author">
                    <div className="testimonial-avatar">{item.avatar}</div>
                    <div className="testimonial-meta">
                      <div className="testimonial-name">{item.author}</div>
                      <div className="testimonial-role">{item.role}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ========== Blog Section ========== */}
        <section id="blog" className="blog-section">
          <h2 className="section-title">📝 Blog</h2>
          <div className="blog-carousel-wrap">
            <button
              type="button"
              className="blog-carousel-btn blog-carousel-btn-left"
              onClick={() => scrollBlog('left')}
              disabled={!canBlogScrollLeft}
              aria-label="Previous posts"
            >
              <ChevronLeft size={28} />
            </button>
            <div className="blog-carousel" ref={blogScrollRef}>
              {blogPosts.map((post) => (
                <div
                  key={post.id}
                  className="blog-card"
                  onClick={() => navigate(`/blog/${post.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/blog/${post.id}`)}
                >
                  <div className="blog-card-image">
                    {post.imageUrl ? (
                      <img src={post.imageUrl} alt={post.title} />
                    ) : (
                      <div className="blog-card-image-placeholder" aria-hidden>📄</div>
                    )}
                  </div>
                  <div className="blog-card-content">
                    <span className="blog-card-category">{post.category}</span>
                    <h3>{post.title}</h3>
                    <p>{post.excerpt}</p>
                    <div className="blog-card-meta">
                      <span>{post.author}</span>
                      <span>•</span>
                      <span>{new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="blog-carousel-btn blog-carousel-btn-right"
              onClick={() => scrollBlog('right')}
              disabled={!canBlogScrollRight}
              aria-label="Next posts"
            >
              <ChevronRight size={28} />
            </button>
          </div>
          <div className="blog-section-actions">
            <button
              type="button"
              className="blog-view-all-button"
              onClick={() => navigate('/blog')}
            >
              View All Posts →
            </button>
          </div>
        </section>

        {/* ========== FAQ Section ========== */}
        <section id="faq" className="faq-section">
          <h2 className="section-title">❓ Frequently Asked Questions</h2>
          <div className="faq-container">
            <div 
              className={`faq-item ${openFAQ === 'what-is-aiquery' ? 'open' : ''}`}
              id="faq-what-is-aiquery"
            >
              <button 
                className="faq-question"
                onClick={() => setOpenFAQ(openFAQ === 'what-is-aiquery' ? null : 'what-is-aiquery')}
              >
                <span>What is AIquery?</span>
                <span className="faq-icon">{openFAQ === 'what-is-aiquery' ? '−' : '+'}</span>
              </button>
              <div className="faq-answer">
                <p>AIquery is a modern web application that allows you to query your data using natural language. Instead of writing complex SQL queries, you can simply ask questions in plain English and get instant results with interactive visualizations. It supports multiple data sources including BigQuery, Airtable, PostgreSQL, MySQL, Redshift, Snowflake, Azure SQL, and Databricks.</p>
              </div>
            </div>

            <div 
              className={`faq-item ${openFAQ === 'how-does-it-work' ? 'open' : ''}`}
              id="faq-how-does-it-work"
            >
              <button 
                className="faq-question"
                onClick={() => setOpenFAQ(openFAQ === 'how-does-it-work' ? null : 'how-does-it-work')}
              >
                <span>How does AIquery work?</span>
                <span className="faq-icon">{openFAQ === 'how-does-it-work' ? '−' : '+'}</span>
              </button>
              <div className="faq-answer">
                <p>AIquery uses advanced AI technology (Large Language Models like GPT-4 or Gemini) to convert your natural language questions into SQL queries. The system understands your intent, analyzes your database schema, and generates accurate queries. You can also create RAG (Retrieval-Augmented Generation) indexes to improve query accuracy by providing context about your database structure.</p>
              </div>
            </div>

            <div 
              className={`faq-item ${openFAQ === 'what-data-sources' ? 'open' : ''}`}
              id="faq-what-data-sources"
            >
              <button 
                className="faq-question"
                onClick={() => setOpenFAQ(openFAQ === 'what-data-sources' ? null : 'what-data-sources')}
              >
                <span>What data sources does AIquery support?</span>
                <span className="faq-icon">{openFAQ === 'what-data-sources' ? '−' : '+'}</span>
              </button>
              <div className="faq-answer">
                <p>AIquery supports a wide range of data sources:</p>
                <ul>
                  <li>Google BigQuery</li>
                  <li>Airtable</li>
                  <li>PostgreSQL</li>
                  <li>MySQL</li>
                  <li>AWS Redshift</li>
                  <li>Azure SQL</li>
                  <li>Snowflake</li>
                  <li>Databricks</li>
                </ul>
                <p>You can connect multiple data sources and switch between them easily.</p>
              </div>
            </div>

            <div 
              className={`faq-item ${openFAQ === 'do-i-need-sql-knowledge' ? 'open' : ''}`}
              id="faq-do-i-need-sql-knowledge"
            >
              <button 
                className="faq-question"
                onClick={() => setOpenFAQ(openFAQ === 'do-i-need-sql-knowledge' ? null : 'do-i-need-sql-knowledge')}
              >
                <span>Do I need to know SQL to use AIquery?</span>
                <span className="faq-icon">{openFAQ === 'do-i-need-sql-knowledge' ? '−' : '+'}</span>
              </button>
              <div className="faq-answer">
                <p>No! That's the beauty of AIquery. You don't need any SQL knowledge. Simply ask questions in plain English like "Show me all customers who made purchases over $1000 last month" and AIquery will generate the SQL query for you. However, if you're curious, you can always view the generated SQL to learn how it works.</p>
              </div>
            </div>

            <div 
              className={`faq-item ${openFAQ === 'is-it-secure' ? 'open' : ''}`}
              id="faq-is-it-secure"
            >
              <button 
                className="faq-question"
                onClick={() => setOpenFAQ(openFAQ === 'is-it-secure' ? null : 'is-it-secure')}
              >
                <span>Is my data secure?</span>
                <span className="faq-icon">{openFAQ === 'is-it-secure' ? '−' : '+'}</span>
              </button>
              <div className="faq-answer">
                <p>Yes, security is a top priority. All connection credentials are encrypted and stored securely per user. Each user can only access their own configured data sources. The system uses industry-standard encryption and follows best practices for data security. Your database credentials are never shared with third parties.</p>
              </div>
            </div>

            <div 
              className={`faq-item ${openFAQ === 'what-is-rag' ? 'open' : ''}`}
              id="faq-what-is-rag"
            >
              <button 
                className="faq-question"
                onClick={() => setOpenFAQ(openFAQ === 'what-is-rag' ? null : 'what-is-rag')}
              >
                <span>What is RAG and why should I use it?</span>
                <span className="faq-icon">{openFAQ === 'what-is-rag' ? '−' : '+'}</span>
              </button>
              <div className="faq-answer">
                <p>RAG (Retrieval-Augmented Generation) is a feature that creates a searchable knowledge base of your table schemas. By creating a Knowledge Base, you help the AI understand your database structure better, which results in more accurate query generation. It's especially useful for complex databases with many tables. The system uses this context to generate better SQL queries that match your intent.</p>
              </div>
            </div>

            <div 
              className={`faq-item ${openFAQ === 'slack-teams-integration' ? 'open' : ''}`}
              id="faq-slack-teams-integration"
            >
              <button 
                className="faq-question"
                onClick={() => setOpenFAQ(openFAQ === 'slack-teams-integration' ? null : 'slack-teams-integration')}
              >
                <span>Can I use AIquery with Slack or Microsoft Teams?</span>
                <span className="faq-icon">{openFAQ === 'slack-teams-integration' ? '−' : '+'}</span>
              </button>
              <div className="faq-answer">
                <p>Yes! AIquery offers Enterprise Community Chatbot integration with Slack and Microsoft Teams. You can query your company's data warehouse directly from these platforms using natural language. Simply configure your Slack or Teams app credentials in the Community Channels section, and you'll be able to ask questions and receive formatted responses with data, charts, and interactive buttons right in your team chat.</p>
              </div>
            </div>

            <div 
              className={`faq-item ${openFAQ === 'pricing' ? 'open' : ''}`}
              id="faq-pricing"
            >
              <button 
                className="faq-question"
                onClick={() => setOpenFAQ(openFAQ === 'pricing' ? null : 'pricing')}
              >
                <span>How much does AIquery cost?</span>
                <span className="faq-icon">{openFAQ === 'pricing' ? '−' : '+'}</span>
              </button>
              <div className="faq-answer">
                <p>AIquery offers a free tier to get started. You can sign up and start querying your data immediately. For enterprise features like Slack/Teams integration, advanced RAG capabilities, and priority support, please contact us at support@gmail.com for custom pricing options.</p>
              </div>
            </div>

            <div 
              className={`faq-item ${openFAQ === 'export-data' ? 'open' : ''}`}
              id="faq-export-data"
            >
              <button 
                className="faq-question"
                onClick={() => setOpenFAQ(openFAQ === 'export-data' ? null : 'export-data')}
              >
                <span>Can I export my query results?</span>
                <span className="faq-icon">{openFAQ === 'export-data' ? '−' : '+'}</span>
              </button>
              <div className="faq-answer">
                <p>Absolutely! AIquery allows you to export your query results in multiple formats:</p>
                <ul>
                  <li><strong>CSV</strong> - For spreadsheet analysis</li>
                  <li><strong>JSON</strong> - For programmatic use</li>
                  <li><strong>PNG</strong> - For charts and visualizations</li>
                </ul>
                <p>You can download your data directly from the results page or from Slack/Teams integrations.</p>
              </div>
            </div>

            <div 
              className={`faq-item ${openFAQ === 'getting-started' ? 'open' : ''}`}
              id="faq-getting-started"
            >
              <button 
                className="faq-question"
                onClick={() => setOpenFAQ(openFAQ === 'getting-started' ? null : 'getting-started')}
              >
                <span>How do I get started?</span>
                <span className="faq-icon">{openFAQ === 'getting-started' ? '−' : '+'}</span>
              </button>
              <div className="faq-answer">
                <p>Getting started is easy! Follow these simple steps:</p>
                <ol>
                  <li>Sign up for a free account</li>
                  <li>Configure your LLM settings (OpenAI or Gemini API key)</li>
                  <li>Connect your data source (BigQuery, Airtable, PostgreSQL, etc.)</li>
                  <li>Start asking questions in natural language!</li>
                </ol>
                <p>For detailed instructions, check out our <a href="/docs" onClick={(e) => { e.preventDefault(); navigate('/docs'); }}>documentation</a> or contact our support team.</p>
              </div>
            </div>
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


export default LandingPage

