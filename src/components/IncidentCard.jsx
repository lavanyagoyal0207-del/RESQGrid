import React from 'react';

const SEVERITY_BADGE = {
  Critical: 'bg-red-500/10 text-red-300 border-red-500/30',
  High: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  Medium: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  Low: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
};

const STATUS_BADGE = {
  Unverified: 'bg-slate-700/40 text-slate-300 border-slate-600/50',
  Corroborated: 'bg-sky-500/15 text-sky-300 border-sky-400/40',
  Confirmed: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40',
  Rejected: 'bg-red-500/10 text-red-300 border-red-400/30',
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
      className={`rq-incident-card w-full text-left rounded-xl p-3.5 transition-all border cursor-pointer ${
        isSelected
          ? 'bg-slate-800/95 border-orange-500 shadow-md ring-1 ring-orange-500/50'
          : 'bg-slate-900/90 hover:bg-slate-850 border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Top Row: "X reports -> 1 incident" + Awaiting Review Orange Dot */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="inline-flex items-center gap-1.5 rounded-md bg-slate-950 border border-slate-800 px-2 py-0.5">
          <span className="font-mono text-xs font-bold text-amber-300 tabular-nums">
            {incident.report_count} reports
          </span>
          <span className="font-mono text-xs text-slate-500">→</span>
          <span className="text-xs font-semibold text-slate-200">1 incident</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-400">
            {formatTime(incident.updated_at)}
          </span>

          {/* If status is Awaiting Review, show amber dot */}
          {isAwaitingReview && (
            <span
              className="flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5"
              title="Awaiting Human Review — AI Suggestion Only"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Review
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Middle Row: Type (Flood / Landslide / Blocked Road) & Place (Mandi) */}
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">
              {incident.type}
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-sm font-semibold text-orange-400">
              {incident.place}
            </span>
          </div>
          <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
            {incident.grouping_reason}
          </p>
        </div>

        <span className="text-[11px] font-mono text-slate-500 shrink-0">
          {incident.incident_id}
        </span>
      </div>

      {/* Bottom Row: Severity badge + Status badge */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
              SEVERITY_BADGE[incident.severity] || SEVERITY_BADGE.Low
            }`}
          >
            <span className={`rq-severity-indicator severity-${severityKey}`} aria-hidden="true" />
            {incident.severity}
          </span>

          <span
            className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
              STATUS_BADGE[incident.status] || STATUS_BADGE.Unverified
            }`}
          >
            {incident.status}
          </span>
        </div>

        <span className="text-[10px] font-medium text-slate-500">
          {incident.response_status || 'Awaiting Assignment'}
        </span>
      </div>
    </button>
  );
}
