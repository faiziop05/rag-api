import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function PrivacyPage() {
  return (
    <div className="legal-page">
      {/* Minimal Navbar */}
      <nav className="navbar" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100 }}>
        <div className="navbar-container">
          <Link to="/" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: '1.15rem', fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--text)', textDecoration: 'none' }}>
            Recall<span style={{ color: 'var(--primary-light)' }}>.</span>
          </Link>
          <Link to="/" className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <ArrowLeft size={16} /> Back
          </Link>
        </div>
      </nav>

      <div className="legal-content">
        <h1>Privacy Policy</h1>
        <p className="legal-date">Last updated: August 24, 2026</p>

        <h2>1. Introduction</h2>
        <p>
          At Recall, we take your privacy seriously. This Privacy Policy explains how we collect, use, store, and protect your personal information when you use our platform.
          By using Recall, you consent to the data practices described in this policy.
        </p>

        <h2>2. Information We Collect</h2>
        <p>We collect the following types of information:</p>
        <ul>
          <li><strong>Account Information:</strong> Email address and hashed password when you register an account.</li>
          <li><strong>Document Content:</strong> Files you upload (PDF, DOCX, TXT) for processing into knowledge bases.</li>
          <li><strong>Query Data:</strong> Questions you ask through the chat interface or API, along with conversation history.</li>
          <li><strong>Usage Data:</strong> API request counts, feature usage patterns, and performance metrics.</li>
          <li><strong>Technical Data:</strong> IP address, browser type, and device information for security and analytics.</li>
        </ul>

        <h2>3. How We Use Your Data</h2>
        <p>Your data is used to:</p>
        <ul>
          <li>Process and store your documents as searchable vector embeddings</li>
          <li>Generate AI-powered answers to your queries using retrieved context</li>
          <li>Authenticate your identity and authorize API access</li>
          <li>Monitor and improve the performance and reliability of our Service</li>
          <li>Send important service-related notifications</li>
        </ul>

        <h2>4. Data Storage & Security</h2>
        <p>
          All data is stored securely using industry-standard encryption. Document embeddings are stored in a PostgreSQL database with pgvector extension.
          Passwords are hashed using bcrypt with salt rounds. API keys are generated using cryptographically secure random bytes.
          We use HTTPS for all data transmission and implement access controls to limit data exposure.
        </p>

        <h2>5. Data Retention</h2>
        <p>
          Your documents, embeddings, and chat history are retained for as long as your account is active.
          When you delete a document or knowledge base, all associated data (embeddings, chunks, images) is permanently removed.
          Upon account deletion, all personal data is purged within 30 days.
        </p>

        <h2>6. Third-Party Services</h2>
        <p>
          Recall may utilize third-party services for infrastructure and AI processing:
        </p>
        <ul>
          <li><strong>Supabase:</strong> Database hosting and authentication services</li>
          <li><strong>Upstash Redis:</strong> Job queue management for document processing</li>
          <li><strong>AI Model Providers:</strong> Language models for answer generation (responses are not stored by providers)</li>
        </ul>
        <p>
          These providers are bound by their own privacy policies and data processing agreements. We select providers that meet our security and privacy standards.
        </p>

        <h2>7. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li><strong>Access:</strong> Request a copy of the personal data we hold about you</li>
          <li><strong>Correction:</strong> Request correction of inaccurate personal data</li>
          <li><strong>Deletion:</strong> Request deletion of your account and all associated data</li>
          <li><strong>Portability:</strong> Request your data in a machine-readable format</li>
          <li><strong>Objection:</strong> Object to certain types of data processing</li>
        </ul>

        <h2>8. Cookies</h2>
        <p>
          Recall uses minimal cookies and local storage for authentication (JWT tokens) and user preferences.
          We do not use tracking cookies or third-party advertising cookies.
          Session data is stored in your browser's local storage and can be cleared by logging out.
        </p>

        <h2>9. Children's Privacy</h2>
        <p>
          Recall is not intended for users under the age of 16. We do not knowingly collect personal information from children.
          If we become aware that a child has provided us with personal data, we will take steps to delete it promptly.
        </p>

        <h2>10. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated revision date.
          Continued use of the Service after changes constitutes acceptance of the modified policy.
        </p>

        <h2>11. Contact Us</h2>
        <p>
          If you have questions or concerns about this Privacy Policy or your personal data, please contact us at <strong>privacy@recall.ai</strong>.
        </p>
      </div>
    </div>
  );
}
