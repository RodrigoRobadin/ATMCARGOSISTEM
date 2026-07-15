const DEFAULT_API_URL = 'https://atmcargosoft.com/api';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/$/, '');

let authToken = null;
const REQUEST_TIMEOUT_MS = 45000;

export function setAuthToken(token) {
  authToken = token || null;
}

export function getAuthToken() {
  return authToken;
}

function buildUrl(path, params) {
  const url = new URL(`${API_URL}${path.startsWith('/') ? path : `/${path}`}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url.toString();
}

export async function apiRequest(path, options = {}) {
  const { params, body, headers, ...rest } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(buildUrl(path, params), {
      ...rest,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(headers || {}),
      },
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('La API no respondio a tiempo. Verifica la IP, el puerto y que el backend este iniciado.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const rawMessage = typeof data === 'object' ? data?.error : data;
    const message =
      typeof rawMessage === 'string' && rawMessage.includes('Cannot GET /api/mobile')
        ? 'La API movil no esta disponible en este servidor. Reinicia/subi el backend actualizado y verifica EXPO_PUBLIC_API_URL.'
        : rawMessage;
    const error = new Error(message || 'Error de conexion');
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function fetchAllRows(path, params = {}, pageSize = 200) {
  const rows = [];
  let offset = 0;

  while (true) {
    const data = await apiRequest(path, { params: { ...params, limit: pageSize, offset } });
    const page = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }

  return rows;
}
export const api = {
  login: (email, password) =>
    apiRequest('/auth/login', { method: 'POST', body: { email, password } }),
  bootstrap: () => apiRequest('/mobile/bootstrap'),
  searchContacts: (q) => fetchAllRows('/contacts', { q }, 200),
  mobileContact: (id) => apiRequest(`/mobile/contacts/${id}`),
  createContact: (payload) => apiRequest('/contacts', { method: 'POST', body: payload }),
  searchOrganizations: (q) => fetchAllRows('/organizations', { q }, 1000),
  mobileOrganization: (id) => apiRequest(`/mobile/organizations/${id}`),
  createOrganization: (payload) => apiRequest('/organizations', { method: 'POST', body: payload }),
  organizationContacts: (id) => apiRequest(`/organizations/${id}/contacts`),
  operationDefaults: (business_unit_key) =>
    apiRequest('/mobile/operation-defaults', { params: { business_unit_key } }),
  mobileOperations: (q) => fetchAllRows('/mobile/operations', { q }, 200),
  mobileOperation: (id) => apiRequest(`/mobile/operations/${id}`),
  updateMobileOperation: (id, payload) => apiRequest(`/mobile/operations/${id}`, { method: 'PATCH', body: payload }),
  createDeal: (payload) => apiRequest('/deals', { method: 'POST', body: payload }),
  addDealCustomField: (dealId, payload) =>
    apiRequest(`/deals/${dealId}/custom-fields`, { method: 'POST', body: payload }),
  updateCargoOperation: (dealId, mode, payload) =>
    apiRequest(`/operations/${dealId}/${mode}`, { method: 'PUT', body: payload }),
  catalogItems: () => apiRequest('/catalog/items', { params: { active: 1, limit: 1000 } }),
  industrialDoors: (dealId) => apiRequest(`/deals/${dealId}/industrial-doors`),
  createIndustrialDoor: (dealId, payload) =>
    apiRequest(`/deals/${dealId}/industrial-doors`, { method: 'POST', body: payload }),
  updateIndustrialDoor: (doorId, payload) =>
    apiRequest(`/industrial-doors/${doorId}`, { method: 'PUT', body: payload }),
  deleteIndustrialDoor: (doorId) => apiRequest(`/industrial-doors/${doorId}`, { method: 'DELETE' }),
  uploadIndustrialDoorImage: (doorId, formData) =>
    apiRequest(`/industrial-doors/${doorId}/images`, { method: 'POST', body: formData }),
  quickQuotes: () => apiRequest('/mobile/quick-quotes'),
  createQuickQuote: (payload) => apiRequest('/mobile/quick-quotes', { method: 'POST', body: payload }),
  uploadAttachment: (formData) =>
    apiRequest('/mobile/attachments', { method: 'POST', body: formData }),
  listAttachments: (entity_type, entity_id) =>
    apiRequest('/mobile/attachments', { params: { entity_type, entity_id } }),
  mobileFollowup: () => apiRequest('/mobile/followup'),
  followupCalls: (params = {}) => apiRequest('/followups/calls', { params }),
  startFollowupCall: (payload) => apiRequest('/followups/calls/start', { method: 'POST', body: payload }),
  completeFollowupCall: (id, payload) =>
    apiRequest(`/followups/calls/${id}/complete`, { method: 'PATCH', body: payload }),
  registerFollowupDevice: (payload) => apiRequest('/followups/devices', { method: 'POST', body: { ...payload, expo_push_token: payload.token || payload.expo_push_token } }),
  unregisterFollowupDevice: (token) =>
    apiRequest('/followups/devices', { method: 'DELETE', body: { expo_push_token: token } }),
  createFollowupCall: (payload) => apiRequest('/mobile/followup/calls', { method: 'POST', body: payload }),
  createFollowupNote: (payload) => apiRequest('/followups/notes', { method: 'POST', body: { ...payload, source: 'mobile' } }),
  createFollowupTask: (payload) => apiRequest('/followups/agenda', { method: 'POST', body: { ...payload, source: 'mobile' } }),
  updateFollowupTask: (id, payload) => apiRequest(`/mobile/followup/tasks/${id}`, { method: 'PATCH', body: payload }),
};
