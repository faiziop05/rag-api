import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload, Layers, MessageSquare, Zap, Shield, Database,
  ChevronRight, Lock, Terminal, FileText, Check, ArrowRight, BookOpen, Scale, BarChart3
} from 'lucide-react';

/* Animated Demo Card — simulates a live RAG session */
function DemoCard() {
  const [phase, setPhase] = useState(0);
  // 0 = doc tag, 1 = user msg, 2 = typing, 3 = ai answer, 4 = citations

  useEffect(() => {
    const timings = [600, 1400, 2200, 3800, 4800];
    const timers = timings.map((t, i) => setTimeout(() => setPhase(i + 1), t));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="hero-demo-card">
      <div className="demo-card-header">
        <div className="demo-card-dots">
          <span className="demo-dot red" />
          <span className="demo-dot yellow" />
          <span className="demo-dot green" />
        </div>
        <span className="demo-card-title">recall.ai — Document Chat</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', padding: '0.2rem 0.5rem', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: '4px' }}>● Live</span>
      </div>

      <div className="demo-body">
        {phase >= 1 && (
          <div style={{ animation: 'page-in 0.3s ease' }}>
            <div className="demo-doc-tag">
              <FileText size={12} />
              ISO_27001_Compliance_Manual.pdf
            </div>
          </div>
        )}

        {phase >= 2 && (
          <div className="demo-user-msg" style={{ animation: 'page-in 0.25s ease' }}>
            What are the exact backup control requirements from this document?
          </div>
        )}

        {phase >= 3 && phase < 4 && (
          <div className="msg-bubble ai" style={{ animation: 'page-in 0.2s ease' }}>
            <div className="typing-indicator">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}

        {phase >= 4 && (
          <div className="demo-ai-msg" style={{ animation: 'page-in 0.3s ease' }}>
            <strong style={{ color: 'var(--text)' }}>Annex A Control 8.13 — Information backup</strong><br /><br />
            Backup copies of information and software shall be taken and tested regularly per explicit organizational policy. Backups must be stored in a separate location and tested for restoration.
          </div>
        )}

        {phase >= 5 && (
          <div className="demo-citations" style={{ animation: 'page-in 0.25s ease' }}>
            <span className="demo-cite-pill"><BookOpen size={10} /> ISO 27001 · Pg 24</span>
            <span className="demo-cite-pill"><BookOpen size={10} /> Annex A · Pg 17</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <Check size={10} color="var(--success)" /> 98% confidence
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="landing page-enter">
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-inner">
          <div className="navbar-logo">
            Recall<span>.</span>
          </div>
          <div className="navbar-links">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
            <a href="#">Docs</a>
          </div>
          <div className="navbar-actions">
            <Link to="/login" className="btn btn-ghost" style={{ color: 'var(--text-muted)' }}>Sign in</Link>
            <Link to="/register" className="btn btn-primary btn-sm">Get started →</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ position: 'relative' }}>
        <div className="hero-glow" />
        <div className="hero-section">
          <div className="hero-content">
            <div className="hero-badge">
              <span className="hero-badge-dot" />
              Multi-modal Vision RAG is now live
              <ChevronRight size={12} />
            </div>

            <h1 className="hero-title">
              Talk to your<br />
              <span className="gradient-text">documents.</span>
            </h1>

            <p className="hero-subtitle">
              Upload any PDF. Extract tables, charts, and text with pinpoint accuracy.
              Get evidence-backed answers with exact page citations — in seconds.
            </p>

            <div className="hero-ctas">
              <Link to="/register" className="btn btn-primary btn-lg">
                Start for free <ArrowRight size={16} />
              </Link>
              <Link to="/login" className="btn btn-secondary btn-lg">
                Sign in
              </Link>
            </div>

            <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Check size={12} color="var(--success)" /> No credit card required
              <span style={{ margin: '0 0.25rem' }}>·</span>
              <Check size={12} color="var(--success)" /> Free tier available
            </p>
          </div>

          <div>
            <DemoCard />
          </div>
        </div>
      </section>

      {/* Trust Bar */}
      <div className="trust-bar" style={{ margin: '0 2rem' }}>
        <span className="trust-label">Trusted for use cases like</span>
        <div className="trust-logos">
          <span className="trust-logo">Legal Review</span>
          <span className="trust-logo">Finance & Earnings</span>
          <span className="trust-logo">Academic Research</span>
          <span className="trust-logo">Compliance Audits</span>
          <span className="trust-logo">Technical Manuals</span>
        </div>
      </div>

      {/* How It Works */}
      <section className="section" id="how">
        <div className="section-inner">
          <div className="section-header">
            <span className="section-label">How it works</span>
            <h2 className="section-title">From document to insight in 3 steps</h2>
            <p className="section-subtitle">A production-grade pipeline from raw unstructured files to pinpoint AI answers.</p>
          </div>

          <div className="steps-grid">
            <div className="step-card">
              <div className="step-number">Step 01</div>
              <div className="step-icon"><Upload size={20} /></div>
              <h3>Upload your file</h3>
              <p>PDF, DOCX, or TXT. Drag and drop or use our REST API. Your data stays private and isolated.</p>
            </div>
            <div className="step-card">
              <div className="step-number">Step 02</div>
              <div className="step-icon"><Layers size={20} /></div>
              <h3>Deep parsing</h3>
              <p>Tables, OCR text, images, and complex layouts are extracted and indexed with our multi-modal vision pipeline.</p>
            </div>
            <div className="step-card">
              <div className="step-number">Step 03</div>
              <div className="step-icon"><MessageSquare size={20} /></div>
              <h3>Ask anything</h3>
              <p>Get precise, hallucination-free answers backed by exact page citations and visual references.</p>
            </div>
          </div>
        </div>
      </section>

      <hr className="section-divider" style={{ margin: '0 2rem' }} />

      {/* Features Bento */}
      <section className="section" id="features">
        <div className="section-inner">
          <div className="section-header">
            <span className="section-label">Features</span>
            <h2 className="section-title">Built different</h2>
            <p className="section-subtitle">Most RAG tools extract text and call it done. We go much deeper.</p>
          </div>

          <div className="bento-grid">
            <div className="bento-card featured" style={{ borderRight: '1px solid var(--border)' }}>
              <div className="bento-icon" style={{ background: 'rgba(79,70,229,0.1)', color: 'var(--primary-light)' }}>
                <Zap size={22} />
              </div>
              <h3>Hybrid Retrieval + Reranking</h3>
              <p>Combines BM25 keyword search with BGE-M3 vector embeddings, then reranks with a cross-encoder. The same architecture used in cutting-edge AI research papers.</p>
              <div className="bento-glow" style={{ background: 'var(--primary)' }} />
            </div>

            <div className="bento-card" style={{ borderLeft: '1px solid var(--border)' }}>
              <div className="bento-icon" style={{ background: 'rgba(6,182,212,0.1)', color: 'var(--accent)' }}>
                <Database size={22} />
              </div>
              <h3>Vision & Table OCR</h3>
              <p>Charts, diagrams, and tables are extracted natively using Docling with visual grounding.</p>
              <div className="bento-glow" style={{ background: 'var(--accent)' }} />
            </div>

            <div className="bento-card" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="bento-icon" style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--success)' }}>
                <FileText size={22} />
              </div>
              <h3>Pinpoint Citations</h3>
              <p>Every answer links directly to the source page, section, and image.</p>
            </div>

            <div className="bento-card" style={{ borderTop: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
              <div className="bento-icon" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--warning)' }}>
                <Terminal size={22} />
              </div>
              <h3>Agentic Router</h3>
              <p>An LLM reads the Table of Contents before searching — directing queries to the right section, not just the closest vector.</p>
            </div>

            <div className="bento-card" style={{ borderTop: '1px solid var(--border)', borderLeft: '1px solid var(--border)' }}>
              <div className="bento-icon" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--danger)' }}>
                <Shield size={22} />
              </div>
              <h3>Multi-tenant Isolation</h3>
              <p>Data is strictly partitioned. Your documents never touch another user's knowledge base.</p>
            </div>

            <div className="bento-card" style={{ borderTop: '1px solid var(--border)', gridColumn: 'span 1' }}>
              <div className="bento-icon" style={{ background: 'rgba(79,70,229,0.1)', color: 'var(--primary-light)' }}>
                <Lock size={22} />
              </div>
              <h3>REST API First</h3>
              <p>Every feature is available via a clean JSON API. Build it into your own app in minutes.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="section" style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div className="section-inner">
          <div className="section-header">
            <span className="section-label">Use cases</span>
            <h2 className="section-title">Built for demanding workflows</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem' }}>
            {[
              { icon: Scale, label: 'Legal & Compliance', desc: 'Search contracts, extract clauses, and flag risks across thousands of pages instantly.' },
              { icon: BarChart3, label: 'Finance & Earnings', desc: 'Query numerical data accurately from complex tables and earnings charts.' },
              { icon: BookOpen, label: 'Academic Research', desc: 'Synthesize literature reviews and get exact citations from dense research papers.' },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} style={{
                background: 'var(--bg)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-lg)',
                padding: '1.75rem',
                transition: 'all 0.2s',
              }}
                onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(79,70,229,0.35)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.transform = ''; }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 'var(--radius)', background: 'rgba(79,70,229,0.1)', border: '1px solid rgba(79,70,229,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem', color: 'var(--primary-light)' }}>
                  <Icon size={20} />
                </div>
                <h3 style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>{label}</h3>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="section" id="pricing">
        <div className="section-inner">
          <div className="section-header">
            <span className="section-label">Pricing</span>
            <h2 className="section-title">Simple, transparent pricing</h2>
            <p className="section-subtitle">Start for free. Scale when you're ready.</p>
          </div>

          <div className="pricing-grid">
            {/* Hobby */}
            <div className="pricing-card">
              <div>
                <div className="pricing-tier">Hobby</div>
                <div className="pricing-price" style={{ marginTop: '0.5rem' }}>Free</div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-subtle)', marginTop: '0.35rem' }}>No credit card required</p>
              </div>
              <ul className="pricing-features">
                {['100 queries / month', '5 documents', 'Standard text parsing', 'Web chat interface'].map(f => (
                  <li key={f}><span className="pricing-check">✓</span>{f}</li>
                ))}
              </ul>
              <Link to="/register" className="btn btn-secondary" style={{ width: '100%', marginTop: 'auto' }}>Get started free</Link>
            </div>

            {/* Pro */}
            <div className="pricing-card featured">
              <div className="pricing-badge">Most Popular</div>
              <div>
                <div className="pricing-tier">Pro Developer</div>
                <div className="pricing-price" style={{ marginTop: '0.5rem' }}>$20<span>/mo</span></div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-subtle)', marginTop: '0.35rem' }}>Billed monthly</p>
              </div>
              <ul className="pricing-features">
                {['5,000 queries / month', '100 documents', 'Deep Vision & Table OCR', 'Full REST API access', 'Priority processing'].map(f => (
                  <li key={f}><span className="pricing-check">✓</span>{f}</li>
                ))}
              </ul>
              <Link to="/register" className="btn btn-primary" style={{ width: '100%', marginTop: 'auto' }}>Start free trial</Link>
            </div>

            {/* Enterprise */}
            <div className="pricing-card">
              <div>
                <div className="pricing-tier">Enterprise</div>
                <div className="pricing-price" style={{ marginTop: '0.5rem' }}>Custom</div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-subtle)', marginTop: '0.35rem' }}>Talk to our team</p>
              </div>
              <ul className="pricing-features">
                {['Unlimited queries', 'SOC-2 compliance', 'Bring Your Own Key (BYOK)', 'Dedicated support SLA', 'Private cloud deployment'].map(f => (
                  <li key={f}><span className="pricing-check">✓</span>{f}</li>
                ))}
              </ul>
              <a href="mailto:hello@recall.ai" className="btn btn-secondary" style={{ width: '100%', marginTop: 'auto' }}>Contact sales</a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="section" id="faq" style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
        <div className="section-inner">
          <div className="section-header">
            <span className="section-label">FAQ</span>
            <h2 className="section-title">Frequently asked questions</h2>
          </div>
          <div className="faq-grid">
            {[
              { q: 'Is my data secure and private?', a: 'Yes. All documents are encrypted at rest and in transit. Each user\'s data is strictly isolated in a separate knowledge base — your documents are never mixed with others.' },
              { q: 'What file formats do you support?', a: 'Currently PDF, DOCX, and TXT. Support for CSV, HTML, and audio is on our roadmap.' },
              { q: 'How is this different from ChatGPT with files?', a: 'Recall uses a purpose-built RAG pipeline with hybrid search, structural routing via Table of Contents, and a cross-encoder reranker — giving far more precise, grounded answers than general-purpose chat models.' },
              { q: 'Can I use the API in my own product?', a: 'Absolutely. The Pro Developer tier is designed exactly for embedding our RAG engine into your own commercial applications via clean REST API.' },
            ].map(({ q, a }) => (
              <div key={q} className="faq-item">
                <h4>{q}</h4>
                <p>{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="section">
        <div className="section-inner">
          <div style={{
            background: 'linear-gradient(135deg, rgba(79,70,229,0.15) 0%, rgba(6,182,212,0.08) 100%)',
            border: '1px solid rgba(79,70,229,0.25)',
            borderRadius: 'var(--radius-xl)',
            padding: '4rem 3rem',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center top, rgba(79,70,229,0.1) 0%, transparent 60%)', pointerEvents: 'none' }} />
            <h2 style={{ fontSize: 'clamp(1.8rem, 3vw, 2.5rem)', marginBottom: '1rem', position: 'relative' }}>
              Ready to talk to your documents?
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '1.05rem', marginBottom: '2rem', position: 'relative' }}>
              Start for free. No credit card required.
            </p>
            <Link to="/register" className="btn btn-primary btn-lg" style={{ position: 'relative' }}>
              Get started — it's free <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '2.5rem', maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div className="footer-logo">Recall<span style={{ color: 'var(--primary-light)' }}>.</span></div>
        <div className="footer-links">
          <a href="#">Documentation</a>
          <a href="#pricing">Pricing</a>
          <a href="#">Privacy Policy</a>
          <a href="#">Terms</a>
        </div>
        <span className="footer-copy">© 2026 Recall. All rights reserved.</span>
      </footer>
    </div>
  );
}
