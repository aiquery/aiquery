import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import './PricingPlans.css';

// Plan names as used by the API
const PLAN_TO_STRIPE: Record<string, 'START_PRO' | 'SMART_PRO'> = {
  StartPro: 'START_PRO',
  SmartPro: 'SMART_PRO',
};

/** Upgrade order: only show plans above current plan */
const PLAN_ORDER = ['Free', 'StartPro', 'SmartPro', 'Enterprise'] as const;
type PlanName = (typeof PLAN_ORDER)[number];

function normalizePlanName(raw: string | undefined): PlanName {
  if (!raw) return 'Free';
  const lower = raw.toLowerCase();
  if (lower === 'free') return 'Free';
  if (lower === 'startpro') return 'StartPro';
  if (lower === 'smartpro') return 'SmartPro';
  if (lower === 'enterprise') return 'Enterprise';
  return 'Free';
}

interface PricingPlan {
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  monthlyGST: number;
  yearlyGST: number;
  features: string[];
  highlighted?: boolean;
}

/** Enterprise is display-only (Contact Sales, no price) */
const ENTERPRISE_FEATURES = [
  'Unlimited connections to Slack or MS Teams (Under Development)',
  'Unlimited knowledge base',
  'Custom number of users',
  'Custom number of workspace',
  'Custom number of queries',
  'Custom number of tables per data source',
  'Data source customization',
  'Business customization',
  'Account permissions management',
  'Dedicated customer support',
];

export interface PricingPlansProps {
  /** When true, used inside UpgradePlanModal; compact layout, no outer section padding */
  embedded?: boolean;
  /** Called when user closes (e.g. modal close); only used when embedded */
  onClose?: () => void;
}

const PricingPlans: React.FC<PricingPlansProps> = ({ embedded = false, onClose }) => {
  const { token, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [additionalMembers, setAdditionalMembers] = useState<number>(0);
  const [checkoutRedirecting, setCheckoutRedirecting] = useState(false);
  const [currentPlanName, setCurrentPlanName] = useState<PlanName>('Free');
  const [subscriptionLoading, setSubscriptionLoading] = useState(embedded);
  const [showEnterpriseContact, setShowEnterpriseContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');

  useEffect(() => {
    if (!embedded || !token) {
      if (embedded && !token) setSubscriptionLoading(false);
      return;
    }
    let cancelled = false;
    axios
      .get('/api/subscription', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (cancelled) return;
        const raw = res.data?.subscription?.planName ?? 'free';
        setCurrentPlanName(normalizePlanName(raw));
      })
      .catch(() => {
        if (!cancelled) setCurrentPlanName('Free');
      })
      .finally(() => {
        if (!cancelled) setSubscriptionLoading(false);
      });
    return () => { cancelled = true; };
  }, [embedded, token]);

  // Aligned with AIQuery Payment Integration Setup Guide: $40/$388, $68/$668, +5% GST
  const plans: PricingPlan[] = [
    {
      name: 'StartPro',
      monthlyPrice: 40,
      yearlyPrice: 388,
      monthlyGST: 40 * 0.05,
      yearlyGST: 388 * 0.05,
      features: [
        'Unlimited connections to Slack or MS Teams (Under Development)',
        'Unlimited knowledge base',
        'Up to 3 users',
        'Up to 3 workspaces',
        'Up to 300 queries/month',
        'Up to 5 tables per data source',
        'Data source customization',
        'Standard customer support',
      ],
    },
    {
      name: 'SmartPro',
      monthlyPrice: 68,
      yearlyPrice: 668,
      monthlyGST: 68 * 0.05,
      yearlyGST: 668 * 0.05,
      features: [
        'Unlimited connections to Slack or MS Teams (Under Development)',
        'Unlimited knowledge base',
        'Up to 6 users',
        'Up to 6 workspaces',
        'Up to 800 queries/month',
        'Up to 10 tables per data source',
        'Data source customization',
        'Priority customer support',
      ],
      highlighted: true,
    },
  ];

  const additionalMemberCost = additionalMembers * 10;
  const additionalMemberGST = additionalMemberCost * 0.05;

  const calculateTotal = (plan: PricingPlan) => {
    if (billingPeriod === 'monthly') {
      return {
        base: plan.monthlyPrice,
        gst: plan.monthlyGST,
        additional: additionalMemberCost,
        additionalGST: additionalMemberGST,
        total: plan.monthlyPrice + plan.monthlyGST + additionalMemberCost + additionalMemberGST,
      };
    } else {
      return {
        base: plan.yearlyPrice,
        gst: plan.yearlyGST,
        additional: additionalMemberCost * 12,
        additionalGST: additionalMemberGST * 12,
        total:
          plan.yearlyPrice + plan.yearlyGST + additionalMemberCost * 12 + additionalMemberGST * 12,
      };
    }
  };

  const handleSubscribe = async (planName: string) => {
    const stripePlan = PLAN_TO_STRIPE[planName];
    if (!stripePlan) return;

    if (!isAuthenticated || !token) {
      navigate('/signup', { state: { from: 'pricing' } });
      return;
    }

    setCheckoutRedirecting(true);
    try {
      const res = await axios.post(
        '/api/stripe/create-checkout-session',
        {
          plan: stripePlan,
          billingPeriod,
          additionalMembers,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.data?.url) {
        window.location.href = res.data.url;
        return;
      }
      throw new Error(res.data?.error || 'No checkout URL returned');
    } catch (err: any) {
      setCheckoutRedirecting(false);
      const msg = err.response?.data?.error || err.message || 'Failed to start checkout';
      alert(msg);
    }
  };

  /** When embedded, show contact card inline on /app_admin; otherwise navigate to /contact */
  const handleContactSales = (forEnterpriseCard?: boolean) => {
    if (embedded && forEnterpriseCard) {
      setShowEnterpriseContact(true);
      return;
    }
    if (embedded && onClose) {
      onClose();
      navigate('/contact');
    } else {
      navigate('/contact');
    }
  };

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const subject = `AIquery Enterprise: ${contactName || 'New inquiry'}`;
    const body = [
      `Name: ${contactName || '-'}`,
      `Email: ${contactEmail || '-'}`,
      '',
      contactMessage || '',
    ].join('\n');
    window.open(`mailto:support@aiquery.ai?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
  };

  // Upgrade card: only show plans above current. Free -> StartPro, SmartPro, Enterprise; StartPro -> SmartPro, Enterprise; SmartPro -> Enterprise; Enterprise -> none
  const currentIndex = PLAN_ORDER.indexOf(currentPlanName);
  const visiblePlanNames = embedded
    ? PLAN_ORDER.slice(currentIndex + 1)
    : (['StartPro', 'SmartPro'] as PlanName[]);
  const visiblePaidPlans = plans.filter((p) => visiblePlanNames.includes(p.name as PlanName));
  const showEnterpriseCard = embedded && visiblePlanNames.includes('Enterprise');

  const wrapperClass = embedded ? 'pricing-plans-embedded' : 'pricing-section';

  if (embedded && showEnterpriseContact) {
    return (
      <section className={wrapperClass}>
        <div className="pricing-container">
          <div className="enterprise-contact-card">
            <h3>Contact Sales – Enterprise</h3>
            <p>Tell us about your requirements and we&apos;ll get back to you.</p>
            <form className="enterprise-contact-form" onSubmit={handleContactSubmit}>
              <div className="enterprise-contact-row">
                <label htmlFor="ec-name">Name</label>
                <input
                  id="ec-name"
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div className="enterprise-contact-row">
                <label htmlFor="ec-email">Email</label>
                <input
                  id="ec-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="your@email.com"
                />
              </div>
              <div className="enterprise-contact-row">
                <label htmlFor="ec-message">Message</label>
                <textarea
                  id="ec-message"
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  placeholder="Your requirements or questions..."
                  rows={4}
                />
              </div>
              <div className="enterprise-contact-actions">
                <button type="button" className="contact-btn secondary" onClick={() => setShowEnterpriseContact(false)}>
                  Back to plans
                </button>
                <button type="submit" className="contact-btn">
                  Send Message
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={wrapperClass}>
      <div className="pricing-container">
        {!embedded && (
          <div className="pricing-header">
            <h2>Simple, Transparent Pricing</h2>
            <p>Choose the perfect plan for your team. Secure checkout powered by Stripe.</p>
          </div>
        )}

        {subscriptionLoading && embedded && (
          <div className="pricing-plans-loading">Loading your plan…</div>
        )}

        {!embedded && (
          <>
            {/* Billing Period Toggle */}
            <div className="billing-toggle">
              <button
                type="button"
                className={`toggle-btn ${billingPeriod === 'monthly' ? 'active' : ''}`}
                onClick={() => setBillingPeriod('monthly')}
              >
                Monthly
              </button>
              <button
                type="button"
                className={`toggle-btn ${billingPeriod === 'yearly' ? 'active' : ''}`}
                onClick={() => setBillingPeriod('yearly')}
              >
                Yearly
                <span className="save-badge">Save 20%</span>
              </button>
            </div>

            {/* Additional Members Selector */}
            <div className="additional-members-section">
              <label htmlFor="members">Additional team users:</label>
              <div className="members-input-group">
                <button
                  type="button"
                  className="member-btn"
                  onClick={() => setAdditionalMembers(Math.max(0, additionalMembers - 1))}
                  aria-label="Decrease users"
                >
                  −
                </button>
                <input
                  id="members"
                  type="number"
                  min="0"
                  value={additionalMembers}
                  onChange={(e) =>
                    setAdditionalMembers(Math.max(0, parseInt(e.target.value, 10) || 0))
                  }
                  className="member-input"
                  aria-label="Number of additional users"
                />
                <button
                  type="button"
                  className="member-btn"
                  onClick={() => setAdditionalMembers(additionalMembers + 1)}
                  aria-label="Increase users"
                >
                  +
                </button>
                <span className="member-cost">
                  ${(additionalMembers * 10).toFixed(2)}
                  {billingPeriod === 'yearly' ? '/year' : '/month'}
                </span>
              </div>
            </div>
          </>
        )}

        {embedded && !subscriptionLoading && visiblePaidPlans.length > 0 && (
          <>
            <div className="billing-toggle">
              <button
                type="button"
                className={`toggle-btn ${billingPeriod === 'monthly' ? 'active' : ''}`}
                onClick={() => setBillingPeriod('monthly')}
              >
                Monthly
              </button>
              <button
                type="button"
                className={`toggle-btn ${billingPeriod === 'yearly' ? 'active' : ''}`}
                onClick={() => setBillingPeriod('yearly')}
              >
                Yearly
                <span className="save-badge">Save 20%</span>
              </button>
            </div>
            <div className="additional-members-section">
              <label htmlFor="members-embedded">Additional team users:</label>
              <div className="members-input-group">
                <button
                  type="button"
                  className="member-btn"
                  onClick={() => setAdditionalMembers(Math.max(0, additionalMembers - 1))}
                  aria-label="Decrease users"
                >
                  −
                </button>
                <input
                  id="members-embedded"
                  type="number"
                  min="0"
                  value={additionalMembers}
                  onChange={(e) =>
                    setAdditionalMembers(Math.max(0, parseInt(e.target.value, 10) || 0))
                  }
                  className="member-input"
                  aria-label="Number of additional users"
                />
                <button
                  type="button"
                  className="member-btn"
                  onClick={() => setAdditionalMembers(additionalMembers + 1)}
                  aria-label="Increase users"
                >
                  +
                </button>
                <span className="member-cost">
                  ${(additionalMembers * 10).toFixed(2)}
                  {billingPeriod === 'yearly' ? '/year' : '/month'}
                </span>
              </div>
            </div>
          </>
        )}

        {/* Pricing Cards – filtered by current plan when embedded */}
        <div className="pricing-cards">
          {visiblePaidPlans.map((plan) => {
            const totals = calculateTotal(plan);
            const period = billingPeriod === 'monthly' ? 'month' : 'year';
            const isUpgradeContext = embedded;

            return (
              <div
                key={plan.name}
                className={`pricing-card ${plan.highlighted ? 'highlighted' : ''}`}
              >
                {plan.highlighted && <div className="popular-badge">Most Popular</div>}

                <h3 className="plan-name">{plan.name}</h3>

                {/* Price Display */}
                <div className="price-section">
                  <div className="price-breakdown">
                    <div className="price-item">
                      <span className="label">Base price:</span>
                      <span className="amount">${totals.base.toFixed(2)}</span>
                    </div>
                    <div className="price-item">
                      <span className="label">GST (5%):</span>
                      <span className="amount">${totals.gst.toFixed(2)}</span>
                    </div>
                    {additionalMembers > 0 && (
                      <>
                        <div className="price-item">
                          <span className="label">
                            {additionalMembers} additional user
                            {additionalMembers > 1 ? 's' : ''}:
                          </span>
                          <span className="amount">${totals.additional.toFixed(2)}</span>
                        </div>
                        <div className="price-item">
                          <span className="label">Additional GST (5%):</span>
                          <span className="amount">${totals.additionalGST.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    <div className="price-item total">
                      <span className="label">Total:</span>
                      <span className="amount">${totals.total.toFixed(2)}</span>
                    </div>
                  </div>
                  <p className="period">per {period}</p>
                </div>

                {/* Features List */}
                <ul className="features-list">
                  {plan.features.map((feature, index) => (
                    <li key={index}>
                      <svg
                        className="check-icon"
                        width="20"
                        height="20"
                        viewBox="0 0 20 20"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden
                      >
                        <path
                          d="M16.667 5L7.5 14.167L3.333 10"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* CTA Button – "Upgrade Plan" for StartPro/SmartPro when embedded */}
                <button
                  type="button"
                  className={`subscribe-btn ${plan.highlighted ? 'primary' : 'secondary'}`}
                  onClick={() => handleSubscribe(plan.name)}
                  disabled={checkoutRedirecting}
                  aria-busy={checkoutRedirecting}
                >
                  {checkoutRedirecting
                    ? 'Redirecting…'
                    : !isAuthenticated
                      ? 'Sign in to get started'
                      : isUpgradeContext
                        ? 'Upgrade Plan'
                        : 'Get started'}
                </button>
              </div>
            );
          })}

          {/* Enterprise card – when embedded and above current plan */}
          {showEnterpriseCard && (
            <div key="Enterprise" className="pricing-card pricing-card-enterprise">
              <h3 className="plan-name">Enterprise</h3>
              <div className="price-section">
                <p className="enterprise-price-text">Custom pricing</p>
              </div>
              <ul className="features-list">
                {ENTERPRISE_FEATURES.map((feature, index) => (
                  <li key={index}>
                    <svg
                      className="check-icon"
                      width="20"
                      height="20"
                      viewBox="0 0 20 20"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden
                    >
                      <path
                        d="M16.667 5L7.5 14.167L3.333 10"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="subscribe-btn secondary"
                onClick={() => handleContactSales(true)}
              >
                Contact Sales
              </button>
            </div>
          )}
        </div>

        {/* Stripe branding - matches Stripe's partner/merchant requirements */}
        <p className="pricing-stripe-notice">
          Payments are securely processed by Stripe. We accept Visa, Mastercard, and American
          Express.
        </p>

        {!embedded && (
          <>
            {/* FAQ Section */}
            <div className="pricing-faq">
              <h3>Frequently asked questions</h3>
              <div className="faq-items">
                <div className="faq-item">
                  <h4>Can I change my plan anytime?</h4>
                  <p>
                    Yes. You can upgrade or downgrade at any time. Changes apply at the start of
                    your next billing cycle.
                  </p>
                </div>
                <div className="faq-item">
                  <h4>What payment methods do you accept?</h4>
                  <p>
                    We accept Visa, Mastercard, and American Express through Stripe. All payments
                    are secure.
                  </p>
                </div>
                <div className="faq-item">
                  <h4>Is there a free trial?</h4>
                  <p>
                    Yes. New accounts get a 30-day free trial. No credit card required to start.
                  </p>
                </div>
                <div className="faq-item">
                  <h4>Do you offer discounts for annual billing?</h4>
                  <p>Yes. Annual plans save 20% compared to monthly billing.</p>
                </div>
                <div className="faq-item">
                <h4>What about team users?</h4>
                <p>
                  StartPro includes up to 3 users; SmartPro up to 6. Additional users are
                  $10/month each (or $96/year).
                </p>
                </div>
                <div className="faq-item">
                  <h4>Can I cancel anytime?</h4>
                  <p>
                    Yes. You can cancel anytime. Access continues until the end of your current
                    billing period.
                  </p>
                </div>
              </div>
            </div>

            {/* Enterprise Section */}
            <div className="enterprise-section">
              <h3>Need a custom plan?</h3>
              <p>
                For enterprise customers with specific requirements, we offer custom pricing and
                dedicated support.
              </p>
              <button type="button" className="contact-btn" onClick={handleContactSales}>
                Contact sales
              </button>
            </div>
          </>
        )}

        {embedded && onClose && (
          <div className="pricing-plans-embedded-actions">
            <button type="button" className="contact-btn" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

export default PricingPlans;
