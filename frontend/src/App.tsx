import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import LandingPage from './components/LandingPage'
import MainApp from './components/MainApp'
import ChatApp from './components/ChatApp'
import WorkspaceCreationPage from './components/WorkspaceCreationPage'
import Documentation from './components/Documentation'
import FeaturesPage from './components/FeaturesPage'
import Blog from './components/Blog'
import PrivacyPolicy from './components/PrivacyPolicy'
import InviteAccept from './components/InviteAccept'
import DemoRequest from './components/DemoRequest'
import Pricing from './components/Pricing'
import PlanCheckoutPage from './components/PlanCheckoutPage'
import PricingWelcomePage from './components/PricingWelcomePage'
import FAQPage from './components/FAQPage'
import TermsOfService from './components/TermsOfService'
import SignUpPage from './components/SignUpPage'
import SignInPage from './components/SignInPage'
import ForgotPasswordPage from './components/ForgotPasswordPage'
import ResetPasswordPage from './components/ResetPasswordPage'
import EmailVerificationPage from './components/EmailVerificationPage'
import ProtectedRoute from './components/ProtectedRoute'
import AdminProtectedRoute from './components/AdminProtectedRoute'
import AdminDashboard from './components/AdminDashboard'
import ErrorBoundary from './components/ErrorBoundary'

function App() {
  console.log('App component rendering')
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route
              path="/app_admin"
              element={
                <ProtectedRoute>
                  <MainApp />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app_admin/chat"
              element={
                <ProtectedRoute>
                  <ChatApp />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app_admin/workspace_creation"
              element={
                <ProtectedRoute>
                  <WorkspaceCreationPage />
                </ProtectedRoute>
              }
            />
            <Route path="/features" element={<FeaturesPage />} />
            <Route path="/docs" element={<Documentation />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:postId" element={<Blog />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/pricing/welcome" element={<PricingWelcomePage />} />
            <Route path="/pricing/:planSlug" element={<PlanCheckoutPage />} />
            <Route path="/contact" element={<DemoRequest />} />
            <Route path="/demo" element={<Navigate to="/contact" replace />} />
            <Route path="/faq" element={<FAQPage />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/signin" element={<SignInPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
            <Route path="/verify-email" element={<EmailVerificationPage />} />
            <Route path="/invite/:token" element={<InviteAccept />} />
            <Route
              path="/admin"
              element={
                <AdminProtectedRoute>
                  <AdminDashboard />
                </AdminProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App

