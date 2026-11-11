import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/index.js';

const silent = { log() {} };
const alwaysOk = { name: 'stub', async sendMessage({ to, text }) { return { delivered: true, to, text }; } };

let bot;
let base;

before(async () => {
  bot = createBot({ env: { VERIFY_TOKEN: 'test-token' }, transport: alwaysOk, logger: silent });
  await new Promise((resolve) => bot.server.listen(0, resolve));
  base = `http://localhost:${bot.server.address().port}`;
});

after(() => {
  bot.close();
  bot.server.close();
});

const inbound = (id, text) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { messages: [{ from: '60123', id, type: 'text', text: { body: text } }] } }] }],
});

test('GET /webhook returns challenge for a valid token', async () => {
  const res = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=test-token&hub.challenge=abc123`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'abc123');
});

test('GET /webhook rejects a wrong token', async () => {
  const res = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=x`);
  assert.equal(res.status, 403);
});

test('POST /webhook acks fast and dispatches asynchronously', async () => {
  const t0 = Date.now();
  const res = await fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(inbound('wamid.1', 'hello')),
  });
  const elapsed = Date.now() - t0;

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: 1 });
  assert.ok(elapsed < 500, `ack took ${elapsed}ms`);

  await new Promise((r) => setTimeout(r, 60));
  assert.equal(bot.queue.stats().pending, 0);
});

test('POST /webhook ignores payloads without messages', async () => {
  const res = await fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: 0 });
});

test('POST /webhook rejects malformed JSON', async () => {
  const res = await fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
});
