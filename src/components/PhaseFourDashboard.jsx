import React, { useEffect, useMemo, useState } from 'react';
import {
  approveAlert,
  archiveSituationBrief,
  correctReportAnalysis,
  createAlert,
  editAlert,
  editSituationBrief,
  fetchAlerts,
  fetchEmergingPatterns,
  fetchReportComparisons,
  fetchSituationBriefHistory,
  simulateAlertSend,
} from '../services/api';
import AnalyticsDashboard from './AnalyticsDashboard';

const PANEL =
  'rq-intelligence-panel rounded-2xl border p-4';
const INPUT =
  'w-full rounded-lg border border-purple-300/25 bg-[#120721] px-3 py-2 text-sm text-white outline-none focus:border-[#FF6B35]';
const LANGUAGES = [
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['pa', 'Punjabi'],
];

function ActionMessage({ message, error = false }) {
  if (!message) return null;
  return (
    <p role={error ? 'alert' : 'status'} className={`mt-3 text-sm ${error ? 'text-red-300' : 'text-emerald-300'}`}>
      {message}
    </p>
  );
}

function AnalysisEditor({ report, places, operator, onSaved }) {
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const canOperate = Boolean(operator && operator.role !== 'viewer');
  const fields = report?.analysis?.fields || {};
  const current = (name) => {
    const stored = values[name];
    if (stored !== undefined) return stored;
    const value = fields[name]?.value;
    return Array.isArray(value) ? value.join(', ') : String(value ?? 'Unknown');
  };
  const update = (name, value) =>
    setValues((existing) => ({ ...existing, [name]: value }));

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const corrections = {};
    for (const [name, value] of Object.entries(values)) {
      if (['immediate_threats', 'infrastructure_damage', 'urgent_resource_requirements'].includes(name)) {
        corrections[name] = value.trim() === 'Unknown'
          ? 'Unknown'
          : value.split(',').map((item) => item.trim()).filter(Boolean);
      } else if (name === 'people_affected') {
        corrections[name] = value.trim() === 'Unknown' ? 'Unknown' : Number(value);
      } else {
        corrections[name] = value;
      }
    }
    const result = await correctReportAnalysis(
      report.report_id,
      corrections,
      operator
    );
    if (!result.ok) {
      setError(result.error);
    } else {
      setMessage('Corrections saved. The original report and verification status are unchanged.');
      setValues({});
      onSaved(result.data.report);
    }
    setBusy(false);
  };

  if (!report) return null;
  const fieldConfig = [
    ['incident_type', 'Incident type', ['Unknown', 'Flood', 'Landslide', 'Blocked Road']],
    ['location', 'Location', ['Unknown', ...places.map((place) => place.place || place.name).filter(Boolean)]],
    ['severity', 'Severity', ['Unknown', 'Low', 'Medium', 'High', 'Critical']],
    ['people_affected', 'People affected (explicit number)', null],
    ['immediate_threats', 'Immediate threats (comma-separated)', null],
    ['infrastructure_damage', 'Infrastructure damage (comma-separated)', null],
    ['urgent_resource_requirements', 'Urgent resource requirements (comma-separated)', null],
  ];

  return (
    <form onSubmit={save} className={`${PANEL} space-y-3`}>
      <div>
        <h3 className="font-display text-sm font-bold text-white">AI extractions · Unverified</h3>
        <p className="mt-1 text-xs text-purple-200/70">
          Unknown means the report did not provide enough explicit evidence. Operator edits do not verify or confirm the report.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {fieldConfig.map(([name, label, options]) => (
          <label key={name} className="space-y-1 text-xs text-purple-200">
            <span>{label}</span>
            {options ? (
              <select value={current(name)} onChange={(event) => update(name, event.target.value)} className={INPUT}>
                {options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input
                value={current(name)}
                onChange={(event) => update(name, event.target.value)}
                maxLength={name === 'people_affected' ? 8 : 500}
                inputMode={name === 'people_affected' ? 'numeric' : 'text'}
                className={INPUT}
              />
            )}
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={!canOperate || busy || Object.keys(values).length === 0}
        title={!canOperate ? 'Operator sign-in required' : ''}
        className="rounded-lg bg-[#FF6B35] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
      >
        {busy ? 'Saving corrections…' : 'Save corrections'}
      </button>
      <ActionMessage message={error} error />
      <ActionMessage message={message} />
    </form>
  );
}

function IntelligenceSection({ reports, places, operator, onReportUpdated }) {
  const [selectedId, setSelectedId] = useState('');
  const [comparisons, setComparisons] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const selected = reports.find((report) => report.report_id === selectedId) || reports[0];

  const load = async () => {
    setLoading(true);
    setError('');
    const [comparisonResult, patternResult] = await Promise.all([
      fetchReportComparisons(operator),
      fetchEmergingPatterns(operator),
    ]);
    if (!comparisonResult.ok || !patternResult.ok) {
      setError(
        comparisonResult.error ||
        patternResult.error ||
        'Intelligence data could not be loaded.'
      );
    } else {
      setComparisons(comparisonResult.data.comparisons || []);
      setPatterns(patternResult.data.patterns || []);
      setLabel(patternResult.data.label || '');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [operator]);

  return (
    <div className="space-y-4">
      <section className={PANEL}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-white">Multilingual report intelligence</h2>
            <p className="mt-1 text-xs text-purple-200/70">
              Original citizen content is preserved. Translation and extraction remain unverified recommendations.
            </p>
          </div>
          <button type="button" onClick={load} disabled={loading} className="rounded-lg border border-purple-300/30 px-3 py-2 text-xs text-white disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh intelligence'}
          </button>
        </div>
        {error && <ActionMessage message={error} error />}
      </section>

      {selected ? (
        <>
          <section className="grid gap-4 lg:grid-cols-2">
            <article className={PANEL}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-sm font-bold text-white">Original report</h3>
                <select
                  aria-label="Select report"
                  value={selected.report_id}
                  onChange={(event) => setSelectedId(event.target.value)}
                  className={`${INPUT} max-w-xs`}
                >
                  {reports.map((report) => (
                    <option key={report.report_id} value={report.report_id}>
                      {report.report_id} · {report.place || 'Unknown'}
                    </option>
                  ))}
                </select>
              </div>
              <p className="whitespace-pre-wrap rounded-xl border border-purple-300/15 bg-[#120721] p-3 text-sm text-white">
                {selected.original_text || 'No text is available. The original audio remains available in incident evidence.'}
              </p>
              <p className="mt-2 text-xs text-purple-200/75">
                Language: <strong>{selected.analysis?.language?.name || selected.detected_language || 'Unknown'}</strong>
                {' · '}Detection confidence: {selected.analysis?.language?.confidence ?? 'Unknown'}
                {' · '}Verification: {selected.verification_status || 'Unverified'}
              </p>
            </article>
            <article className={PANEL}>
              <h3 className="font-display text-sm font-bold text-white">English translation</h3>
              <p className="mt-2 min-h-24 whitespace-pre-wrap rounded-xl border border-purple-300/15 bg-[#120721] p-3 text-sm text-white">
                {selected.translated_text || 'Translation is unavailable. No translated text has been fabricated.'}
              </p>
              <p className="mt-2 text-xs text-purple-200/75">
                Translation status: <strong>{selected.translation_status || 'Unavailable'}</strong>
                {' · '}AI processing: {selected.analysis_status || 'Not processed'}
              </p>
              {selected.transcription_status && (
                <p className="mt-1 text-xs text-purple-200/75">
                  Audio transcription: {selected.transcription_status}
                </p>
              )}
            </article>
          </section>
          <AnalysisEditor
            key={selected.report_id}
            report={selected}
            places={places}
            operator={operator}
            onSaved={onReportUpdated}
          />
        </>
      ) : (
        <p className={`${PANEL} text-sm text-purple-200/75`}>No stored reports are available for analysis.</p>
      )}

      <section className={PANEL}>
        <h3 className="font-display text-sm font-bold text-white">Potential duplicates and contradictions</h3>
        <p className="mb-3 mt-1 text-xs text-purple-200/70">
          These comparisons identify review candidates only; they never delete reports or prove an incident.
        </p>
        {comparisons.length ? (
          <div className="space-y-3">
            {comparisons.map((item) => (
              <article key={item.report_ids.join(':')} className="rounded-xl border border-orange-300/20 bg-[#120721] p-3">
                <div className="flex flex-wrap justify-between gap-2 text-xs">
                  <strong className="text-orange-200">{item.classification}</strong>
                  <span className="font-mono text-purple-200">{item.report_ids.join(' ↔ ')}</span>
                </div>
                <p className="mt-1 text-xs text-purple-100">
                  Similarity {item.text_similarity} · {item.time_difference_minutes} minutes apart
                  {item.severity_conflict ? ' · Conflicting severity' : ''}
                </p>
                <p className="mt-1 text-xs text-amber-200">
                  Incident relation: {item.contradicts_incident ? 'contradicts linked incident evidence' : item.supports_incident ? 'associated with the same incident; not confirmation' : 'no shared incident association'}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-purple-200/80">
                  {(item.reasoning || []).map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-xs text-purple-200/70">No candidate comparisons in the configured time/location window.</p>
        )}
      </section>

      <section className={PANEL}>
        <h3 className="font-display text-sm font-bold text-white">Emerging patterns</h3>
        <p className="mb-3 mt-1 text-xs text-amber-200">{label || 'Observed anomalies only; not a validated disaster prediction.'}</p>
        {patterns.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {patterns.map((pattern, index) => (
              <article key={`${pattern.type}-${index}`} className="rounded-xl border border-amber-300/20 bg-[#120721] p-3">
                <div className="font-semibold text-orange-200">{pattern.type}</div>
                <p className="mt-1 text-sm text-white">{pattern.description}</p>
                <p className="mt-2 text-xs text-purple-200/75">
                  Locations: {(pattern.locations || []).join(', ') || 'Unknown'}
                  {' · '}Evidence: {pattern.confidence}
                </p>
                <p className="mt-1 text-xs text-purple-200/65">{pattern.evidence_strength}</p>
                <p className="mt-2 break-all font-mono text-[10px] text-purple-300/80">
                  Supporting reports: {(pattern.supporting_report_ids || []).join(', ') || 'None'}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-xs text-purple-200/70">No stored reports meet the current anomaly thresholds.</p>
        )}
      </section>
    </div>
  );
}

function BriefSection({
  brief,
  setBrief,
  operator,
  onGenerate,
  onApprove,
  isGenerating,
  isApproving,
}) {
  const [history, setHistory] = useState([]);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isDraft = ['Draft', 'Draft — Needs Human Review'].includes(brief?.status);
  const isApproved = ['Approved', 'Approved by Human Operator'].includes(brief?.status);
  const canOperate = Boolean(operator && operator.role !== 'viewer');

  useEffect(() => {
    let active = true;
    fetchSituationBriefHistory(operator).then((result) => {
      if (!active) return;
      if (result.ok) setHistory(result.data.briefs || []);
      else setError(result.error || 'Brief history could not be loaded.');
    });
    return () => { active = false; };
  }, [brief?.version_id, operator]);

  const saveEdits = async () => {
    setBusy(true);
    setError('');
    const result = await editSituationBrief(edits, operator);
    if (!result.ok) {
      setError(result.error);
    } else {
      setBrief(result.data.brief);
      setEdits({});
    }
    setBusy(false);
  };

  const archive = async () => {
    setBusy(true);
    setError('');
    const result = await archiveSituationBrief(operator);
    if (!result.ok) setError(result.error);
    else setBrief(null);
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <section className={PANEL}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-white">Operational situation brief</h2>
            <p className="mt-1 text-xs text-purple-200/70">
              Uses stored records only. Drafts are not published and recommendations never dispatch resources.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onGenerate} disabled={!canOperate || isGenerating} className="rounded-lg border border-purple-300/30 px-3 py-2 text-xs text-white disabled:opacity-50">
              {isGenerating ? 'Generating…' : 'Generate draft'}
            </button>
            {isDraft && (
              <button type="button" onClick={saveEdits} disabled={!canOperate || busy || !Object.keys(edits).length} className="rounded-lg bg-[#FF6B35] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                {busy ? 'Saving…' : 'Save edits'}
              </button>
            )}
            {isDraft && (
              <button type="button" onClick={onApprove} disabled={!canOperate || busy || isApproving} className="rounded-lg border border-emerald-300/35 px-3 py-2 text-xs text-emerald-200 disabled:opacity-50">
                {isApproving ? 'Approving…' : 'Approve brief'}
              </button>
            )}
            {isApproved && (
              <button type="button" onClick={archive} disabled={!canOperate || busy} className="rounded-lg border border-purple-300/30 px-3 py-2 text-xs text-purple-100 disabled:opacity-50">
                Archive approved brief
              </button>
            )}
          </div>
        </div>
        {error && <ActionMessage message={error} error />}
        {!canOperate && <p className="mt-2 text-xs text-amber-200">Operator sign-in is required to edit, approve, or archive.</p>}
      </section>

      {brief ? (
        <>
          <section className="grid gap-3 md:grid-cols-2">
            {(brief.sections || []).map((section) => (
              <label key={section.key} className={`${PANEL} block space-y-2`}>
                <span className="font-display text-sm font-bold text-white">{section.title}</span>
                <textarea
                  value={edits[section.key] ?? section.text ?? ''}
                  onChange={(event) => setEdits((current) => ({ ...current, [section.key]: event.target.value }))}
                  readOnly={!isDraft}
                  rows={4}
                  maxLength={5000}
                  className={`${INPUT} resize-y`}
                />
                <span className="block text-[11px] text-purple-200/65">
                  {section.verification} · Reports: {(section.report_ids || []).join(', ') || 'None'}
                </span>
              </label>
            ))}
          </section>
          <p className="text-xs text-purple-200/70">
            Status: <strong className="text-orange-200">{brief.status}</strong>
            {' · '}Generated: {brief.generated_at ? new Date(brief.generated_at).toLocaleString() : 'Unknown'}
          </p>
        </>
      ) : (
        <p className={`${PANEL} text-sm text-purple-200/70`}>No current brief. Generate a draft from currently stored incident and report data.</p>
      )}

      <section className={PANEL}>
        <h3 className="font-display text-sm font-bold text-white">Archived brief history</h3>
        {history.length ? (
          <ul className="mt-2 space-y-2">
            {history.map((item) => (
              <li key={item.version_id || item.PK} className="rounded-lg bg-[#120721] p-3 text-xs">
                <strong className="text-purple-100">{item.title || 'Situation brief'}</strong>
                <span className="ml-2 text-purple-300">{item.status}</span>
                <p className="mt-1 text-purple-200/70">
                  {item.generated_at ? new Date(item.generated_at).toLocaleString() : 'Timestamp unavailable'}
                  {' · '}Approved by {item.approved_by || 'Unknown'}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-purple-200/70">No archived briefs are stored.</p>
        )}
      </section>
    </div>
  );
}

function AlertSection({ places, operator }) {
  const [alerts, setAlerts] = useState([]);
  const [selectedLocations, setSelectedLocations] = useState([]);
  const [severity, setSeverity] = useState('High');
  const [urgency, setUrgency] = useState('Warning');
  const [draftMessages, setDraftMessages] = useState({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const canOperate = Boolean(operator && operator.role !== 'viewer');

  const loadAlerts = async () => {
    const result = await fetchAlerts(operator);
    if (!result.ok) setError(result.error);
    else setAlerts(result.data.alerts || []);
  };
  useEffect(() => { loadAlerts(); }, [operator]);

  const createDraft = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    const result = await createAlert(
      { locations: selectedLocations, severity, urgency },
      operator
    );
    if (!result.ok) setError(result.error);
    else {
      setMessage('Alert draft created from human-confirmed reports. No message was sent.');
      setSelectedLocations([]);
      await loadAlerts();
    }
    setLoading(false);
  };

  const updateMessage = (alertId, language, value) =>
    setDraftMessages((current) => ({
      ...current,
      [alertId]: { ...(current[alertId] || {}), [language]: value },
    }));

  const saveMessages = async (alert) => {
    setBusyId(alert.alert_id);
    setError('');
    const result = await editAlert(
      alert.alert_id,
      draftMessages[alert.alert_id] || {},
      operator
    );
    if (!result.ok) setError(result.error);
    else {
      setDraftMessages((current) => ({ ...current, [alert.alert_id]: {} }));
      setMessage('Alert draft edits saved. The alert remains a draft.');
      await loadAlerts();
    }
    setBusyId('');
  };

  const transition = async (alert, action) => {
    setBusyId(alert.alert_id);
    setError('');
    const result = action === 'approve'
      ? await approveAlert(alert.alert_id, operator)
      : await simulateAlertSend(alert.alert_id, operator);
    if (!result.ok) setError(result.error);
    else {
      setMessage(
        action === 'approve'
          ? 'Alert approved by an operator; it remains unsent.'
          : 'Simulated delivery recorded. No SMS or broadcast service was contacted.'
      );
      await loadAlerts();
    }
    setBusyId('');
  };

  return (
    <div className="space-y-4">
      <section className={PANEL}>
        <h2 className="font-display text-lg font-bold text-white">Citizen alert management</h2>
        <p className="mt-1 text-xs text-amber-200">
          Prototype only — messages are never sent through SMS or broadcast systems.
          Drafts require human confirmation and approval.
        </p>
        <form onSubmit={createDraft} className="mt-4 grid gap-3 md:grid-cols-2">
          <fieldset className="rounded-xl border border-purple-300/15 p-3 md:col-span-2">
            <legend className="px-1 text-xs text-purple-200">Affected locations with human-confirmed reports</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {places.map((place) => {
                const name = place.place || place.name;
                if (!name) return null;
                return (
                  <label key={name} className="flex items-center gap-2 text-xs text-purple-100">
                    <input
                      type="checkbox"
                      checked={selectedLocations.includes(name)}
                      onChange={(event) => setSelectedLocations((current) =>
                        event.target.checked
                          ? [...current, name]
                          : current.filter((value) => value !== name)
                      )}
                    />
                    {name}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="space-y-1 text-xs text-purple-200">
            <span>Severity label</span>
            <select value={severity} onChange={(event) => setSeverity(event.target.value)} className={INPUT}>
              {['Low', 'Medium', 'High', 'Critical'].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-purple-200">
            <span>Urgency label</span>
            <select value={urgency} onChange={(event) => setUrgency(event.target.value)} className={INPUT}>
              {['Advisory', 'Watch', 'Warning', 'Emergency'].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <button disabled={!canOperate || loading || !selectedLocations.length} className="rounded-lg bg-[#FF6B35] px-4 py-2 text-xs font-bold text-white disabled:opacity-50 md:col-span-2">
            {loading ? 'Preparing draft…' : 'Generate multilingual draft'}
          </button>
        </form>
        {!canOperate && <p className="mt-2 text-xs text-amber-200">Operator sign-in is required to create or approve alerts.</p>}
        <ActionMessage message={error} error />
        <ActionMessage message={message} />
      </section>

      <section className="space-y-3">
        {alerts.length ? alerts.map((alert) => (
          <article key={alert.alert_id} className={PANEL}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-bold text-white">{alert.alert_id} · {alert.urgency} / {alert.severity}</h3>
                <p className="mt-1 text-xs text-purple-200/70">
                  {alert.locations?.join(', ')} · Status: {alert.status} · Supporting confirmed reports: {alert.supporting_report_ids?.join(', ')}
                </p>
              </div>
              <span className="rounded border border-orange-300/25 px-2 py-1 text-[10px] text-orange-200">{alert.delivery_mode}</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {LANGUAGES.map(([language, name]) => (
                <label key={language} className="space-y-1 text-xs text-purple-200">
                  <span>{name} · {alert.translation_status?.[language] || 'Needs review'}</span>
                  <textarea
                    value={draftMessages[alert.alert_id]?.[language] ?? alert.messages?.[language] ?? ''}
                    readOnly={alert.status !== 'Draft'}
                    onChange={(event) => updateMessage(alert.alert_id, language, event.target.value)}
                    rows={5}
                    maxLength={2000}
                    className={`${INPUT} resize-y`}
                  />
                </label>
              ))}
            </div>
            {alert.status === 'Draft' && (
              <button
                type="button"
                onClick={() => saveMessages(alert)}
                disabled={!canOperate || busyId === alert.alert_id || !Object.keys(draftMessages[alert.alert_id] || {}).length}
                className="mt-3 rounded-lg border border-purple-300/30 px-3 py-2 text-xs text-white disabled:opacity-50"
              >
                {busyId === alert.alert_id ? 'Saving…' : 'Save message edits'}
              </button>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {alert.status === 'Draft' && (
                <button type="button" onClick={() => transition(alert, 'approve')} disabled={!canOperate || busyId === alert.alert_id} className="rounded-lg border border-emerald-300/30 px-3 py-2 text-xs text-emerald-200 disabled:opacity-50">
                  Approve
                </button>
              )}
              {alert.status === 'Approved' && (
                <button type="button" onClick={() => transition(alert, 'send')} disabled={!canOperate || busyId === alert.alert_id} className="rounded-lg bg-[#FF6B35] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                  Record simulated delivery
                </button>
              )}
            </div>
            <ol className="mt-3 space-y-1 border-t border-purple-300/15 pt-2 text-[10px] text-purple-200/65">
              {(alert.history || []).map((entry, index) => (
                <li key={`${entry.status}-${entry.timestamp}-${index}`}>
                  {entry.status} · {entry.operator} · {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Unknown'}
                </li>
              ))}
            </ol>
          </article>
        )) : (
          <p className={PANEL + ' text-sm text-purple-200/70'}>No stored alert drafts or delivery records.</p>
        )}
      </section>
    </div>
  );
}

export default function PhaseFourDashboard({
  incidents,
  reports,
  resources,
  places,
  brief,
  setBrief,
  operator,
  onGenerateBrief,
  onApproveBrief,
  onReportUpdated,
  isGeneratingBrief,
  isApprovingBrief,
}) {
  const [section, setSection] = useState('intelligence');
  const reportCount = useMemo(() => reports.length, [reports]);
  const sections = [
    ['intelligence', 'Report Intelligence'],
    ['brief', 'Situation Brief'],
    ['alerts', 'Citizen Alerts'],
    ['analytics', 'Operational Analytics'],
  ];

  return (
    <main className="relative z-20 mx-auto flex w-full max-w-[1680px] flex-1 flex-col gap-4 p-4 lg:p-5">
      <section className={PANEL}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#FF6B35]">Phase 4 · Decision support</p>
            <h1 className="mt-1 font-display text-xl font-bold text-white">Operational Intelligence</h1>
            <p className="mt-1 text-xs text-purple-200/70">
              {reportCount} stored reports · {incidents.length} stored incidents · {resources.length} resource records
            </p>
          </div>
          <nav aria-label="Operational intelligence sections" className="flex flex-wrap gap-2">
            {sections.map(([key, title]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                  section === key
                    ? 'border-[#FF6B35]/50 bg-[#FF6B35] text-white'
                    : 'border-purple-300/20 bg-[#120721] text-purple-100'
                }`}
              >
                {title}
              </button>
            ))}
          </nav>
        </div>
      </section>
      {section === 'intelligence' && (
        <IntelligenceSection
          reports={reports}
          places={places}
          operator={operator}
          onReportUpdated={onReportUpdated}
        />
      )}
      {section === 'brief' && (
        <BriefSection
          brief={brief}
          setBrief={setBrief}
          operator={operator}
          onGenerate={onGenerateBrief}
          onApprove={onApproveBrief}
          isGenerating={isGeneratingBrief}
          isApproving={isApprovingBrief}
        />
      )}
      {section === 'alerts' && (
        <AlertSection places={places} operator={operator} />
      )}
      {section === 'analytics' && (
        <AnalyticsDashboard places={places} operator={operator} />
      )}
    </main>
  );
}
