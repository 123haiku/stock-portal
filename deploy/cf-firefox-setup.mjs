// Drive the Cloudflare dashboard in Firefox through the remote debugging
// protocol (Firefox --remote-debugging-port, CDP subset), so no API token is
// needed: the dashboard's own cookie session does the work.
//
//   node deploy/cf-firefox-setup.mjs --self-test   # no browser; validates the merge
//   node deploy/cf-firefox-setup.mjs               # opens Firefox, waits for login
//
// Env: CF_ZONE, CF_TUNNEL, CF_WEB_PORT, CF_API_PORT, CF_PORT, CF_PROFILE
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ZONE = process.env.CF_ZONE || 'ngc6543.tech';
const TUNNEL = process.env.CF_TUNNEL || '209278a2-be88-4639-a032-096f7a3ccb45';
const WEB_PORT = Number(process.env.CF_WEB_PORT || 8088);
const API_PORT = Number(process.env.CF_API_PORT || 4000);
const DEBUG_PORT = Number(process.env.CF_PORT || 9334);
const PORTAL = `portal.${ZONE}`;
const FIREFOX = 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

async function targets(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const tab = list.find((t) => t.type === 'page' && t.url.includes('cloudflare'));
        if (tab) return tab;
      }
    } catch (err) {
      lastErr = err;
    }
    await sleep(500);
  }
  throw new Error(`no Cloudflare tab on port ${DEBUG_PORT}${lastErr ? `: ${lastErr.message}` : ''}`);
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

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'evaluate failed');
    }
    return res.result.value;
  }
}

async function run() {
  if (!existsSync(FIREFOX)) throw new Error(`firefox not found at ${FIREFOX}`);
  const profile = process.env.CF_PROFILE || join(HERE, 'build', 'ff-profile');
  mkdirSync(profile, { recursive: true });

  console.log('launching firefox with remote debugging on', DEBUG_PORT);
  const child = spawn(
    FIREFOX,
    [
      '--remote-debugging-port', String(DEBUG_PORT),
      '--new-instance',
      '--profile', profile,
      '--no-remote',
      'https://dash.cloudflare.com/profile/api-tokens',
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();

  const tab = await targets();
  console.log('attached:', tab.url);
  const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable').catch(() => {});

  const probe = `(async () => {
    try {
      const r = await fetch('/api/v4/user', { credentials: 'include' });
      if (r.status !== 200) return 'status:' + r.status;
      const j = await r.json();
      return (j.result && j.result.email) || 'no-email';
    } catch (e) { return 'err:' + e.message; }
  })()`;

  console.log('waiting for a signed-in dashboard session (log in in the opened window)...');
  const deadline = Date.now() + 300000;
  let who = null;
  while (Date.now() < deadline) {
    who = await cdp.eval(probe).catch((e) => `eval:${e.message}`);
    if (who && who.includes('@')) break;
    process.stdout.write('.');
    await sleep(3000);
  }
  console.log('');
  if (!who || !who.includes('@')) throw new Error(`dashboard session not usable: ${who}`);
  console.log('signed in as:', who);

  const accountId = await cdp.eval(
    `fetch('/api/v4/accounts', { credentials: 'include' }).then((r) => r.json()).then((j) => (j.result && j.result[0] && j.result[0].id) || null)`,
  );
  if (!accountId) throw new Error('no account id returned');
  console.log('account:', accountId);

  const cfg = await cdp.eval(
    `fetch('/api/v4/accounts/${accountId}/cfd_tunnel/${TUNNEL}/configurations', { credentials: 'include' }).then((r) => r.json())`,
  );
  if (!cfg.success) throw new Error(`read config: ${JSON.stringify(cfg.errors)}`);
  const before = cfg.result?.config?.ingress || [];
  console.log('ingress before:', JSON.stringify(before));

  const after = mergeIngress(before, portalRules());
  console.log('ingress after :', JSON.stringify(after));

  const payload = JSON.stringify({ config: { ...(cfg.result?.config || {}), ingress: after } });
  const put = await cdp.eval(
    `fetch('/api/v4/accounts/${accountId}/cfd_tunnel/${TUNNEL}/configurations', {
       method: 'PUT', credentials: 'include',
       headers: { 'Content-Type': 'application/json' },
       body: ${JSON.stringify(payload)}
     }).then((r) => r.json())`,
  );
  if (!put.success) throw new Error(`write config: ${JSON.stringify(put.errors)}`);
  console.log('applied version:', put.result?.version ?? 'n/a');

  const zones = await cdp.eval(
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
  const existing = await cdp.eval(
    `fetch('/api/v4/zones/${zoneId}/dns_records?name=${PORTAL}', { credentials: 'include' }).then((r) => r.json())`,
  );
  const rid = existing?.result?.[0]?.id;
  const dns = await cdp.eval(
    `fetch('/api/v4/zones/${zoneId}/dns_records${rid ? `/${rid}` : ''}', {
       method: ${rid ? '"PUT"' : '"POST"'},
       credentials: 'include',
       headers: { 'Content-Type': 'application/json' },
       body: ${JSON.stringify(record)}
     }).then((r) => r.json())`,
  );
  if (!dns.success) throw new Error(`dns: ${JSON.stringify(dns.errors)}`);
  console.log(`dns ${rid ? 'updated' : 'created'}:`, dns.result.name, '->', dns.result.content, 'proxied:', dns.result.proxied);

  console.log('');
  console.log('public web: https://' + PORTAL + '/');
  console.log('public api: https://' + PORTAL + '/api/health');
  cdp.ws.close();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR', err?.message || err);
    process.exit(1);
  });
