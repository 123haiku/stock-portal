#!/usr/bin/env bash
# Install Node.js 22 from the NodeSource repository and verify node:sqlite.
set -eu
sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs 2>&1 | tail -8
echo "=== versions ==="
node -v
npm -v
echo "=== node:sqlite ==="
node -e 'const s = require("node:sqlite"); console.log("node:sqlite OK")' 2>&1 | head -3
