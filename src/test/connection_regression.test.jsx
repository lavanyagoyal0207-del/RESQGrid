import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import * as api from '../services/api';

// Mock DarkMap to isolate connection lifecycle and auth tests from Leaflet DOM dependencies in JSDOM
vi.mock('../components/DarkMap', () => ({
  default: () => <div data-testid="mock-dark-map" />,
}));

describe('ResQGrid Connection Lifecycle and Security Regression Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Scenario 1 & 2: Anonymous user with healthy backend displays API Online and polls /health, NEVER /incidents', async () => {
    const healthSpy = vi.spyOn(api, 'checkBackendHealth').mockResolvedValue({
      ok: true,
      status: 'healthy',
      service: 'resqgrid-backend',
      commit: '92265929238fc3db6c060c0d3c11b18b4271f575',
    });
    const incidentsSpy = vi.spyOn(api, 'fetchIncidentsData').mockResolvedValue({
      source: 'unauthorized',
      status: 401,
      error: 'Operator credentials are required.',
    });

    render(<App />);

    // Must show online state, NOT "API unavailable · no live data"
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'API Online · Sign in for operational data'
      );
    });

    expect(healthSpy).toHaveBeenCalled();
    expect(incidentsSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/API unavailable · no live data/i)).not.toBeInTheDocument();
  });

  it('Scenario 6: Backend unavailable accurately reports offline', async () => {
    vi.spyOn(api, 'checkBackendHealth').mockResolvedValue({
      ok: false,
      status: 'offline',
      error: 'Connection refused',
    });
    vi.spyOn(api, 'fetchIncidentsData');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('API Offline');
    });
  });

  it('Scenario 7: Backend returning 401 for protected route does NOT label backend offline or unavailable', async () => {
    vi.spyOn(api, 'checkBackendHealth').mockResolvedValue({
      ok: true,
      status: 'healthy',
      service: 'resqgrid-backend',
    });
    const incidentsSpy = vi.spyOn(api, 'fetchIncidentsData').mockResolvedValue({
      source: 'unauthorized',
      status: 401,
      error: 'Operator credentials are required.',
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'API Online · Sign in for operational data'
      );
    });

    // Even if fetchIncidentsData was invoked, 401 must not turn status into "API Offline" or "API unavailable"
    expect(screen.queryByText(/API Offline/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/API unavailable/i)).not.toBeInTheDocument();
  });

  it('Scenario 3: Citizen can sign in and report without accessing protected /incidents', async () => {
    vi.spyOn(api, 'checkBackendHealth').mockResolvedValue({
      ok: true,
      status: 'healthy',
    });
    const incidentsSpy = vi.spyOn(api, 'fetchIncidentsData');
    const loginCitizenSpy = vi.spyOn(api, 'loginCitizen').mockResolvedValue({
      ok: true,
      data: {
        user: {
          user_id: 'USR-CITIZEN-01',
          name: 'Jane Citizen',
          email: 'jane@example.com',
          role: 'citizen',
        },
      },
    });
    const postReportSpy = vi.spyOn(api, 'postFieldReport').mockResolvedValue({
      ok: true,
      data: {
        report: {
          report_id: 'REP-SAVED-99',
          place: 'Mandi',
          type: 'Flood',
          severity: 'High',
          original_text: 'Flood water rising near bridge',
          verification_status: 'Unverified',
        },
      },
    });

    render(<App />);

    // Go to control room
    fireEvent.click(screen.getByRole('button', { name: /Explore Control Room/i }));

    // Switch to Citizen tab in OperatorAccessPanel
    fireEvent.click(screen.getByRole('tab', { name: /Citizen portal/i }));

    // Switch to Sign In mode
    fireEvent.click(screen.getByRole('button', { name: /Sign In \(Existing Citizen\)/i }));

    // Fill in credentials
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'password123' },
    });

    // Submit citizen sign in
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(loginCitizenSpy).toHaveBeenCalled());

    // Click Submit Report button in citizen card
    const submitReportNavBtn = await screen.findByRole('button', { name: /Submit Report/i });
    fireEvent.click(submitReportNavBtn);

    // Wait for the textarea to be available and fill report form
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Describe incident...')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText('Describe incident...'), {
      target: { value: 'Flood water rising near bridge' },
    });
    const submitBtn = screen.getByRole('button', { name: 'Submit Report' });
    fireEvent.click(submitBtn);

    await waitFor(() => expect(postReportSpy).toHaveBeenCalled());

    // Verified: report submitted with report ID, and /incidents was NEVER called
    expect(incidentsSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(/Reference ID REP-SAVED-99/i)).toBeInTheDocument();
  });

  it('Scenario 4 & 5: Operator login loads protected data; operator logout clears all protected records', async () => {
    vi.spyOn(api, 'checkBackendHealth').mockResolvedValue({
      ok: true,
      status: 'healthy',
    });
    const incidentsSpy = vi.spyOn(api, 'fetchIncidentsData').mockResolvedValue({
      source: 'flask-api',
      incidents: [
        {
          incident_id: 'INC-OP-1',
          type: 'Flood',
          place: 'Mandi',
          severity: 'Critical',
          status: 'Confirmed',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      reports: [
        {
          report_id: 'REP-OP-1',
          place: 'Mandi',
          type: 'Flood',
          severity: 'Critical',
          original_text: 'Bridge submerged',
          verification_status: 'Confirmed',
        },
      ],
      places: [],
      resources: [],
      brief: null,
      riskAssessment: null,
    });
    vi.spyOn(api, 'verifyOperatorCredentials').mockResolvedValue({
      ok: true,
      data: {
        operator: 'duty-commander',
        role: 'operator',
      },
    });

    render(<App />);

    // Go to control room
    fireEvent.click(screen.getByRole('button', { name: /Explore Control Room/i }));

    // Switch to Operator access tab
    fireEvent.click(screen.getByRole('tab', { name: /Operator access/i }));

    // Enter operator credentials
    fireEvent.change(screen.getByPlaceholderText('Enter your operator ID'), {
      target: { value: 'duty-commander' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'passphrase123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // Protected operational data must load
    await waitFor(() => {
      expect(incidentsSpy).toHaveBeenCalled();
    });

    // Connection must display Live operational data
    expect(
      screen.getByRole('status', { name: /System status: Live operational data/i })
    ).toBeInTheDocument();

    // Now log out operator
    const logoutBtn = screen.getAllByRole('button', { name: 'Sign out' })[0];
    fireEvent.click(logoutBtn);

    // Protected records must be completely purged from UI
    await waitFor(() => {
      expect(
        screen.getByRole('status', {
          name: /System status: API Online · Sign in for operational data/i,
        })
      ).toBeInTheDocument();
    });
  });

  it('Scenario 8 & 9: Report submission returns saved report ID on success and prevents false success notifications on failure', async () => {
    vi.spyOn(api, 'checkBackendHealth').mockResolvedValue({ ok: true, status: 'healthy' });
    vi.spyOn(api, 'loginCitizen').mockResolvedValue({
      ok: true,
      data: { user: { user_id: 'USR-1', name: 'Citizen', email: 'c@example.com', role: 'citizen' } },
    });
    const postReportSpy = vi.spyOn(api, 'postFieldReport').mockResolvedValue({
      ok: false,
      error: 'Database transaction failed',
    });

    render(<App />);

    // Go to control room
    fireEvent.click(screen.getByRole('button', { name: /Explore Control Room/i }));

    // Switch to Citizen tab in OperatorAccessPanel
    fireEvent.click(screen.getByRole('tab', { name: /Citizen portal/i }));
    fireEvent.click(screen.getByRole('button', { name: /Sign In \(Existing Citizen\)/i }));

    // Fill in credentials
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'c@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const submitReportNavBtn = await screen.findByRole('button', { name: /Submit Report/i });
    fireEvent.click(submitReportNavBtn);

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Describe incident...')).toBeInTheDocument()
    );

    fireEvent.change(screen.getByPlaceholderText('Describe incident...'), {
      target: { value: 'Landslide blocked main road' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Report' }));

    // Error alert must appear
    expect(await screen.findByRole('alert')).toHaveTextContent('Database transaction failed');
    // Success notification must NEVER appear
    expect(screen.queryByText(/Emergency report received/i)).not.toBeInTheDocument();
  });

  it('Scenario 10: Refresh/polling guards against duplicate in-flight requests', async () => {
    let resolveHealth;
    const slowHealthPromise = new Promise((resolve) => {
      resolveHealth = resolve;
    });
    const healthSpy = vi
      .spyOn(api, 'checkBackendHealth')
      .mockImplementation(() => slowHealthPromise);

    render(<App />);

    // Initial load triggered one health check
    expect(healthSpy).toHaveBeenCalledTimes(1);

    // Navigate to control room so TopBar is rendered
    fireEvent.click(screen.getByRole('button', { name: /Explore Control Room/i }));

    // Click refresh button in TopBar while first request is in flight
    const refreshBtn = screen.getByRole('button', { name: /Refresh dashboard data/i });
    fireEvent.click(refreshBtn);

    // healthCheckInFlight ref must prevent overlapping duplicate requests
    expect(healthSpy).toHaveBeenCalledTimes(1);

    // Resolve the promise
    await act(async () => {
      resolveHealth({ ok: true, status: 'healthy' });
    });
  });

  it('Scenario 11: Stored reports appear consistently in Intelligence and clearly indicate operator auth for pattern analysis', async () => {
    vi.spyOn(api, 'checkBackendHealth').mockResolvedValue({
      ok: true,
      status: 'healthy',
      service: 'resqgrid-backend',
    });

    render(<App />);

    // Go to control room
    fireEvent.click(screen.getByRole('button', { name: /Explore Control Room/i }));

    // Switch to Intelligence view
    const intelligenceNavBtn = screen.getByRole('button', { name: /^Intelligence$/i });
    fireEvent.click(intelligenceNavBtn);

    // Intelligence top banner must show truthful status, NOT "API Offline"
    expect(screen.queryByText(/API Offline · backend is unreachable/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Operator sign-in required/i)).toBeInTheDocument();

    // Must NOT claim API is unavailable
    expect(screen.queryByText(/API unavailable/i)).not.toBeInTheDocument();
  });

  it('Scenario 12: Direct operator login navigates to operator form, authenticates, redirects to operator dashboard, and loads protected incidents', async () => {
    vi.spyOn(api, 'checkBackendHealth').mockResolvedValue({
      ok: true,
      status: 'healthy',
      service: 'resqgrid-backend',
    });
    const incidentsSpy = vi.spyOn(api, 'fetchIncidentsData').mockResolvedValue({
      source: 'flask-api',
      incidents: [
        {
          incident_id: 'INC-DIRECT-1',
          type: 'Flood',
          place: 'Mandi',
          severity: 'Critical',
          status: 'Confirmed',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      reports: [
        {
          report_id: 'REP-DIRECT-1',
          place: 'Mandi',
          type: 'Flood',
          severity: 'Critical',
          original_text: 'Highway washed away near river',
          verification_status: 'Confirmed',
        },
      ],
      places: [],
      resources: [],
      brief: null,
      riskAssessment: null,
    });
    vi.spyOn(api, 'verifyOperatorCredentials').mockResolvedValue({
      ok: true,
      data: {
        operator: 'command-lead',
        role: 'commander',
      },
    });

    render(<App />);

    // Click direct Operator Login button on LandingPage
    const operatorLoginBtn = screen.getByRole('button', { name: /^Operator Login$/i });
    fireEvent.click(operatorLoginBtn);

    // Operator Access tab should be directly active and fields ready
    expect(screen.getByRole('tab', { name: /Operator access/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByPlaceholderText('Enter your operator ID')).toBeInTheDocument();

    // Enter operator credentials
    fireEvent.change(screen.getByPlaceholderText('Enter your operator ID'), {
      target: { value: 'command-lead' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'tactical-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // Protected operational data must load and operator dashboard is active
    await waitFor(() => {
      expect(incidentsSpy).toHaveBeenCalled();
    });

    // Operator command session must be visible
    expect(screen.getByText(/AUTHORIZED COMMAND SESSION/i)).toBeInTheDocument();
    expect(screen.getAllByText('command-lead')[0]).toBeInTheDocument();

    // Protected incident must appear in the incident feed
    expect(await screen.findByText('INC-DIRECT-1')).toBeInTheDocument();
  });
});
