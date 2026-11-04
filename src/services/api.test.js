import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchIncidentsData,
  generateSituationBrief,
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
