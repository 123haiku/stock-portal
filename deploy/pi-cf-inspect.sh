#!/usr/bin/env bash
# Inspect the Cloudflare tunnel state on the Pi: systemd unit, quick-tunnel
# process, public hostname, and what the service currently serves.
set -u

echo "=== systemd unit ==="
systemctl cat cloudflared 2>/dev/null | sed -n '1,40p'

echo "=== unit env ==="
systemctl show cloudflared -p ExecStart -p User -p Restart -p RestartUSec 2>/dev/null

echo "=== token file (redacted length) ==="
if sudo -n test -r /etc/cloudflared/token; then
  sudo -n wc -c /etc/cloudflared/token
fi

echo "=== quick tunnel process ==="
ps -o pid,user,etime,args -p 20767 2>/dev/null

echo "=== listeners 3000/3080 ==="
sudo -n ss -ltnp 2>/dev/null | grep -E ':(3000|3080|2024[12])' || echo "none"

echo "=== cloudflared logs (last 25) ==="
sudo -n journalctl -u cloudflared -n 25 --no-pager 2>/dev/null | tail -25

echo "=== public hostname from quick tunnel log ==="
journalctl --user -n 2000 --no-pager 2>/dev/null | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -3
grep -rhoE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/*.log /home/guanzi/*.log 2>/dev/null | tail -3
