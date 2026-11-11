#!/usr/bin/env bash
# Inspect the tunnel token format without printing secrets.
set -u
TOK=$(sudo -n cat /etc/cloudflared/token)
echo "len: ${#TOK}"
echo "has spaces: $(printf '%s' "$TOK" | grep -c ' ')   starts: $(printf '%.4s' "$TOK")"
echo "--- base64 decode ---"
printf '%s' "$TOK" | base64 -d 2>/dev/null | head -c 120
echo
echo "--- json keys ---"
printf '%s' "$TOK" | base64 -d 2>/dev/null | python3 -c '
import sys, json
raw = sys.stdin.read()
start = raw.find("{")
if start < 0:
    print("no json object found; raw prefix:", raw[:80]); sys.exit(0)
data = json.loads(raw[start:])
print("keys:", sorted(data.keys()))
print("accountTag:", data.get("a"))
print("tunnelId:", data.get("t"))
print("cred-domain:", data.get("s"))
'
