#!/usr/bin/env bash
# Verify the deployed API on the Pi: test suite, live login, DB row counts.
set -u
cd "$HOME/stock-portal/server" || exit 1

echo "=== api tests ==="
node --test test/api.test.js 2>&1 | tail -14

echo "=== live endpoints ==="
curl -s -m 5 -o /dev/null -w 'health HTTP=%{http_code}\n' http://127.0.0.1:4000/api/health
TOKEN=$(curl -s -m 5 -X POST http://127.0.0.1:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"sales@portal.local","password":"demo1234"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -n "$TOKEN" ]; then
  echo "login: token len ${#TOKEN}"
else
  echo "login: FAILED"
fi
curl -s -m 5 -o /dev/null -w 'products HTTP=%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:4000/api/products?limit=5"
curl -s -m 5 -o /dev/null -w 'products-noauth HTTP=%{http_code}\n' "http://127.0.0.1:4000/api/products"
curl -s -m 5 -o /dev/null -w 'badlogin HTTP=%{http_code}\n' -X POST http://127.0.0.1:4000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@portal.local","password":"wrong"}'

echo "=== db rows ==="
node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.env.HOME+"/stock-portal/server/data/portal.db");for(const t of ["products","categories","users","quotes"]){console.log(t, d.prepare("SELECT COUNT(*) n FROM "+t).get().n);}' 2>&1 | grep -v Experimental
