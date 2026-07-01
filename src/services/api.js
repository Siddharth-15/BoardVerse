// BoardVerse API service wrapper

// Default server URL. Can be overwritten in UI Settings and saved in localStorage.
let BASE_URL = localStorage.getItem('boardverse_server_url') || 'http://localhost:3000';

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

// Manage guest profile states locally
export function setGuestProfile(username) {
  if (username) {
    localStorage.setItem('boardverse_guest_username', username);
    localStorage.setItem('boardverse_guest_userid', 'guest_' + Math.random().toString(36).substring(2, 9));
  } else {
    localStorage.removeItem('boardverse_guest_username');
    localStorage.removeItem('boardverse_guest_userid');
  }
}

export function getGuestProfile() {
  const username = localStorage.getItem('boardverse_guest_username');
  const userId = localStorage.getItem('boardverse_guest_userid');
  if (username && userId) {
    return { username, userId, isGuest: true };
  }
  return null;
}

// User details helper
export function getUserInfo() {
  const guest = getGuestProfile();
  if (guest) return guest;

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
      isGuest: false
    };
  } catch (err) {
    console.error('Error decoding auth token:', err);
    return null;
  }
}

export function logout() {
  setToken(null);
  setGuestProfile(null);
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
  setGuestProfile(null); // Clear guest status
  setToken(data.token);
  return data;
}

export async function login(username, password) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  setGuestProfile(null); // Clear guest status
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
