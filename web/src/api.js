import axios from 'axios';

/**
 * Shared axios instance.
 * Base URL is relative so the Vite dev proxy (or a same-origin deployment)
 * forwards /api to the Express server - no CORS config needed in the browser.
 */
export const api = axios.create({
  baseURL: '/api',
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
