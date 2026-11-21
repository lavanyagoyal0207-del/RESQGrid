import React, { useEffect, useState } from 'react';
import { fetchOperationalAnalytics } from '../services/api';

const PANEL =
  'rq-intelligence-panel rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl';
const INPUT =
  'rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500 transition-colors';

function Metric({ label, value, detail }) {
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-3.5 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-white">{value ?? '—'}</p>
      {detail && <p className="mt-1 text-[10px] text-slate-500">{detail}</p>}
    </article>
  );
}

function CountBars({ title, values, emptyText = 'No stored values in this filter.' }) {
  const entries = Object.entries(values || {}).sort((left, right) => right[1] - left[1]);
  const maximum = Math.max(1, ...entries.map(([, value]) => Number(value) || 0));
  return (
    <section className={PANEL}>
      <h3 className="font-display text-sm font-bold text-white">{title}</h3>
      {entries.length ? (
        <div className="mt-3 space-y-3">
          {entries.map(([label, count]) => (
            <div key={label}>
              <div className="mb-1 flex justify-between gap-3 text-xs">
                <span className="truncate text-slate-200">{label}</span>
                <strong className="text-orange-400 font-mono">{count}</strong>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-900">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-orange-600 to-amber-500"
                  style={{ width: `${Math.min(100, (Number(count) / maximum) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">{emptyText}</p>
      )}
    </section>
  );
}

function SeverityTrend({ values }) {
  const entries = Object.entries(values || {}).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const severities = [
    ['Critical', 'bg-red-500'],
    ['High', 'bg-orange-500'],
    ['Medium', 'bg-amber-400'],
    ['Low', 'bg-emerald-500'],
    ['Unknown', 'bg-slate-400'],
  ];
  const totals = entries.map(([, counts]) =>
    Object.values(counts || {}).reduce((total, count) => total + count, 0)
  );
  const maximum = Math.max(1, ...totals);
  return (
    <section className={PANEL}>
      <h3 className="font-display text-sm font-bold text-white">Severity trend by day</h3>
      {entries.length ? (
        <>
          <div className="mt-3 space-y-3">
            {entries.map(([day, counts]) => {
              const total = Object.values(counts || {}).reduce((sum, count) => sum + count, 0);
              return (
                <div key={day}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-slate-200">{day}</span>
                    <strong className="text-orange-400 font-mono">{total}</strong>
                  </div>
                  <div
                    className="flex h-3 overflow-hidden rounded-full bg-slate-900"
                    role="img"
                    aria-label={`${day}: ${Object.entries(counts || {}).map(([severity, count]) => `${severity} ${count}`).join(', ')}`}
                  >
                    {severities.map(([severity, color]) => {
                      const count = counts?.[severity] || 0;
                      return count ? (
                        <div
                          key={severity}
                          className={color}
                          title={`${severity}: ${count}`}
                          style={{ width: `${(count / maximum) * 100}%` }}
                        />
                      ) : null;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-400">
            {severities.map(([severity, color]) => (
              <span key={severity} className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${color}`} />
                {severity}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-slate-500">No incident severity history is stored for this filter.</p>
      )}
    </section>
  );
}

export default function AnalyticsDashboard({ places, operator }) {
  const [filters, setFilters] = useState({ from_date: '', to_date: '', place: '' });
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (event) => {
    event?.preventDefault();
    if (!operator) {
      setAnalytics(null);
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const result = await fetchOperationalAnalytics(filters, operator);
    if (!result.ok) {
      setError(result.error || 'Analytics could not be loaded.');
    } else {
      setAnalytics(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [operator]);

  const incidents = analytics?.incident_analytics || {};
  const response = analytics?.response_analytics || {};
  const communication = analytics?.communication_analytics || {};
  const historical = analytics?.historical_analytics || {};
  const hasRows = (incidents.total_reports || 0) > 0 || (incidents.total_incidents || 0) > 0;

  return (
    <div className="space-y-4">
      <section className={PANEL}>
        <div>
          <h2 className="font-display text-lg font-bold text-white">Operational analytics</h2>
          <p className="mt-1 text-xs text-slate-400">
            Aggregated from stored records only. Empty or unsupported values are shown as zero, empty, or unavailable—not estimated.
          </p>
        </div>
        <form onSubmit={load} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs text-slate-300">
            <span>From date</span>
            <input type="date" value={filters.from_date} onChange={(event) => setFilters({ ...filters, from_date: event.target.value })} className={`${INPUT} w-full`} />
          </label>
          <label className="space-y-1 text-xs text-slate-300">
            <span>To date</span>
            <input type="date" value={filters.to_date} onChange={(event) => setFilters({ ...filters, to_date: event.target.value })} className={`${INPUT} w-full`} />
          </label>
          <label className="space-y-1 text-xs text-slate-300">
            <span>Location</span>
            <select value={filters.place} onChange={(event) => setFilters({ ...filters, place: event.target.value })} className={`${INPUT} w-full`}>
              <option value="">All locations</option>
              {places.map((place) => {
                const name = place.place || place.name;
                return name ? <option key={name} value={name}>{name}</option> : null;
              })}
            </select>
          </label>
          <button type="submit" disabled={loading} className="self-end rounded-lg bg-orange-600 hover:bg-orange-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition shadow-sm disabled:opacity-50">
            {loading ? 'Loading…' : 'Apply filters'}
          </button>
        </form>
        {!operator && (
          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <span className="font-semibold">Operator sign-in required:</span> Detailed operational analytics and cross-district trend aggregation require operator authorization.
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
        {analytics && (
          <p className="mt-3 text-[10px] text-slate-500">{analytics.data_source}</p>
        )}
      </section>

      {analytics && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Total reports" value={incidents.total_reports || 0} />
            <Metric label="Incidents" value={incidents.total_incidents || 0} />
            <Metric label="Human-confirmed reports" value={incidents.verified_reports || 0} />
            <Metric label="Unverified / corroborated" value={incidents.unverified_or_corroborated_reports || 0} />
          </section>

          {!hasRows && (
            <p className={`${PANEL} text-sm text-purple-200/70`}>
              No stored incidents or reports match these filters. Metrics remain empty rather than being populated with sample data.
            </p>
          )}

          <section className="grid gap-4 lg:grid-cols-3">
            <CountBars title="Incidents by severity" values={incidents.by_severity} />
            <CountBars title="Incidents by category" values={incidents.by_category} />
            <CountBars title="Incidents by location" values={incidents.by_location} />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Average response time"
              value={response.average_response_minutes == null ? 'Unavailable' : `${response.average_response_minutes} min`}
              detail="Requires stored dispatch and resolution timestamps."
            />
            <Metric label="Resolved incidents" value={response.resolved_incidents || 0} />
            <Metric label="Active incidents" value={response.active_incidents || 0} />
            <Metric label="Pending assignments" value={response.pending_assignments || 0} />
            <Metric label="Resources deployed" value={response.resources_deployed || 0} />
            <Metric label="Resources available" value={response.resources_available || 0} />
            <Metric label="Resources unavailable" value={response.resources_unavailable || 0} />
            <Metric
              label="Resource utilization"
              value={response.resource_utilization_percent == null ? 'Unavailable' : `${response.resource_utilization_percent}%`}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <CountBars title="Reports by language" values={communication.reports_by_language} />
            <CountBars title="Voice vs text reports" values={communication.voice_vs_text} />
          </section>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Transcriptions completed" value={communication.transcription_successes || 0} />
            <Metric label="Transcriptions failed" value={communication.transcription_failures || 0} />
            <Metric label="Alerts generated" value={communication.alert_history?.total || 0} />
            <Metric label="Alerts by status" value={Object.entries(communication.alert_history?.by_status || {}).map(([key, count]) => `${key}: ${count}`).join(' · ') || 'None'} />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <CountBars title="Historical report volume by day" values={historical.reports_by_day} />
            <CountBars title="Historical incident distribution" values={historical.incidents_by_location} />
          </section>
          <SeverityTrend values={historical.severity_by_day} />
        </>
      )}
    </div>
  );
}
