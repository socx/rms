import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import ResendVerificationPage from './pages/ResendVerificationPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import ApiKeysPage from './pages/ApiKeysPage.jsx';
import EmailBrandingPage from './pages/EmailBrandingPage.jsx';
import EventsPage from './pages/EventsPage.jsx';
import EventDetailPage from './pages/EventDetailPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import ApiStatusBadge from './components/ApiStatusBadge.jsx';
import { getStoredToken } from './hooks/useAuth.js';

function RootRedirect() {
  return getStoredToken() ? <Navigate to="/events" replace /> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <>
      <ApiStatusBadge />
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/resend-verification" element={<ResendVerificationPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/:id" element={<EventDetailPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/api-keys" element={<ApiKeysPage />} />
        <Route path="/email-branding" element={<EmailBrandingPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </>
  );
}
