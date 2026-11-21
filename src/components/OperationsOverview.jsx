import React, { useMemo } from 'react';

export default function OperationsOverview({
  reports,
  riskAssessment,
  incomingReportIds,
}) {
  const recentReports = useMemo(
    () =>
      [...reports]
        .sort(
          (left, right) =>
            new Date(right.created_at || 0) - new Date(left.created_at || 0)
        )
        .slice(0, 8),
    [reports]
  );
  const flaggedLocations = (riskAssessment?.locations || []).filter(
    (location) => location.requires_attention
  );

  return (
    <section className="rq-operations-panel rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-lg">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                Incoming Field Reports
              </h2>
              <p className="text-[11px] text-slate-400">
                Latest individual reports from the active data source
              </p>
            </div>
            <span className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
              {reports.length} reports
            </span>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {recentReports.map((report) => (
              <article
                key={report.report_id}
                className="rounded-xl border border-slate-800 bg-slate-900/90 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-bold text-orange-400">
                      {report.report_id}
                    </span>
                    {incomingReportIds.includes(report.report_id) && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300">
                        New
                      </span>
                    )}
                  </div>
                  <time
                    className="text-[10px] text-slate-400"
                    dateTime={report.created_at}
                  >
                    {report.created_at
                      ? new Date(report.created_at).toLocaleString()
                      : 'Timestamp unavailable'}
                  </time>
                </div>
                <p className="mt-1 text-[11px] text-slate-300">
                  {report.type || 'Incident'} · {report.place || 'Location unavailable'} ·{' '}
                  {report.severity || 'Severity unknown'}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-slate-200">
                  {report.original_text || 'No description available.'}
                </p>
              </article>
            ))}
            {recentReports.length === 0 && (
              <p className="rounded-xl border border-slate-800 p-4 text-xs text-slate-400 text-center">
                No reports are available from the current data source.
              </p>
            )}
          </div>
        </div>

        <div>
          <div className="mb-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-white">
              Geographic Risk Assessment
            </h2>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
              {riskAssessment?.label ||
                'Assessment unavailable — requires human review'}
            </p>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {flaggedLocations.map((location) => (
              <article
                key={location.place}
                className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-white">{location.place}</h3>
                  <span className="font-mono text-[10px] text-amber-300">
                    {location.incident_count} active incidents · {location.report_count} reports
                  </span>
                </div>
                <ul className="mt-2 space-y-1 text-[11px] text-amber-200/90">
                  {location.reasons?.map((reason, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="text-amber-400">•</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
            {flaggedLocations.length === 0 && (
              <p className="rounded-xl border border-slate-800 p-4 text-xs text-slate-400 text-center">
                No active sectors currently meet the automated risk-escalation threshold.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
