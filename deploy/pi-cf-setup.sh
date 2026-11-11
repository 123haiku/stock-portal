#!/usr/bin/env bash
# Expose the Stock Portal API and static bundle through the existing Cloudflare
# Tunnel. Requires CF_API_TOKEN and CF_ACCOUNT_ID in the environment.
#   CF_API_TOKEN: Account > Cloudflare Tunnel:Edit, Zone > DNS:Edit (scoped to
#                 the zone that owns $DOMAIN)
set -eu

DOMAIN="${DOMAIN:-ngc6543.tech}"
HOST="${HOST:-portal.$DOMAIN}"
API="${API:-$DOMAIN}"          # A record: apex -> API
WEB_PORT=8088
TUNNEL_ID="209278a2-be88-4639-a032-096f7a3ccb45"
: "${CF_API_TOKEN:?set CF_API_TOKEN}"
: "${CF_ACCOUNT_ID:?set CF_ACCOUNT_ID}"

cf() {
  local method=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -sS -X "$method" "https://api.cloudflare.com/client/v4$path" \
      -H "Authorization: Bearer $CF_API_TOKEN" \
      -H 'Content-Type: application/json' \
      --data "$body"
  else
    curl -sS -X "$method" "https://api.cloudflare.com/client/v4$path" \
      -H "Authorization: Bearer $CF_API_TOKEN"
  fi
}

echo "=== verify token ==="
cf GET "/accounts/$CF_ACCOUNT_ID/tokens/verify" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("ok:",d["success"], d.get("result",{}).get("status"))'

echo "=== zone id for $API ==="
ZONE_ID=$(cf GET "/zones?name=$API" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["result"][0]["id"] if d["success"] and d["result"] else "")')
echo "zone: $ZONE_ID"
[ -n "$ZONE_ID" ] || { echo "zone lookup failed"; exit 1; }

echo "=== apply tunnel ingress ==="
cat > /tmp/ingress.json <<EOF
{"config":{"ingress":[
  {"hostname":"$HOST","path":"/api/.*","service":"http://localhost:4000","originRequest":{"noTLSVerify":true}},
  {"hostname":"$HOST","service":"http://localhost:$WEB_PORT"},
  {"hostname":"$API","service":"http://localhost:4000"},
  {"service":"http_status:404"}
]}}
EOF
cf PUT "/accounts/$CF_ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" "$(cat /tmp/ingress.json)" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("success:",d["success"]);print(json.dumps(d.get("result",{}).get("config",{}).get("ingress",[]),indent=1))'

echo "=== DNS records (proxied CNAME -> tunnel) ==="
for NAME in "$HOST" "$API"; do
  EXIST=$(cf GET "/zones/$ZONE_ID/dns_records?name=$NAME" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["result"][0]["id"] if d["result"] else "")')
  BODY=$(printf '{"type":"CNAME","name":"%s","content":"%s.cfargotunnel.com","proxied":true,"ttl":1}' "$NAME" "$TUNNEL_ID")
  if [ -n "$EXIST" ]; then
    cf PUT "/zones/$ZONE_ID/dns_records/$EXIST" "$BODY" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("updated:",d["success"], d.get("errors"))'
  else
    cf POST "/zones/$ZONE_ID/dns_records" "$BODY" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("created:",d["success"], d.get("errors"))'
  fi
done

echo "=== restart cloudflared (picks up remote config) ==="
sudo -n systemctl restart cloudflared
sleep 6
sudo -n systemctl is-active cloudflared

echo "=== public probes ==="
for URL in "https://$API/api/health" "https://$HOST/api/health" "https://$HOST/"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$URL" || echo "000")
  echo "$URL -> $code"
done
