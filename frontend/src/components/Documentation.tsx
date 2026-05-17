import React, { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Logo from './Logo'
import LandingHeader from './LandingHeader'
import LandingFooter from './LandingFooter'
import { X, Send, Search } from 'lucide-react'
import GetInTouchSection from './GetInTouchSection'
import './Documentation.css'
import './LandingPage.css'

const Documentation: React.FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated, signOut } = useAuth()
  const [activeSection, setActiveSection] = useState<string>('overview')
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [isResizing, setIsResizing] = useState(false)
  const [headerHeight, setHeaderHeight] = useState(90)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)

  // Kira chatbot (reuse Landing styles/behavior)
  const [isChatbotOpen, setIsChatbotOpen] = useState(false)
  const [landingChatMessages, setLandingChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    { role: 'assistant', content: "Hi there! 👋 I'm Kira.Very happy to answer your questions about AIquery services." }
  ])
  const [landingChatInput, setLandingChatInput] = useState('')
  const [landingChatLoading, setLandingChatLoading] = useState(false)

  const [docsFilter, setDocsFilter] = useState('')

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

  const handleSectionClick = (sectionId: string, e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    setActiveSection(sectionId)
    // bring content into view (especially after scrolling)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const docNavItems = useMemo(() => ([
    { id: 'overview', label: 'Overview' },
    { id: 'quick-start', label: 'Getting Started' },
    { id: 'workspaces', label: 'Workspaces' },
    { id: 'data-sources', label: 'Data Sources & Connections' },
    { id: 'rag-generation', label: 'Knowledge Base' },
    { id: 'querying', label: 'Querying Data' },
    { id: 'visualizations', label: 'Visualizations' },
    { id: 'chat-history', label: 'Chat History' },
    { id: 'collaboration', label: 'Collaboration' },
    { id: 'slack-connection', label: 'Slack Connection' },
    { id: 'teams-connection', label: 'Microsoft Teams Connection' },
    { id: 'billing', label: 'Billing & Usage' },
    { id: 'api-reference', label: 'API Reference' },
    { id: 'troubleshooting', label: 'Troubleshooting' }
  ]), [])

  const filteredNavItems = useMemo(() => {
    const q = docsFilter.trim().toLowerCase()
    if (!q) return docNavItems
    return docNavItems.filter(i => i.label.toLowerCase().includes(q))
  }, [docNavItems, docsFilter])

  useEffect(() => {
    // Calculate header height dynamically
    const updateHeaderHeight = () => {
      const header = document.querySelector('.documentation-page .landing-nav') as HTMLElement
      if (header) {
        const height = header.offsetHeight
        setHeaderHeight(height)
      }
    }

    updateHeaderHeight()
    window.addEventListener('resize', updateHeaderHeight)
    
    return () => {
      window.removeEventListener('resize', updateHeaderHeight)
    }
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      
      const newWidth = e.clientX
      const minWidth = 200
      const maxWidth = 500
      
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setSidebarWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }

  return (
    <div className="documentation-page">
      <LandingHeader
        navRef={headerRef}
        activePath="/docs"
        primaryButtonLabel="Get Started Free"
      />

      <div className="docs-container">
        <aside 
          className="docs-sidebar" 
          ref={sidebarRef}
          style={{ 
            width: `${sidebarWidth}px`,
            top: `${headerHeight}px`,
            height: `calc(100vh - ${headerHeight}px)`
          }}
        >
          <div 
            className="docs-sidebar-resize-handle"
            ref={resizeRef}
            onMouseDown={handleResizeStart}
          />
          <div className="docs-sidebar-top">
            <div className="docs-sidebar-title">Docs</div>
            <div className="docs-sidebar-search">
              <Search size={16} />
              <input
                value={docsFilter}
                onChange={(e) => setDocsFilter(e.target.value)}
                placeholder="Search sections…"
                aria-label="Search documentation sections"
              />
            </div>
          </div>

          <nav className="docs-sidebar-nav" aria-label="Documentation sections">
            {filteredNavItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={`docs-sidebar-link ${activeSection === item.id ? 'active' : ''}`}
                onClick={(e) => handleSectionClick(item.id, e)}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        <main className="docs-content">
          <header className="docs-hero">
            <div className="docs-hero-inner">
              <h1 className="docs-hero-title">AIquery Documentation</h1>
              <p className="docs-hero-subtitle">
                Workspace-first setup, data connections, Knowledge Bases, chat history, integrations, and billing—everything in one place.
              </p>
              <div className="docs-hero-actions">
                <button type="button" className="docs-hero-action" onClick={() => setActiveSection('quick-start')}>Getting Started</button>
                <button type="button" className="docs-hero-action" onClick={() => setActiveSection('rag-generation')}>Knowledge Base</button>
                <button type="button" className="docs-hero-action" onClick={() => setActiveSection('api-reference')}>API Reference</button>
              </div>
            </div>
          </header>

          <section id="overview" className={`docs-section ${activeSection === 'overview' ? 'active' : 'hidden'}`}>
            <p className="docs-intro">
              Welcome to AIquery! This guide covers the current app experience: Workspaces, data source connections, Knowledge Bases, chat, collaboration, and billing.
            </p>

            <h2>What is AIquery?</h2>
            <p>
              AIquery is a modern web application that allows you to query your data using natural language. 
              Instead of writing complex SQL queries, simply ask questions in plain English and get instant results 
              with interactive visualizations.
            </p>

            <h2>Key Features</h2>
            <ul className="docs-feature-list">
              <li>
                <strong>💬 Natural Language Queries</strong> - Ask questions about your data in plain English
              </li>
              <li>
                <strong>📊 Interactive Visualizations</strong> - Automatic chart generation from query results
              </li>
              <li>
                <strong>🔍 SQL Transparency</strong> - View the generated SQL queries
              </li>
              <li>
                <strong>📥 Data Export</strong> - Download query results as CSV, JSON, or PNG
              </li>
              <li>
                <strong>🧠 Knowledge Base (RAG)</strong> - Improve accuracy with schema context and Few‑Shot prompts
              </li>
              <li>
                <strong>🔗 Multi Data Source Support</strong> - Connect to BigQuery, Airtable, PostgreSQL, Redshift, and more
              </li>
              <li>
                <strong>🗂️ Workspaces</strong> - Organize your configurations and collaborate per workspace
              </li>
              <li>
                <strong>👥 Team & Sharing</strong> - Invite members and assign roles (admin/view)
              </li>
              <li>
                <strong>💬 Slack & Teams Integration</strong> - Query your data directly from Slack or Microsoft Teams
              </li>
              <li>
                <strong>📚 Chat History</strong> - Save, rename, search, and delete past chat sessions
              </li>
            </ul>

            <h2>Supported Data Sources</h2>
            <div className="docs-data-sources-grid">
              <div className="docs-data-source-card">
                <h3>Google BigQuery</h3>
                <p>Query your BigQuery datasets using natural language</p>
              </div>
              <div className="docs-data-source-card">
                <h3>Airtable</h3>
                <p>Access your Airtable bases and tables</p>
              </div>
              <div className="docs-data-source-card">
                <h3>PostgreSQL</h3>
                <p>Connect to PostgreSQL databases</p>
              </div>
              <div className="docs-data-source-card">
                <h3>AWS Redshift</h3>
                <p>Query Redshift data warehouses</p>
              </div>
              <div className="docs-data-source-card">
                <h3>Azure SQL</h3>
                <p>Access Azure SQL databases</p>
              </div>
              <div className="docs-data-source-card">
                <h3>Snowflake</h3>
                <p>Query Snowflake data warehouses</p>
              </div>
              <div className="docs-data-source-card">
                <h3>MySQL</h3>
                <p>Connect to MySQL databases</p>
              </div>
              <div className="docs-data-source-card">
                <h3>Databricks</h3>
                <p>Access Databricks SQL warehouses</p>
              </div>
            </div>
          </section>

          <section id="quick-start" className={`docs-section ${activeSection === 'quick-start' ? 'active' : 'hidden'}`}>
            <h2>Getting Started</h2>
            
            <h3>1. Sign Up / Sign In</h3>
            <p>
              Create an account or sign in to your existing account. You can sign up using your email address.
            </p>

            <h3>2. Create or Open a Workspace</h3>
            <p>
              AIquery is workspace-based. After signing in, go to <code>/app_admin</code> to view your workspaces.
              Open an existing workspace or create a new one, then click <strong>Open</strong> to activate it.
            </p>

            <h3>3. Configure LLM Settings</h3>
            <p>
              In your workspace setup, configure your LLM (Large Language Model) provider:
            </p>
            <ol>
              <li>Open <strong>Workspace Setup</strong> (<code>/app_admin/workspace_creation</code>)</li>
              <li>Go to <strong>LLM Configuration</strong></li>
              <li>Choose your LLM provider (OpenAI or Gemini)</li>
              <li>Enter your API key:
                <ul>
                  <li>For OpenAI: Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI Platform</a></li>
                  <li>For Gemini: Get your API key from <a href="https://makersuite.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a></li>
                </ul>
              </li>
              <li>Click <strong>"Test Connection"</strong> to verify your API key</li>
              <li>Click <strong>"Save"</strong> to store your configuration</li>
            </ol>

            <h3>4. Connect a Data Source</h3>
            <p>
              In <strong>Workspace Setup</strong>, select a data source and configure its connection:
            </p>
            <ol>
              <li>Go to <strong>Data</strong></li>
              <li>Select a data source (e.g., BigQuery, Airtable, PostgreSQL)</li>
              <li>Use the <strong>Data Source Connection</strong> card to enter credentials</li>
              <li>Enter your connection credentials</li>
              <li>Click <strong>"Test Connection"</strong> to verify</li>
              <li>Click <strong>"Save"</strong> to store the connection</li>
            </ol>

            <h3>5. Create a Knowledge Base (Recommended)</h3>
            <p>
              Knowledge Bases improve accuracy by storing table schema context and optional Few‑Shot prompts.
              In <strong>Workspace Setup</strong>, use the <strong>Knowledge Base</strong> card to create or manage one.
            </p>

            <h3>6. Start Querying</h3>
            <p>
              Go to <code>/app_admin/chat</code> and start asking questions:
            </p>
            <ul>
              <li>"Show me the first 5 rows from the People table"</li>
              <li>"What was the revenue last month?"</li>
              <li>"Compare sales by region"</li>
              <li>"How many users signed up yesterday?"</li>
            </ul>

            <h3>7. View Results</h3>
            <p>
              After asking a question, you'll see:
            </p>
            <ul>
              <li><strong>Response</strong> - AI interpretation of your data</li>
              <li><strong>Data Preview</strong> - First 5 rows of results (click "Show More Data" for all rows)</li>
              <li><strong>Interactive Buttons</strong>:
                <ul>
                  <li>Show SQL Query - View the generated SQL</li>
                  <li>Show Chart - Visualize your data</li>
                  <li>Download CSV/JSON/PNG - Export your results</li>
                </ul>
              </li>
            </ul>
          </section>

          <section id="workspaces" className={`docs-section ${activeSection === 'workspaces' ? 'active' : 'hidden'}`}>
            <h2>Workspaces</h2>

            <p>
              Workspaces help you organize configuration and collaboration. The app uses an <strong>active workspace</strong>
              (stored as <code>aiquery_active_workspace_id</code>) for chat and sharing.
            </p>

            <h3>Workspace Admin</h3>
            <ul>
              <li>Go to <code>/app_admin</code> to view and manage workspaces.</li>
              <li>Click <strong>Open</strong> to activate a workspace and jump to Chat.</li>
              <li>Use <strong>Create Workspace</strong> to create a new one.</li>
            </ul>

            <h3>Workspace Setup</h3>
            <ul>
              <li>Go to <code>/app_admin/workspace_creation</code> to configure a workspace.</li>
              <li>Use the left sidebar to switch between <strong>Data</strong>, <strong>LLM</strong>, and <strong>Community</strong>.</li>
              <li>In the <strong>Data</strong> section, selecting a data source opens the <strong>Data Source Connection</strong> and <strong>Knowledge Base</strong> cards.</li>
            </ul>
          </section>

          <section id="data-sources" className={`docs-section ${activeSection === 'data-sources' ? 'active' : 'hidden'}`}>
            <h2>Data Source Configuration</h2>

            <h3>Google BigQuery</h3>
            <p>To connect to BigQuery:</p>
            <ol>
              <li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a></li>
              <li>Create a service account with BigQuery access</li>
              <li>Download the service account key (JSON file)</li>
              <li>In AIquery, enter:
                <ul>
                  <li><strong>Project ID</strong> - Your Google Cloud project ID</li>
                  <li><strong>Service Account Key</strong> - Paste the entire JSON content</li>
                  <li><strong>Datasets</strong> (Optional) - Comma-separated list of datasets to query</li>
                </ul>
              </li>
            </ol>

            <h3>Airtable</h3>
            <p>To connect to Airtable:</p>
            <ol>
              <li>Go to <a href="https://airtable.com/account" target="_blank" rel="noopener noreferrer">Airtable Account Settings</a></li>
              <li>Navigate to <strong>Developer</strong> section</li>
              <li>Create a Personal Access Token (PAT)</li>
              <li>Get your Base ID from the API documentation page</li>
              <li>In AIquery, enter:
                <ul>
                  <li><strong>API Key</strong> - Your Personal Access Token (starts with "pat")</li>
                  <li><strong>Base ID</strong> - Your Airtable Base ID (starts with "app")</li>
                </ul>
              </li>
            </ol>

            <h3>SQL Databases (PostgreSQL, MySQL, Redshift, etc.)</h3>
            <p>To connect to SQL databases:</p>
            <ol>
              <li>Gather your database connection details:
                <ul>
                  <li>Host/Server address</li>
                  <li>Port number</li>
                  <li>Database name</li>
                  <li>Username and password</li>
                  <li>Schema (optional, for some databases)</li>
                </ul>
              </li>
              <li>In AIquery, enter all required connection fields</li>
              <li>Click <strong>"Test Connection"</strong> to verify</li>
              <li>Click <strong>"Save"</strong> to store the connection</li>
            </ol>

            <div className="docs-note">
              <strong>Note:</strong> Connection credentials are encrypted and stored securely per user. 
              Each user can only access their own configured data sources.
            </div>
          </section>

          <section id="rag-generation" className={`docs-section ${activeSection === 'rag-generation' ? 'active' : 'hidden'}`}>
            <h2>Knowledge Base (RAG)</h2>
            
            <p>
              Knowledge Bases improve query accuracy by storing schema context (tables/columns/metadata) and optional Few‑Shot prompts.
              This helps AIquery generate more accurate SQL and better explanations.
            </p>

            <h3>Creating a Knowledge Base</h3>
            <ol>
              <li>Ensure your data source connection is saved and tested</li>
              <li>Open <code>/app_admin/workspace_creation</code> (Workspace Setup)</li>
              <li>Select your data source in the left sidebar (Data section)</li>
              <li>In the <strong>Knowledge Base</strong> card, click <strong>Create New Knowledge Base</strong></li>
              <li>Select tables to include and generate</li>
            </ol>

            <p>
              The system will:
            </p>
            <ul>
              <li>Fetch table schemas from your data source</li>
              <li>Generate descriptions for each table using AI</li>
              <li>Create a Knowledge Base for better query generation</li>
            </ul>

            <h3>Managing Knowledge Bases</h3>
            <p>
              In the Knowledge Base card, you can:
            </p>
            <ul>
              <li><strong>View</strong> - See all tables included in the index</li>
              <li><strong>Edit</strong> - Update table metadata or remove tables</li>
              <li><strong>Few‑Shot Prompt</strong> - Add example prompts:
                <ul>
                  <li><strong>User Question</strong></li>
                  <li><strong>Assistant SQL Query</strong> (optional)</li>
                  <li><strong>Assistant Answer</strong> (optional)</li>
                </ul>
              </li>
              <li><strong>Delete</strong> - Remove a Knowledge Base if no longer needed</li>
            </ul>

            <div className="docs-note">
              <strong>Tip:</strong> Knowledge Bases are especially useful for complex databases with many tables. 
              They help the AI understand relationships and generate more accurate queries.
            </div>
          </section>

          <section id="chat-history" className={`docs-section ${activeSection === 'chat-history' ? 'active' : 'hidden'}`}>
            <h2>Chat History</h2>
            <p>
              AIquery saves chat sessions so you can return to previous conversations. The Chat History panel lets you:
            </p>
            <ul>
              <li><strong>Start a new chat</strong></li>
              <li><strong>Search</strong> sessions by title</li>
              <li><strong>Rename</strong> a session</li>
              <li><strong>Select and bulk delete</strong> sessions</li>
            </ul>
          </section>

          <section id="collaboration" className={`docs-section ${activeSection === 'collaboration' ? 'active' : 'hidden'}`}>
            <h2>Collaboration</h2>
            <p>
              You can invite team members and control permissions with roles:
            </p>
            <ul>
              <li><strong>Admin</strong>: can configure connections/Knowledge Bases and manage members</li>
              <li><strong>View</strong>: can query and view results (configuration may be restricted)</li>
            </ul>
            <p>
              In the app you can manage members from Workspace Admin and from the Chat workspace sharing UI.
            </p>
          </section>

          <section id="billing" className={`docs-section ${activeSection === 'billing' ? 'active' : 'hidden'}`}>
            <h2>Billing & Usage</h2>
            <p>
              Plans control feature limits such as monthly queries and the number of team members. You can view your current plan,
              usage, upgrade, or cancel from the admin experience.
            </p>
            <ul>
              <li><strong>Current Plan</strong>: view plan name and renewal dates</li>
              <li><strong>Usage</strong>: see monthly query usage and remaining quota</li>
              <li><strong>Upgrade</strong>: change plan tier</li>
            </ul>
          </section>

          <section id="querying" className={`docs-section ${activeSection === 'querying' ? 'active' : 'hidden'}`}>
            <h2>Querying Your Data</h2>

            <h3>Natural Language Queries</h3>
            <p>
              Ask questions in plain English. The AI will convert your question into the appropriate query format 
              (SQL for databases, Airtable query format for Airtable).
            </p>

            <h4>Example Questions</h4>
            <div className="docs-examples">
              <div className="docs-example">
                <strong>Simple Queries:</strong>
                <ul>
                  <li>"Show me the first 5 rows from the People table"</li>
                  <li>"What are all the columns in the Orders table?"</li>
                  <li>"List all customers"</li>
                </ul>
              </div>
              <div className="docs-example">
                <strong>Filtered Queries:</strong>
                <ul>
                  <li>"Show me orders from last month"</li>
                  <li>"Find all users with status 'active'"</li>
                  <li>"Get products with price greater than $100"</li>
                </ul>
              </div>
              <div className="docs-example">
                <strong>Aggregations:</strong>
                <ul>
                  <li>"What was the total revenue last month?"</li>
                  <li>"How many users signed up yesterday?"</li>
                  <li>"What's the average order value?"</li>
                </ul>
              </div>
              <div className="docs-example">
                <strong>Complex Queries:</strong>
                <ul>
                  <li>"Compare sales by region for the last quarter"</li>
                  <li>"Show me the top 10 customers by revenue"</li>
                  <li>"What's the trend of user signups over the past 6 months?"</li>
                </ul>
              </div>
            </div>

            <h3>Understanding Results</h3>
            <p>
              After asking a question, you'll receive:
            </p>
            <ul>
              <li><strong>Response</strong> - AI-generated summary and interpretation of your data</li>
              <li><strong>Data Preview</strong> - First 5 rows of results (click "Show More Data" to see all)</li>
              <li><strong>SQL Query</strong> (hidden by default) - Click "Show SQL Query" to view the generated query</li>
              <li><strong>Chart</strong> (hidden by default) - Click "Show Chart" to visualize your data</li>
            </ul>

            <h3>Interactive Features</h3>
            <ul>
              <li><strong>Show More Data</strong> - View all rows instead of just the first 5</li>
              <li><strong>Show/Hide SQL Query</strong> - Toggle visibility of the generated SQL</li>
              <li><strong>Show Chart</strong> - Generate and display a visualization</li>
              <li><strong>Download CSV/JSON/PNG</strong> - Export your results in various formats</li>
              <li><strong>Chart Type Buttons</strong> - Change chart type (Bar, Pie, Line, Scatter, Histogram)</li>
            </ul>
          </section>

          <section id="visualizations" className={`docs-section ${activeSection === 'visualizations' ? 'active' : 'hidden'}`}>
            <h2>Data Visualizations</h2>

            <p>
              AIquery automatically generates visualizations from your query results. Charts are created using Python 
              and displayed directly in the interface.
            </p>

            <h3>Chart Types</h3>
            <div className="docs-chart-types">
              <div className="docs-chart-type">
                <h4>Bar Chart</h4>
                <p>Best for comparing categories or discrete values</p>
              </div>
              <div className="docs-chart-type">
                <h4>Line Chart</h4>
                <p>Ideal for showing trends over time</p>
              </div>
              <div className="docs-chart-type">
                <h4>Pie Chart</h4>
                <p>Perfect for showing proportions and percentages</p>
              </div>
              <div className="docs-chart-type">
                <h4>Scatter Plot</h4>
                <p>Useful for identifying relationships between variables</p>
              </div>
              <div className="docs-chart-type">
                <h4>Histogram</h4>
                <p>Great for showing distribution of numerical data</p>
              </div>
            </div>

            <h3>Using Charts</h3>
            <ol>
              <li>Ask a question that returns data</li>
              <li>Click <strong>"Show Chart"</strong> button</li>
              <li>The system will automatically choose the best chart type</li>
              <li>Use chart type buttons to change the visualization</li>
              <li>Download the chart as PNG if needed</li>
            </ol>

            <div className="docs-note">
              <strong>Note:</strong> Chart generation requires Python 3.8+ with matplotlib and pandas installed. 
              The system will automatically use the best chart type based on your data structure.
            </div>
          </section>

          <section id="slack-connection" className={`docs-section ${activeSection === 'slack-connection' ? 'active' : 'hidden'}`}>
            <h2>Slack Connection</h2>

            <p>
              AIquery can be integrated with Slack, allowing you to query your data directly from Slack channels 
              and direct messages.
            </p>

            <h3>Setting Up Slack Integration</h3>
            
            <h4>✅ PART 1 — Create the Slack App</h4>
            <ol>
              <li>Go to the <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">Slack API console</a></li>
              <li>Create a new app:
                <ul>
                  <li>Click <strong>"Create New App"</strong></li>
                  <li>Select <strong>"From scratch"</strong></li>
                  <li>Give it a name (e.g., Data Assistant Bot)</li>
                  <li>Choose your workspace</li>
                </ul>
              </li>
            </ol>

            <h4>✅ PART 2 — Add Bot Features</h4>
            <p>Your app needs the following bot token scopes:</p>
            <ol>
              <li>Go to: <strong>Features → OAuth & Permissions → Scopes → Bot Token Scopes</strong></li>
              <li>Add these scopes:
                <ul>
                  <li><code>chat:write</code></li>
                  <li><code>chat:write.public</code></li>
                  <li><code>commands</code></li>
                  <li><code>im:write</code></li>
                  <li><code>channels:history</code></li>
                  <li><code>channels:read</code></li>
                  <li><code>files:write</code></li>
                </ul>
              </li>
              <li>Still in OAuth & Permissions, click <strong>"Install to Workspace"</strong></li>
              <li>Copy the <strong>Bot User OAuth Token</strong> (Format: <code>xoxb-1234...</code>) - You will use this in your AIquery configuration</li>
            </ol>

            <h4>✅ PART 3 — Enable Interactivity (buttons, actions, etc.)</h4>
            <p>To make Slack buttons work:</p>
            <ol>
              <li>Go to: <strong>Features → Interactivity & Shortcuts</strong></li>
              <li>Enable <strong>Interactivity: ON</strong></li>
              <li>Set Request URL: <code>https://&lt;your-server&gt;/api/slack/interactions</code>
                <div className="docs-note">
                  <strong>Note:</strong> This endpoint will receive button clicks and interactive actions from Slack.
                </div>
              </li>
            </ol>

            <h4>✅ PART 4 — Slash Commands (optional but recommended)</h4>
            <p>Create a command like <code>/askdata</code>:</p>
            <ol>
              <li>Go to: <strong>Features → Slash Commands → Create New Command</strong></li>
              <li>Configure:
                <ul>
                  <li><strong>Command:</strong> <code>/askdata</code></li>
                  <li><strong>Request URL:</strong> <code>https://&lt;your-server&gt;/api/slack/command</code></li>
                  <li><strong>Short description:</strong> Ask the data assistant</li>
                </ul>
              </li>
            </ol>

            <h4>✅ PART 5 — Event Subscriptions (Bot listens to channel messages)</h4>
            <p>If you want the bot to respond when you "ask a question in the channel", turn this on:</p>
            <ol>
              <li>Go to: <strong>Features → Event Subscriptions → Enable Events</strong></li>
              <li>Set Request URL: <code>https://&lt;your-server&gt;/api/slack/events</code></li>
              <li>Subscribe to Bot Events - Click <strong>"Add Bot User Event"</strong> and add:
                <ul>
                  <li><code>message.channels</code></li>
                  <li><code>app_mention</code></li>
                </ul>
              </li>
            </ol>

            <h4>✅ PART 6 — Configure in AIquery</h4>
            <ol>
              <li>Go to <strong>"Community Channels"</strong> in the AIquery sidebar</li>
              <li>Click on <strong>"Slack"</strong></li>
              <li>Enter your Slack app credentials:
                <ul>
                  <li><strong>Slack API Token</strong> - The Bot User OAuth Token you copied (starts with "xoxb-")</li>
                  <li><strong>Verification Token</strong> - Found in <strong>Basic Information → App Credentials</strong></li>
                  <li><strong>Signing Secret</strong> - Found in <strong>Basic Information → App Credentials</strong></li>
                </ul>
              </li>
              <li>Click <strong>"Test Connection"</strong> to verify</li>
              <li>Click <strong>"Connect"</strong> to save</li>
            </ol>

            <h4>✅ PART 7 — Add Bot to Your Channel (Optional)</h4>
            <p>In Slack:</p>
            <ol>
              <li>Go to your channel</li>
              <li>Type <code>/invite @Data Assistant Bot</code> (or whatever you named your bot)</li>
            </ol>

            <h3>Using Slack</h3>
            <p>
              Once configured, you can query your data directly in Slack:
            </p>
            <ul>
              <li>Mention your bot or send a direct message</li>
              <li>Ask questions in natural language</li>
              <li>Receive formatted responses with data, charts, and interactive buttons</li>
              <li>Use buttons to show SQL, charts, or download data</li>
            </ul>

            <h3>Slack Features</h3>
            <ul>
              <li>Formatted responses with Block Kit</li>
              <li>Interactive buttons for follow-up actions</li>
              <li>Chart images displayed directly in Slack</li>
              <li>File downloads (CSV, JSON, PNG)</li>
              <li>Thread support for conversations</li>
            </ul>
          </section>

          <section id="teams-connection" className={`docs-section ${activeSection === 'teams-connection' ? 'active' : 'hidden'}`}>
            <h2>Microsoft Teams Connection</h2>

            <p>
              AIquery can be integrated with Microsoft Teams, allowing you to query your data directly from Teams 
              channels and chats.
            </p>

            <h3>Setting Up Microsoft Teams Integration</h3>
            <ol>
              <li>Go to <strong>"Community Channels"</strong> in the sidebar</li>
              <li>Click on <strong>"Microsoft Teams"</strong></li>
              <li>Configure your Teams app:
                <ul>
                  <li><strong>Teams App ID</strong> - Your Microsoft Teams app ID</li>
                  <li><strong>Bot ID</strong> - Bot ID from your Teams app registration</li>
                  <li><strong>Bot Password</strong> - Bot password from your Teams app registration</li>
                  <li><strong>Tenant ID</strong> - Your Microsoft Azure tenant ID (optional)</li>
                </ul>
              </li>
              <li>Click <strong>"Test Connection"</strong> to verify</li>
              <li>Click <strong>"Connect"</strong> to save</li>
            </ol>

            <h3>Using Microsoft Teams</h3>
            <p>
              Once configured, you can query your data directly in Microsoft Teams:
            </p>
            <ul>
              <li>Mention your bot in a channel or send a direct message</li>
              <li>Ask questions in natural language</li>
              <li>Receive formatted responses with data, charts, and interactive buttons</li>
              <li>Use buttons to show SQL, charts, or download data</li>
            </ul>

            <h3>Microsoft Teams Features</h3>
            <ul>
              <li>Formatted responses with Adaptive Cards</li>
              <li>Interactive buttons for follow-up actions</li>
              <li>Chart images displayed directly in Teams</li>
              <li>File downloads (CSV, JSON, PNG)</li>
              <li>Thread support for conversations</li>
            </ul>

            <div className="docs-note">
              <strong>Note:</strong> To create a Microsoft Teams app, you'll need to register your app in the 
              <a href="https://dev.teams.microsoft.com/" target="_blank" rel="noopener noreferrer"> Microsoft Teams Developer Portal</a>. 
              Make sure to configure the necessary permissions and endpoints for your bot.
            </div>
          </section>

          <section id="api-reference" className={`docs-section ${activeSection === 'api-reference' ? 'active' : 'hidden'}`}>
            <h2>API Reference</h2>

            <h3>Chat Endpoint</h3>
            <div className="docs-api-endpoint">
              <code>POST /api/chat</code>
              <p>Send a natural language question and get results</p>
              <pre>{`{
  "question": "What was the revenue last month?",
  "userName": "User",
  "connectionConfig": { ... },
  "llmProvider": "openai",
  "openaiApiKey": "..."
}`}</pre>
            </div>

            <h3>Connection Management</h3>
            <ul>
              <li><code>GET /api/connections</code> - Get all connection configs</li>
              <li><code>POST /api/connections</code> - Save a connection config</li>
              <li><code>DELETE /api/connections/:sourceId</code> - Delete a connection</li>
              <li><code>POST /api/test-connection</code> - Test a connection</li>
            </ul>

            <h3>Knowledge Base (RAG) Endpoints</h3>
            <ul>
              <li><code>GET /api/rag/tables</code> - Get available tables for RAG</li>
              <li><code>POST /api/rag/create</code> - Create a Knowledge Base</li>
              <li><code>GET /api/rag/indexes</code> - Get all Knowledge Bases</li>
              <li><code>GET /api/rag/index/:projectId</code> - Get a specific Knowledge Base</li>
              <li><code>DELETE /api/rag/index/:projectId</code> - Delete a Knowledge Base</li>
              <li><code>POST /api/rag/add-question</code> - Add a Few‑Shot prompt to a Knowledge Base</li>
              <li><code>DELETE /api/rag/questions</code> - Delete Few‑Shot prompts</li>
            </ul>

            <h3>LLM Settings</h3>
            <ul>
              <li><code>GET /api/settings/llm</code> - Get LLM settings</li>
              <li><code>POST /api/settings/llm</code> - Save LLM settings</li>
              <li><code>POST /api/settings/llm/test</code> - Test LLM connection</li>
              <li><code>DELETE /api/settings/llm</code> - Delete LLM settings</li>
            </ul>

            <h3>Workspaces</h3>
            <ul>
              <li><code>GET /api/workspaces</code> - List workspaces</li>
              <li><code>GET /api/workspaces/:id</code> - Get workspace details and members</li>
              <li><code>POST /api/workspaces</code> - Create workspace</li>
              <li><code>PUT /api/workspaces/:id</code> - Update workspace</li>
              <li><code>POST /api/workspaces/:id/activate</code> - Activate workspace</li>
              <li><code>DELETE /api/workspaces/:id</code> - Delete workspace</li>
            </ul>

            <h3>Members</h3>
            <ul>
              <li><code>GET /api/members</code> - List members</li>
              <li><code>POST /api/members/invite</code> - Invite member</li>
              <li><code>POST /api/members/invite-link</code> - Create invite link</li>
              <li><code>POST /api/members/accept-invite</code> - Accept invite</li>
              <li><code>PUT /api/members/:userId/role</code> - Update role</li>
              <li><code>DELETE /api/members/:userId</code> - Remove member</li>
              <li><code>GET /api/members/permissions</code> - Check permissions</li>
            </ul>

            <h3>Subscription & Usage</h3>
            <ul>
              <li><code>GET /api/subscription</code> - Get subscription and limits</li>
              <li><code>POST /api/subscription</code> - Create/update subscription</li>
              <li><code>POST /api/subscription/cancel</code> - Cancel subscription</li>
              <li><code>GET /api/subscription/usage</code> - Usage stats</li>
              <li><code>GET /api/payments</code> - Payment history</li>
            </ul>

            <h3>Chat History</h3>
            <ul>
              <li><code>GET /api/chat/history/sessions</code> - List sessions</li>
              <li><code>GET /api/chat/history/sessions/:sessionId</code> - Get session messages</li>
              <li><code>PUT /api/chat/history/sessions/:sessionId/title</code> - Rename session</li>
              <li><code>DELETE /api/chat/history/sessions/:sessionId</code> - Delete session</li>
            </ul>
          </section>

          <section id="troubleshooting" className={`docs-section ${activeSection === 'troubleshooting' ? 'active' : 'hidden'}`}>
            <h2>Troubleshooting</h2>

            <h3>Connection Issues</h3>
            <div className="docs-troubleshooting-item">
              <h4>❌ "Connection test failed"</h4>
              <p><strong>Possible causes:</strong></p>
              <ul>
                <li>Incorrect credentials (API key, password, etc.)</li>
                <li>Network connectivity issues</li>
                <li>Firewall blocking the connection</li>
                <li>Database server not accessible</li>
              </ul>
              <p><strong>Solutions:</strong></p>
              <ul>
                <li>Double-check all credentials</li>
                <li>Verify network connectivity</li>
                <li>Check firewall rules</li>
                <li>Ensure the database server is running</li>
              </ul>
            </div>

            <h3>Query Generation Issues</h3>
            <div className="docs-troubleshooting-item">
              <h4>❌ "Error generating query"</h4>
              <p><strong>Possible causes:</strong></p>
              <ul>
                <li>LLM API key is invalid or expired</li>
                <li>API rate limits exceeded</li>
                <li>Question is too ambiguous</li>
                <li>No Knowledge Base for complex queries</li>
              </ul>
              <p><strong>Solutions:</strong></p>
              <ul>
                <li>Verify your LLM API key is correct</li>
                <li>Check API rate limits and wait if needed</li>
                <li>Rephrase your question to be more specific</li>
                <li>Create a Knowledge Base for better accuracy</li>
              </ul>
            </div>

            <h3>Knowledge Base Issues</h3>
            <div className="docs-troubleshooting-item">
              <h4>❌ "No tables found"</h4>
              <p><strong>Possible causes:</strong></p>
              <ul>
                <li>Connection not configured</li>
                <li>Insufficient permissions</li>
                <li>Table names don't match</li>
              </ul>
              <p><strong>Solutions:</strong></p>
              <ul>
                <li>Ensure data source is connected</li>
                <li>Check user permissions</li>
                <li>Use manual table input if auto-discovery fails</li>
              </ul>
            </div>

            <h3>Chart Generation Issues</h3>
            <div className="docs-troubleshooting-item">
              <h4>❌ "Chart generation failed"</h4>
              <p><strong>Possible causes:</strong></p>
              <ul>
                <li>Python not installed or not in PATH</li>
                <li>Missing Python dependencies (matplotlib, pandas)</li>
                <li>Data format not suitable for visualization</li>
              </ul>
              <p><strong>Solutions:</strong></p>
              <ul>
                <li>Install Python 3.8+ and ensure it's in PATH</li>
                <li>Run setup script: <code>backend/visualization/setup_python_deps.sh</code></li>
                <li>Try a different query that returns numerical data</li>
              </ul>
            </div>

            <h3>Getting Help</h3>
            <p>
              If you're still experiencing issues:
            </p>
            <ul>
              <li>Check the server logs for detailed error messages</li>
              <li>Review the documentation for your specific data source</li>
              <li>Verify all configuration settings are correct</li>
              <li>Contact support at <a href="mailto:support@gmail.com">support@gmail.com</a></li>
            </ul>
          </section>

          <section className={`docs-section docs-footer ${activeSection === 'overview' ? 'active' : 'hidden'}`}>
            <h2>Additional Resources</h2>
            <div className="docs-resources">
              <div className="docs-resource">
                <h3>📚 In‑repo Guides</h3>
                <ul>
                  <li><code>docs/DEVELOPER_MANUAL.md</code></li>
                  <li><code>docs/TEAM_MANAGEMENT.md</code></li>
                  <li><code>docs/CHAT_HISTORY_FEATURE.md</code></li>
                  <li><code>docs/PAYMENT_AND_SUBSCRIPTION_SYSTEM.md</code></li>
                  <li><code>docs/MULTI_DATA_SOURCE_RAG.md</code></li>
                  <li><code>docs/LLM_MODEL_CONFIGURATION.md</code></li>
                </ul>
                <div className="docs-note">
                  <strong>Tip:</strong> These guides live in the repository <code>docs/</code> folder.
                </div>
              </div>
              <div className="docs-resource">
                <h3>🔗 External Links</h3>
                <ul>
                  <li><a href="https://cloud.google.com/bigquery/docs" target="_blank" rel="noopener noreferrer">BigQuery Documentation</a></li>
                  <li><a href="https://airtable.com/api" target="_blank" rel="noopener noreferrer">Airtable API Documentation</a></li>
                  <li><a href="https://platform.openai.com/docs" target="_blank" rel="noopener noreferrer">OpenAI API Documentation</a></li>
                  <li><a href="https://ai.google.dev/docs" target="_blank" rel="noopener noreferrer">Google Gemini API Documentation</a></li>
                </ul>
              </div>
            </div>
          </section>
        </main>
      </div>

      <GetInTouchSection subtitle="Need help with onboarding, an integration, or an enterprise plan? Our team is ready to help." />

      {/* Footer */}
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

export default Documentation

