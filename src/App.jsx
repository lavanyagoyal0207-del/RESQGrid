import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  checkBackendHealth,
  fetchIncidentsData,
  postFieldReport,
  postVoiceReport,
  registerCitizen,
  loginCitizen,
  verifyOperatorCredentials,
  verifyReport,
  confirmIncident,
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
import IncomingReportsQueue from './components/IncomingReportsQueue';
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
  const [accessPanelTab, setAccessPanelTab] = useState('citizen');
  const [evidenceTab, setEvidenceTab] = useState('incidents');
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);

  const [apiMode, setApiMode] = useState('connecting');
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [apiError, setApiError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  // In-memory authentication state only: no plaintext passwords or credentials in browser storage
  const [operatorCredentials, setOperatorCredentials] = useState(null);
  const [citizenUser, setCitizenUser] = useState(null);
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [isApprovingBrief, setIsApprovingBrief] = useState(false);
  const [toastBanner, setToastBanner] = useState(null);
  const dashboardRequestInFlight = useRef(false);
  const healthCheckInFlight = useRef(false);
  const knownReportIds = useRef(null);

  // Defensive cleanup: purge any legacy credentials from browser storage on mount
  useEffect(() => {
    try {
      sessionStorage.removeItem('resqgrid_citizen_user');
      sessionStorage.removeItem('resqgrid_operator_creds');
      localStorage.removeItem('resqgrid_citizen_user');
      localStorage.removeItem('resqgrid_operator_creds');
    } catch {
      // Ignore errors in environments where web storage is restricted
    }
  }, []);

  const triggerToast = (title, detail, tone = 'orange') => {
    setToastBanner({ title, detail, tone });

    setTimeout(() => {
      setToastBanner((prev) =>
        prev?.title === title ? null : prev
      );
    }, 4200);
  };

  const refreshBackendHealth = async () => {
    if (healthCheckInFlight.current) return;
    healthCheckInFlight.current = true;
    try {
      const health = await checkBackendHealth();
      if (health.ok) {
        setApiError('');
        if (!operatorCredentials) {
          setApiMode('online-anonymous');
        }
        return health;
      } else {
        setApiError(health.error || 'Backend is unreachable.');
        if (!operatorCredentials || incidents.length === 0) {
          setApiMode('offline');
        } else {
          setApiMode('snapshot-retained');
        }
        return health;
      }
    } catch (err) {
      setApiError(err.message || 'Backend health check failed.');
      if (!operatorCredentials || incidents.length === 0) {
        setApiMode('offline');
      } else {
        setApiMode('snapshot-retained');
      }
      return { ok: false, error: err.message };
    } finally {
      healthCheckInFlight.current = false;
    }
  };

  const refreshDashboardData = async (
    manual = false,
    credentials = operatorCredentials
  ) => {
    // If not authenticated as operator, check health instead of requesting protected /incidents
    if (!credentials?.username || !credentials?.password) {
      if (manual) setIsSyncing(true);
      try {
        const health = await refreshBackendHealth();
        return { source: health?.ok ? 'online-anonymous' : 'offline', health };
      } finally {
        if (manual) setIsSyncing(false);
      }
    }

    if (dashboardRequestInFlight.current) return { source: 'busy' };
    dashboardRequestInFlight.current = true;
    if (manual) setIsSyncing(true);
    try {
      const snapshot = await fetchIncidentsData(credentials);
      if (snapshot.source === 'unauthorized') {
        setApiError(snapshot.error || 'Operator credentials are required for operational data.');
        if (incidents.length > 0) {
          setApiMode('snapshot-retained');
        } else {
          setApiMode('online-anonymous');
        }
        return snapshot;
      }

      if (snapshot.source !== 'flask-api') {
        setApiError(snapshot.error || 'Backend is unavailable.');
        if (incidents.length > 0) {
          setApiMode('snapshot-retained');
        } else {
          setApiMode('offline');
        }
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
      if (incidents.length > 0) {
        setApiMode('snapshot-retained');
      } else {
        setApiMode('offline');
      }
      return { source: 'unavailable', error: error.message };
    } finally {
      dashboardRequestInFlight.current = false;
      if (manual) setIsSyncing(false);
    }
  };

  const syncWithFlaskApi = async () => {
    if (!operatorCredentials) {
      if (healthCheckInFlight.current) return;
      setIsSyncing(true);
      try {
        const health = await refreshBackendHealth();
        if (health?.ok) {
          triggerToast(
            'API Online',
            'Backend is healthy and responding. Sign in as an operator to view live incidents.',
            'emerald'
          );
        } else {
          triggerToast(
            'API Offline',
            'Backend health check failed. Could not reach Flask service.',
            'orange'
          );
        }
      } catch (err) {
        setApiMode('offline');
        setApiError(err.message);
        triggerToast('API Offline', 'Backend health check failed.', 'orange');
      } finally {
        setIsSyncing(false);
      }
      return;
    }

    const result = await refreshDashboardData(true, operatorCredentials);
    if (result.source === 'flask-api') {
      triggerToast(
        'Dashboard Refreshed',
        'Incident, report, resource, and risk data were loaded from Flask.',
        'emerald'
      );
    } else if (result.source === 'unauthorized') {
      triggerToast(
        'Authentication Required',
        result.error || 'Operator credentials expired or invalid.',
        'orange'
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
    const poll = async () => {
      if (!active || document.visibilityState !== 'visible') return;
      if (operatorCredentials) {
        await refreshDashboardData(false, operatorCredentials);
      } else {
        await refreshBackendHealth();
      }
    };
    poll();
    const intervalMs = operatorCredentials ? 15000 : 30000;
    const timer = window.setInterval(poll, intervalMs);
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
  const hasOperationalData =
    (apiMode === 'flask-api' || apiMode === 'snapshot-retained') &&
    Boolean(operatorCredentials) &&
    (incidents.length > 0 || reports.length > 0);

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

  const handleCitizenRegister = async (userData) => {
    const result = await registerCitizen(userData);
    if (!result.ok) {
      triggerToast('Registration Failed', result.error, 'red');
      return result;
    }
    const citizenObj = {
      ...result.data.user,
      username: userData.email,
      password: userData.password,
    };
    // Kept in React memory only for active tab session
    setCitizenUser(citizenObj);
    triggerToast(
      'Registration Successful',
      `Welcome, ${result.data.user.name}! Your citizen account is ready.`,
      'emerald'
    );
    setActiveView('submit-page');
    return result;
  };

  const handleCitizenLogin = async (credentials) => {
    const result = await loginCitizen(credentials);
    if (!result.ok) {
      triggerToast('Citizen Sign-in Failed', result.error, 'red');
      return result;
    }
    const citizenObj = {
      ...result.data.user,
      username: credentials.email || credentials.username || credentials.identifier,
      password: credentials.password,
    };
    // Kept in React memory only for active tab session
    setCitizenUser(citizenObj);
    triggerToast(
      'Citizen Signed In',
      `Welcome back, ${result.data.user.name}.`,
      'emerald'
    );
    setActiveView('submit-page');
    return result;
  };

  const handleCitizenLogout = () => {
    setCitizenUser(null);
    try {
      sessionStorage.removeItem('resqgrid_citizen_user');
      localStorage.removeItem('resqgrid_citizen_user');
    } catch {
      // Ignore
    }
    triggerToast('Signed Out', 'You have been signed out of your citizen account.', 'slate');
  };

  const handleOpenOperatorLogin = () => {
    setAccessPanelTab('operator');
    setActiveView('control-room');
  };

  const handleOpenCitizenLogin = () => {
    setAccessPanelTab('citizen');
    setActiveView('control-room');
  };

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
    // Kept in React memory only for active tab session
    setOperatorCredentials(authenticatedCredentials);
    setAccessPanelTab('operator');
    await refreshDashboardData(false, authenticatedCredentials);
    setActiveView('control-room');
    triggerToast(
      'Operator Signed In',
      `Authenticated as ${result.data.operator} (${authenticatedCredentials.role}).`,
      'emerald'
    );
    return result;
  };

  const handleOperatorLogout = () => {
    setOperatorCredentials(null);
    try {
      sessionStorage.removeItem('resqgrid_operator_creds');
      localStorage.removeItem('resqgrid_operator_creds');
    } catch {
      // Ignore
    }
    setIncidents([]);
    setReports([]);
    setPlaces(mockData.places || []);
    setResources([]);
    setBrief(null);
    setRiskAssessment(null);
    setSelectedIncidentId(null);
    setIncomingReportIds([]);
    knownReportIds.current = null;
    setLastSyncAt(null);
    setApiMode('online-anonymous');
    setApiError('');
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

  const handleConfirmIncident = async (incidentId) => {
    if (!requireOperator()) return { ok: false };
    setIsSubmittingAction(true);
    try {
      const result = await confirmIncident(incidentId, operatorCredentials);
      if (!result.ok) {
        triggerToast('Incident Confirmation Failed', result.error, 'red');
        return result;
      }
      await refreshDashboardData();
      triggerToast('Incident Confirmed', `Incident ${incidentId} confirmed by operator.`, 'emerald');
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
    if (!citizenUser) {
      triggerToast(
        'Authentication Required',
        'Citizen sign-in is required to submit an emergency report.',
        'orange'
      );
      return {
        ok: false,
        error: 'Citizen sign-in is required to submit an emergency report.',
      };
    }

    const res = await postFieldReport(
      {
        original_text,
        place,
        type,
        severity,
        source,
        idempotency_key,
      },
      citizenUser
    );

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

    // Immediately update local state so the saved report is visible
    setReports((prev) => [savedReport, ...prev.filter((r) => r.report_id !== savedReport.report_id)]);
    if (res.data?.incident) {
      const savedInc = res.data.incident;
      setIncidents((prev) => {
        const exists = prev.some((i) => i.incident_id === savedInc.incident_id);
        if (exists) {
          return prev.map((i) => (i.incident_id === savedInc.incident_id ? savedInc : i));
        }
        return [savedInc, ...prev];
      });
    }

    // Refresh dashboard if operator credentials are present
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
    if (!citizenUser) {
      triggerToast(
        'Authentication Required',
        'Citizen sign-in is required to submit a voice emergency report.',
        'orange'
      );
      return {
        ok: false,
        error: 'Citizen sign-in is required to submit a voice emergency report.',
      };
    }

    const res = await postVoiceReport(audioFile, metadata, citizenUser);

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

    setReports((prev) => [savedReport, ...prev.filter((r) => r.report_id !== savedReport.report_id)]);

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
      onConfirmIncident={handleConfirmIncident}
      onLoadReportAudio={handleLoadReportAudio}
      onResponseStatusChange={handleResponseStatusChange}
      isSubmittingAction={isSubmittingAction}
    />
  );

  const renderOperatorAccess = () => (
    <OperatorAccessPanel
      operator={operatorCredentials?.username}
      role={operatorCredentials?.role}
      citizenUser={citizenUser}
      defaultTab={operatorCredentials ? 'operator' : accessPanelTab}
      defaultCitizenMode="login"
      onLogin={handleOperatorLogin}
      onLogout={handleOperatorLogout}
      onCitizenRegister={handleCitizenRegister}
      onCitizenLogin={handleCitizenLogin}
      onCitizenLogout={handleCitizenLogout}
      onOpenSubmitReport={() => setActiveView('submit-page')}
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
          onOpenOperatorLogin={handleOpenOperatorLogin}
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
            citizenUser={citizenUser}
            onCitizenLogout={handleCitizenLogout}
            onOpenOperatorLogin={handleOpenOperatorLogin}
            onOpenCitizenLogin={handleOpenCitizenLogin}
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
                citizenUser={citizenUser}
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
                incidents={incidents}
                reports={reports}
                resources={resources}
                places={places}
                brief={brief}
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
                    {apiMode === 'flask-api'
                      ? (lastSyncAt
                          ? `Live operational data · Updated ${new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                          : 'Live operational data')
                      : apiMode === 'snapshot-retained'
                        ? (lastSyncAt
                            ? `Last successful snapshot · Sync ${new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            : 'Last successful snapshot')
                        : apiMode === 'online-anonymous'
                          ? 'API Online · Sign in for operational data'
                          : apiMode === 'connecting'
                            ? 'Connecting…'
                            : 'API Offline'}
                  </span>
                  {incomingReportIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView('evidence');
                        setEvidenceTab('reports');
                      }}
                      className="rq-new-reports cursor-pointer hover:underline border-0 bg-transparent p-0 text-inherit font-inherit"
                    >
                      {incomingReportIds.length} new reports
                    </button>
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
                    <article
                      className="rq-metric-card cursor-pointer hover:border-[#FF6B35]/50 transition"
                      onClick={() => {
                        setActiveView('evidence');
                        setEvidenceTab('reports');
                      }}
                      title="Click to open verification queue"
                    >
                      <span className="rq-metric-icon amber"><ShieldCheck size={17} /></span>
                      <span className="rq-metric-label">Unverified reports</span>
                      <strong>{hasOperationalData ? awaitingReviewCount : '—'}</strong>
                      <small>Click to open verification queue</small>
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
                          riskAssessment={riskAssessment}
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
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1a0b2e]/90 p-2 rounded-xl border border-purple-400/20">
                    <div className="flex items-center gap-1.5 rounded-lg bg-[#120721] p-1 border border-purple-300/20">
                      <button
                        type="button"
                        onClick={() => setEvidenceTab('incidents')}
                        className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                          evidenceTab === 'incidents'
                            ? 'bg-[#FF6B35] text-white shadow'
                            : 'text-purple-200/75 hover:text-white hover:bg-[#2D1B4E]/60'
                        }`}
                      >
                        Incident Queue ({filteredIncidents.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setEvidenceTab('reports')}
                        className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5 ${
                          evidenceTab === 'reports'
                            ? 'bg-[#FF6B35] text-white shadow'
                            : 'text-purple-200/75 hover:text-white hover:bg-[#2D1B4E]/60'
                        }`}
                      >
                        <span>Incoming Reports & Verification ({reports.length})</span>
                        {awaitingReviewCount > 0 && (
                          <span className="rounded-full bg-red-500/90 text-white text-[10px] px-1.5 py-0.2">
                            {awaitingReviewCount}
                          </span>
                        )}
                      </button>
                    </div>

                    <div className="text-xs text-purple-300/70 hidden sm:block">
                      {evidenceTab === 'incidents'
                        ? 'Select an incident to review clustered reports, assign resources, and confirm.'
                        : 'Review citizen submissions, inspect AI grouping rationale, and corroborate.'}
                    </div>
                  </div>

                  {evidenceTab === 'incidents' ? (
                    <section className="rq-evidence-grid">
                      <div className="rq-feed-frame rq-evidence-queue">
                        <div className="rq-section-heading">
                          <div><p className="rq-eyebrow">INCIDENT QUEUE</p><h2>Select an incident</h2></div>
                        </div>
                        {renderIncidentList()}
                      </div>
                      <div>{renderIncidentDetail()}</div>
                    </section>
                  ) : (
                    <IncomingReportsQueue
                      reports={reports}
                      incidents={incidents}
                      operator={operatorCanMutate ? operatorCredentials.username : null}
                      onVerifyReport={handleVerifyReport}
                      onConfirmIncident={handleConfirmIncident}
                      onSelectIncident={(id) => {
                        setSelectedIncidentId(id);
                        setEvidenceTab('incidents');
                      }}
                      onLoadReportAudio={handleLoadReportAudio}
                      isSubmittingAction={isSubmittingAction}
                    />
                  )}
                </div>
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
        citizenUser={citizenUser}
        onSubmitReport={handleSubmitReport}
        onSubmitVoiceReport={handleSubmitVoiceReport}
      />
    </div>
  );
}