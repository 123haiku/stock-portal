#!/usr/bin/env bash
# Report what the running cloudflared thinks its ingress config is.
set -u
echo "=== service ==="
sudo -n systemctl is-active cloudflared
sudo -n systemctl show cloudflared -p ActiveEnterTimestamp

echo "=== log since restart (config lines) ==="
sudo -n journalctl -u cloudflared --since "-3min" --no-pager | grep -Ei 'ingress|configuration|registered|ERR|WRN' | tail -30

echo "=== local upstreams ==="
for p in 4000 8088; do
  printf 'localhost:%s -> ' "$p"
  curl -s -o /dev/null -m 4 -w '%{http_code}\n' "http://127.0.0.1:$p/" || echo fail
done
curl -s -m 4 -o /dev/null -w 'api health: %{http_code}\n' http://127.0.0.1:4000/api/health
