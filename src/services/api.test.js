import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchIncidentsData,
  generateSituationBrief,
  postFieldReport,
  postVoiceReport,
  registerCitizen,
  loginCitizen,
  encodeBase64Utf8,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
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
});
