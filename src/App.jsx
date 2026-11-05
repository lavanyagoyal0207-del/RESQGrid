import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchIncidentsData,
  postFieldReport,
  postVoiceReport,
  verifyOperatorCredentials,
  verifyReport,
  generateSituationBrief,
  approveSituationBrief,
  fetchReportAudio,
  createResource,
  updateResource,
  assignResource,
  updateIncidentResponse,
} from './services/api';

import FogOverlay from './components/FogOverlay';
import TopBar from './components/TopBar';
import DarkMap from './components/DarkMap';
import IncidentList from './components/IncidentList';
import IncidentDetail from './components/IncidentDetail';
import BriefPanel from './components/BriefPanel';
import SubmitReportModal from './components/SubmitReportModal';
import OperatorAccessPanel from './components/OperatorAccessPanel';
import ResourceManagementPanel from './components/ResourceManagementPanel';
import OperationsOverview from './components/OperationsOverview';
import PhaseFourDashboard from './components/PhaseFourDashboard';
import LandingPage from './components/LandingPage';
import mockData from './data/mockData.json';
import { AlertTriangle, Activity, PackageCheck, ShieldCheck } from 'lucide-react';

function OverviewSkeleton() {
  return (
    <div className="rq-overview-skeleton" role="status" aria-label="Loading control room data" aria-busy="true">
      <span className="sr-only">Loading operational records…</span>
      <div className="rq-skeleton-metrics" aria-hidden="true">
        {[0, 1, 2, 3].map((item) => (
          <div className="rq-skeleton rq-skeleton-metric" key={item} />
        ))}
      </div>
      <div className="rq-skeleton-content" aria-hidden="true">
        <div className="rq-skeleton rq-skeleton-map" />
        <div className="rq-skeleton rq-skeleton-feed" />
      </div>
    </div>
  );
}

export default function App() {
  const [incidents, setIncidents] = useState([]);
  const [reports, setReports] = useState([]);
  const [places, setPlaces] = useState(mockData.places || []);
  const [resources, setResources] = useState([]);
  const [riskAssessment, setRiskAssessment] = useState(null);
  const [incomingReportIds, setIncomingReportIds] = useState([]);

  const [brief, setBrief] = useState(null);

  const [selectedIncidentId, setSelectedIncidentId] = useState(null);
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [mapTypeFilter, setMapTypeFilter] = useState('ALL');
  const [mapVerificationFilter, setMapVerificationFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeView, setActiveView] = useState('home');
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);

  const [apiMode, setApiMode] = useState('connecting');
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [apiError, setApiError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [operatorCredentials, setOperatorCredentials] = useState(null);
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [isApprovingBrief, setIsApprovingBrief] = useState(false);
  const [toastBanner, setToastBanner] = useState(null);
  const dashboardRequestInFlight = useRef(false);
  const knownReportIds = useRef(null);

  const triggerToast = (title, detail, tone = 'orange') => {
    setToastBanner({ title, detail, tone });

    setTimeout(() => {
      setToastBanner((prev) =>
        prev?.title === title ? null : prev
      );
    }, 4200);
  };

  const refreshDashboardData = async (
    manual = false,
    credentials = operatorCredentials
  ) => {
    if (dashboardRequestInFlight.current) return { source: 'busy' };
    dashboardRequestInFlight.current = true;
    if (manual) setIsSyncing(true);
    try {
      const snapshot = await fetchIncidentsData(credentials);
      if (snapshot.source !== 'flask-api') {
        setApiError(snapshot.error || 'Backend is unavailable.');
        setApiMode('offline');
        return snapshot;
      }

      const reportIds = snapshot.reports.map((report) => report.report_id);
      if (knownReportIds.current === null) {
        knownReportIds.current = new Set(reportIds);
      } else {
        const newIds = reportIds.filter(
          (reportId) => !knownReportIds.current.has(reportId)
        );
        if (newIds.length) {
          setIncomingReportIds((current) =>
            [...new Set([...newIds, ...current])].slice(0, 20)
          );
        }
        reportIds.forEach((reportId) => knownReportIds.current.add(reportId));
      }

      setIncidents(snapshot.incidents);
      setReports(snapshot.reports);
      setResources(snapshot.resources);
      if (snapshot.places.length) setPlaces(snapshot.places);
      setBrief(snapshot.brief);
      setRiskAssessment(snapshot.riskAssessment);
      setApiMode('flask-api');
      setApiError('');
      setLastSyncAt(new Date().toISOString());
      return snapshot;
    } catch (error) {
      setApiError(error.message || 'Backend is unavailable.');
      setApiMode('offline');
      return { source: 'unavailable', error: error.message };
    } finally {
      dashboardRequestInFlight.current = false;
      if (manual) setIsSyncing(false);
    }
  };

  const syncWithFlaskApi = async () => {
    const result = await refreshDashboardData(true);
    if (result.source === 'flask-api') {
      triggerToast(
        'Dashboard Refreshed',
        'Incident, report, resource, and risk data were loaded from Flask.',
        'emerald'
      );
    } else {
      triggerToast(
        'Backend Unavailable',
        'No live refresh completed. Previously loaded records are retained, if available.',
        'orange'
      );
    }
  };

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active && document.visibilityState === 'visible') {
        refreshDashboardData();
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [operatorCredentials]);

  // Active incidents (excluding rejected incidents)
  const activeIncidents = useMemo(() => {
    return incidents
      .filter((incident) => incident.status !== 'Rejected')
      .sort(
        (a, b) =>
          new Date(b.updated_at) - new Date(a.updated_at)
      );
  }, [incidents]);

  // Filter incidents
  const filteredIncidents = useMemo(() => {
    return activeIncidents.filter((inc) => {
      if (
        severityFilter !== 'ALL' &&
        inc.severity !== severityFilter
      ) {
        return false;
      }

      if (statusFilter === 'Awaiting') {
        if (inc.status === 'Confirmed') return false;
      } else if (
        statusFilter !== 'ALL' &&
        inc.status !== statusFilter
      ) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();

        const matchPlace = inc.place.toLowerCase().includes(q);
        const matchType = inc.type.toLowerCase().includes(q);
        const matchId = inc.incident_id.toLowerCase().includes(q);

        if (!matchPlace && !matchType && !matchId) {
          return false;
        }
      }

      return true;
    });
  }, [
    activeIncidents,
    severityFilter,
    statusFilter,
    searchQuery,
  ]);

  // Dashboard counters
  const incidentCount = activeIncidents.length;
  const hasOperationalData = apiMode === 'flask-api' || Boolean(lastSyncAt);

  const reportCount = reports.length;
  const awaitingReviewCount = reports.filter(
    (report) => !['Confirmed', 'Rejected'].includes(
      report.verification_status || 'Unverified'
    )
  ).length;

  // Selected incident
  const selectedIncident = useMemo(
    () =>
      activeIncidents.find(
        (incident) =>
          incident.incident_id === selectedIncidentId
      ) ||
      activeIncidents[0] ||
      null,
    [activeIncidents, selectedIncidentId]
  );
  const operatorCanMutate =
    Boolean(operatorCredentials) && operatorCredentials.role !== 'viewer';

  const handleOperatorLogin = async (credentials) => {
    const result = await verifyOperatorCredentials(credentials);
    if (!result.ok) {
      triggerToast('Operator Sign-in Failed', result.error, 'red');
      return result;
    }

    const authenticatedCredentials = {
      ...credentials,
      role: result.data.role || 'operator',
    };
    setOperatorCredentials(authenticatedCredentials);
    await refreshDashboardData(false, authenticatedCredentials);
    triggerToast(
      'Operator Signed In',
      `Authenticated as ${result.data.operator} (${authenticatedCredentials.role}).`,
      'emerald'
    );
    return result;
  };

  const handleOperatorLogout = () => {
    setOperatorCredentials(null);
    setIncidents([]);
    setReports([]);
    setPlaces(mockData.places || []);
    setResources([]);
    setBrief(null);
    setRiskAssessment(null);
    setIncomingReportIds([]);
    knownReportIds.current = null;
    setApiMode('connecting');
    setApiError('Sign in as an authorized viewer or operator to load control-room data.');
  };

  const handleVerifyReport = async (reportId, status) => {
    if (!operatorCanMutate) {
      return { ok: false, error: 'Sign in as an authorized operator first.' };
    }

    setIsSubmittingAction(true);
    try {
      const result = await verifyReport(
        reportId,
        status,
        operatorCredentials
      );
      if (!result.ok) {
        triggerToast('Report Verification Failed', result.error, 'red');
        return result;
      }

      const snapshot = await refreshDashboardData();
      if (snapshot.source !== 'flask-api') {
        setReports((current) =>
          current.map((report) =>
            report.report_id === reportId
              ? result.data.report
              : report
          )
        );
      }

      triggerToast(
        `Report ${status}`,
        `${reportId} ${status.toLowerCase()} by ${operatorCredentials.username}.`,
        status === 'Confirmed' ? 'emerald' : 'red'
      );
      return result;
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleGenerateBrief = async () => {
    if (!operatorCredentials || operatorCredentials.role === 'viewer') {
      triggerToast(
        'Generation Requires Sign-in',
        'An operator role is required to generate a situation brief.',
        'red'
      );
      return;
    }

    setIsGeneratingBrief(true);
    try {
      const result = await generateSituationBrief(operatorCredentials);
      if (!result.ok) {
        triggerToast('Brief Generation Failed', result.error, 'red');
        return;
      }

      setBrief(result.data);
      triggerToast(
        'Draft Situation Brief Generated',
        'The new summary is a draft and requires human approval.',
        'orange'
      );
    } finally {
      setIsGeneratingBrief(false);
    }
  };

  const handleApproveBrief = async () => {
    if (!operatorCanMutate) {
      triggerToast('Approval Requires Sign-in', 'Sign in as an authorized operator.', 'red');
      return;
    }

    setIsApprovingBrief(true);
    try {
      const result = await approveSituationBrief(operatorCredentials);
      if (!result.ok) {
        triggerToast('Brief Approval Failed', result.error, 'red');
        return;
      }

      setBrief(result.data);
      triggerToast(
        'Situation Brief Approved',
        `Approved by ${result.data.approved_by}.`,
        'emerald'
      );
    } finally {
      setIsApprovingBrief(false);
    }
  };

  const handleLoadReportAudio = (reportId) =>
    fetchReportAudio(reportId, operatorCredentials);

  const requireOperator = () => {
    if (operatorCredentials) return true;
    triggerToast(
      'Operator Sign-in Required',
      'Sign in before managing resources or response assignments.',
      'red'
    );
    return false;
  };

  const handleCreateResource = async (payload) => {
    if (!requireOperator()) return { ok: false };
    setIsSubmittingAction(true);
    try {
      const result = await createResource(payload, operatorCredentials);
      if (!result.ok) {
        triggerToast('Resource Creation Failed', result.error, 'red');
        return result;
      }
      await refreshDashboardData();
      triggerToast('Resource Added', `${payload.name} saved to the resource registry.`, 'emerald');
      return result;
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleUpdateResource = async (resourceId, payload) => {
    if (!requireOperator()) return { ok: false };
    setIsSubmittingAction(true);
    try {
      const result = await updateResource(resourceId, payload, operatorCredentials);
      if (!result.ok) {
        triggerToast('Resource Update Failed', result.error, 'red');
        return result;
      }
      await refreshDashboardData();
      triggerToast('Resource Updated', 'The resource change was saved.', 'emerald');
      return result;
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleAssignResource = async (incidentId, payload) => {
    if (!requireOperator()) return { ok: false };
    setIsSubmittingAction(true);
    try {
      const result = await assignResource(
        incidentId,
        payload,
        operatorCredentials
      );
      if (!result.ok) {
        triggerToast('Assignment Failed', result.error, 'red');
        return result;
      }
      await refreshDashboardData();
      triggerToast(
        'Resource Assigned',
        `${payload.quantity} unit(s) assigned to ${incidentId}.`,
        'emerald'
      );
      return result;
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleResponseStatusChange = async (incidentId, status, notes) => {
    if (!requireOperator()) return { ok: false };
    setIsSubmittingAction(true);
    try {
      const result = await updateIncidentResponse(
        incidentId,
        { status, notes },
        operatorCredentials
      );
      if (!result.ok) {
        triggerToast('Response Update Failed', result.error, 'red');
        return result;
      }
      await refreshDashboardData();
      triggerToast('Response Progress Updated', `Status is now ${status}.`, 'emerald');
      return result;
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Submit report through Flask API
  const handleSubmitReport = async ({
    original_text,
    place,
    type,
    severity,
    source,
    idempotency_key,
  }) => {
    const res = await postFieldReport({
      original_text,
      place,
      type,
      severity,
      source,
      idempotency_key,
    });

    // Stop if backend submission failed
    if (!res.ok) {
      triggerToast(
        'Report Submission Failed',
        res.error || 'Could not save report to the backend.',
        'red'
      );

      return res;
    }

    // Get the actual saved report ID
    const savedReport = res.data.report;

    if (!savedReport) {
      triggerToast(
        'Submission Error',
        'Backend response did not contain the saved report.',
        'red'
      );

      return {
        ok: false,
        error: 'Saved report missing from backend response.',
      };
    }

    // Only refresh dashboard if operator credentials are present
    if (operatorCredentials) {
      const snapshot = await refreshDashboardData();
      if (snapshot.source !== 'flask-api') {
        triggerToast(
          'Report Saved',
          `Report ${savedReport.report_id} was saved, but dashboard refresh failed.`,
          'orange'
        );

        return res;
      }
    }

    // Update dashboard with actual backend data
    triggerToast(
      'Report Successfully Submitted',
      `Reference ID ${savedReport.report_id} queued for operator review.`,
      'emerald'
    );

    return res;
  };

  const handleSubmitVoiceReport = async (audioFile, metadata) => {
    const res = await postVoiceReport(audioFile, metadata);

    if (!res.ok) {
      triggerToast(
        'Voice Report Upload Failed',
        res.error || 'Could not save the audio report to the backend.',
        'red'
      );
      return res;
    }

    const savedReport = res.data?.report;

    if (!savedReport) {
      triggerToast(
        'Voice Report Response Error',
        'The backend did not return the saved voice report.',
        'red'
      );
      return {
        ...res,
        ok: false,
        error: 'Saved voice report missing from backend response.',
      };
    }

    if (operatorCredentials) {
      const snapshot = await refreshDashboardData();

      const transcriptionCompleted =
        savedReport.transcription_status === 'Completed';
      const dashboardRefreshed = snapshot.source === 'flask-api';

      triggerToast(
        transcriptionCompleted
          ? 'Voice Report Transcribed'
          : 'Voice Report Saved for Review',
        `${savedReport.report_id}: ${
          res.data.message || 'Audio and report metadata saved.'
        }${dashboardRefreshed ? '' : ' Dashboard refresh was unavailable.'}`,
        transcriptionCompleted && dashboardRefreshed ? 'emerald' : 'orange'
      );
    } else {
      triggerToast(
        'Voice Report Received',
        `Reference ID ${savedReport.report_id} queued for operator review.`,
        'emerald'
      );
    }

    return res;
  };

  const criticalIncidentCount = activeIncidents.filter(
    (incident) => incident.severity === 'Critical'
  ).length;
  const deployedResourceCount = resources.reduce(
    (total, resource) => total + (Number(resource.deployed_quantity) || 0),
    0
  );
  const responseInProgressCount = activeIncidents.filter((incident) =>
    ['Team Dispatched', 'Response in Progress'].includes(incident.response_status)
  ).length;
  const severityDistribution = ['Critical', 'High', 'Medium', 'Low'].map((severity) => ({
    severity,
    count: activeIncidents.filter((incident) => incident.severity === severity).length,
  }));

  const renderIncidentList = (openDetailsOnSelect = false) => (
    <IncidentList
      incidents={filteredIncidents}
      selectedIncidentId={selectedIncident?.incident_id}
      onSelectIncident={(id) => {
        setSelectedIncidentId(id);
        if (openDetailsOnSelect) setActiveView('evidence');
      }}
      statusFilter={statusFilter}
      onStatusFilterChange={setStatusFilter}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      isDataAvailable={hasOperationalData}
    />
  );

  const renderIncidentDetail = () => (
    <IncidentDetail
      incident={selectedIncident}
      reports={reports}
      operator={operatorCanMutate ? operatorCredentials.username : null}
      onVerifyReport={handleVerifyReport}
      onLoadReportAudio={handleLoadReportAudio}
      onResponseStatusChange={handleResponseStatusChange}
      isSubmittingAction={isSubmittingAction}
    />
  );

  const renderOperatorAccess = () => operatorCredentials ? null : (
    <OperatorAccessPanel
      onLogin={handleOperatorLogin}
      onLogout={handleOperatorLogout}
    />
  );

  return (
    <div className={`rq-app-shell ${activeView === 'home' ? 'is-home' : ''}`}>
      <FogOverlay isOperational={activeView !== 'home'} />

      {activeView === 'home' ? (
        <LandingPage
          apiMode={apiMode}
          onReport={() => setActiveView('submit-page')}
          onOpenControlRoom={() => setActiveView('control-room')}
        />
      ) : (
        <>
          <TopBar
            incidentCount={hasOperationalData ? incidentCount : null}
            reportCount={hasOperationalData ? reportCount : null}
            awaitingReviewCount={hasOperationalData ? awaitingReviewCount : null}
            activeView={activeView}
            onSelectView={setActiveView}
            onOpenSubmitModal={() => setIsSubmitModalOpen(true)}
            apiMode={apiMode}
            lastSyncAt={lastSyncAt}
            apiError={apiError}
            onSyncApi={syncWithFlaskApi}
            isSyncing={isSyncing}
            operator={operatorCredentials?.username}
            role={operatorCredentials?.role}
            onLogout={handleOperatorLogout}
          />

          {toastBanner && (
            <div className={`rq-toast ${toastBanner.tone || 'orange'}`} role="status">
              <span className="rq-toast-mark"><Activity size={17} /></span>
              <span>
                <strong>{toastBanner.title}</strong>
                <small>{toastBanner.detail}</small>
              </span>
            </div>
          )}

          {activeView === 'submit-page' ? (
            <main className="rq-page rq-submit-page">
              <div className="rq-page-heading">
                <div>
                  <p className="rq-eyebrow">COMMUNITY INTAKE</p>
                  <h1>Share what you’re seeing.</h1>
                  <p className="rq-page-description">Reports are preserved for review by authorized emergency operators.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveView('control-room')}
                  className="button-secondary"
                >
                  Return to overview
                </button>
              </div>
              <SubmitReportModal
                isOpen={true}
                isStandalonePage={true}
                places={places}
                onSubmitReport={handleSubmitReport}
                onSubmitVoiceReport={handleSubmitVoiceReport}
                onClose={() => setActiveView('control-room')}
              />
            </main>
          ) : activeView === 'phase4' ? (
            <>
              <div className="rq-page rq-access-wrap">{renderOperatorAccess()}</div>
              <PhaseFourDashboard
                apiMode={apiMode}
                incidents={apiMode === 'flask-api' ? incidents : []}
                reports={apiMode === 'flask-api' ? reports : []}
                resources={apiMode === 'flask-api' ? resources : []}
                places={apiMode === 'flask-api' ? places : []}
                brief={apiMode === 'flask-api' ? brief : null}
                setBrief={setBrief}
                operator={operatorCredentials}
                onGenerateBrief={handleGenerateBrief}
                onApproveBrief={handleApproveBrief}
                isGeneratingBrief={isGeneratingBrief}
                isApprovingBrief={isApprovingBrief}
                onReportUpdated={(updatedReport) => setReports((current) =>
                  current.map((report) =>
                    report.report_id === updatedReport.report_id
                      ? updatedReport
                      : report
                  )
                )}
              />
            </>
          ) : (
            <main className="rq-page">
              <div className="rq-page-heading">
                <div>
                  <p className="rq-eyebrow">
                    {activeView === 'control-room' ? 'OPERATIONS OVERVIEW' : activeView === 'evidence' ? 'REVIEW WORKSPACE' : 'FIELD COORDINATION'}
                  </p>
                  <h1>
                    {activeView === 'control-room' ? 'Situation overview' : activeView === 'evidence' ? 'Evidence & verification' : 'Response operations'}
                  </h1>
                  <p className="rq-page-description">
                    {activeView === 'control-room'
                      ? 'A shared, evidence-led view of reports and incidents.'
                      : activeView === 'evidence'
                        ? 'Review individual reports, recordings, and incident context.'
                        : 'Coordinate resources and review operational recommendations.'}
                  </p>
                </div>
                <div className="rq-sync-summary" role="status" title={apiError || undefined}>
                  <span className={`rq-sync-dot ${apiMode === 'flask-api' ? 'is-live' : ''}`} />
                  <span>
                    {apiMode === 'offline'
                      ? lastSyncAt
                        ? `Offline · last sync ${new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : 'API unavailable · no live data loaded'
                      : lastSyncAt
                        ? `Updated ${new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : 'Waiting for first sync'}
                  </span>
                  {incomingReportIds.length > 0 && (
                    <span className="rq-new-reports">{incomingReportIds.length} new reports</span>
                  )}
                </div>
              </div>

              {renderOperatorAccess()}

              {activeView === 'control-room' && (
                apiMode === 'connecting' ? (
                  <OverviewSkeleton />
                ) : (
                <>
                  <section className="rq-metrics-grid" aria-label="Operational summary">
                    <article className="rq-metric-card">
                      <span className="rq-metric-icon violet"><Activity size={17} /></span>
                      <span className="rq-metric-label">Active incidents</span>
                      <strong>{hasOperationalData ? incidentCount : '—'}</strong>
                      <small>Across monitored locations</small>
                    </article>
                    <article className="rq-metric-card">
                      <span className="rq-metric-icon critical"><AlertTriangle size={17} /></span>
                      <span className="rq-metric-label">Critical severity</span>
                      <strong>{hasOperationalData ? criticalIncidentCount : '—'}</strong>
                      <small>Requires operator attention</small>
                    </article>
                    <article className="rq-metric-card">
                      <span className="rq-metric-icon amber"><ShieldCheck size={17} /></span>
                      <span className="rq-metric-label">Unverified reports</span>
                      <strong>{hasOperationalData ? awaitingReviewCount : '—'}</strong>
                      <small>Require human review</small>
                    </article>
                    <article className="rq-metric-card">
                      <span className="rq-metric-icon green"><PackageCheck size={17} /></span>
                      <span className="rq-metric-label">Resources deployed</span>
                      <strong>{hasOperationalData ? deployedResourceCount : '—'}</strong>
                      <small>{hasOperationalData ? `${responseInProgressCount} responses underway` : 'Live status unavailable'}</small>
                    </article>
                  </section>

                  <section className="rq-severity-overview" aria-label="Incident severity distribution">
                    <div className="rq-severity-heading">
                      <div><p className="rq-eyebrow">SEVERITY PROFILE</p><h2>Current incident distribution</h2></div>
                      <span>{hasOperationalData ? 'Stored incident labels' : 'No live records loaded'}</span>
                    </div>
                    <div className="rq-severity-content">
                      <div className="rq-severity-stack" role="img" aria-label={severityDistribution.map(({ severity, count }) => `${severity}: ${count}`).join(', ')}>
                        {severityDistribution.map(({ severity, count }) => (
                          <span
                            key={severity}
                            className={`severity-segment severity-${severity.toLowerCase()}`}
                            style={{ width: `${incidentCount ? (count / incidentCount) * 100 : 0}%` }}
                          />
                        ))}
                      </div>
                      <div className="rq-severity-legend">
                        {severityDistribution.map(({ severity, count }) => (
                          <span key={severity}>
                            <i className={`severity-dot severity-${severity.toLowerCase()}`} />
                            {severity} <strong>{count}</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className="rq-overview-grid">
                    <div className="rq-map-frame">
                      <div className="rq-section-heading">
                        <div><p className="rq-eyebrow">GEOGRAPHIC VIEW</p><h2>Incident map</h2></div>
                        <span className="rq-map-meta">{places.length} configured locations</span>
                      </div>
                      <div className="rq-map-canvas">
                        <DarkMap
                          incidents={activeIncidents}
                          places={places}
                          selectedIncidentId={selectedIncident?.incident_id}
                          onSelectIncident={(id) => {
                            setSelectedIncidentId(id);
                            setActiveView('evidence');
                          }}
                          reports={reports}
                          severityFilter={severityFilter}
                          onSeverityFilterChange={setSeverityFilter}
                          typeFilter={mapTypeFilter}
                          onTypeFilterChange={setMapTypeFilter}
                          verificationFilter={mapVerificationFilter}
                          onVerificationFilterChange={setMapVerificationFilter}
                        />
                      </div>
                    </div>
                    <div className="rq-feed-frame">
                      <div className="rq-section-heading">
                        <div><p className="rq-eyebrow">MONITORING</p><h2>Incident feed</h2></div>
                        <button type="button" className="rq-text-link" onClick={() => setActiveView('evidence')}>
                          Review queue <span aria-hidden="true">→</span>
                        </button>
                      </div>
                      {renderIncidentList(true)}
                    </div>
                  </section>

                </>
                )
              )}

              {activeView === 'evidence' && (
                <section className="rq-evidence-grid">
                  <div className="rq-feed-frame rq-evidence-queue">
                    <div className="rq-section-heading">
                      <div><p className="rq-eyebrow">INCIDENT QUEUE</p><h2>Select an incident</h2></div>
                    </div>
                    {renderIncidentList()}
                  </div>
                  <div>{renderIncidentDetail()}</div>
                </section>
              )}

              {activeView === 'operations' && (
                <>
                  <section className="rq-lower-grid rq-operations-top">
                    <OperationsOverview
                      reports={reports}
                      riskAssessment={riskAssessment}
                      incomingReportIds={incomingReportIds}
                    />
                    <BriefPanel
                      brief={brief}
                      onApproveBrief={handleApproveBrief}
                      onGenerateBrief={handleGenerateBrief}
                      selectedIncident={selectedIncident}
                      operator={operatorCanMutate ? operatorCredentials.username : null}
                      isGenerating={isGeneratingBrief}
                      isApproving={isApprovingBrief}
                    />
                  </section>
                  <ResourceManagementPanel
                    resources={resources}
                    incidents={activeIncidents}
                    selectedIncident={selectedIncident}
                    operator={operatorCanMutate ? operatorCredentials.username : null}
                    onCreateResource={handleCreateResource}
                    onUpdateResource={handleUpdateResource}
                    onAssignResource={handleAssignResource}
                    isSubmitting={isSubmittingAction}
                  />
                </>
              )}
            </main>
          )}
        </>
      )}

      <SubmitReportModal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        places={places}
        onSubmitReport={handleSubmitReport}
        onSubmitVoiceReport={handleSubmitVoiceReport}
      />
    </div>
  );
}