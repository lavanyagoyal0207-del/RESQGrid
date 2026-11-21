import React from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Globe2,
  Layers,
  Radio,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';

const connectionLabel = {
  'flask-api': 'Live operational data',
  'live-operational': 'Live operational data',
  'online-anonymous': 'API Online · Sign in for operational data',
  'snapshot-retained': 'Last successful snapshot',
  offline: 'API Offline',
  connecting: 'Connecting',
};

export default function LandingPage({
  apiMode,
  onReport,
  onOpenControlRoom,
}) {
  return (
    <main className="landing-page text-slate-100 min-h-screen flex flex-col justify-between">
      {/* Top Navigation */}
      <header className="landing-header flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-30">
        <a href="#home" className="brand-lockup flex items-center gap-3 no-underline text-white group" aria-label="ResQGrid home">
          <span className="brand-symbol flex items-center justify-center h-9 w-9 rounded-lg bg-orange-600/15 border border-orange-500/30 text-orange-500 shadow-sm" aria-hidden="true">
            <ShieldAlert size={20} strokeWidth={2.2} />
          </span>
          <span className="flex flex-col">
            <span className="brand-name font-bold text-base tracking-tight text-white flex items-center gap-1">
              ResQ<span className="text-orange-500">Grid</span>
            </span>
            <span className="brand-caption text-[10px] font-semibold tracking-wider uppercase text-slate-400">
              DISASTER INTELLIGENCE PLATFORM
            </span>
          </span>
        </a>

        <div className="flex items-center gap-4">
          <span
            className={`landing-status status-${apiMode} inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border ${
              apiMode === 'flask-api' || apiMode === 'live-operational'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : apiMode === 'online-anonymous'
                  ? 'bg-sky-500/10 border-sky-500/30 text-sky-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            }`}
            role="status"
          >
            <span
              className={`connection-dot h-2 w-2 rounded-full ${
                apiMode === 'flask-api' || apiMode === 'live-operational'
                  ? 'bg-emerald-400 animate-pulse'
                  : apiMode === 'online-anonymous'
                    ? 'bg-sky-400'
                    : 'bg-amber-400'
              }`}
            />
            {connectionLabel[apiMode] || 'System status unavailable'}
          </span>
        </div>
      </header>

      {/* Hero Section */}
      <section id="home" className="landing-hero relative px-6 pt-16 pb-20 max-w-6xl mx-auto w-full flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-700/60 text-xs font-semibold text-slate-300 mb-6 shadow-sm">
          <span className="h-2 w-2 rounded-full bg-orange-500 animate-ping" />
          <span>NATIONAL EMERGENCY COORDINATION & FIELD INTELLIGENCE</span>
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white max-w-4xl leading-tight">
          When Disaster Strikes, <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-amber-300 to-orange-500">
            Every Second Matters.
          </span>
        </h1>

        <p className="hero-description text-lg sm:text-xl font-medium text-slate-300 mt-5 max-w-2xl">
          One platform. Every report. Faster emergency response.
        </p>

        <p className="text-sm text-slate-400 max-w-2xl mt-2 leading-relaxed">
          Unifying multilingual citizen field voice and text notes with automated spatial clustering,
          hotspot threat detection, and human-verified tactical operator dispatch.
        </p>

        {/* Action CTAs */}
        <div className="hero-actions flex flex-wrap items-center justify-center gap-4 mt-8">
          <button
            type="button"
            className="button-primary inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-semibold text-sm shadow-lg shadow-orange-600/25 transition-all focus:ring-2 focus:ring-orange-400 focus:outline-none"
            onClick={onReport}
          >
            Report an Emergency <ArrowRight size={17} />
          </button>
          <button
            type="button"
            className="button-secondary inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-sm transition-all focus:ring-2 focus:ring-slate-500 focus:outline-none"
            onClick={onOpenControlRoom}
          >
            Explore Control Room <ArrowUpRight size={17} />
          </button>
        </div>

        {/* Operational Trust Indicators */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-12 w-full max-w-4xl pt-8 border-t border-slate-800/80">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/40 border border-slate-800 text-left">
            <ShieldCheck size={20} className="text-emerald-400 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-slate-200">Human-Verified Decisions</p>
              <p className="text-[11px] text-slate-400">Zero automated dispatches without operator review</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/40 border border-slate-800 text-left">
            <Globe2 size={20} className="text-sky-400 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-slate-200">Multilingual Intake</p>
              <p className="text-[11px] text-slate-400">English, Hindi & Punjabi voice translation</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/40 border border-slate-800 text-left">
            <Layers size={20} className="text-orange-400 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-slate-200">Spatial Clustered Intelligence</p>
              <p className="text-[11px] text-slate-400">Automated distance and temporal grouping</p>
            </div>
          </div>
        </div>
      </section>

      {/* Operational Principles */}
      <section className="landing-principles px-6 py-12 max-w-6xl mx-auto w-full" aria-label="How ResQGrid supports response">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <article className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 relative overflow-hidden group hover:border-slate-700 transition-colors">
            <span className="principle-number font-mono text-xs font-bold text-orange-500 uppercase tracking-widest block mb-2">
              PILLAR 01
            </span>
            <h2 className="text-base font-bold text-white mb-2">Listen to the community</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Capture text reports and localized voice notes from field witnesses. Preserve original citizen recordings in private S3 storage.
            </p>
          </article>

          <article className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 relative overflow-hidden group hover:border-slate-700 transition-colors">
            <span className="principle-number font-mono text-xs font-bold text-sky-400 uppercase tracking-widest block mb-2">
              PILLAR 02
            </span>
            <h2 className="text-base font-bold text-white mb-2">Understand the evidence</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Corroborate independent field observations with explainable distance clustering and AI-generated situation drafts.
            </p>
          </article>

          <article className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 relative overflow-hidden group hover:border-slate-700 transition-colors">
            <span className="principle-number font-mono text-xs font-bold text-emerald-400 uppercase tracking-widest block mb-2">
              PILLAR 03
            </span>
            <h2 className="text-base font-bold text-white mb-2">Coordinate with confidence</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Deploy tactical emergency resources with clear status progression, audit trails, and multi-sector visibility.
            </p>
          </article>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer px-6 py-6 border-t border-slate-800/80 bg-slate-950/60 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-200">ResQGrid Operations Network</span>
          <span className="footer-divider text-slate-600">/</span>
          <span>Emergency Coordination Platform</span>
        </div>
        <span>Real reports · Human-led decisions · Honest system status</span>
      </footer>
    </main>
  );
}
