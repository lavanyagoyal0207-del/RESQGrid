import React from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Moon,
  ShieldCheck,
} from 'lucide-react';

const connectionLabel = {
  'flask-api': 'Control room connected',
  connecting: 'Connecting to control room',
  offline: 'API unavailable · no live data',
};

export default function LandingPage({
  apiMode,
  onReport,
  onOpenControlRoom,
}) {
  return (
    <main className="landing-page text-slate-100">
      <section id="home" className="landing-hero">
        <div className="hero-landscape" aria-hidden="true">
          <span className="hero-moon-halo" />
          <span className="hero-moon" />
          <span className="hero-skyline skyline-far" />
          <span className="hero-ridge ridge-far" />
          <span className="hero-ridge ridge-near" />
          <span className="hero-forest forest-far" />
          <span className="hero-forest forest-near" />
          <span className="hero-settlement-glow" />
          <span className="hero-settlement-lights lights-far" />
          <span className="hero-settlement-lights lights-near" />
          <span className="hero-horizon-light" />
          <span className="hero-fog fog-first" />
          <span className="hero-fog fog-second" />
          <span className="hero-foreground" />
        </div>

        <header className="landing-header">
          <a href="#home" className="brand-lockup" aria-label="ResQGrid home">
            <span className="brand-symbol" aria-hidden="true">
              <Moon size={21} strokeWidth={1.7} />
            </span>
            <span>
              <span className="brand-name">ResQ<span>Grid</span></span>
              <span className="brand-caption">HALLOWEEN NIGHT WATCH</span>
            </span>
          </a>
          <span className={`landing-status status-${apiMode}`} role="status">
            <span className="connection-dot" />
            {connectionLabel[apiMode] || 'System status unavailable'}
          </span>
        </header>

        <div className="hero-copy">
          <p className="eyebrow"><span /> EMERGENCY INTELLIGENCE · NIGHT WATCH ACTIVE</p>
          <h1>
            When Disaster Strikes,
            <br />
            <span>Every Second Matters.</span>
          </h1>
          <p className="hero-description">
            One platform. Every report. Faster emergency response.
          </p>
          <div className="hero-actions">
            <button type="button" className="button-primary" onClick={onReport}>
              Report an Emergency <ArrowRight size={18} />
            </button>
            <button type="button" className="button-secondary" onClick={onOpenControlRoom}>
              Explore Control Room <ArrowUpRight size={17} />
            </button>
          </div>
          <div className="hero-trust">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>Human-reviewed reports · Evidence-led decisions</span>
          </div>
        </div>

        <div className="hero-scene-caption" aria-hidden="true">
          <span>NIGHT WATCH</span>
          <span className="caption-rule" />
          <span>COMMUNITY REPORTS · HUMAN-LED RESPONSE</span>
        </div>
        <div className="hero-edge-indicator" aria-hidden="true"><span /> AWARENESS · VERIFICATION · RESPONSE</div>
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
        <span>ResQGrid <span className="footer-divider">/</span> Halloween Night Watch</span>
        <span>Real reports · Human-led decisions · Honest system status</span>
      </footer>
    </main>
  );
}
