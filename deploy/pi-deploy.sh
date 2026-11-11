#!/usr/bin/env bash
# Deploy the stock-portal API + static web bundle on the Raspberry Pi.
# Idempotent: re-running rsyncs the staged tree and restarts the user unit.
set -eu

APP_DIR="$HOME/stock-portal"
SRC="${1:?usage: pi-deploy.sh <staged-dir>}"
PORT=4000

echo "=== rsync ==="
mkdir -p "$APP_DIR"
rsync -a --delete --exclude data/ --exclude node_modules/ "$SRC/server/" "$APP_DIR/server/"
rsync -a --delete "$SRC/web/" "$APP_DIR/web/"
mkdir -p "$APP_DIR/server/data"

echo "=== npm ci (production) ==="
cd "$APP_DIR/server"
npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -5

echo "=== static file server ==="
cat > "$APP_DIR/server/serve-web.js" <<'EOF'
// Minimal static server for the prebuilt Vue bundle. No dependencies.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] || 'web');
const PORT = Number(process.env.WEB_PORT || 8088);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = join(ROOT, normalize(decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(path);
    if (info.isDirectory()) path = join(path, 'index.html');
  } catch {
    path = join(ROOT, 'index.html');
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
      'Cache-Control': extname(path) === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '0.0.0.0', () => console.log(`[web] listening on http://0.0.0.0:${PORT}`));
EOF

cat > "$APP_DIR/server/.env" <<EOF
PORT=$PORT
JWT_SECRET=pi-stock-portal-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
DB_PATH=$APP_DIR/server/data/portal.db
WEB_PORT=8088
EOF
chmod 600 "$APP_DIR/server/.env"

echo "=== systemd user units ==="
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/stock-portal-api.service" <<EOF
[Unit]
Description=Stock Portal API (stock-portal)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$APP_DIR/server/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

cat > "$HOME/.config/systemd/user/stock-portal-web.service" <<EOF
[Unit]
Description=Stock Portal static web bundle
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/server/.env
ExecStart=/usr/bin/node $APP_DIR/server/serve-web.js $APP_DIR/web
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now stock-portal-api.service stock-portal-web.service
sleep 3
systemctl --user --no-pager status stock-portal-api.service | head -12
systemctl --user --no-pager status stock-portal-web.service | head -12

echo "=== health (loopback) ==="
curl -s -m 5 -w '\nHTTP=%{http_code}\n' "http://127.0.0.1:$PORT/api/health" || true
echo "=== health (LAN 192.168.37.200) ==="
curl -s -m 5 -w '\nHTTP=%{http_code}\n' "http://192.168.37.200:$PORT/api/health" || true
echo "=== web index ==="
curl -s -m 5 -o /dev/null -w 'HTTP=%{http_code} bytes=%{size_download}\n' "http://192.168.37.200:8088/"
echo "=== login ==="
curl -s -m 8 -X POST "http://192.168.37.200:$PORT/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@portal.local","password":"demo1234"}' | head -c 300
echo
