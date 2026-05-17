import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import Logo from './Logo';
import './PlanCheckoutPage.css';

const PLAN_SLUG_TO_STRIPE: Record<string, 'START_PRO' | 'SMART_PRO'> = {
  startpro: 'START_PRO',
  smartpro: 'SMART_PRO',
};

type PlanSlug = 'startpro' | 'smartpro';

interface PlanConfig {
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  monthlyGST: number;
  yearlyGST: number;
  features: string[];
}

const PLAN_CONFIG: Record<PlanSlug, PlanConfig> = {
  startpro: {
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
  smartpro: {
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
  },
};

const PlanCheckoutPage: React.FC = () => {
  const { planSlug } = useParams<{ planSlug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token, isAuthenticated } = useAuth();
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [additionalMembers, setAdditionalMembers] = useState<number>(0);
  const [checkoutRedirecting, setCheckoutRedirecting] = useState(false);

  const slug = (planSlug?.toLowerCase() || '') as PlanSlug;

  // Restore billing period from URL (e.g. after signup redirect ?billing=yearly)
  useEffect(() => {
    const billing = searchParams.get('billing');
    if (billing === 'monthly' || billing === 'yearly') setBillingPeriod(billing);
  }, [searchParams]);
  const plan = PLAN_CONFIG[slug];
  const stripePlan = PLAN_SLUG_TO_STRIPE[slug];

  const additionalMemberCost = additionalMembers * 10;
  const additionalMemberGST = additionalMemberCost * 0.05;

  const getTotals = () => {
    if (!plan) {
      return { base: 0, gst: 0, additional: 0, additionalGST: 0, total: 0, period: 'month' as const };
    }
    if (billingPeriod === 'monthly') {
      const base = plan.monthlyPrice;
      const gst = plan.monthlyGST;
      const additional = additionalMemberCost;
      const additionalGST = additionalMemberGST;
      const total = base + gst + additional + additionalGST;
      return { base, gst, additional, additionalGST, total, period: 'month' as const };
    }
    const base = plan.yearlyPrice;
    const gst = plan.yearlyGST;
    const additional = additionalMemberCost * 12;
    const additionalGST = additionalMemberGST * 12;
    const total = base + gst + additional + additionalGST;
    return { base, gst, additional, additionalGST, total, period: 'year' as const };
  };

  const handleCheckout = async () => {
    if (!stripePlan) {
      navigate('/pricing');
      return;
    }
    if (!isAuthenticated || !token) {
      navigate('/signup', { state: { from: 'pricing', plan: slug, billingPeriod } });
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

  const handleBack = () => {
    localStorage.setItem('aiquery_admin_active_panel', 'currentPlan');
    navigate('/app_admin');
  };

  if (!plan || !stripePlan) {
    navigate('/pricing');
    return null;
  }

  const totals = getTotals();

  return (
    <div className="plan-checkout-page">
      <header className="plan-checkout-topbar">
        <button
          type="button"
          className="plan-checkout-back"
          onClick={handleBack}
          aria-label="Back to Upgrade Plan"
        >
          ← Back
        </button>
        <Logo linkToAdmin={false} imageSrc="/images/aiquery_logo5.png" imageOnly />
      </header>
      <div className="plan-checkout-container">
        <div className="plan-checkout-grid">
          {/* Left: plan description */}
          <div className="plan-checkout-left">
            <h1 className="plan-checkout-title">{plan.name}</h1>
            <p className="plan-checkout-desc">
              Get full access to AIquery with this plan. Perfect for growing teams.
            </p>
            <ul className="plan-checkout-features">
              {plan.features.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>

          {/* Right: payment options */}
          <div className="plan-checkout-right">
            <h2 className="plan-checkout-side-title">Choose your plan</h2>

            <div className="plan-checkout-toggle">
              <button
                type="button"
                className={`plan-checkout-toggle-btn ${billingPeriod === 'monthly' ? 'active' : ''}`}
                onClick={() => setBillingPeriod('monthly')}
              >
                Monthly
              </button>
              <button
                type="button"
                className={`plan-checkout-toggle-btn ${billingPeriod === 'yearly' ? 'active' : ''}`}
                onClick={() => setBillingPeriod('yearly')}
              >
                Yearly
                <span className="plan-checkout-save">Save 20%</span>
              </button>
            </div>

            <div className="plan-checkout-members">
              <label htmlFor="plan-checkout-members">Additional team users:</label>
              <div className="plan-checkout-members-input">
                <button
                  type="button"
                  className="plan-checkout-members-btn"
                  onClick={() => setAdditionalMembers(Math.max(0, additionalMembers - 1))}
                  aria-label="Decrease"
                >
                  −
                </button>
                <input
                  id="plan-checkout-members"
                  type="number"
                  min={0}
                  value={additionalMembers}
                  onChange={(e) =>
                    setAdditionalMembers(Math.max(0, parseInt(e.target.value, 10) || 0))
                  }
                  aria-label="Additional team users"
                />
                <button
                  type="button"
                  className="plan-checkout-members-btn"
                  onClick={() => setAdditionalMembers(additionalMembers + 1)}
                  aria-label="Increase"
                >
                  +
                </button>
              </div>
            </div>

            <div className="plan-checkout-price-section">
              <div className="plan-checkout-price-breakdown">
                <div className="plan-checkout-price-item">
                  <span className="plan-checkout-price-label">Base price:</span>
                  <span className="plan-checkout-price-amount">${totals.base.toFixed(2)}</span>
                </div>
                <div className="plan-checkout-price-item">
                  <span className="plan-checkout-price-label">GST (5%):</span>
                  <span className="plan-checkout-price-amount">${totals.gst.toFixed(2)}</span>
                </div>
                {additionalMembers > 0 && (
                  <>
                    <div className="plan-checkout-price-item">
                      <span className="plan-checkout-price-label">
                        {additionalMembers} additional user{additionalMembers > 1 ? 's' : ''}:
                      </span>
                      <span className="plan-checkout-price-amount">${totals.additional.toFixed(2)}</span>
                    </div>
                    <div className="plan-checkout-price-item">
                      <span className="plan-checkout-price-label">Additional GST (5%):</span>
                      <span className="plan-checkout-price-amount">${totals.additionalGST.toFixed(2)}</span>
                    </div>
                  </>
                )}
                <div className="plan-checkout-price-item plan-checkout-price-total">
                  <span className="plan-checkout-price-label">Total:</span>
                  <span className="plan-checkout-price-amount">${totals.total.toFixed(2)}</span>
                </div>
              </div>
              <p className="plan-checkout-period">per {totals.period}</p>
            </div>

            <button
              type="button"
              className="plan-checkout-next"
              onClick={handleCheckout}
              disabled={checkoutRedirecting}
              aria-busy={checkoutRedirecting}
            >
              {checkoutRedirecting ? 'Redirecting…' : !isAuthenticated ? 'Sign up to continue' : 'Check Out'}
            </button>
          </div>
        </div>
      </div>

      <footer className="plan-checkout-footer">
        <a href="/terms" onClick={(e) => { e.preventDefault(); navigate('/terms'); }}>Terms of Service</a>
        <span className="plan-checkout-footer-sep">·</span>
        <a href="/privacy" onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}>Privacy Policy</a>
        <p className="plan-checkout-copyright">Copyright © 2026 AIquery</p>
      </footer>
    </div>
  );
};

export default PlanCheckoutPage;
