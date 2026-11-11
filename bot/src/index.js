import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createQueue } from './queue.js';
import { buildTransport } from './transport.js';

/**
 * WhatsApp-style webhook receiver.
 *
 * GET  /webhook  - subscription handshake (hub.mode / hub.verify_token / hub.challenge)
 * POST /webhook  - inbound message events; acked immediately, dispatched asynchronously
 * GET  /stats    - queue depth + dead-letter count
 * GET  /health   - liveness
 */

export function createBot({ env = process.env, transport = buildTransport(env), logger = console } = {}) {
  const verifyToken = env.VERIFY_TOKEN || 'local-dev-token';
  const queue = createQueue({ logger });

  const json = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 1e6) reject(new Error('payload too large'));
      });
      req.on('end', () => resolve(raw));
      req.on('error', reject);
    });

  /** Meta signs the raw body when APP_SECRET is configured; verify before parsing. */
  function signatureValid(raw, header) {
    if (!env.APP_SECRET) return true;
    if (!header) return false;
    const expected = 'sha256=' + createHash('sha256').update(raw).update(env.APP_SECRET).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(header));
    return a.length === b.length && timingSafeEqual(a, b);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, transport: transport.name, ts: Date.now() });
    }

    if (req.method === 'GET' && url.pathname === '/stats') {
      return json(res, 200, queue.stats());
    }

    if (req.method === 'GET' && url.pathname === '/webhook') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === verifyToken) {
        logger.log('[webhook] verification handshake accepted');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(challenge ?? '');
      }
      logger.log('[webhook] verification rejected');
      return json(res, 403, { error: 'verification failed' });
    }

    if (req.method === 'POST' && url.pathname === '/webhook') {
      const raw = await readBody(req);

      if (!signatureValid(raw, req.headers['x-hub-signature-256'])) {
        logger.log('[webhook] invalid signature');
        return json(res, 401, { error: 'invalid signature' });
      }

      let payload;
      try {
        payload = JSON.parse(raw || '{}');
      } catch {
        return json(res, 400, { error: 'invalid JSON body' });
      }

      const messages = payload?.entry?.flatMap((entry) =>
        (entry?.changes || []).flatMap((change) => change?.value?.messages || []),
      ) || [];

      // Acknowledge first: the platform retries any 5xx/timeout and duplicates messages.
      json(res, 200, { received: messages.length });

      for (const message of messages) {
        const from = message.from;
        const text = message.text?.body ?? `[${message.type || 'unknown'} message]`;
        logger.log(`[inbound] from=${from} text="${text}"`);

        queue.enqueue({
          id: `${from}-${message.id || Date.now()}`,
          handler: () => transport.sendMessage({ to: from, text: `Echo: ${text}` }),
        });
      }
      return;
    }

    json(res, 404, { error: 'not found', path: url.pathname });
  });

  return { server, queue, transport, close: () => queue.close() };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const port = Number(process.env.PORT || 4010);
  const bot = createBot();
  bot.server.listen(port, () => {
    console.log(`[bot] webhook listening on http://localhost:${port}`);
    console.log(`[bot] transport: ${bot.transport.name}`);
    console.log('[bot] routes: GET /webhook (handshake) | POST /webhook (events) | GET /stats | GET /health');
  });
}
