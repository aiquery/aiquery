import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Logo from './Logo'
import LandingHeader from './LandingHeader'
import LandingFooter from './LandingFooter'
import { X, Send } from 'lucide-react'
import GetInTouchSection from './GetInTouchSection'
import './LandingPage.css'
import './PrivacyPolicy.css'

const PrivacyPolicy: React.FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated, signOut } = useAuth()

  // Kira chatbot (reuse Landing styles/behavior)
  const [isChatbotOpen, setIsChatbotOpen] = useState(false)
  const [landingChatMessages, setLandingChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    { role: 'assistant', content: "Hi there! 👋 I'm Kira.Very happy to answer your questions about AIquery services." }
  ])
  const [landingChatInput, setLandingChatInput] = useState('')
  const [landingChatLoading, setLandingChatLoading] = useState(false)

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

  const nav = (
    <LandingHeader primaryButtonLabel="Get Started Free" />
  )

  const footer = <LandingFooter />

  const contactSection = <GetInTouchSection subtitle="If you have questions or concerns about our Privacy Policy or data practices, please contact us." />

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
    <div className="privacy-policy-page">
      {nav}
      <main className="privacy-main">
        <div className="privacy-content">
        <div className="privacy-header">
          <h1>Privacy Policy</h1>
          <p className="privacy-last-updated">Last Updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>

        <div className="privacy-body">
          <section className="privacy-section">
            <p className="privacy-intro">
              At AIquery, we are committed to protecting your privacy and ensuring the security of your data. 
              This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you 
              use our service. Please read this policy carefully to understand our practices regarding your data.
            </p>
          </section>

          <section className="privacy-section">
            <h2>1. Information We Collect</h2>
            
            <h3>1.1 Account Information</h3>
            <p>When you create an account with AIquery, we collect:</p>
            <ul>
              <li>Name and email address</li>
              <li>Password (encrypted and hashed)</li>
              <li>Account preferences and settings</li>
            </ul>

            <h3>1.2 Connection Credentials</h3>
            <p>To enable you to query your data sources, we collect and store:</p>
            <ul>
              <li>Database connection credentials (API keys, tokens, passwords)</li>
              <li>Connection configuration details (hosts, ports, database names)</li>
              <li>Data source preferences and settings</li>
            </ul>
            <p className="privacy-note">
              <strong>Important:</strong> All connection credentials are encrypted at rest and in transit. 
              We use industry-standard encryption methods to protect your sensitive information.
            </p>

            <h3>1.3 Usage Information</h3>
            <p>We automatically collect information about how you use our service:</p>
            <ul>
              <li>Query history and generated SQL queries</li>
              <li>Data source connections and configurations</li>
              <li>Knowledge Base information and table schemas</li>
              <li>LLM provider preferences and API keys</li>
              <li>Feature usage and interaction patterns</li>
            </ul>

            <h3>1.4 Technical Information</h3>
            <p>We collect technical information to improve our service:</p>
            <ul>
              <li>IP address and location data</li>
              <li>Browser type and version</li>
              <li>Device information</li>
              <li>Log files and error reports</li>
            </ul>
          </section>

          <section className="privacy-section">
            <h2>2. How We Use Your Information</h2>
            
            <p>We use the information we collect for the following purposes:</p>
            
            <h3>2.1 Service Provision</h3>
            <ul>
              <li>To provide, maintain, and improve our services</li>
              <li>To process your queries and generate SQL statements</li>
              <li>To connect to your data sources and execute queries</li>
              <li>To create and manage Knowledge Bases</li>
              <li>To generate visualizations and export data</li>
            </ul>

            <h3>2.2 Account Management</h3>
            <ul>
              <li>To create and manage your account</li>
              <li>To authenticate and authorize access</li>
              <li>To communicate with you about your account</li>
              <li>To provide customer support</li>
            </ul>

            <h3>2.3 Service Improvement</h3>
            <ul>
              <li>To analyze usage patterns and improve our AI models</li>
              <li>To enhance query accuracy and performance</li>
              <li>To develop new features and functionality</li>
              <li>To troubleshoot and fix technical issues</li>
            </ul>

            <h3>2.4 Communication</h3>
            <ul>
              <li>To send you service-related notifications</li>
              <li>To respond to your inquiries and support requests</li>
              <li>To send you updates about our service (with your consent)</li>
            </ul>
          </section>

          <section className="privacy-section">
            <h2>3. Data Security</h2>
            
            <p>We implement comprehensive security measures to protect your information:</p>
            
            <h3>3.1 Encryption</h3>
            <ul>
              <li>All data is encrypted in transit using TLS/SSL protocols</li>
              <li>Connection credentials are encrypted at rest using AES-256 encryption</li>
              <li>Passwords are hashed using bcrypt with salt</li>
            </ul>

            <h3>3.2 Access Controls</h3>
            <ul>
              <li>Role-based access control ensures users can only access their own data</li>
              <li>Multi-factor authentication available for enhanced security</li>
              <li>Regular security audits and vulnerability assessments</li>
            </ul>

            <h3>3.3 Infrastructure Security</h3>
            <ul>
              <li>Secure cloud infrastructure with industry-standard protections</li>
              <li>Regular security updates and patches</li>
              <li>Intrusion detection and monitoring systems</li>
              <li>Backup and disaster recovery procedures</li>
            </ul>

            <p className="privacy-note">
              <strong>Note:</strong> While we implement strong security measures, no method of transmission 
              over the Internet or electronic storage is 100% secure. We cannot guarantee absolute security, 
              but we are committed to protecting your data to the best of our ability.
            </p>
          </section>

          <section className="privacy-section">
            <h2>4. Data Sharing and Disclosure</h2>
            
            <p>We do not sell, trade, or rent your personal information to third parties. We may share your information only in the following circumstances:</p>
            
            <h3>4.1 Service Providers</h3>
            <p>We may share information with trusted third-party service providers who assist us in operating our service:</p>
            <ul>
              <li>Cloud hosting providers (for infrastructure)</li>
              <li>LLM providers (OpenAI, Google Gemini) - only for processing your queries</li>
              <li>Analytics services (for usage analysis)</li>
            </ul>
            <p>All service providers are contractually obligated to protect your information and use it only for the purposes we specify.</p>

            <h3>4.2 Legal Requirements</h3>
            <p>We may disclose your information if required by law or in response to:</p>
            <ul>
              <li>Court orders or legal processes</li>
              <li>Government requests or investigations</li>
              <li>Protection of our rights, property, or safety</li>
              <li>Protection of our users' rights, property, or safety</li>
            </ul>

            <h3>4.3 Business Transfers</h3>
            <p>In the event of a merger, acquisition, or sale of assets, your information may be transferred to the acquiring entity, subject to the same privacy protections.</p>
          </section>

          <section className="privacy-section">
            <h2>5. Your Data Rights</h2>
            
            <p>You have the following rights regarding your personal information:</p>
            
            <h3>5.1 Access</h3>
            <p>You can access and review your account information, connection configurations, and query history at any time through your account dashboard.</p>

            <h3>5.2 Correction</h3>
            <p>You can update or correct your account information and connection credentials at any time through the settings page.</p>

            <h3>5.3 Deletion</h3>
            <p>You can request deletion of your account and all associated data by contacting us at support@aiquery.ai. We will process your request within 30 days.</p>

            <h3>5.4 Data Portability</h3>
            <p>You can export your query results, connection configurations, and Knowledge Bases in standard formats (CSV, JSON) at any time.</p>

            <h3>5.5 Opt-Out</h3>
            <p>You can opt out of marketing communications by clicking the unsubscribe link in our emails or by contacting us directly.</p>
          </section>

          <section className="privacy-section">
            <h2>6. Third-Party Services</h2>
            
            <p>Our service integrates with third-party services:</p>
            
            <h3>6.1 LLM Providers</h3>
            <p>When you use AIquery, your queries are processed by third-party LLM providers (OpenAI or Google Gemini) that you configure. These providers have their own privacy policies:</p>
            <ul>
              <li><a href="https://openai.com/privacy" target="_blank" rel="noopener noreferrer">OpenAI Privacy Policy</a></li>
              <li><a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a></li>
            </ul>
            <p>We only send your query text and database schema information to these providers. We do not send your connection credentials or raw data.</p>

            <h3>6.2 Data Source Providers</h3>
            <p>When you connect to data sources (BigQuery, Airtable, PostgreSQL, etc.), you are subject to their respective privacy policies and terms of service.</p>

            <h3>6.3 Slack and Microsoft Teams</h3>
            <p>If you use our Slack or Teams integration, your interactions are subject to Slack's and Microsoft's privacy policies respectively.</p>
          </section>

          <section className="privacy-section">
            <h2>7. Data Retention</h2>
            
            <p>We retain your information for as long as necessary to provide our services and fulfill the purposes outlined in this policy:</p>
            <ul>
              <li><strong>Account Information:</strong> Retained while your account is active and for 30 days after account deletion</li>
              <li><strong>Connection Credentials:</strong> Retained while your account is active and until you delete the connection</li>
              <li><strong>Query History:</strong> Retained for 90 days unless you choose to delete it earlier</li>
              <li><strong>Knowledge Bases:</strong> Retained until you delete them or your account is deleted</li>
              <li><strong>Log Files:</strong> Retained for 30 days for security and troubleshooting purposes</li>
            </ul>
            <p>After the retention period, we securely delete or anonymize your information in accordance with our data retention policies.</p>
          </section>

          <section className="privacy-section">
            <h2>8. Children's Privacy</h2>
            
            <p>
              AIquery is not intended for users under the age of 18. We do not knowingly collect personal 
              information from children. If you believe we have collected information from a child, please 
              contact us immediately at support@aiquery.ai, and we will take steps to delete such information.
            </p>
          </section>

          <section className="privacy-section">
            <h2>9. International Data Transfers</h2>
            
            <p>
              Your information may be transferred to and processed in countries other than your country of 
              residence. These countries may have different data protection laws than your country. By using 
              our service, you consent to the transfer of your information to these countries. We ensure that 
              appropriate safeguards are in place to protect your information in accordance with this Privacy Policy.
            </p>
          </section>

          <section className="privacy-section">
            <h2>10. Changes to This Privacy Policy</h2>
            
            <p>
              We may update this Privacy Policy from time to time to reflect changes in our practices or 
              for other operational, legal, or regulatory reasons. We will notify you of any material changes 
              by posting the new Privacy Policy on this page and updating the "Last Updated" date. We encourage 
              you to review this Privacy Policy periodically to stay informed about how we protect your information.
            </p>
            <p>
              Your continued use of our service after any changes to this Privacy Policy constitutes your 
              acceptance of the updated policy.
            </p>
          </section>

          <section className="privacy-section">
            <h2>11. Contact Us</h2>
            
            <p>If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:</p>
            
            <div className="privacy-contact">
              <p><strong>Email:</strong> <a href="mailto:support@aiquery.ai">support@aiquery.ai</a></p>
              <p><strong>Subject Line:</strong> Privacy Policy Inquiry</p>
            </div>
            
            <p>We will respond to your inquiry within 30 days.</p>
          </section>

          <section className="privacy-section">
            <h2>12. Compliance</h2>
            
            <p>AIquery is designed to help you comply with data protection regulations:</p>
            <ul>
              <li><strong>GDPR (General Data Protection Regulation):</strong> We comply with GDPR requirements for EU users</li>
              <li><strong>CCPA (California Consumer Privacy Act):</strong> We respect CCPA rights for California residents</li>
              <li><strong>Other Regulations:</strong> We strive to comply with applicable data protection laws in all jurisdictions</li>
            </ul>
            <p>
              If you have specific compliance requirements or need assistance with data protection compliance, 
              please contact us at support@aiquery.ai.
            </p>
          </section>

          <div className="privacy-footer">
            <p className="privacy-acknowledgment">
              By using AIquery, you acknowledge that you have read and understood this Privacy Policy and 
              agree to the collection, use, and disclosure of your information as described herein.
            </p>
          </div>
        </div>
        </div>
      </main>

      {contactSection}
      {footer}
      {kiraChatbot}

    </div>
  )
}

export default PrivacyPolicy

