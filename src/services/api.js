// Default server URL. Can be overwritten in UI Settings and saved in localStorage.
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
let BASE_URL = localStorage.getItem('boardverse_server_url');

if (!BASE_URL) {
  // If running local dev server (Vite on port 5173), point to backend at 3000
  if (isLocal && window.location.port === '5173') {
    BASE_URL = 'http://localhost:3000';
  } else {
    // In production (same origin) or local preview
    BASE_URL = window.location.origin;
  }
}

export function getServerUrl() {
  return BASE_URL;
}

export function setServerUrl(url) {
  // Normalize trailing slash
  BASE_URL = url.endsWith('/') ? url.slice(0, -1) : url;
  localStorage.setItem('boardverse_server_url', BASE_URL);
}

// Token helper management
export function setToken(token) {
  if (token) {
    localStorage.setItem('boardverse_jwt_token', token);
  } else {
    localStorage.removeItem('boardverse_jwt_token');
  }
}

export function getToken() {
  return localStorage.getItem('boardverse_jwt_token');
}

// User details helper
export function getUserInfo() {
  const token = getToken();
  if (!token) return null;

  try {
    // Decode basic JWT payload (middle part)
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      window.atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload);
    return {
      userId: payload.userId,
      username: payload.username,
      isGuest: !!payload.isGuest
    };
  } catch (err) {
    console.error('Error decoding auth token:', err);
    return null;
  }
}

export function logout() {
  setToken(null);
}

// Generic fetch wrapper with Authorization header
async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Network request failed');
  }
  return data;
}

// API Functions
export async function register(username, password) {
  const data = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  setToken(data.token);
  return data;
}

export async function login(username, password) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  setToken(data.token);
  return data;
}

export async function loginAsGuest(username) {
  const data = await request('/api/auth/guest', {
    method: 'POST',
    body: JSON.stringify({ username })
  });
  setToken(data.token);
  return data;
}

export async function createSession(name) {
  return request('/api/sessions/create', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
}

export async function getMySessions() {
  return request('/api/sessions/my');
}

export async function getSession(id) {
  return request(`/api/sessions/${id}`);
}

export async function updateSessionDetails(id, { name, topic }) {
  return request(`/api/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name, topic })
  });
}

// Local cache helper for tracking sessions joined as viewer
export function getJoinedSessionsHistory() {
  const history = localStorage.getItem('boardverse_joined_sessions_history');
  return history ? JSON.parse(history) : [];
}

export function addJoinedSessionToHistory(session) {
  const history = getJoinedSessionsHistory();
  // Avoid duplicating sessions
  const filtered = history.filter(s => s.id !== session.id);
  filtered.unshift({
    id: session.id,
    name: session.name,
    hostName: session.hostName,
    joinedAt: new Date().toISOString()
  });
  // Cap at 20 historical items
  if (filtered.length > 20) filtered.pop();
  localStorage.setItem('boardverse_joined_sessions_history', JSON.stringify(filtered));
}
