import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import Logo from './Logo';
import './PricingWelcomePage.css';

const PricingWelcomePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);

  // After Stripe redirect, verify checkout session so subscription is synced to DB
  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    if (!sessionId || verified) return;

    const token = localStorage.getItem('aiquery_token');
    if (!token) return;

    setVerifying(true);
    axios
      .post(
        '/api/stripe/verify-checkout-session',
        { sessionId },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      .then((res) => {
        if (res.data?.success) {
          setVerified(true);
        }
      })
      .catch((err) => {
        console.error('Error verifying checkout session:', err);
        // Still allow user to continue; webhook may have synced
        setVerified(true);
      })
      .finally(() => setVerifying(false));
  }, [searchParams, verified]);

  return (
    <div className="pricing-welcome-page">
      <header className="pricing-welcome-topbar">
        <Logo linkToAdmin={false} imageSrc="/images/aiquery_logo5.png" imageOnly />
      </header>
      <main className="pricing-welcome-main">
        <div className="pricing-welcome-card">
          <h1 className="pricing-welcome-title">Congratulations</h1>
          <p className="pricing-welcome-message">
            {verifying ? 'Activating your plan…' : 'Thank you for subscribing.'} Welcome to AIquery — you’re all set.
          </p>
          <button
            type="button"
            className="pricing-welcome-button"
            onClick={() => navigate('/app_admin')}
            disabled={verifying}
          >
            {verifying ? 'Please wait…' : 'Welcome to Your Workspace'}
          </button>
        </div>
      </main>
      <footer className="pricing-welcome-footer">
        <a href="/terms" onClick={(e) => { e.preventDefault(); navigate('/terms'); }}>Terms of Service</a>
        <span className="pricing-welcome-footer-sep">·</span>
        <a href="/privacy" onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}>Privacy Policy</a>
      </footer>
    </div>
  );
};

export default PricingWelcomePage;
