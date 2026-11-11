import axios from 'axios';
import { resolveApiBase } from './apiBase.js';

/**
 * Resolve the API base URL for both delivery targets.
 *
 * - Browser (Vite dev / static hosting): relative "/api", forwarded by the dev
 *   proxy or served same-origin.
 * - Capacitor native shell: a WebView has no dev proxy, so the base is probed at
 *   startup from a candidate list (see apiBase.js) and cached for later launches.
 *
 * Requests are issued before the probe finishes, so every call waits on the same
 * promise instead of failing with a relative-URL error.
 */
export const api = axios.create({
  timeout: 12000,
});

api.interceptors.request.use(async (config) => {
  if (!config.baseURL) config.baseURL = await resolveApiBase();
  return config;
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
    const detail = error.response?.data?.error || error.message;
    const base = error.config?.baseURL || '';
    // Surface the address that failed: "timeout" alone hides whether the phone
    // reached the right host.
    const message = error.response ? detail : `${detail} (${base || 'unknown API host'})`;
    return Promise.reject(new Error(message));
  },
);
