const DEFAULT_API_BASE = import.meta.env?.VITE_FLASK_API_URL || '';
const DEFAULT_REQUEST_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...options } = {}) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    timeoutMs,
  );
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function getIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getAuthorizationHeader(credentials) {
  if (!credentials?.username || !credentials?.password) return {};
  return {
    Authorization: `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
  };
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Fetch one consistent dashboard snapshot for live refreshes.
export async function fetchIncidentsData(credentials, apiBase = DEFAULT_API_BASE) {
  try {
    const response = await fetchWithTimeout(`${apiBase}/incidents`, {
      headers: getAuthorizationHeader(credentials),
    });

    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }

    return {
      source: 'flask-api',
      incidents: data.incidents || [],
      reports: data.reports || [],
      places: data.places || [],
      resources: data.resources || [],
      brief: data.brief || null,
      riskAssessment: data.risk_assessment || null,
    };
  } catch (error) {
    return {
      source: 'unavailable',
      error: error.message || 'The dashboard API is unavailable.',
    };
  }
}

// 2. Fetch situation brief
export async function fetchSituationBrief(credentials, apiBase = DEFAULT_API_BASE) {
  try {
    const response = await fetchWithTimeout(`${apiBase}/brief`, {
      headers: getAuthorizationHeader(credentials),
    });

    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }

    return {
      source: 'flask-api',
      brief: data,
    };
  } catch (error) {
    return {
      source: 'unavailable',
      error: error.message || 'The situation brief API is unavailable.',
    };
  }
}

// 3. Confirm an incident
export async function postConfirmIncident(
  incidentId,
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  try {
    const response = await fetchWithTimeout(
      `${apiBase}/incidents/${incidentId}/confirm`,
      {
        method: 'POST',
        headers: getAuthorizationHeader(credentials),
      }
    );

    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);

    return {
      ok: true,
      mode: 'flask-api',
      data,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'error',
      error: error.message,
    };
  }
}

// 4. Submit a field report
export async function postFieldReport(
  payload,
  apiBase = DEFAULT_API_BASE
) {
  try {
    const idempotencyKey = payload.idempotency_key || getIdempotencyKey();
    const { idempotency_key, ...reportPayload } = payload;
    const response = await fetchWithTimeout(`${apiBase}/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(reportPayload),
    });

    const data = await readJsonResponse(response);
    if (!response.ok || data?.ok === false) {
      return {
        ok: false,
        mode: 'error',
        status: response.status,
        data,
        error: data?.error || `HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      mode: 'flask-api',
      data,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'error',
      error: error.message,
    };
  }
}
// 5. Upload a voice report
export async function postVoiceReport(
  audioFile,
  metadata,
  apiBase = DEFAULT_API_BASE
) {
  try {
    const formData = new FormData();

    formData.append('audio', audioFile);
    formData.append('place', metadata.place);
    formData.append('type', metadata.type);
    formData.append('severity', metadata.severity);

    const response = await fetchWithTimeout(`${apiBase}/voice-report`, {
      timeoutMs: 120000,
      method: 'POST',
      headers: {
        'Idempotency-Key': metadata.idempotency_key || getIdempotencyKey(),
      },
      body: formData,
    });

    const data = await readJsonResponse(response);
    if (!data) {
      throw new Error(`Server returned an invalid response (HTTP ${response.status}).`);
    }

    if (!response.ok || data?.ok === false) {
      return {
        ok: false,
        mode: 'error',
        status: response.status,
        data,
        error: data?.error || `HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      mode: 'flask-api',
      data,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'error',
      error: error.message,
    };
  }
}

export async function verifyOperatorCredentials(
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  try {
    const response = await fetchWithTimeout(`${apiBase}/operator/session`, {
      method: 'POST',
      headers: getAuthorizationHeader(credentials),
    });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      return {
        ok: false,
        error: data?.error || `HTTP ${response.status}`,
      };
    }

    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message || 'Operator sign-in failed.' };
  }
}

export async function verifyReport(
  reportId,
  status,
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  try {
    const response = await fetchWithTimeout(
      `${apiBase}/reports/${encodeURIComponent(reportId)}/verification`,
      {
        method: 'POST',
        headers: {
          ...getAuthorizationHeader(credentials),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      }
    );
    const data = await readJsonResponse(response);

    if (!response.ok) {
      return { ok: false, error: data?.error || `HTTP ${response.status}` };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message || 'Report verification failed.' };
  }
}

export async function generateSituationBrief(
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  try {
    const response = await fetchWithTimeout(`${apiBase}/brief/generate`, {
      method: 'POST',
      headers: getAuthorizationHeader(credentials),
    });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      return { ok: false, error: data?.error || `HTTP ${response.status}` };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message || 'Brief generation failed.' };
  }
}

export async function approveSituationBrief(
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  try {
    const response = await fetchWithTimeout(`${apiBase}/brief/approve`, {
      method: 'POST',
      headers: getAuthorizationHeader(credentials),
    });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      return { ok: false, error: data?.error || `HTTP ${response.status}` };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message || 'Brief approval failed.' };
  }
}

export async function fetchReportAudio(
  reportId,
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  try {
    const response = await fetchWithTimeout(
      `${apiBase}/reports/${encodeURIComponent(reportId)}/audio`,
      { headers: getAuthorizationHeader(credentials) }
    );

    if (!response.ok) {
      const data = await readJsonResponse(response);
      return { ok: false, error: data?.error || `HTTP ${response.status}` };
    }
    return { ok: true, blob: await response.blob() };
  } catch (error) {
    return { ok: false, error: error.message || 'Audio retrieval failed.' };
  }
}

async function authenticatedJsonRequest(path, method, payload, credentials, apiBase) {
  try {
    const response = await fetchWithTimeout(`${apiBase}${path}`, {
      method,
      headers: {
        ...getAuthorizationHeader(credentials),
        'Content-Type': 'application/json',
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);
    if (!response.ok || data?.ok === false) {
      return {
        ok: false,
        error: data?.error || `HTTP ${response.status}`,
      };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message || 'The request failed.' };
  }
}

export function createResource(payload, credentials, apiBase = DEFAULT_API_BASE) {
  return authenticatedJsonRequest('/resources', 'POST', payload, credentials, apiBase);
}

export function updateResource(
  resourceId,
  payload,
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  return authenticatedJsonRequest(
    `/resources/${encodeURIComponent(resourceId)}`,
    'PATCH',
    payload,
    credentials,
    apiBase
  );
}

export function assignResource(
  incidentId,
  payload,
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  return authenticatedJsonRequest(
    `/incidents/${encodeURIComponent(incidentId)}/resources`,
    'POST',
    payload,
    credentials,
    apiBase
  );
}

export function updateIncidentResponse(
  incidentId,
  payload,
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  return authenticatedJsonRequest(
    `/incidents/${encodeURIComponent(incidentId)}/response`,
    'PATCH',
    payload,
    credentials,
    apiBase
  );
}

export function fetchReportComparisons(
  credentials,
  windowMinutes = 60,
  apiBase = DEFAULT_API_BASE
) {
  return authenticatedJsonRequest(
    `/intelligence/compare?window_minutes=${encodeURIComponent(windowMinutes)}`,
    'GET',
    undefined,
    credentials,
    apiBase
  );
}

export function fetchEmergingPatterns(credentials, apiBase = DEFAULT_API_BASE) {
  return authenticatedJsonRequest(
    '/intelligence/patterns',
    'GET',
    undefined,
    credentials,
    apiBase
  );
}

export function correctReportAnalysis(
  reportId,
  fields,
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  return authenticatedJsonRequest(
    `/reports/${encodeURIComponent(reportId)}/analysis-corrections`,
    'PATCH',
    { fields },
    credentials,
    apiBase
  );
}

export function editSituationBrief(
  sections,
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  return authenticatedJsonRequest(
    '/brief',
    'PATCH',
    { sections },
    credentials,
    apiBase
  );
}

export function fetchSituationBriefHistory(credentials, apiBase = DEFAULT_API_BASE) {
  return authenticatedJsonRequest(
    '/brief/history',
    'GET',
    undefined,
    credentials,
    apiBase
  );
}

export function archiveSituationBrief(
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  return authenticatedJsonRequest(
    '/brief/archive',
    'POST',
    {},
    credentials,
    apiBase
  );
}

export function fetchAlerts(credentials, apiBase = DEFAULT_API_BASE) {
  return authenticatedJsonRequest(
    '/alerts',
    'GET',
    undefined,
    credentials,
    apiBase
  );
}

export function createAlert(payload, credentials, apiBase = DEFAULT_API_BASE) {
  return authenticatedJsonRequest('/alerts', 'POST', payload, credentials, apiBase);
}

export function editAlert(
  alertId,
  messages,
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  return authenticatedJsonRequest(
    `/alerts/${encodeURIComponent(alertId)}`,
    'PATCH',
    { messages },
    credentials,
    apiBase
  );
}

export function approveAlert(
  alertId,
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  return authenticatedJsonRequest(
    `/alerts/${encodeURIComponent(alertId)}/approve`,
    'POST',
    {},
    credentials,
    apiBase
  );
}

export function simulateAlertSend(
  alertId,
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  return authenticatedJsonRequest(
    `/alerts/${encodeURIComponent(alertId)}/send`,
    'POST',
    {},
    credentials,
    apiBase
  );
}

export function fetchOperationalAnalytics(
  filters = {},
  credentials,
  apiBase = DEFAULT_API_BASE
) {
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value)
  ).toString();
  return authenticatedJsonRequest(
    `/analytics${query ? `?${query}` : ''}`,
    'GET',
    undefined,
    credentials,
    apiBase
  );
}