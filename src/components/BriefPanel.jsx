import React from 'react';

export default function BriefPanel({
  brief,
  onApproveBrief,
  onGenerateBrief,
  selectedIncident,
  operator,
  isGenerating,
  isApproving,
}) {
  const isApproved = ['Approved', 'Approved by Human Operator'].includes(brief?.status);
  const statusLabel = brief?.status || 'No Brief Available';

  return (
    <div className="rq-brief-panel flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl">
      <div>
        {/* Top Row: Title "Situation Brief" + Badge on top "Draft, needs review" (Yellow) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
          <div>
            <h2 className="font-display text-base font-bold text-white">
              {brief?.title || 'Situation Brief'}
            </h2>
            <p className="text-[11px] text-slate-400">
              AI-Generated Sector Synthesis • Endpoint: <code className="font-mono text-orange-400">GET /brief</code>
            </p>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold border ${
              isApproved
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-400/10 text-amber-400 border-amber-400/30'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isApproved ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
              }`}
            />
            <span>{statusLabel}</span>
          </span>
        </div>

        {/* AI Generated Summary Text */}
        <div className="mt-3 rounded-xl bg-slate-900 border border-slate-800 p-3.5 text-xs leading-relaxed text-slate-300 space-y-2.5">
          <p>
            {brief?.text ||
              'No situation brief has been generated from the current backend data.'}
          </p>
          {brief?.new_data_available && (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-amber-300">
              New report data arrived after approval. Generate a fresh draft before relying on this historical brief.
            </p>
          )}

          {brief && (brief.affected_locations || brief.report_count != null) && (
            <dl className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-2">
              <div>
                <dt className="text-slate-400">Affected incidents</dt>
                <dd className="font-semibold text-white">{brief.incident_count ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Individual reports</dt>
                <dd className="font-semibold text-white">{brief.report_count ?? '—'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-400">Affected locations</dt>
                <dd className="font-semibold text-white">
                  {(brief.affected_locations || []).join(', ') || 'None'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-400">High-severity incidents</dt>
                <dd className="font-semibold text-white">
                  {(brief.high_severity_incidents || []).join(', ') || 'None reported'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Human-confirmed reports</dt>
                <dd className="font-semibold text-white">{brief.confirmed_report_count ?? 0}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Unverified/corroborated</dt>
                <dd className="font-semibold text-white">{brief.unverified_report_count ?? 0}</dd>
              </div>
            </dl>
          )}

          {selectedIncident && (
            <div className="pt-2.5 border-t border-slate-800">
              <div className="text-[11px] font-semibold text-orange-400 uppercase tracking-wider">
                Focused Incident Brief — {selectedIncident.place} ({selectedIncident.type}) [Status: {selectedIncident.status}]:
              </div>
              <p className="mt-1 text-slate-200">{selectedIncident.summary}</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row: Golden Rule Notice + [Approve Brief] Button */}
      <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11px] text-slate-400">
          {isApproved
            ? `Approved by ${brief.approved_by || 'Human Operator'} at ${brief.approved_at || '—'}`
            : brief
              ? 'Draft only — cannot be published or dispatched until approved by an operator.'
              : 'No brief exists yet. Generate a draft from currently stored incident and report data.'}
        </span>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onGenerateBrief}
            disabled={isGenerating}
            className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:text-white transition shadow-sm disabled:opacity-60"
          >
            {isGenerating ? 'Generating...' : 'Generate Draft'}
          </button>
          <button
            type="button"
            onClick={onApproveBrief}
            disabled={!brief || isApproved || isApproving || !operator}
            title={!operator ? 'Operator sign-in required' : ''}
            className={`btn-tactical rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all border ${
              isApproved
                ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/40 cursor-default'
                : 'bg-orange-600 hover:bg-orange-500 text-white border-orange-500/50 shadow-sm disabled:opacity-50'
            }`}
          >
            {isApproving ? 'Approving...' : isApproved ? 'Brief Approved' : 'Approve Brief'}
          </button>
        </div>
      </div>
    </div>
  );
}
