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
    <div className="rq-brief-panel flex flex-col justify-between rounded-2xl border p-4">
      <div>
        {/* Top Row: Title "Situation Brief" + Badge on top "Draft, needs review" (Yellow) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-purple-400/20">
          <div>
            <h2 className="font-display text-base font-bold text-white">
              {brief?.title || 'Situation Brief'}
            </h2>
            <p className="text-[11px] text-purple-200/75">
              AI-Generated Sector Synthesis • Endpoint: <code className="font-mono text-[#FF6B35]">GET /brief</code>
            </p>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold border ${
              isApproved
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                : 'bg-amber-400/20 text-amber-300 border-amber-300/60 shadow-[0_0_15px_rgba(251,191,36,0.25)]'
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
        <div className="mt-3 rounded-xl bg-[#120721]/80 border border-purple-300/15 p-3.5 text-xs leading-relaxed text-purple-100/95 space-y-2.5">
          <p>
            {brief?.text ||
              'No situation brief has been generated from the current backend data.'}
          </p>
          {brief?.new_data_available && (
            <p className="rounded-lg border border-amber-300/25 bg-amber-400/10 px-2.5 py-1.5 text-amber-200">
              New report data arrived after approval. Generate a fresh draft before relying on this historical brief.
            </p>
          )}

          {brief && (brief.affected_locations || brief.report_count != null) && (
            <dl className="grid grid-cols-2 gap-2 border-t border-purple-300/15 pt-2">
              <div>
                <dt className="text-purple-300/75">Affected incidents</dt>
                <dd className="font-semibold text-white">{brief.incident_count ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-purple-300/75">Individual reports</dt>
                <dd className="font-semibold text-white">{brief.report_count ?? '—'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-purple-300/75">Affected locations</dt>
                <dd className="font-semibold text-white">
                  {(brief.affected_locations || []).join(', ') || 'None'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-purple-300/75">High-severity incidents</dt>
                <dd className="font-semibold text-white">
                  {(brief.high_severity_incidents || []).join(', ') || 'None reported'}
                </dd>
              </div>
              <div>
                <dt className="text-purple-300/75">Human-confirmed reports</dt>
                <dd className="font-semibold text-white">{brief.confirmed_report_count ?? 0}</dd>
              </div>
              <div>
                <dt className="text-purple-300/75">Unverified/corroborated</dt>
                <dd className="font-semibold text-white">{brief.unverified_report_count ?? 0}</dd>
              </div>
            </dl>
          )}

          {selectedIncident && (
            <div className="pt-2.5 border-t border-purple-300/15">
              <div className="text-[11px] font-semibold text-[#FF6B35] uppercase tracking-wider">
                Focused Incident Brief — {selectedIncident.place} ({selectedIncident.type}) [Status: {selectedIncident.status}]:
              </div>
              <p className="mt-1 text-slate-200">{selectedIncident.summary}</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row: Golden Rule Notice + [Approve Brief] Button */}
      <div className="mt-4 pt-3 border-t border-purple-400/20 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11px] text-purple-200/75">
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
            className="rounded-xl border border-purple-300/30 px-3 py-2 text-xs font-semibold text-purple-100 hover:text-white disabled:opacity-60"
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
                ? 'bg-emerald-700/50 text-emerald-200 border-emerald-400/40 cursor-default'
                : 'bg-[#FF6B35] hover:bg-[#ff8255] text-white border-orange-300/50 shadow-[0_0_18px_rgba(255,107,53,0.45)] disabled:opacity-50'
            }`}
          >
            {isApproving ? 'Approving...' : isApproved ? 'Brief Approved' : 'Approve Brief'}
          </button>
        </div>
      </div>
    </div>
  );
}
