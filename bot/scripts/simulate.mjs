/**
 * Demo driver: fires a burst of inbound webhook events at a running bot and
 * reports the queue's behaviour. Used for the interview walkthrough.
 *
 * Usage: npm run simulate   (bot must already be listening on PORT, default 4010)
 */

const BASE = process.env.BASE_URL || 'http://localhost:4010';
const COUNT = Number(process.env.COUNT || 8);

function event(id, body) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA-DEMO',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '60123456789' },
              messages: [
                {
                  from: '60111222333',
                  id,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

const started = Date.now();
console.log(`[sim] posting ${COUNT} inbound events to ${BASE}/webhook`);

const responses = await Promise.all(
  Array.from({ length: COUNT }, async (_, i) => {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event(`wamid.sim.${i}`, `order enquiry ${i + 1}`)),
    });
    const body = await res.json();
    return { status: res.status, ms: Date.now() - t0, body };
  }),
);

const statuses = [...new Set(responses.map((r) => r.status))];
const slowest = Math.max(...responses.map((r) => r.ms));
const fastest = Math.min(...responses.map((r) => r.ms));
console.log(`[sim] statuses=${statuses.join(',')} ack latency min=${fastest}ms max=${slowest}ms`);

// Poll the queue until it settles or the deadline passes.
const deadline = Date.now() + 20000;
let last;
while (Date.now() < deadline) {
  const snapshot = await (await fetch(`${BASE}/stats`)).json();
  if (last && last.pending === 0 && snapshot.pending === 0 && snapshot.deadLetters === last.deadLetters) break;
  last = snapshot;
  if (snapshot.pending === 0) break;
  await new Promise((r) => setTimeout(r, 400));
}

const final = await (await fetch(`${BASE}/stats`)).json();
console.log(`[sim] queue settled: pending=${final.pending} deadLetters=${final.deadLetters} in ${Date.now() - started}ms`);
console.log('[sim] note: dead letters are expected with FAKE_FAILURE_RATE>0 - they prove the retry path ran');
