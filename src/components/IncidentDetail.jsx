import React, { useEffect, useRef, useState } from 'react';

const STATUS_BADGE = {
  Unverified: 'bg-slate-600/40 text-slate-200 border-slate-400/50',
  Corroborated: 'bg-sky-500/25 text-sky-200 border-sky-400/50',
  Confirmed: 'bg-emerald-500/25 text-emerald-200 border-emerald-400/50',
  Rejected: 'bg-red-500/25 text-red-200 border-red-400/50',
};

export default function IncidentDetail({
  incident,
  reports,
  operator,
  onVerifyReport,
  onLoadReportAudio,
  onResponseStatusChange,
  isSubmittingAction,
}) {
  const [audioUrls, setAudioUrls] = useState({});
  const [audioLoading, setAudioLoading] = useState({});
  const [audioErrors, setAudioErrors] = useState({});
  const [responseError, setResponseError] = useState('');
  const [responseBusy, setResponseBusy] = useState(false);
  const [responseNotes, setResponseNotes] = useState('');
  const audioUrlsRef = useRef(new Set());

  useEffect(() => () => {
    audioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!operator) {
      audioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      audioUrlsRef.current.clear();
      setAudioUrls({});
      setAudioErrors({});
    }
  }, [operator]);

  if (!incident) {
    return (
      <div className="rounded-2xl bg-[#2D1B4E]/60 border border-purple-400/20 p-6 text-center shadow-lg">
        <p className="font-display text-sm font-semibold text-white">
          Select an Incident on the Map or Queue to Inspect Grouped Field Reports
        </p>
        <p className="text-xs text-purple-200/70 mt-1">
          Golden Rule: AI only suggests clusters and translations. Human operator confirmation is required.
        </p>
      </div>
    );
  }

  const incidentReportIds = Array.isArray(incident.report_ids)
    ? incident.report_ids
    : [];
  const incidentReports = reports.filter((report) =>
    incidentReportIds.includes(report.report_id) ||
    report.incident_id === incident.incident_id
  );
  const isConfirmed = incident.status === 'Confirmed';
  const latitude = Number(incident.lat);
  const longitude = Number(incident.lng);
  const responseStatus = incident.response_status || 'Awaiting Assignment';
  const responseTransitions = {
    'Awaiting Assignment': ['Assigned'],
    Assigned: ['Awaiting Assignment', 'Team Dispatched'],
    'Team Dispatched': ['Response in Progress'],
    'Response in Progress': ['Resolved'],
    Resolved: [],
  };
  const returnedDeploymentIds = new Set(
    (incident.response_history || [])
      .filter((entry) => entry.action === 'Resource Returned')
      .map((entry) => entry.deployment_id)
  );
  const activeAssignments = (incident.response_assignments || []).filter(
    (assignment) =>
      assignment.status !== 'Returned' &&
      !returnedDeploymentIds.has(assignment.deployment_id)
  );
  const nextResponseStatuses = responseTransitions[responseStatus] || [];

  const handleLoadAudio = async (reportId) => {
    setAudioLoading((current) => ({ ...current, [reportId]: true }));
    setAudioErrors((current) => ({ ...current, [reportId]: '' }));
    try {
      const result = await onLoadReportAudio(reportId);
      if (!result.ok) {
        setAudioErrors((current) => ({
          ...current,
          [reportId]: result.error || 'Audio could not be loaded.'
        }));
        return;
      }

      const url = URL.createObjectURL(result.blob);
      audioUrlsRef.current.add(url);
      setAudioUrls((current) => ({ ...current, [reportId]: url }));
    } finally {
      setAudioLoading((current) => ({ ...current, [reportId]: false }));
    }
  };

  const handleResponseUpdate = async (event) => {
    event.preventDefault();
    setResponseBusy(true);
    setResponseError('');
    const formData = new FormData(event.currentTarget);
    const result = await onResponseStatusChange(
      incident.incident_id,
      formData.get('status'),
      responseNotes
    );
    if (!result.ok) {
      setResponseError(result.error || 'Response status could not be updated.');
    } else {
      setResponseNotes('');
    }
    setResponseBusy(false);
  };

  return (
    <div className="rq-detail-card flex flex-col rounded-2xl border overflow-hidden">
      {/* TOP: Type, Place, Lat/Lng, Status */}
      <div className="p-4 border-b border-purple-400/20 bg-gradient-to-r from-[#2D1B4E] to-[#1a0b2e]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-[#FF6B35]/20 border border-[#FF6B35]/50 px-2 py-0.5 font-mono text-[11px] font-bold text-[#FF6B35]">
                {incident.incident_id}
              </span>
              <span className="font-display text-lg font-bold text-white">
                {incident.type} — {incident.place}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-purple-200/80 font-mono">
              <span>
                Coordinates:{' '}
                <strong className="text-white">
                  {Number.isFinite(latitude) && Number.isFinite(longitude)
                    ? `${latitude.toFixed(4)}° N, ${longitude.toFixed(4)}° E`
                    : 'Unavailable'}
                </strong>
              </span>
              <span>•</span>
              <span>
                Aggregation: <strong className="text-[#FF6B35]">{incident.report_count} reports -&gt; 1 incident</strong>
              </span>
              <span>•</span>
              <span>Severity: <strong className="text-white">{incident.severity || 'Unknown'}</strong></span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`rounded-lg border px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                STATUS_BADGE[incident.status] || STATUS_BADGE.Unverified
              }`}
            >
              Status: {incident.status}
            </span>
          </div>
        </div>

        {/* Grouping Reason Banner */}
        <div className="mt-3 rounded-xl bg-[#120721]/90 border border-[#FF6B35]/35 px-3.5 py-2.5 flex items-start gap-2.5">
          <svg
            className="h-4 w-4 text-[#FF6B35] shrink-0 mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="text-xs">
            <div className="font-semibold text-orange-200">
              AI Clustering Logic (Status: {incident.status} — {isConfirmed ? 'Verified by Human Operator' : 'Requires Human Confirmation'}):
            </div>
            <div className="text-purple-100/90 mt-0.5">
              {incident.grouping_reason || 'No grouping rationale is recorded for this incident.'}
            </div>
          </div>
        </div>
      </div>

      {/* MIDDLE: List of Grouped Reports (original_text Hindi/Punjabi + translated_text English + time) */}
      <div className="p-4 space-y-3 max-h-[340px] overflow-y-auto bg-[#120721]/60">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xs font-bold uppercase tracking-wider text-purple-200/90">
            Evidence and Individual Reports ({incidentReports.length})
          </h3>
          <span className="text-[11px] text-purple-300/70">
            Each report retains its own human verification status.
          </span>
        </div>

        {incidentReports.map((rep) => (
          <div
            key={rep.report_id}
            className="rounded-xl bg-[#2D1B4E]/75 border border-purple-300/20 p-3.5 space-y-2 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-purple-200/75 border-b border-purple-300/15 pb-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-[#FF6B35]">{rep.report_id}</span>
                <span className="rounded bg-[#1a0b2e] px-2 py-0.5 text-purple-100 border border-purple-300/20">
                  {rep.source}
                </span>
                <span
                  className={`rounded border px-2 py-0.5 ${
                    STATUS_BADGE[rep.verification_status || 'Unverified'] ||
                    STATUS_BADGE.Unverified
                  }`}
                >
                  {rep.verification_status || 'Unverified'}
                </span>
              </div>
              <span className="font-mono" title={rep.created_at}>
                {rep.created_at
                  ? new Date(rep.created_at).toLocaleString()
                  : 'Timestamp unavailable'}
              </span>
            </div>

            <div className="space-y-1.5 text-xs">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-300/80 block">
                  Report description / original transcript:
                </span>
                <p className="text-white font-medium bg-[#1a0b2e]/80 rounded-lg px-2.5 py-1.5 mt-0.5 border border-purple-300/15">
                  {rep.original_text || 'No transcript or text description is available.'}
                </p>
              </div>
              {rep.detected_language && (
                <p className="text-purple-200/80">
                  Detected language: <strong>{rep.detected_language}</strong>
                  {rep.transcription_status && (
                    <> · Transcription: <strong>{rep.transcription_status}</strong></>
                  )}
                </p>
              )}
              {rep.grouping_reason && (
                <p className="text-purple-200/80">
                  Grouping rationale: {rep.grouping_reason}
                </p>
              )}
              {rep.verified_by && (
                <p className="text-purple-200/80">
                  Reviewed by {rep.verified_by} at {rep.verified_at || 'timestamp unavailable'}
                </p>
              )}
              {rep.has_audio && (
                <div className="space-y-2 border-t border-purple-300/15 pt-2">
                  <div className="font-semibold text-purple-100">Original recording (private S3 audio)</div>
                  {audioUrls[rep.report_id] ? (
                    <audio
                      controls
                      preload="none"
                      src={audioUrls[rep.report_id]}
                      className="w-full"
                    >
                      Audio playback is not supported by this browser.
                    </audio>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleLoadAudio(rep.report_id)}
                      disabled={!operator || audioLoading[rep.report_id]}
                      title={!operator ? 'Operator sign-in required' : ''}
                      className="rounded-lg border border-purple-300/30 px-3 py-1.5 text-purple-100 disabled:opacity-50"
                    >
                      {audioLoading[rep.report_id] ? 'Loading audio...' : 'Load original audio'}
                    </button>
                  )}
                  {audioErrors[rep.report_id] && (
                    <p role="alert" className="text-red-300">{audioErrors[rep.report_id]}</p>
                  )}
                </div>
              )}
              {operator && !['Confirmed', 'Rejected'].includes(
                rep.verification_status || 'Unverified'
              ) && (
                <div className="flex flex-wrap gap-2 border-t border-purple-300/15 pt-2">
                  <button
                    type="button"
                    disabled={isSubmittingAction}
                    onClick={() => onVerifyReport(rep.report_id, 'Confirmed')}
                    className="rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                  >
                    {isSubmittingAction ? 'Saving...' : 'Confirm report'}
                  </button>
                  <button
                    type="button"
                    disabled={isSubmittingAction}
                    onClick={() => onVerifyReport(rep.report_id, 'Rejected')}
                    className="rounded-lg bg-red-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                  >
                    {isSubmittingAction ? 'Saving...' : 'Reject report'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {incidentReports.length === 0 && (
          <p className="rounded-xl border border-purple-300/15 p-3 text-xs text-purple-200/75">
            No individual reports are currently linked to this incident.
          </p>
        )}
      </div>

      <section className="border-t border-purple-400/20 bg-[#1a0b2e]/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-white">
              Emergency Response Coordination
            </h3>
            <p className="mt-1 text-[11px] text-purple-200/75">
              Current progress: <strong className="text-orange-200">{responseStatus}</strong>
            </p>
          </div>
          {operator && nextResponseStatuses.length > 0 && (
            <form onSubmit={handleResponseUpdate} className="flex flex-wrap items-center gap-2">
              <select
                name="status"
                required
                defaultValue={nextResponseStatuses[0]}
                className="rounded-lg border border-purple-300/25 bg-[#120721] px-2 py-1.5 text-xs text-white"
              >
                {nextResponseStatuses.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <input
                value={responseNotes}
                onChange={(event) => setResponseNotes(event.target.value)}
                maxLength={500}
                placeholder="Operator note (optional)"
                className="w-48 rounded-lg border border-purple-300/25 bg-[#120721] px-2 py-1.5 text-xs text-white"
              />
              <button
                type="submit"
                disabled={responseBusy || isSubmittingAction}
                className="rounded-lg bg-[#FF6B35] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {responseBusy ? 'Saving...' : 'Update response'}
              </button>
            </form>
          )}
        </div>
        {responseError && (
          <p role="alert" className="mt-2 text-xs text-red-300">{responseError}</p>
        )}
        {!operator && (
          <p className="mt-2 text-[10px] text-purple-200/60">
            Operator sign-in is required to change response progress.
          </p>
        )}

        <div className="mt-3 space-y-2">
          {activeAssignments.map((assignment) => (
            <article key={assignment.deployment_id} className="rounded-lg border border-orange-300/15 bg-[#2D1B4E]/45 px-3 py-2 text-[11px]">
              <div className="font-semibold text-white">
                {assignment.resource_name || assignment.resource_id} · {assignment.quantity} unit(s)
              </div>
              <p className="text-purple-200/75">
                {assignment.resource_type || 'Resource'} · {assignment.status} · Assigned by {assignment.assigned_by || 'operator'} at {assignment.assigned_at ? new Date(assignment.assigned_at).toLocaleString() : 'timestamp unavailable'}
              </p>
            </article>
          ))}
          {activeAssignments.length === 0 && (
            <p className="text-[11px] text-purple-200/60">No resources are assigned to this incident.</p>
          )}
        </div>

        <div className="mt-3 border-t border-purple-300/10 pt-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-purple-200/75">
            Response and Assignment History
          </h4>
          <ol className="mt-1 space-y-1">
            {[...(incident.response_history || [])].reverse().slice(0, 8).map((entry, index) => (
              <li key={`${entry.timestamp}-${index}`} className="text-[10px] text-purple-100/75">
                {entry.action || entry.to_status || 'Operator action'}
                {entry.to_status ? `: ${entry.from_status || '—'} -> ${entry.to_status}` : ''}
                {entry.resource_name ? ` · ${entry.resource_name}` : ''}
                {entry.operator ? ` · ${entry.operator}` : ''}
                {entry.timestamp ? ` · ${new Date(entry.timestamp).toLocaleString()}` : ''}
                {entry.notes ? ` · ${entry.notes}` : ''}
              </li>
            ))}
            {!(incident.response_history || []).length && (
              <li className="text-[10px] text-purple-200/60">No response actions recorded.</li>
            )}
          </ol>
        </div>
      </section>

      <div className="p-4 border-t border-purple-400/20 bg-[#2D1B4E]/80 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-purple-200/85">
          {isConfirmed ? (
            <span className="text-emerald-300 font-semibold">
              Incident confirmed by {incident.confirmed_by || 'authorized operator'}
              {incident.confirmed_at ? ` at ${incident.confirmed_at}` : ''}
            </span>
          ) : (
            <span>
              Incident grouping is an AI suggestion. Confirm or reject each report individually after review.
              {!operator && ' Sign in as an authorized operator to verify reports or access private audio.'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
