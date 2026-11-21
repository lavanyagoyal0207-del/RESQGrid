import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  MapPin,
  Search,
  ShieldAlert,
  ShieldCheck,
  User,
  Volume2,
  XCircle,
} from 'lucide-react';

const STATUS_BADGE = {
  Unverified: 'bg-slate-600/40 text-slate-200 border-slate-400/50',
  Corroborated: 'bg-sky-500/25 text-sky-200 border-sky-400/50',
  Confirmed: 'bg-emerald-500/25 text-emerald-200 border-emerald-400/50',
  Rejected: 'bg-red-500/25 text-red-200 border-red-400/50',
};

const SEVERITY_BADGE = {
  Critical: 'bg-red-500/25 text-red-200 border-red-500/60',
  High: 'bg-amber-500/25 text-amber-200 border-amber-500/60',
  Medium: 'bg-yellow-500/25 text-yellow-200 border-yellow-500/60',
  Low: 'bg-emerald-500/25 text-emerald-200 border-emerald-500/60',
};

export default function IncomingReportsQueue({
  reports,
  incidents,
  operator,
  onVerifyReport,
  onConfirmIncident,
  onSelectIncident,
  onLoadReportAudio,
  isSubmittingAction,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [selectedReport, setSelectedReport] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState('');

  const filteredReports = useMemo(() => {
    return (reports || []).filter((report) => {
      if (statusFilter !== 'ALL') {
        const reportStatus = report.verification_status || 'Unverified';
        if (reportStatus !== statusFilter) return false;
      }

      if (severityFilter !== 'ALL' && report.severity !== severityFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesId = report.report_id?.toLowerCase().includes(query);
        const matchesPlace = report.place?.toLowerCase().includes(query);
        const matchesType = report.type?.toLowerCase().includes(query);
        const matchesReporter =
          report.reporter_name?.toLowerCase().includes(query) ||
          report.reporter_email?.toLowerCase().includes(query);
        const matchesText = report.original_text?.toLowerCase().includes(query);
        const matchesIncident = report.incident_id?.toLowerCase().includes(query);

        if (
          !matchesId &&
          !matchesPlace &&
          !matchesType &&
          !matchesReporter &&
          !matchesText &&
          !matchesIncident
        ) {
          return false;
        }
      }

      return true;
    });
  }, [reports, statusFilter, severityFilter, searchQuery]);

  const handleOpenReview = (report) => {
    setSelectedReport(report);
    setAudioUrl(null);
    setAudioError('');
  };

  const handleCloseReview = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setSelectedReport(null);
    setAudioError('');
  };

  const handleLoadAudio = async (reportId) => {
    if (!onLoadReportAudio) return;
    setAudioLoading(true);
    setAudioError('');
    try {
      const result = await onLoadReportAudio(reportId);
      if (!result.ok) {
        setAudioError(result.error || 'Audio could not be loaded.');
        return;
      }
      const url = URL.createObjectURL(result.blob);
      setAudioUrl(url);
    } catch (err) {
      setAudioError(err.message || 'Audio loading failed.');
    } finally {
      setAudioLoading(false);
    }
  };

  const handleVerify = async (reportId, status) => {
    if (!onVerifyReport) return;
    const res = await onVerifyReport(reportId, status);
    if (res?.ok && selectedReport?.report_id === reportId) {
      setSelectedReport((prev) => ({
        ...prev,
        verification_status: status,
      }));
    }
  };

  const handleConfirmLinkedIncident = async (incidentId) => {
    if (!onConfirmIncident) return;
    await onConfirmIncident(incidentId);
  };

  const unverifiedCount = (reports || []).filter(
    (r) => !['Confirmed', 'Rejected'].includes(r.verification_status || 'Unverified')
  ).length;

  return (
    <div className="rq-reports-queue flex flex-col rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden shadow-xl">
      {/* HEADER */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-orange-500/10 border border-orange-500/30 px-2.5 py-0.5 font-mono text-xs font-bold text-orange-400">
                VERIFICATION QUEUE
              </span>
              <h2 className="font-display text-base font-bold text-white">
                Incoming Field Reports
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Operator intake: inspect individual citizen reports, review clustering rationale, and corroborate or reject.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1 font-mono text-slate-300">
              Total: <strong className="text-white">{(reports || []).length}</strong>
            </span>
            <span className="rounded-lg bg-orange-500/10 border border-orange-500/30 px-3 py-1 font-mono text-orange-400">
              Awaiting Review: <strong>{unverifiedCount}</strong>
            </span>
          </div>
        </div>

        {/* SEARCH AND FILTERS */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ID, place, emergency type, reporter, or text..."
              className="w-full rounded-lg bg-slate-950 border border-slate-700 pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800 overflow-x-auto scrollbar-none">
            {['ALL', 'Unverified', 'Corroborated', 'Confirmed', 'Rejected'].map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`rounded px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  statusFilter === status
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {status}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase px-1 font-mono">Severity:</span>
            {['ALL', 'Critical', 'High'].map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => setSeverityFilter(sev)}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  severityFilter === sev
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-900 text-slate-400 uppercase font-mono text-[10px] tracking-wider sticky top-0 z-10 border-b border-slate-800 backdrop-blur-sm">
            <tr>
              <th className="py-2.5 px-3">Report ID / Time</th>
              <th className="py-2.5 px-3">Reporter</th>
              <th className="py-2.5 px-3">Emergency Type</th>
              <th className="py-2.5 px-3">Location</th>
              <th className="py-2.5 px-3">Clustered Incident</th>
              <th className="py-2.5 px-3">Verification</th>
              <th className="py-2.5 px-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filteredReports.map((report) => {
              const status = report.verification_status || 'Unverified';
              const sev = report.severity || 'Medium';
              const createdDate = report.created_at
                ? new Date(report.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    month: 'short',
                    day: 'numeric',
                  })
                : '—';

              return (
                <tr
                  key={report.report_id}
                  className="hover:bg-slate-900/60 transition-colors"
                >
                  <td className="py-3 px-3">
                    <div className="font-mono font-bold text-orange-400">
                      {report.report_id}
                    </div>
                    <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3" />
                      {createdDate}
                    </div>
                  </td>

                  <td className="py-3 px-3">
                    <div className="font-medium text-white flex items-center gap-1">
                      <User className="h-3 w-3 text-slate-400" />
                      {report.reporter_name || 'Anonymous Citizen'}
                    </div>
                    {report.reporter_email && (
                      <div className="text-[10px] text-slate-400 truncate max-w-[120px]">
                        {report.reporter_email}
                      </div>
                    )}
                  </td>

                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-white">{report.type}</span>
                      <span
                        className={`rounded px-1.5 py-0.2 border text-[10px] font-bold ${
                          SEVERITY_BADGE[sev] || SEVERITY_BADGE.Medium
                        }`}
                      >
                        {sev}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate max-w-[180px] mt-0.5">
                      {report.original_text || report.source}
                    </div>
                  </td>

                  <td className="py-3 px-3">
                    <div className="font-medium text-slate-200 flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-orange-400" />
                      {report.place}
                    </div>
                    {report.lat && report.lng && (
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {Number(report.lat).toFixed(4)}°, {Number(report.lng).toFixed(4)}°
                      </div>
                    )}
                  </td>

                  <td className="py-3 px-3">
                    {report.incident_id ? (
                      <button
                        type="button"
                        onClick={() => onSelectIncident && onSelectIncident(report.incident_id)}
                        className="font-mono text-xs text-sky-400 hover:text-sky-300 underline flex items-center gap-1"
                        title="View linked incident"
                      >
                        {report.incident_id}
                      </button>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>

                  <td className="py-3 px-3">
                    <span
                      className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                        STATUS_BADGE[status] || STATUS_BADGE.Unverified
                      }`}
                    >
                      {status}
                    </span>
                  </td>

                  <td className="py-3 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleOpenReview(report)}
                      className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:text-white transition flex items-center gap-1 ml-auto"
                    >
                      <Eye className="h-3.5 w-3.5 text-orange-400" />
                      Review
                    </button>
                  </td>
                </tr>
              );
            })}

            {filteredReports.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  <ShieldAlert className="h-8 w-8 mx-auto mb-2 text-slate-600" />
                  <p className="text-sm font-semibold">No reports match the current filter.</p>
                  <p className="text-xs mt-1 text-slate-500">Try resetting the search query or status filter.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* REVIEW MODAL */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="rq-report-modal w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-orange-400">
                    {selectedReport.report_id}
                  </span>
                  <span
                    className={`rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
                      STATUS_BADGE[selectedReport.verification_status || 'Unverified'] ||
                      STATUS_BADGE.Unverified
                    }`}
                  >
                    {selectedReport.verification_status || 'Unverified'}
                  </span>
                </div>
                <h3 className="font-display text-lg font-bold text-white mt-1">
                  Report Review & Human Verification
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseReview}
                className="text-slate-400 hover:text-white rounded-lg p-1 hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Reporter & Metadata Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Type</span>
                <strong className="text-white">{selectedReport.type}</strong>
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Severity</span>
                <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold ${SEVERITY_BADGE[selectedReport.severity] || SEVERITY_BADGE.Medium}`}>
                  {selectedReport.severity}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Location</span>
                <strong className="text-slate-200">{selectedReport.place}</strong>
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Submitted At</span>
                <span className="text-slate-300">
                  {selectedReport.created_at ? new Date(selectedReport.created_at).toLocaleString() : '—'}
                </span>
              </div>
            </div>

            {/* Reporter Contact */}
            <div className="text-xs bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-slate-400">Reporter:</span>{' '}
                <strong className="text-white">{selectedReport.reporter_name || 'Anonymous Citizen'}</strong>
                {selectedReport.reporter_email && (
                  <span className="text-slate-400 ml-2">({selectedReport.reporter_email})</span>
                )}
              </div>
              <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300 text-[10px] border border-slate-700">
                {selectedReport.source || 'Citizen Field Report'}
              </span>
            </div>

            {/* Description / Content */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase font-mono tracking-wider text-slate-400">
                Report Description / Field Observation
              </label>
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 text-sm text-white leading-relaxed">
                {selectedReport.original_text || 'No text content available.'}
              </div>
              {selectedReport.detected_language && (
                <p className="text-xs text-slate-400">
                  Detected language: <strong className="text-slate-200">{selectedReport.detected_language}</strong>
                </p>
              )}
            </div>

            {/* AI Clustering Rationale */}
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-orange-400">
                <CheckCircle2 className="h-4 w-4 text-orange-400" />
                Incident Association & Clustering Rationale:
              </div>
              <p className="text-slate-300 leading-normal pl-5">
                {selectedReport.grouping_reason || 'No grouping rationale recorded.'}
              </p>
              {selectedReport.incident_id && (
                <div className="pl-5 pt-1 flex items-center gap-2">
                  <span className="text-slate-400">Linked Incident:</span>
                  <span className="font-mono font-bold text-white bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
                    {selectedReport.incident_id}
                  </span>
                </div>
              )}
            </div>

            {/* Audio Recording if available */}
            {selectedReport.has_audio && (
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-2 text-xs">
                <div className="flex items-center gap-2 font-semibold text-slate-200">
                  <Volume2 className="h-4 w-4 text-orange-400" />
                  Citizen Voice Recording (S3 Secure Storage)
                </div>
                {audioUrl ? (
                  <audio controls preload="none" src={audioUrl} className="w-full" />
                ) : (
                  <button
                    type="button"
                    onClick={() => handleLoadAudio(selectedReport.report_id)}
                    disabled={!operator || audioLoading}
                    className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-slate-200 text-xs font-medium disabled:opacity-50 transition"
                  >
                    {audioLoading ? 'Loading audio from S3...' : 'Load original audio recording'}
                  </button>
                )}
                {audioError && <p className="text-red-400 text-xs">{audioError}</p>}
              </div>
            )}

            {/* OPERATOR ACTION BUTTONS */}
            <div className="border-t border-slate-800 pt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                {operator ? (
                  <span>Acting as authorized operator: <strong className="text-white">{operator}</strong></span>
                ) : (
                  <span className="text-amber-400">Sign in as an operator to corroborate or reject.</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {operator && (
                  <>
                    <button
                      type="button"
                      disabled={isSubmittingAction}
                      onClick={() => handleVerify(selectedReport.report_id, 'Confirmed')}
                      className="rounded-lg bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/50 px-3.5 py-1.5 text-xs font-bold text-white transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {isSubmittingAction ? 'Saving...' : 'Confirm Report'}
                    </button>

                    <button
                      type="button"
                      disabled={isSubmittingAction}
                      onClick={() => handleVerify(selectedReport.report_id, 'Rejected')}
                      className="rounded-lg bg-red-600 hover:bg-red-500 border border-red-500/50 px-3.5 py-1.5 text-xs font-bold text-white transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" />
                      {isSubmittingAction ? 'Saving...' : 'Reject Report'}
                    </button>

                    {selectedReport.incident_id && onConfirmIncident && (
                      <button
                        type="button"
                        disabled={isSubmittingAction}
                        onClick={() => handleConfirmLinkedIncident(selectedReport.incident_id)}
                        className="rounded-lg bg-orange-600 hover:bg-orange-500 border border-orange-500/50 px-3.5 py-1.5 text-xs font-bold text-white transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                      >
                        <ShieldCheck className="h-4 w-4" />
                        Confirm Entire Incident
                      </button>
                    )}
                  </>
                )}

                <button
                  type="button"
                  onClick={handleCloseReview}
                  className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:text-white transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
