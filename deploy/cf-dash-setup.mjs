// Drive the Cloudflare dashboard through a real browser session instead of an
// API token. Uses the DevTools protocol on an Edge/Chrome instance started with
// its own profile, so the dashboard's cookie session does the authentication.
//
//   node deploy/cf-dash-setup.mjs --self-test   # no browser; checks origin split
//   node deploy/cf-dash-setup.mjs               # opens the browser, waits for login
//
// Env: CF_ZONE, CF_TUNNEL, CF_WEB_PORT, CF_API_PORT, CF_PROFILE, CF_PORT
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ZONE = process.env.CF_ZONE || 'ngc6543.tech';
const TUNNEL = process.env.CF_TUNNEL || '209278a2-be88-4639-a032-096f7a3ccb45';
const WEB_PORT = Number(process.env.CF_WEB_PORT || 8088);
const API_PORT = Number(process.env.CF_API_PORT || 4000);
const PORT = Number(process.env.CF_PORT || 9333);
const PORTAL = `portal.${ZONE}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Keep the tunnel's existing hostnames; only the portal entries are ours.
export function mergeIngress(existing, rules) {
  const kept = (existing || []).filter((rule) => rule.hostname !== PORTAL);
  const named = kept.filter((rule) => rule.hostname);
  const tail = kept.filter((rule) => !rule.hostname);
  return [...named, ...rules, ...(tail.length ? [tail[tail.length - 1]] : [{ service: 'http_status:404' }])];
}

export function portalRules() {
  return [
    { hostname: PORTAL, path: '/api/.*', service: `http://localhost:${API_PORT}` },
    { hostname: PORTAL, service: `http://localhost:${WEB_PORT}` },
  ];
}

if (process.argv.includes('--self-test')) {
  const before = [
    { hostname: 'api.ngc6543.tech', service: 'http://localhost:8000' },
    { service: 'http_status:404' },
  ];
  const after = mergeIngress(before, portalRules());
  const checks = [
    ['keeps api.ngc6543.tech untouched', after.some((r) => r.hostname === 'api.ngc6543.tech' && r.service.endsWith(':8000'))],
    ['portal /api/* -> API port', after.some((r) => r.hostname === PORTAL && r.path === '/api/.*' && r.service.endsWith(`:${API_PORT}`))],
    ['portal / -> web port', after.some((r) => r.hostname === PORTAL && !r.path && r.service.endsWith(`:${WEB_PORT}`))],
    ['catch-all stays last', !after[after.length - 1].hostname],
    ['idempotent', JSON.stringify(mergeIngress(after, portalRules())) === JSON.stringify(after)],
  ];
  console.log('before:', JSON.stringify(before));
  console.log('after :', JSON.stringify(after));
  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
    if (!pass) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

function findBrowser() {
  const paths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return paths.find((p) => existsSync(p)) || null;
}

async function devtoolsUrl(port, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const page = list.find((t) => t.type === 'page');
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch (err) {
      lastErr = err;
    }
    await sleep(400);
  }
  throw new Error(`DevTools not reachable on ${port}${lastErr ? `: ${lastErr.message}` : ''}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, err) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', err, { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evalIn(expression, userGesture = false) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`evaluate failed: ${d}`);
    }
    return res.result.value;
  }
}

async function run() {
  const browser = findBrowser();
  if (!browser) throw new Error('no Edge/Chrome installation found');
  const profile = process.env.CF_PROFILE || join(HERE, 'build', 'cf-profile');
  mkdirSync(profile, { recursive: true });

  console.log('launching:', browser);
  const child = spawn(
    browser,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      'https://dash.cloudflare.com/profile/api-tokens',
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();

  const wsUrl = await devtoolsUrl(PORT);
  const cdp = await Cdp.connect(wsUrl);
  await cdp.send('Runtime.enable');
  console.log('browser attached; waiting for a signed-in dashboard session (up to 5 min)');

  const signedIn = `(async () => {
    try {
      const r = await fetch('/api/v4/user', { credentials: 'include' });
      if (r.status !== 200) return null;
      const j = await r.json();
      return (j.result && j.result.email) || null;
    } catch { return null; }
  })()`;

  const deadline = Date.now() + 300000;
  let email = null;
  while (Date.now() < deadline && !email) {
    email = await cdp.evalIn(signedIn).catch(() => null);
    if (!email) await sleep(2000);
  }
  if (!email) throw new Error('dashboard did not reach a signed-in session within 5 minutes');
  console.log('signed in as:', email);

  const accountId = await cdp.evalIn(
    `fetch('/api/v4/accounts', { credentials: 'include' }).then((r) => r.json()).then((j) => j.result?.[0]?.id ?? null)`,
  );
  if (!accountId) throw new Error('no account returned by /api/v4/accounts');
  console.log('account:', accountId);

  const cfg = await cdp.evalIn(
    `fetch('/api/v4/accounts/${accountId}/cfd_tunnel/${TUNNEL}/configurations', { credentials: 'include' }).then((r) => r.json())`,
  );
  if (!cfg.success) throw new Error(`read configuration failed: ${JSON.stringify(cfg.errors)}`);
  const before = cfg.result?.config?.ingress || [];
  console.log('ingress before:', JSON.stringify(before));

  const after = mergeIngress(before, portalRules());
  console.log('ingress after :', JSON.stringify(after));

  const payload = JSON.stringify({ config: { ...(cfg.result?.config || {}), ingress: after } });
  const put = await cdp.evalIn(
    `fetch('/api/v4/accounts/${accountId}/cfd_tunnel/${TUNNEL}/configurations', {
       method: 'PUT',
       credentials: 'include',
       headers: { 'Content-Type': 'application/json' },
       body: ${JSON.stringify(payload)}
     }).then((r) => r.json())`,
  );
  if (!put.success) throw new Error(`write configuration failed: ${JSON.stringify(put.errors)}`);
  console.log('applied version:', put.result?.version ?? 'n/a');

  const zones = await cdp.evalIn(
    `fetch('/api/v4/zones?name=${ZONE}', { credentials: 'include' }).then((r) => r.json())`,
  );
  const zoneId = zones?.result?.[0]?.id;
  if (!zoneId) throw new Error(`zone ${ZONE} not visible`);
  console.log('zone:', zoneId);

  const record = JSON.stringify({
    type: 'CNAME',
    name: PORTAL,
    content: `${TUNNEL}.cfargotunnel.com`,
    proxied: true,
    ttl: 1,
  });
  const existing = await cdp.evalIn(
    `fetch('/api/v4/zones/${zoneId}/dns_records?name=${PORTAL}', { credentials: 'include' }).then((r) => r.json())`,
  );
  const id = existing?.result?.[0]?.id;
  const dns = await cdp.evalIn(
    `fetch('/api/v4/zones/${zoneId}/dns_records${id ? `/${id}` : ''}', {
       method: ${id ? '"PUT"' : '"POST"'},
       credentials: 'include',
       headers: { 'Content-Type': 'application/json' },
       body: ${JSON.stringify(record)}
     }).then((r) => r.json())`,
  );
  if (!dns.success) throw new Error(`dns write failed: ${JSON.stringify(dns.errors)}`);
  console.log(`dns ${id ? 'updated' : 'created'}:`, dns.result.name, '->', dns.result.content, 'proxied:', dns.result.proxied);

  console.log('');
  console.log('public web : https://' + PORTAL + '/');
  console.log('public api : https://' + PORTAL + '/api/health');
  console.log('browser left open; close it when finished.');
  cdp.ws.close();
  return 0;
}

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('ERROR', err?.message || err);
    process.exit(1);
  });
