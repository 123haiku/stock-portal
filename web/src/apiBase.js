// Runtime-configurable API base for the Capacitor build.
//
// The native shell cannot rely on the /api proxy a browser gets from Vite, and a
// baked-in LAN IP breaks as soon as DHCP hands the server a different address.
// At startup we therefore probe a short candidate list (server first) and cache
// the winner in localStorage so later launches skip the probe.
//
// Candidate sources, in order:
//   1. localStorage override  (set by setApiBase, e.g. from the login screen)
//   2. VITE_API_URL           (build-time pin, highest priority when present)
//   3. window.location.origin (browser, same-origin /api)
//   4. built-in LAN mirror    (the Pi that hosts the API)
//   5. `localhost`            (adb reverse tcp:4000 for USB-tethered devices)
//   6. `10.0.2.2`             (Android emulator host loopback)

const CACHE_KEY = 'portal.apiBase';
const PROBE_TIMEOUT_MS = 2500;

const BUILT_IN = [
  'http://192.168.37.200:4000/api',
  'http://localhost:4000/api',
  'http://10.0.2.2:4000/api',
];

export function setApiBase(base) {
  const clean = String(base || '').replace(/\/+$/, '');
  if (!clean) {
    localStorage.removeItem(CACHE_KEY);
    return '';
  }
  localStorage.setItem(CACHE_KEY, clean);
  return clean;
}

export function getApiBase() {
  return localStorage.getItem(CACHE_KEY) || import.meta.env.VITE_API_URL || '';
}

function candidates() {
  const list = [];
  const push = (value) => {
    const v = String(value || '').replace(/\/+$/, '');
    if (v && !list.includes(v)) list.push(v);
  };

  push(getApiBase());
  if (import.meta.env.VITE_API_URL) return list;

  const origin = window.location.origin;
  // Capacitor serves the bundle from http://localhost, where a relative /api
  // resolves to nothing; only reuse the origin for real http(s) hosts.
  if (/^https?:$/.test(window.location.protocol) && !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
    push(`${origin}/api`);
  }
  BUILT_IN.forEach(push);
  return list;
}

async function probe(base) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return false;
    const body = await res.json();
    return body && body.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let resolved = null;

/**
 * Resolve the API base once per page load. Returns the cached value when a
 * previous launch already found a reachable server.
 */
export function resolveApiBase() {
  if (resolved) return resolved;

  const cached = getApiBase();
  resolved = (async () => {
    const list = candidates();
    const ordered = cached && list.includes(cached) ? [cached, ...list.filter((x) => x !== cached)] : list;
    for (const base of ordered) {
      // eslint-disable-next-line no-await-in-loop
      if (await probe(base)) {
        setApiBase(base);
        return base;
      }
    }
    // Nothing answered: keep the first candidate so the error message names a
    // real address instead of an empty string.
    return ordered[0] || '/api';
  })();

  return resolved;
}
