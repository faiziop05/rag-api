import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function TermsPage() {
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
        <h1>Terms & Conditions</h1>
        <p className="legal-date">Last updated: August 24, 2026</p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing and using the Recall platform ("Service"), you accept and agree to be bound by these Terms and Conditions.
          If you do not agree to these terms, you should not use the Service. These terms apply to all users, including registered account holders and API consumers.
        </p>

        <h2>2. Description of Service</h2>
        <p>
          Recall is a Retrieval-Augmented Generation (RAG) platform that allows users to upload documents, process them into searchable knowledge bases, and query them using natural language.
          The Service includes:
        </p>
        <ul>
          <li>Document ingestion and processing (PDF, DOCX, TXT)</li>
          <li>AI-powered search and question answering with citations</li>
          <li>RESTful API access for programmatic integration</li>
          <li>Web-based dashboard and chat interface</li>
        </ul>

        <h2>3. User Accounts</h2>
        <p>
          You are responsible for maintaining the confidentiality of your account credentials, including passwords and API keys.
          You agree to notify us immediately of any unauthorized use of your account.
          We reserve the right to suspend or terminate accounts that violate these terms.
        </p>

        <h2>4. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Upload malicious files or content intended to harm the Service</li>
          <li>Attempt to reverse-engineer, decompile, or disassemble any part of the Service</li>
          <li>Use the Service to process or store content that violates applicable laws</li>
          <li>Share API keys with unauthorized third parties</li>
          <li>Exceed the rate limits or resource quotas defined by your plan tier</li>
        </ul>

        <h2>5. Intellectual Property</h2>
        <p>
          You retain full ownership of all documents you upload to the Service. Recall does not claim any intellectual property rights over your content.
          The Service itself, including its design, code, and algorithms, is the intellectual property of Recall and is protected by applicable copyright and patent laws.
        </p>

        <h2>6. Data Processing</h2>
        <p>
          When you upload a document, it is processed through our AI pipeline to generate embeddings and extract structured content.
          This processing is performed solely to provide the Service and does not constitute a transfer of ownership.
          Processed data is stored securely and associated with your account. See our <Link to="/privacy" style={{ color: 'var(--primary-light)' }}>Privacy Policy</Link> for more details.
        </p>

        <h2>7. API Usage</h2>
        <p>
          API access is provided through authenticated API keys. Each API key is linked to your account and is subject to the rate limits and quotas of your subscription plan.
          Abuse of API endpoints, including excessive requests or automated scraping, may result in temporary or permanent suspension of your API access.
        </p>

        <h2>8. Limitation of Liability</h2>
        <p>
          The Service is provided "as is" without warranties of any kind, either express or implied. We do not guarantee the accuracy, completeness, or reliability of AI-generated responses.
          Users should always verify critical information using the cited source documents. Recall shall not be liable for any direct, indirect, incidental, or consequential damages arising from use of the Service.
        </p>

        <h2>9. Service Availability</h2>
        <p>
          We strive to maintain high availability but do not guarantee uninterrupted access to the Service. Planned maintenance windows will be communicated in advance whenever possible.
          We reserve the right to modify, suspend, or discontinue any part of the Service at any time with reasonable notice.
        </p>

        <h2>10. Modifications to Terms</h2>
        <p>
          We reserve the right to update these Terms at any time. Changes will be effective immediately upon posting.
          Continued use of the Service after changes constitutes acceptance of the modified terms.
          We recommend reviewing these terms periodically.
        </p>

        <h2>11. Contact</h2>
        <p>
          If you have any questions about these Terms & Conditions, please contact us at <strong>support@recall.ai</strong>.
        </p>
      </div>
    </div>
  );
}
