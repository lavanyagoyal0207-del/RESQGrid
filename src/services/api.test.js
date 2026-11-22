import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBackendHealth,
  fetchIncidentsData,
  generateSituationBrief,
  postFieldReport,
  postVoiceReport,
  registerCitizen,
  loginCitizen,
  encodeBase64Utf8,
  verifyReport,
  confirmIncident,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('backend health and connection checks', () => {
  it('returns healthy status and metadata when GET /health succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        status: 'healthy',
        service: 'resqgrid-backend',
        commit: '92265929238fc3db6c060c0d3c11b18b4271f575',
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkBackendHealth('/api');

    expect(result.ok).toBe(true);
    expect(result.status).toBe('healthy');
    expect(result.commit).toBe('92265929238fc3db6c060c0d3c11b18b4271f575');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Accept: 'application/json' }),
      }),
    );
  });

  it('returns offline status when GET /health fails with network or server error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkBackendHealth('/api');

    expect(result.ok).toBe(false);
    expect(result.status).toBe('offline');
    expect(result.error).toBe('Failed to fetch');
  });

  it('distinguishes 401 unauthorized from backend unavailability in fetchIncidentsData', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ok: false,
        code: 'unauthorized',
        error: 'Operator credentials are required.',
      }), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchIncidentsData(null, '/api');

    expect(result.source).toBe('unauthorized');
    expect(result.status).toBe(401);
    expect(result.error).toBe('Operator credentials are required.');
  });

  it('correctly maps risk_assessment property from realistic GET /incidents response', async () => {
    const realisticIncidentsPayload = {
      incidents: [
        {
          incident_id: 'INC-MANDI-1',
          place: 'Mandi',
          type: 'Flood',
          severity: 'Critical',
          status: 'Confirmed',
        },
      ],
      reports: [],
      places: [{ place: 'Mandi', lat: 31.7087, lng: 76.932 }],
      resources: [],
      brief: null,
      risk_assessment: {
        label: 'AI-generated recommendation — requires human review',
        generated_at: '2026-11-21T12:00:00Z',
        window_minutes: 30,
        locations: [
          {
            place: 'Mandi',
            lat: 31.7087,
            lng: 76.932,
            incident_count: 1,
            report_count: 3,
            requires_attention: true,
            reasons: ['1 active incident is marked Critical.'],
          },
        ],
      },
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(realisticIncidentsPayload), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchIncidentsData(
      { username: 'operator', password: 'secret' },
      '/api',
    );

    expect(result.source).toBe('flask-api');
    expect(result.riskAssessment).toBeDefined();
    expect(result.riskAssessment.locations[0].place).toBe('Mandi');
    expect(result.riskAssessment.locations[0].lat).toBe(31.7087);
    expect(result.riskAssessment.locations[0].lng).toBe(76.932);
    expect(result.riskAssessment.locations[0].requires_attention).toBe(true);
  });
});

describe('citizen authentication API calls', () => {
  it('registers a new citizen via POST /auth/register', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        user: {
          user_id: 'USR-123',
          name: 'Jane Doe',
          email: 'jane@example.com',
          role: 'citizen',
        },
      }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const payload = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'password123',
    };
    const result = await registerCitizen(payload, '/api');

    expect(result.ok).toBe(true);
    expect(result.data.user.role).toBe('citizen');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
  });

  it('authenticates a citizen via POST /auth/login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        user: {
          user_id: 'USR-123',
          name: 'Jane Doe',
          email: 'jane@example.com',
          role: 'citizen',
        },
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const credentials = {
      email: 'jane@example.com',
      password: 'password123',
    };
    const result = await loginCitizen(credentials, '/api');

    expect(result.ok).toBe(true);
    expect(result.data.user.role).toBe('citizen');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...credentials, role: 'citizen' }),
      }),
    );
  });
});

describe('authenticated API calls', () => {
  it('sends operator credentials with protected dashboard reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        incidents: [],
        reports: [],
        places: [],
        resources: [],
      })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const credentials = { username: 'operator-a', password: 'secret' };

    const result = await fetchIncidentsData(credentials, '/api');

    expect(result.source).toBe('flask-api');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/incidents',
      expect.objectContaining({
        headers: { Authorization: `Basic ${btoa('operator-a:secret')}` },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('sends credentials to brief generation and preserves sanitized API errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: 'Operator credentials are required.' }),
        { status: 401 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const credentials = { username: 'operator-a', password: 'secret' };

    const result = await generateSituationBrief(credentials, '/api');

    expect(result).toEqual({
      ok: false,
      error: 'Operator credentials are required.',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/brief/generate',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: `Basic ${btoa('operator-a:secret')}` },
      }),
    );
  });
});

describe('citizen report retry identifiers', () => {
  it('sends a stable body submission_id in addition to the optional header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        report: { report_id: 'REP-1' },
      })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const payload = {
      original_text: 'Water is rising.',
      place: 'Mandi',
      type: 'Flood',
      severity: 'High',
      submission_id: 'citizen-action-0001',
    };

    const result = await postFieldReport(payload, '/api');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/report',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'citizen-action-0001',
        }),
        body: JSON.stringify(payload),
      }),
    );
  });

  it('attaches basic authorization header when citizen credentials are provided to postFieldReport', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        report: { report_id: 'REP-AUTH-1' },
      })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const payload = {
      original_text: 'Water is rising.',
      place: 'Mandi',
      type: 'Flood',
      severity: 'High',
    };
    const credentials = {
      username: 'jane@example.com',
      password: 'password123',
    };

    const result = await postFieldReport(payload, credentials, '/api');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/report',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa('jane@example.com:password123')}`,
        }),
      }),
    );
  });

  it('attaches basic authorization header when citizen credentials are provided to postVoiceReport', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        report: { report_id: 'REP-VOICE-AUTH-1' },
      })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const audioFile = new File(['dummy audio'], 'recording.wav', { type: 'audio/wav' });
    const metadata = {
      place: 'Mandi',
      type: 'Flood',
      severity: 'High',
    };
    const credentials = {
      username: 'jane@example.com',
      password: 'password123',
    };

    const result = await postVoiceReport(audioFile, metadata, credentials, '/api');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/voice-report',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa('jane@example.com:password123')}`,
        }),
      }),
    );
  });
});

function decodeBase64Utf8(base64Str) {
  const binary = atob(base64Str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

describe('Unicode-safe Basic Auth encoding', () => {
  it('correctly encodes and round-trips ASCII credentials', () => {
    const raw = 'citizen@example.com:StandardPass123!';
    const encoded = encodeBase64Utf8(raw);
    expect(decodeBase64Utf8(encoded)).toBe(raw);
    // Standard btoa should match ASCII output
    expect(encoded).toBe(btoa(raw));
  });

  it('correctly encodes Hindi and Punjabi Unicode passwords without throwing', () => {
    const hindi = 'citizen.hindi@example.com:सुरक्षित_पासवर्ड_१२३';
    const punjabi = 'citizen.punjabi@example.com:ਸੁਰੱਖਿਅਤ_ਪਾਸਵਰਡ_੧੨੩';

    const hindiEncoded = encodeBase64Utf8(hindi);
    const punjabiEncoded = encodeBase64Utf8(punjabi);

    expect(decodeBase64Utf8(hindiEncoded)).toBe(hindi);
    expect(decodeBase64Utf8(punjabiEncoded)).toBe(punjabi);
  });

  it('correctly encodes passwords containing emojis and symbols', () => {
    const raw = 'citizen.emoji@example.com:SecureKey🔒🔥2026!✨';
    const encoded = encodeBase64Utf8(raw);
    expect(decodeBase64Utf8(encoded)).toBe(raw);
  });

  it('attaches UTF-8 encoded Basic Auth header for Unicode citizen credentials in postFieldReport', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, report: { report_id: 'REP-UNI-1' } })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const payload = {
      original_text: 'Flood warning.',
      place: 'Mandi',
      type: 'Flood',
      severity: 'High',
    };
    const credentials = {
      username: 'citizen@example.com',
      password: 'पासवर्ड😀123',
    };

    const expectedEncoded = encodeBase64Utf8(`${credentials.username}:${credentials.password}`);
    const result = await postFieldReport(payload, credentials, '/api');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/report',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${expectedEncoded}`,
        }),
      }),
    );
    const sentAuth = fetchMock.mock.calls[0][1].headers.Authorization;
    const base64Part = sentAuth.replace('Basic ', '');
    expect(decodeBase64Utf8(base64Part)).toBe(`${credentials.username}:${credentials.password}`);
  });

  it('verifyReport sends status and operator Basic Auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, report: { report_id: 'REP-101', verification_status: 'Confirmed' } })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const credentials = { username: 'duty-commander', password: 'cmd-password' };
    const result = await verifyReport('REP-101', 'Confirmed', credentials, '/api');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reports/REP-101/verification',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: `Basic ${encodeBase64Utf8('duty-commander:cmd-password')}`,
        }),
        body: JSON.stringify({ status: 'Confirmed' }),
      }),
    );
  });

  it('verifyReport includes rejection reason when rejecting report', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        report: { report_id: 'REP-102', verification_status: 'Rejected', rejection_reason: 'Duplicate citizen submission' }
      })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const credentials = { username: 'duty-commander', password: 'cmd-password' };
    const result = await verifyReport('REP-102', 'Rejected', credentials, '/api', 'Duplicate citizen submission');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reports/REP-102/verification',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: `Basic ${encodeBase64Utf8('duty-commander:cmd-password')}`,
        }),
        body: JSON.stringify({ status: 'Rejected', reason: 'Duplicate citizen submission' }),
      }),
    );
  });

  it('confirmIncident sends POST to /incidents/:id/confirm with operator Basic Auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        incident: { incident_id: 'INC-201', status: 'Confirmed', confirmed_by: 'duty-commander' }
      })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const credentials = { username: 'duty-commander', password: 'cmd-password' };
    const result = await confirmIncident('INC-201', credentials, '/api');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/incidents/INC-201/confirm',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Basic ${encodeBase64Utf8('duty-commander:cmd-password')}`,
        }),
      }),
    );
  });
});
