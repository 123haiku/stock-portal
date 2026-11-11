#!/usr/bin/env bash
# Read-only capability probe for the Raspberry Pi host.
set -u
echo "=== node ==="
node -v
echo "=== node:sqlite ==="
node -e 'const s = require("node:sqlite"); console.log("node:sqlite OK:", Object.keys(s).join(","))' 2>&1 | head -5
echo "=== mem ==="
free -h | head -2
echo "=== disk ==="
df -h / | tail -1
echo "=== target dir ==="
ls -d "$HOME/stock-portal" 2>/dev/null || echo "absent: $HOME/stock-portal"
echo "=== systemd user bus ==="
systemctl --user is-system-running 2>&1
echo "=== linger ==="
loginctl show-user "$(id -un)" 2>/dev/null | grep -i linger || echo "linger: unknown"
echo "=== sudo ==="
sudo -n true 2>/dev/null && echo "sudo_nopass: yes" || echo "sudo_nopass: no"
echo "=== ports in use (4000/8088/3000) ==="
ss -ltn 2>/dev/null | awk 'NR==1 || /:(4000|8088|3000)\>/'
