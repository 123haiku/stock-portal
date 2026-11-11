/**
 * In-memory dispatch queue with exponential backoff.
 *
 * Design points that matter:
 *  - FIFO order is preserved per queue run (head-of-line blocking is acceptable
 *    for a single WhatsApp session; a real deployment would shard by recipient).
 *  - The webhook handler returns 200 immediately and hands work here, because a
 *    slow webhook response makes the platform retry and duplicate the message.
 *  - Failures retry with a capped exponential backoff, then dead-letter.
 */

export function createQueue({ maxAttempts = 5, baseDelayMs = 250, maxDelayMs = 8000, logger = console } = {}) {
  const pending = [];
  const deadLetters = [];
  let draining = false;
  let timer = null;

  const stats = () => ({
    pending: pending.length,
    deadLetters: deadLetters.length,
    draining,
  });

  async function drain() {
    if (draining) return;
    draining = true;

    while (pending.length) {
      const job = pending[0];
      try {
        const result = await job.handler();
        pending.shift();
        logger.log(`[queue] ok id=${job.id} attempts=${job.attempts} -> ${JSON.stringify(result)}`);
      } catch (err) {
        job.attempts += 1;
        if (job.attempts >= maxAttempts) {
          pending.shift();
          deadLetters.push({ ...job, error: err.message });
          logger.log(`[queue] dead-letter id=${job.id} after ${job.attempts} attempts: ${err.message}`);
          continue;
        }
        const delay = Math.min(baseDelayMs * 2 ** job.attempts, maxDelayMs);
        logger.log(`[queue] retry id=${job.id} attempt=${job.attempts} in ${delay}ms: ${err.message}`);
        draining = false;
        timer = setTimeout(() => {
          timer = null;
          drain();
        }, delay);
        return;
      }
    }

    draining = false;
  }

  function enqueue(job) {
    const entry = { attempts: 0, enqueuedAt: Date.now(), ...job };
    pending.push(entry);
    // Yield so the HTTP response is flushed before the first send attempt.
    setImmediate(() => drain());
    return entry;
  }

  function close() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { enqueue, stats, close, pending, deadLetters };
}
