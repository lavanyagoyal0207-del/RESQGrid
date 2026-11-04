import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchIncidentsData,
  generateSituationBrief,
  postFieldReport,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
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
});
