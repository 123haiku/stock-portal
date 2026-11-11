#!/usr/bin/env bash
# Probe the tunnel's public hostnames after the DNS/config step.
set -u
DOMAIN="${DOMAIN:-ngc6543.tech}"
HOST="${HOST:-portal.$DOMAIN}"
for URL in "https://$HOST/api/health" "https://$HOST/" "https://$DOMAIN/api/health"; do
  printf '%s -> ' "$URL"
  curl -s -m 20 -o /tmp/body.$$ -w 'HTTP=%{http_code} t=%{time_total}s ip=%{remote_ip}\n' "$URL" || echo "curl-failed"
  head -c 120 /tmp/body.$$ 2>/dev/null; echo
  rm -f /tmp/body.$$
done
sudo -n systemctl is-active cloudflared
