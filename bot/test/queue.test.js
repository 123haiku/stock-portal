import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../src/queue.js';

const silent = { log() {} };

test('queue delivers a job and records success', async () => {
  const queue = createQueue({ logger: silent });
  let calls = 0;
  queue.enqueue({ id: 'ok-1', handler: async () => { calls += 1; return 'done'; } });

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls, 1);
  assert.equal(queue.stats().pending, 0);
  queue.close();
});

test('queue retries with backoff then succeeds', async () => {
  const queue = createQueue({ baseDelayMs: 10, maxDelayMs: 20, logger: silent });
  let attempts = 0;
  queue.enqueue({
    id: 'flaky',
    handler: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient');
      return 'ok';
    },
  });

  await new Promise((r) => setTimeout(r, 300));
  assert.equal(attempts, 3);
  assert.equal(queue.stats().pending, 0);
  assert.equal(queue.stats().deadLetters, 0);
  queue.close();
});

test('queue dead-letters after maxAttempts', async () => {
  const queue = createQueue({ maxAttempts: 3, baseDelayMs: 5, maxDelayMs: 10, logger: silent });
  queue.enqueue({ id: 'poison', handler: async () => { throw new Error('always fails'); } });

  await new Promise((r) => setTimeout(r, 300));
  assert.equal(queue.stats().pending, 0);
  assert.equal(queue.stats().deadLetters, 1);
  assert.equal(queue.deadLetters[0].attempts, 3);
  queue.close();
});

test('queue preserves FIFO order', async () => {
  const queue = createQueue({ logger: silent });
  const order = [];
  for (const n of [1, 2, 3, 4]) {
    queue.enqueue({ id: `fifo-${n}`, handler: async () => { order.push(n); } });
  }

  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(order, [1, 2, 3, 4]);
  queue.close();
});
