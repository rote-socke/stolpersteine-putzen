// Thin client for the Worker API (see docs/CONTRACT.md).

export class ApiError extends Error {
  /** status 0 means the network failed or timed out. */
  constructor(status, data) {
    super(data?.error ?? `http_${status}`);
    this.status = status;
    this.data = data ?? {};
  }
}

export async function api(method, path, { token, organizerCode, body } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (organizerCode) headers['x-organizer-code'] = organizerCode;
  const init = {
    method,
    headers,
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(15000);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, { error: 'network' });
  }
  if (res.status === 204) return {};
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, data);
  if (data === null) throw new ApiError(0, { error: 'network' });
  return data;
}

export const getState = () => api('GET', '/api/state');
export const getMe = (token) => api('GET', '/api/groups/me', { token });
export const createGroup = (organizerCode, name) =>
  api('POST', '/api/groups', { organizerCode, body: { name } });

const orgaPath = (id, action = '') => `/api/orga/groups/${encodeURIComponent(id)}${action}`;
export const orgaGroups = (organizerCode) => api('GET', '/api/orga/groups', { organizerCode });
export const orgaInvite = (organizerCode, id) => api('GET', orgaPath(id, '/invite'), { organizerCode });
export const orgaRotate = (organizerCode, id) => api('POST', orgaPath(id, '/rotate'), { organizerCode });
export const orgaRename = (organizerCode, id, name) =>
  api('PATCH', orgaPath(id), { organizerCode, body: { name } });
export const orgaDelete = (organizerCode, id) => api('DELETE', orgaPath(id), { organizerCode });

const locPath = (id, action) => `/api/locations/${encodeURIComponent(id)}/${action}`;
export const locationAction = (token, id, action) => api('POST', locPath(id, action), { token });
export const saveNote = (token, id, text) => api('PUT', locPath(id, 'note'), { token, body: { text } });

export const getPresence = ({ token, organizerCode }) => api('GET', '/api/presence', { token, organizerCode });
export const putPresence = (token, body) => api('PUT', '/api/presence', { token, body });
export const deletePresence = (token, deviceId) =>
  api('DELETE', `/api/presence/${encodeURIComponent(deviceId)}`, { token });
