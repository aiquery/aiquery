import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Logo from './Logo'
import LandingHeader from './LandingHeader'
import LandingFooter from './LandingFooter'
import { X, Send } from 'lucide-react'
import GetInTouchSection from './GetInTouchSection'
import './LandingPage.css'
import './TermsOfService.css'

const TermsOfService: React.FC = () => {
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

  const contactSection = <GetInTouchSection subtitle="If you have questions or concerns about our Terms of Service, please contact us." />

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
    <div className="terms-page">
      {nav}
      <main className="terms-main">
        <div className="terms-content">
          <div className="terms-header">
            <h1>Terms of Service</h1>
            <p className="terms-last-updated">Last Updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>

          <div className="terms-body">
            <section className="terms-section">
              <p className="terms-intro">
                Welcome to AIquery. These Terms of Service ("Terms") govern your access to and use of the AIquery 
                service ("Service"), including our website, applications, and APIs. By accessing or using AIquery, 
                you agree to be bound by these Terms. If you do not agree to these Terms, you may not use the Service.
              </p>
              <p className="terms-intro">
                <strong>Please read these Terms carefully.</strong> They contain important information about your 
                legal rights, including limitations on our liability and your indemnification obligations.
              </p>
            </section>

            <section className="terms-section">
              <h2>1. Acceptance of Terms</h2>
              <p>
                By creating an account, accessing, or using AIquery, you acknowledge that you have read, understood, 
                and agree to be bound by these Terms and our Privacy Policy. If you are using AIquery on behalf of 
                an organization, you represent and warrant that you have the authority to bind that organization 
                to these Terms, and "you" will refer to both you and the organization.
              </p>
              <p>
                These Terms constitute a legally binding agreement between you and AIquery. If you do not agree 
                to these Terms, you must immediately stop using the Service and may not access or use any part of it.
              </p>
            </section>

            <section className="terms-section">
              <h2>2. Account Registration and Eligibility</h2>
              
              <h3>2.1 Eligibility</h3>
              <p>You must be at least 18 years old and have the legal capacity to enter into contracts to use AIquery. 
              By using the Service, you represent and warrant that:</p>
              <ul>
                <li>You are at least 18 years of age</li>
                <li>You have the legal authority to enter into these Terms</li>
                <li>You will provide accurate, current, and complete information during registration</li>
                <li>You will maintain and update your account information to keep it accurate, current, and complete</li>
                <li>You are responsible for maintaining the confidentiality of your account credentials</li>
                <li>You are responsible for all activities that occur under your account</li>
              </ul>

              <h3>2.2 Account Security</h3>
              <p>You are solely responsible for maintaining the confidentiality of your account password and for all 
              activities that occur under your account. You agree to:</p>
              <ul>
                <li>Use a strong, unique password</li>
                <li>Notify us immediately of any unauthorized access or use of your account</li>
                <li>Not share your account credentials with any third party</li>
                <li>Log out from your account when using shared or public devices</li>
              </ul>
              <p className="terms-note">
                <strong>Important:</strong> AIquery is not liable for any loss or damage arising from your failure 
                to comply with these security obligations.
              </p>
            </section>

            <section className="terms-section">
              <h2>3. Description of Service</h2>
              <p>
                AIquery is a workspace-first platform that enables users to query data sources using natural language. 
                The Service includes:
              </p>
              <ul>
                <li>Natural language to SQL query generation using AI/LLM technology</li>
                <li>Connection management for various data sources (BigQuery, Airtable, PostgreSQL, MySQL, Snowflake, Redshift, Azure SQL, Databricks)</li>
                <li>Knowledge Base (RAG) creation and management for improved query accuracy</li>
                <li>Few-Shot prompt configuration to guide query generation</li>
                <li>Query execution and result visualization</li>
                <li>Chat history and session management</li>
                <li>Slack and Microsoft Teams integrations</li>
                <li>Workspace and team collaboration features</li>
              </ul>
              <p>
                We reserve the right to modify, suspend, or discontinue any part of the Service at any time, 
                with or without notice, for any reason.
              </p>
            </section>

            <section className="terms-section">
              <h2>4. Acceptable Use Policy</h2>
              <p>
                You agree to use AIquery only for lawful purposes and in accordance with these Terms. You agree 
                <strong> NOT </strong>to:
              </p>
              <ul>
                <li>Use the Service to violate any applicable law, regulation, or third-party right</li>
                <li>Use the Service to transmit, store, or process any malicious code, viruses, malware, or harmful software</li>
                <li>Attempt to gain unauthorized access to any part of the Service, other accounts, or connected systems</li>
                <li>Use automated systems (bots, scrapers, crawlers) to access the Service without our express written permission</li>
                <li>Reverse engineer, decompile, disassemble, or attempt to extract the source code of the Service</li>
                <li>Interfere with or disrupt the integrity or performance of the Service or any third-party data sources</li>
                <li>Use the Service to generate content that is illegal, harmful, threatening, abusive, defamatory, or discriminatory</li>
                <li>Use the Service to process personal data without proper authorization or in violation of applicable privacy laws</li>
                <li>Use the Service in a manner that could damage, disable, overburden, or impair our servers or networks</li>
                <li>Impersonate any person or entity or falsely state or misrepresent your affiliation with any person or entity</li>
                <li>Collect or harvest information about other users without their consent</li>
                <li>Use the Service for any competitive purpose, including benchmarking or creating competing services</li>
                <li>Share, resell, or redistribute access to the Service without our express written permission</li>
              </ul>
              <p className="terms-note">
                <strong>Violation of this Acceptable Use Policy may result in immediate suspension or termination 
                of your account and access to the Service, without refund.</strong>
              </p>
            </section>

            <section className="terms-section">
              <h2>5. AI-Generated Content and Disclaimers</h2>
              
              <h3>5.1 AI Output Accuracy</h3>
              <p>
                AIquery uses artificial intelligence and large language models (LLMs) to generate SQL queries from 
                natural language inputs. <strong>You acknowledge and agree that:</strong>
              </p>
              <ul>
                <li>AI-generated SQL queries may contain errors, inaccuracies, or may not produce the intended results</li>
                <li>You are solely responsible for reviewing, validating, and testing all generated SQL before execution</li>
                <li>You should not rely on AI-generated queries as the sole basis for critical business decisions without human verification</li>
                <li>AI models may produce unexpected or incorrect outputs, including but not limited to SQL syntax errors, logical errors, or performance issues</li>
                <li>AIquery does not guarantee the accuracy, completeness, or reliability of any AI-generated content</li>
              </ul>

              <h3>5.2 Model Limitations and Disclaimers</h3>
              <p>
                The Service is provided "AS IS" and "AS AVAILABLE" without warranties of any kind, either express 
                or implied. We specifically disclaim:
              </p>
              <ul>
                <li>Any warranty that the Service will be uninterrupted, error-free, or free from defects</li>
                <li>Any warranty that AI-generated queries will be accurate, complete, or suitable for your purposes</li>
                <li>Any warranty of merchantability, fitness for a particular purpose, or non-infringement</li>
                <li>Any warranty regarding the performance, availability, or reliability of third-party LLM providers</li>
                <li>Any warranty that the Service will meet your specific requirements or expectations</li>
              </ul>

              <h3>5.3 Professional Advice Disclaimer</h3>
              <p>
                <strong>AIquery is not a substitute for professional advice.</strong> The Service should not be used 
                as the sole basis for:
              </p>
              <ul>
                <li>Legal, medical, financial, or other professional advice</li>
                <li>Decisions that could have material legal, financial, or personal consequences</li>
                <li>Compliance with regulatory requirements without independent verification</li>
                <li>Audit, accounting, or tax-related decisions</li>
              </ul>
              <p>
                You are solely responsible for evaluating the accuracy, completeness, and appropriateness of any 
                information or output generated by the Service for your specific use case.
              </p>
            </section>

            <section className="terms-section">
              <h2>6. Data Ownership and Processing</h2>
              
              <h3>6.1 Your Data</h3>
              <p>
                You retain all ownership rights to your data, including:
              </p>
              <ul>
                <li>Data stored in your connected data sources</li>
                <li>Query inputs and natural language questions</li>
                <li>Query results and exported data</li>
                <li>Knowledge Base configurations and metadata</li>
                <li>Workspace configurations and customizations</li>
              </ul>
              <p>
                AIquery does not claim ownership of your data. You are solely responsible for ensuring you have 
                the necessary rights and permissions to use, process, and query your data through the Service.
              </p>

              <h3>6.2 Data Processing</h3>
              <p>
                To provide the Service, AIquery processes your data as follows:
              </p>
              <ul>
                <li><strong>Query Processing:</strong> Your natural language queries and database schema information 
                are sent to third-party LLM providers (OpenAI, Google Gemini) that you configure to generate SQL queries. 
                We do not send your raw data or connection credentials to LLM providers.</li>
                <li><strong>Query Execution:</strong> Generated SQL queries are executed against your connected data 
                sources using the credentials you provide. Query results are returned to you and may be stored in your 
                chat history.</li>
                <li><strong>Service Improvement:</strong> We may use aggregated, anonymized usage data to improve 
                our Service, but we do not use your raw data or query results for training or improving third-party 
                LLM models without your explicit consent.</li>
              </ul>
              <p>
                For detailed information about how we handle your data, please review our 
                <a href="/privacy" onClick={(e) => { e.preventDefault(); navigate('/privacy') }}> Privacy Policy</a>.
              </p>

              <h3>6.3 Data Security</h3>
              <p>
                We implement industry-standard security measures to protect your data, including encryption in transit 
                and at rest. However, you acknowledge that:
              </p>
              <ul>
                <li>No method of transmission over the Internet or electronic storage is 100% secure</li>
                <li>You are responsible for maintaining the security of your connection credentials</li>
                <li>You should not store highly sensitive or regulated data (e.g., payment card data, health records) 
                in data sources accessed through AIquery without appropriate safeguards</li>
                <li>AIquery is not responsible for security breaches resulting from your failure to secure your 
                account or connection credentials</li>
              </ul>
            </section>

            <section className="terms-section">
              <h2>7. Intellectual Property Rights</h2>
              
              <h3>7.1 AIquery Intellectual Property</h3>
              <p>
                The Service, including its design, features, functionality, software, text, graphics, logos, and 
                other content, is owned by AIquery or its licensors and is protected by copyright, trademark, 
                patent, and other intellectual property laws. You may not:
              </p>
              <ul>
                <li>Copy, modify, distribute, sell, or lease any part of the Service</li>
                <li>Reverse engineer or attempt to extract the source code of the Service</li>
                <li>Remove, alter, or obscure any proprietary notices on the Service</li>
                <li>Use AIquery's trademarks, logos, or brand features without our prior written consent</li>
              </ul>

              <h3>7.2 AI-Generated Output Ownership</h3>
              <p>
                Subject to your compliance with these Terms, you own the SQL queries and results generated by the 
                Service for your use. However:
              </p>
              <ul>
                <li>You may not use AI-generated outputs in ways that violate these Terms or applicable law</li>
                <li>You may not use outputs for high-risk applications (medical diagnosis, legal advice, financial 
                trading) without appropriate human oversight and verification</li>
                <li>You may not claim that AI-generated content was created by humans</li>
                <li>You are responsible for ensuring your use of outputs complies with third-party rights and 
                applicable regulations</li>
              </ul>

              <h3>7.3 User Content License</h3>
              <p>
                By submitting content (queries, feedback, suggestions) to AIquery, you grant us a non-exclusive, 
                worldwide, royalty-free license to use, modify, and display such content solely for the purpose 
                of providing and improving the Service.
              </p>
            </section>

            <section className="terms-section">
              <h2>8. Payment Terms and Subscriptions</h2>
              
              <h3>8.1 Subscription Plans</h3>
              <p>
                AIquery offers various subscription plans with different features, usage limits, and pricing. 
                Current plans and pricing are available at <a href="/pricing" onClick={(e) => { e.preventDefault(); navigate('/pricing') }}>our pricing page</a>. 
                We reserve the right to modify our pricing and plans at any time, with changes taking effect 
                at the start of your next billing cycle.
              </p>

              <h3>8.2 Billing and Payment</h3>
              <p>
                By subscribing to a paid plan, you agree to:
              </p>
              <ul>
                <li>Pay all fees associated with your subscription plan</li>
                <li>Provide accurate billing information and keep it updated</li>
                <li>Authorize us to charge your payment method for all fees</li>
                <li>Pay fees in advance for the billing period (monthly or annual)</li>
                <li>Pay any applicable taxes, duties, or fees</li>
              </ul>

              <h3>8.3 Free Trial</h3>
              <p>
                We may offer a free trial period. If you are on a free trial:
              </p>
              <ul>
                <li>You will be automatically converted to a paid plan at the end of the trial period unless you cancel</li>
                <li>You must provide valid payment information to start a trial</li>
                <li>We reserve the right to modify or discontinue free trials at any time</li>
              </ul>

              <h3>8.4 Renewals and Cancellations</h3>
              <p>
                Subscriptions automatically renew at the end of each billing period unless you cancel before the 
                renewal date. You may cancel your subscription at any time through your account settings. 
                Cancellation takes effect at the end of your current billing period. You will continue to have 
                access to the Service until the end of the paid period.
              </p>

              <h3>8.5 Refunds</h3>
              <p>
                All fees are non-refundable except as required by law or as explicitly stated in these Terms. 
                We do not provide refunds for:
              </p>
              <ul>
                <li>Partial billing periods</li>
                <li>Unused features or query credits</li>
                <li>Dissatisfaction with the Service (subject to our refund policy)</li>
                <li>Account termination due to violation of these Terms</li>
              </ul>
              <p>
                If you believe you are entitled to a refund, please contact us at support@aiquery.ai.
              </p>

              <h3>8.6 Usage Limits and Overages</h3>
              <p>
                Your subscription plan includes specific usage limits (e.g., number of queries per month, number 
                of users, Knowledge Base size). If you exceed these limits:
              </p>
              <ul>
                <li>We may suspend or throttle your access until the next billing period</li>
                <li>We may require you to upgrade to a higher plan</li>
                <li>We may charge overage fees (if applicable to your plan)</li>
                <li>You are responsible for monitoring your usage and upgrading when necessary</li>
              </ul>
            </section>

            <section className="terms-section">
              <h2>9. Rate Limits and Fair Use</h2>
              <p>
                To ensure fair access and system stability, AIquery implements rate limits and fair use policies:
              </p>
              <ul>
                <li>We may limit the number of queries, API calls, or requests you can make within a given time period</li>
                <li>Rate limits vary by subscription plan and may be adjusted at our discretion</li>
                <li>Excessive use that degrades system performance may result in throttling or suspension</li>
                <li>You agree not to circumvent or attempt to circumvent rate limits</li>
                <li>We reserve the right to implement additional restrictions to prevent abuse</li>
              </ul>
              <p>
                If you require higher rate limits, please contact us at support@aiquery.ai to discuss enterprise options.
              </p>
            </section>

            <section className="terms-section">
              <h2>10. Third-Party Services and Integrations</h2>
              
              <h3>10.1 LLM Providers</h3>
              <p>
                AIquery integrates with third-party LLM providers (OpenAI, Google Gemini) that you configure. 
                Your use of these providers is subject to their respective terms of service and privacy policies. 
                AIquery is not responsible for:
              </p>
              <ul>
                <li>The availability, performance, or reliability of third-party LLM services</li>
                <li>Changes to third-party LLM APIs, pricing, or terms</li>
                <li>Any issues arising from your use of third-party LLM services</li>
                <li>Compliance with third-party LLM provider terms and policies</li>
              </ul>

              <h3>10.2 Data Source Providers</h3>
              <p>
                When you connect to data sources (BigQuery, Airtable, PostgreSQL, etc.), you are subject to 
                their respective terms of service and privacy policies. AIquery is not responsible for:
              </p>
              <ul>
                <li>The availability, performance, or security of your data sources</li>
                <li>Data loss or corruption in your data sources</li>
                <li>Compliance with data source provider terms and policies</li>
                <li>Any issues arising from your use of third-party data sources</li>
              </ul>

              <h3>10.3 Slack and Microsoft Teams</h3>
              <p>
                If you use our Slack or Teams integrations, your use is subject to Slack's and Microsoft's 
                respective terms of service. You are responsible for:
              </p>
              <ul>
                <li>Obtaining necessary permissions and authorizations from Slack/Microsoft</li>
                <li>Complying with Slack's and Microsoft's terms and policies</li>
                <li>Ensuring your use of integrations complies with your organization's policies</li>
              </ul>
            </section>

            <section className="terms-section">
              <h2>11. Beta Features and Early Access</h2>
              <p>
                AIquery may offer beta features, early access programs, or experimental functionality. These 
                features are provided "AS IS" and may:
              </p>
              <ul>
                <li>Contain bugs, errors, or incomplete functionality</li>
                <li>Be modified or discontinued at any time without notice</li>
                <li>Have different terms, limitations, or restrictions</li>
                <li>Not be covered by our standard support or SLA commitments</li>
              </ul>
              <p>
                <strong>You use beta features at your own risk.</strong> AIquery disclaims all warranties 
                and liability related to beta features to the maximum extent permitted by law.
              </p>
            </section>

            <section className="terms-section">
              <h2>12. Limitation of Liability</h2>
              
              <h3>12.1 Limitation of Damages</h3>
              <p>
                <strong>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, AIQUERY AND ITS AFFILIATES, OFFICERS, 
                DIRECTORS, EMPLOYEES, AGENTS, AND LICENSORS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, 
                SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO:</strong>
              </p>
              <ul>
                <li>Loss of profits, revenue, data, or business opportunities</li>
                <li>Cost of substitute goods or services</li>
                <li>Business interruption or loss of goodwill</li>
                <li>Errors or inaccuracies in AI-generated content</li>
                <li>Data loss or corruption</li>
                <li>Security breaches or unauthorized access</li>
                <li>Service interruptions or unavailability</li>
              </ul>

              <h3>12.2 Liability Cap</h3>
              <p>
                <strong>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, AIQUERY'S TOTAL LIABILITY TO YOU 
                FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE 
                AMOUNT YOU PAID TO AIQUERY IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR ONE HUNDRED 
                DOLLARS ($100), WHICHEVER IS GREATER.</strong>
              </p>

              <h3>12.3 Exclusions</h3>
              <p>
                Some jurisdictions do not allow the exclusion or limitation of certain damages. If these laws 
                apply to you, some or all of the above exclusions or limitations may not apply, and you may 
                have additional rights. However, to the maximum extent permitted by law, our liability is 
                limited as described above.
              </p>
            </section>

            <section className="terms-section">
              <h2>13. Indemnification</h2>
              <p>
                <strong>You agree to indemnify, defend, and hold harmless AIquery and its affiliates, officers, 
                directors, employees, agents, and licensors from and against any and all claims, damages, losses, 
                liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or relating to:</strong>
              </p>
              <ul>
                <li>Your use or misuse of the Service</li>
                <li>Your violation of these Terms or any applicable law</li>
                <li>Your violation of any third-party rights, including intellectual property rights</li>
                <li>Your data, content, or materials</li>
                <li>Your use of AI-generated outputs in violation of these Terms or applicable law</li>
                <li>Any claims arising from your connection to third-party data sources</li>
                <li>Any claims arising from your use of third-party LLM providers or integrations</li>
              </ul>
              <p>
                This indemnification obligation will survive termination of these Terms and your use of the Service.
              </p>
            </section>

            <section className="terms-section">
              <h2>14. Termination</h2>
              
              <h3>14.1 Termination by You</h3>
              <p>
                You may terminate your account at any time by:
              </p>
              <ul>
                <li>Canceling your subscription through your account settings</li>
                <li>Contacting us at support@aiquery.ai and requesting account deletion</li>
              </ul>
              <p>
                Upon termination, your access to the Service will cease, and we may delete your account data 
                in accordance with our Privacy Policy. You are responsible for exporting any data you wish to 
                retain before termination.
              </p>

              <h3>14.2 Termination by AIquery</h3>
              <p>
                We may suspend or terminate your account immediately, without prior notice, if:
              </p>
              <ul>
                <li>You violate these Terms or our Acceptable Use Policy</li>
                <li>You fail to pay fees when due</li>
                <li>You engage in fraudulent, illegal, or harmful activities</li>
                <li>We are required to do so by law or court order</li>
                <li>We discontinue the Service or a portion thereof</li>
                <li>We determine, in our sole discretion, that your use poses a security risk or threatens the 
                integrity of the Service</li>
              </ul>

              <h3>14.3 Effect of Termination</h3>
              <p>
                Upon termination:
              </p>
              <ul>
                <li>Your right to access and use the Service will immediately cease</li>
                <li>All outstanding fees will become immediately due and payable</li>
                <li>We may delete your account data in accordance with our data retention policies</li>
                <li>Sections of these Terms that by their nature should survive termination will survive, 
                including but not limited to Sections 5 (Disclaimers), 12 (Limitation of Liability), 13 
                (Indemnification), and 17 (Governing Law)</li>
              </ul>
            </section>

            <section className="terms-section">
              <h2>15. Modifications to Terms and Service</h2>
              
              <h3>15.1 Changes to Terms</h3>
              <p>
                We reserve the right to modify these Terms at any time. If we make material changes, we will:
              </p>
              <ul>
                <li>Notify you by email (to the address associated with your account) or through a notice 
                on the Service</li>
                <li>Post the updated Terms on this page with an updated "Last Updated" date</li>
                <li>Provide at least 30 days' notice for material changes (except for changes required by law)</li>
              </ul>
              <p>
                Your continued use of the Service after the effective date of the modified Terms constitutes 
                your acceptance of the changes. If you do not agree to the modified Terms, you must stop 
                using the Service and terminate your account.
              </p>

              <h3>15.2 Changes to Service</h3>
              <p>
                We reserve the right to modify, suspend, or discontinue any part of the Service at any time, 
                with or without notice. We are not liable to you or any third party for any modification, 
                suspension, or discontinuation of the Service.
              </p>
            </section>

            <section className="terms-section">
              <h2>16. Dispute Resolution</h2>
              
              <h3>16.1 Informal Resolution</h3>
              <p>
                Before filing a claim, you agree to contact us at support@aiquery.ai to attempt to resolve 
                the dispute informally. We will attempt to resolve the dispute in good faith within 60 days 
                of your notice.
              </p>

              <h3>16.2 Binding Arbitration</h3>
              <p>
                If we cannot resolve the dispute informally, you and AIquery agree to resolve any disputes 
                arising out of or relating to these Terms or the Service through binding arbitration, except 
                that:
              </p>
              <ul>
                <li>Either party may bring claims in small claims court if the claims qualify</li>
                <li>Either party may seek injunctive relief in court to prevent irreparable harm</li>
                <li>Either party may opt out of arbitration within 30 days of first accepting these Terms</li>
              </ul>
              <p>
                Arbitration will be conducted by a single arbitrator under the rules of the American Arbitration 
                Association (AAA) or a similar arbitration organization. The arbitration will be conducted in the 
                English language and will be held in a location mutually agreed upon by the parties.
              </p>

              <h3>16.3 Class Action Waiver</h3>
              <p>
                You and AIquery agree that any disputes will be resolved on an individual basis and not as a 
                class, collective, or representative action. You waive any right to participate in a class action 
                lawsuit or class-wide arbitration.
              </p>
            </section>

            <section className="terms-section">
              <h2>17. Governing Law and Jurisdiction</h2>
              <p>
                These Terms shall be governed by and construed in accordance with the laws of the State of 
                California, United States, without regard to its conflict of law provisions. Any legal action 
                or proceeding arising out of or relating to these Terms or the Service (except for arbitration) 
                shall be brought exclusively in the federal or state courts located in San Francisco County, 
                California, and you consent to the personal jurisdiction of such courts.
              </p>
              <p>
                If you are located outside the United States, you agree that any disputes will be resolved 
                according to the laws of California, United States, and you consent to the jurisdiction of 
                courts in San Francisco County, California.
              </p>
            </section>

            <section className="terms-section">
              <h2>18. General Provisions</h2>
              
              <h3>18.1 Entire Agreement</h3>
              <p>
                These Terms, together with our Privacy Policy, constitute the entire agreement between you and 
                AIquery regarding the Service and supersede all prior agreements and understandings.
              </p>

              <h3>18.2 Severability</h3>
              <p>
                If any provision of these Terms is found to be invalid, illegal, or unenforceable, the remaining 
                provisions will continue in full force and effect, and the invalid provision will be modified 
                to the minimum extent necessary to make it valid and enforceable.
              </p>

              <h3>18.3 Waiver</h3>
              <p>
                No waiver of any term or condition of these Terms shall be deemed a further or continuing waiver 
                of such term or condition or any other term or condition. Any failure to assert a right or 
                provision under these Terms shall not constitute a waiver of such right or provision.
              </p>

              <h3>18.4 Assignment</h3>
              <p>
                You may not assign or transfer these Terms or your account without our prior written consent. 
                We may assign or transfer these Terms or our rights and obligations without restriction.
              </p>

              <h3>18.5 Force Majeure</h3>
              <p>
                AIquery shall not be liable for any failure or delay in performance under these Terms due to 
                circumstances beyond our reasonable control, including but not limited to acts of God, natural 
                disasters, war, terrorism, labor disputes, internet failures, or actions of third-party service 
                providers.
              </p>

              <h3>18.6 Notices</h3>
              <p>
                All notices to AIquery must be sent to support@aiquery.ai. We may send notices to you via 
                email to the address associated with your account or through the Service.
              </p>

              <h3>18.7 Contact Information</h3>
              <p>
                If you have questions about these Terms, please contact us at:
              </p>
              <div className="terms-contact">
                <p><strong>Email:</strong> <a href="mailto:support@aiquery.ai">support@aiquery.ai</a></p>
                <p><strong>Subject Line:</strong> Terms of Service Inquiry</p>
              </div>
            </section>

            <div className="terms-footer">
              <p className="terms-acknowledgment">
                <strong>By using AIquery, you acknowledge that you have read, understood, and agree to be bound 
                by these Terms of Service.</strong> If you do not agree to these Terms, you may not use the Service.
              </p>
              <p className="terms-acknowledgment">
                These Terms are effective as of the date you first access or use the Service and will remain in 
                effect until terminated in accordance with Section 14.
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

export default TermsOfService
