const DEFAULT_API_URL = 'https://atmcargosoft.com/api';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/$/, '');

let authToken = null;

export function setAuthToken(token) {
  authToken = token || null;
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
  const response = await fetch(buildUrl(path, params), {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(headers || {}),
    },
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
  });

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

export const api = {
  login: (email, password) =>
    apiRequest('/auth/login', { method: 'POST', body: { email, password } }),
  bootstrap: () => apiRequest('/mobile/bootstrap'),
  searchContacts: (q) => apiRequest('/contacts', { params: { q, limit: 30 } }),
  createContact: (payload) => apiRequest('/contacts', { method: 'POST', body: payload }),
  searchOrganizations: (q) => apiRequest('/organizations', { params: { q, limit: 30 } }),
  createOrganization: (payload) => apiRequest('/organizations', { method: 'POST', body: payload }),
  organizationContacts: (id) => apiRequest(`/organizations/${id}/contacts`),
  operationDefaults: (business_unit_key) =>
    apiRequest('/mobile/operation-defaults', { params: { business_unit_key } }),
  createDeal: (payload) => apiRequest('/deals', { method: 'POST', body: payload }),
  addDealCustomField: (dealId, payload) =>
    apiRequest(`/deals/${dealId}/custom-fields`, { method: 'POST', body: payload }),
  updateCargoOperation: (dealId, mode, payload) =>
    apiRequest(`/operations/${dealId}/${mode}`, { method: 'PUT', body: payload }),
  createIndustrialDoor: (dealId, payload) =>
    apiRequest(`/deals/${dealId}/industrial-doors`, { method: 'POST', body: payload }),
  quickQuotes: () => apiRequest('/mobile/quick-quotes'),
  createQuickQuote: (payload) => apiRequest('/mobile/quick-quotes', { method: 'POST', body: payload }),
  uploadAttachment: (formData) =>
    apiRequest('/mobile/attachments', { method: 'POST', body: formData }),
  listAttachments: (entity_type, entity_id) =>
    apiRequest('/mobile/attachments', { params: { entity_type, entity_id } }),
};
