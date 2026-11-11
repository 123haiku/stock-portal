// Point the Pi's existing Cloudflare Tunnel at the Stock Portal without
// disturbing hostnames that are already routed.
//
// Reads the tunnel's current ingress, keeps every rule it does not own, and
// prepends the portal rules. Idempotent: re-running replaces only the portal
// entries.
//
//   CLOUDFLARE_API_TOKEN  Zone > DNS:Edit (ngc6543.tech)
//                         Account > Cloudflare Tunnel:Edit
//   CLOUDFLARE_ACCOUNT_ID account tag from the tunnel token
//
// Usage:  node deploy/cf-setup.mjs [--dry-run]
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || 'c2d025ab2cbcafa619beb6e5a7ddb5c7';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ZONE_NAME = 'ngc6543.tech';
const TUNNEL_ID = '209278a2-be88-4639-a032-096f7a3ccb45';
const WEB_PORT = 8088;
const API_PORT = 4000;

const PORTAL = `portal.${ZONE_NAME}`;
const DRY = process.argv.includes('--dry-run');

if (!TOKEN) {
  console.error('CLOUDFLARE_API_TOKEN is not set');
  process.exit(2);
}

const api = async (method, path, body) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.success) {
    console.error(`${method} ${path} ->`, JSON.stringify(json.errors));
    process.exit(1);
  }
  return json.result;
};

// Rules for the portal, in match order.
const portalRules = [
  { hostname: PORTAL, path: '/api/.*', service: `http://localhost:${API_PORT}` },
  { hostname: PORTAL, service: `http://localhost:${WEB_PORT}` },
];

// Keep every existing rule except portal's, and keep the catch-all last.
function merge(existing) {
  const kept = (existing || []).filter((rule) => rule.hostname !== PORTAL);
  const catchAll = kept.filter((rule) => !rule.hostname);
  const named = kept.filter((rule) => rule.hostname);
  const tail = catchAll.length ? [catchAll[catchAll.length - 1]] : [{ service: 'http_status:404' }];
  return [...named, ...portalRules, ...tail];
}

// Dashboard-created tokens are user-owned, so they answer on /user/tokens/verify;
// /accounts/{id}/tokens/verify only recognises account-owned tokens.
const verify = await api('GET', '/user/tokens/verify').catch(() => null);
if (!verify) {
  console.error('token rejected by /user/tokens/verify - re-roll it in the dashboard');
  process.exit(1);
}
console.log('token:', verify.status);

const zones = await api('GET', `/zones?name=${ZONE_NAME}`);
const zoneId = zones[0]?.id;
if (!zoneId) {
  console.error(`zone ${ZONE_NAME} not visible to this token - add Zone > DNS:Edit with that zone in Zone Resources`);
  process.exit(1);
}
console.log('zone:', zoneId);

const current = await api('GET', `/accounts/${ACCOUNT}/cfd_tunnel/${TUNNEL_ID}/configurations`);
const before = current?.config?.ingress || [];
console.log('ingress before:', JSON.stringify(before));

const after = merge(before);
console.log('ingress after :', JSON.stringify(after));

if (DRY) {
  console.log('dry run - nothing written');
  process.exit(0);
}

const applied = await api('PUT', `/accounts/${ACCOUNT}/cfd_tunnel/${TUNNEL_ID}/configurations`, {
  config: { ...(current?.config || {}), ingress: after },
});
console.log('applied version:', applied?.version ?? 'n/a');
console.log('applied ingress:', JSON.stringify(applied?.config?.ingress ?? after));

const body = {
  type: 'CNAME',
  name: PORTAL,
  content: `${TUNNEL_ID}.cfargotunnel.com`,
  proxied: true,
  ttl: 1,
};
const records = await api('GET', `/zones/${zoneId}/dns_records?name=${PORTAL}`);
if (records.length) {
  const updated = await api('PUT', `/zones/${zoneId}/dns_records/${records[0].id}`, body);
  console.log(`dns updated: ${updated.name} -> ${updated.content} proxied=${updated.proxied}`);
} else {
  const created = await api('POST', `/zones/${zoneId}/dns_records`, body);
  console.log(`dns created: ${created.name} -> ${created.content} proxied=${created.proxied}`);
}
