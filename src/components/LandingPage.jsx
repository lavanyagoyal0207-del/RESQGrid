import React from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  CheckCircle2,
  MapPinned,
  Radio,
  ShieldCheck,
} from 'lucide-react';

const connectionLabel = {
  'flask-api': 'Control room connected',
  connecting: 'Connecting to control room',
  offline: 'Control room temporarily unavailable',
  'mock-json': 'Preview mode · operational data unavailable',
};

export default function LandingPage({
  apiMode,
  onReport,
  onOpenControlRoom,
}) {
  return (
    <main className="landing-page min-h-screen overflow-hidden text-slate-100">
      <header className="landing-header">
        <a
          href="#home"
          className="brand-lockup"
          aria-label="ResQGrid home"
        >
          <span className="brand-symbol" aria-hidden="true">
            <ShieldCheck size={20} strokeWidth={1.8} />
          </span>
          <span>
            <span className="brand-name">ResQ<span>Grid</span></span>
            <span className="brand-caption">Emergency intelligence</span>
          </span>
        </a>
        <div className="landing-header-actions">
          <span className="connection-label" role="status">
            <span className={`connection-dot connection-${apiMode}`} />
            {connectionLabel[apiMode] || 'System status unavailable'}
          </span>
          <button type="button" className="button-secondary" onClick={onOpenControlRoom}>
            Operator access <ArrowUpRight size={15} />
          </button>
        </div>
      </header>

      <section id="home" className="landing-hero">
        <div className="hero-copy">
          <p className="eyebrow"><span /> BUILT FOR THE MOMENTS THAT MATTER</p>
          <h1>
            When every signal
            <br />
            matters, <span>see the whole picture.</span>
          </h1>
          <p className="hero-description">
            ResQGrid brings community reports and emergency response teams
            together—so operators can understand what is happening, review
            evidence, and coordinate with clarity.
          </p>
          <div className="hero-actions">
            <button type="button" className="button-primary" onClick={onReport}>
              Report an emergency <ArrowRight size={17} />
            </button>
            <button type="button" className="button-link" onClick={onOpenControlRoom}>
              Open the control room <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="hero-trust">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>AI assists. Trained people make the decisions.</span>
          </div>
        </div>

        <div className="intelligence-visual" role="img" aria-label="Illustration of the report review and response workflow">
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />
          <div className="visual-grid" />
          <svg className="terrain-lines" viewBox="0 0 640 520" fill="none" aria-hidden="true">
            <path d="M37 319C103 280 126 316 179 269C231 223 236 176 304 195C374 215 389 148 448 165C505 182 514 235 604 191" />
            <path d="M32 352C93 311 137 349 196 292C251 239 260 207 313 222C381 241 401 177 451 193C504 210 530 262 614 219" />
            <path d="M40 383C107 346 149 382 211 320C270 262 281 236 325 249C389 269 411 210 456 223C509 238 539 291 608 252" />
            <path d="M77 420C132 383 169 407 227 353C283 302 297 271 340 278C398 287 421 249 466 255C516 262 545 318 596 289" />
            <path d="M122 451C173 418 197 434 244 391C294 346 314 307 352 308C405 309 433 282 475 289C518 297 545 339 578 323" />
          </svg>
          <div className="visual-core">
            <div className="core-ring"><Radio size={25} strokeWidth={1.5} /></div>
            <span className="core-label">RESQGRID</span>
            <span className="core-caption">Shared situational awareness</span>
          </div>
          <div className="workflow-card workflow-intake">
            <span className="workflow-icon"><AudioLines size={17} /></span>
            <span><strong>Community signal</strong><small>Voice · text · location</small></span>
            <ArrowDownRight className="workflow-arrow" size={16} />
          </div>
          <div className="workflow-card workflow-review">
            <span className="workflow-icon"><MapPinned size={17} /></span>
            <span><strong>Operator review</strong><small>Evidence before action</small></span>
            <CheckCircle2 className="workflow-check" size={17} />
          </div>
          <div className="visual-caption">
            <span className="caption-line" />
            A clearer view for coordinated response
          </div>
        </div>
      </section>

      <section className="landing-principles" aria-label="How ResQGrid supports response">
        <article>
          <span className="principle-number">01</span>
          <div><h2>Listen to the community</h2><p>Bring text and voice reports into one reviewable operational picture.</p></div>
        </article>
        <article>
          <span className="principle-number">02</span>
          <div><h2>Understand the evidence</h2><p>See reports in context, with original details preserved for human review.</p></div>
        </article>
        <article>
          <span className="principle-number">03</span>
          <div><h2>Coordinate with confidence</h2><p>Give authorized teams a shared view of incidents, resources, and response.</p></div>
        </article>
      </section>
      <footer className="landing-footer">
        <span>ResQGrid <span className="footer-divider">/</span> Emergency operations, made clearer.</span>
        <span>Human-led decisions · Evidence-first coordination</span>
      </footer>
    </main>
  );
}
