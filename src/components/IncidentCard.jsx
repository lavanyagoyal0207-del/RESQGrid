import React from 'react';

const SEVERITY_BADGE = {
  Critical: 'bg-red-500/15 text-red-200 border-red-400/45',
  High: 'bg-orange-500/15 text-orange-200 border-orange-400/40',
  Medium: 'bg-amber-500/15 text-amber-200 border-amber-400/40',
  Low: 'bg-purple-400/10 text-purple-100 border-purple-300/30',
};

const STATUS_BADGE = {
  Unverified: 'bg-slate-600/35 text-slate-200 border-slate-400/40',
  Corroborated: 'bg-sky-500/25 text-sky-200 border-sky-400/50',
  Confirmed: 'bg-emerald-500/25 text-emerald-200 border-emerald-400/50',
  Rejected: 'bg-rose-500/15 text-rose-200 border-rose-400/40',
};

export default function IncidentCard({ incident, isSelected, onClick }) {
  const isAwaitingReview = incident.status !== 'Confirmed' && incident.status !== 'Rejected';
  const severityKey = String(incident.severity || 'low').toLowerCase();

  const formatTime = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return iso;
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rq-incident-card btn-tactical w-full text-left rounded-xl p-3.5 transition-all border ${
        isSelected
          ? 'bg-[#302638] border-[#ed7540] shadow-[0_0_24px_rgba(237,117,64,0.16)] ring-1 ring-[#ed7540]/45'
          : 'bg-[#1b1821] hover:bg-[#24202b] border-white/10 hover:border-white/20'
      }`}
    >
      {/* Top Row: "14 reports -> 1 incident" + Awaiting Review Orange Dot */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="inline-flex items-center gap-1.5 rounded-md bg-[#1a0b2e]/90 border border-purple-300/20 px-2.5 py-1">
          <span className="font-display text-xs font-bold text-[#FFB347] tabular-nums">
            {incident.report_count} reports
          </span>
          <span className="font-mono text-xs font-bold text-purple-300">-&gt;</span>
          <span className="font-display text-xs font-bold text-white">1 incident</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-purple-200/80">
            {formatTime(incident.updated_at)}
          </span>

          {/* If status is Awaiting Review, show orange dot */}
          {isAwaitingReview && (
            <span
              className="flex items-center gap-1.5 rounded-full bg-[#FF6B35]/15 border border-[#FF6B35]/40 px-2 py-0.5"
              title="Awaiting Human Review — AI Suggestion Only"
            >
              <span className="h-2 w-2 rounded-full bg-[#FF9A52] shadow-[0_0_8px_rgba(255,117,24,0.65)]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#FFC083]">
                Review
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Middle Row: Type (Flood / Landslide / Blocked Road) & Place (Mandi) */}
      <div className="flex items-baseline justify-between gap-2 mb-2.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-base font-bold text-white">
              {incident.type}
            </span>
            <span className="text-purple-300/60">•</span>
            <span className="font-display text-base font-semibold text-orange-200">
              {incident.place}
            </span>
          </div>
          <p className="text-xs text-purple-200/80 line-clamp-1 mt-0.5">
            {incident.grouping_reason}
          </p>
        </div>

        <span className="text-[11px] font-mono text-purple-200/70 shrink-0">
          {incident.incident_id}
        </span>
      </div>

      {/* Bottom Row: Severity badge + Status badge (Unverified - Grey, Corroborated - Blue, Confirmed - Green) */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-purple-300/10">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
              SEVERITY_BADGE[incident.severity] || SEVERITY_BADGE.Low
            }`}
          >
            <span className={`rq-severity-indicator severity-${severityKey}`} aria-hidden="true" />
            <span>Severity: {incident.severity || 'Unknown'}</span>
          </span>

          <span
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
              STATUS_BADGE[incident.status] || STATUS_BADGE.Unverified
            }`}
          >
            <span>{incident.status}</span>
          </span>
        </div>

        <span className="text-[11px] font-medium text-purple-200/80 group-hover:text-white flex items-center gap-1">
          <span>Inspect</span>
          <svg className="h-3 w-3 text-[#FF6B35]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </button>
  );
}
