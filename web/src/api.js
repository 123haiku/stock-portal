import axios from 'axios';

/**
 * Resolve the API base URL for both delivery targets.
 *
 * - Browser (Vite dev / static hosting): relative "/api", forwarded by the dev
 *   proxy or served same-origin.
 * - Capacitor native shell: a WebView has no dev proxy, so a build-time
 *   VITE_API_URL is injected. `adb reverse tcp:4000 tcp:4000` makes
 *   http://localhost:4000 reach the host machine over USB.
 */
const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
});

const TOKEN_KEY = 'portal.token';
const USER_KEY = 'portal.user';

export const session = {
  get token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

api.interceptors.request.use((config) => {
  const token = session.token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // A 401 means the JWT expired or was tampered with: drop the stale session.
    if (error.response?.status === 401) session.clear();
    const message = error.response?.data?.error || error.message;
    return Promise.reject(new Error(message));
  },
);
