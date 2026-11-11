/**
 * Transport layer.
 *
 * Two implementations:
 *  - "fake"  : logs to stdout and fails on a configurable share of calls so the
 *              retry/backoff path is demonstrable without any network access.
 *  - "cloud" : WhatsApp Cloud API (Graph) send-message call. Requires
 *              WHATSAPP_TOKEN and WHATSAPP_PHONE_ID.
 *
 * The queue never knows which one it is talking to.
 */

export function createFakeTransport({ failureRate = 0.15, latencyMs = 60, logger = console } = {}) {
  let delivered = 0;
  return {
    name: 'fake',
    async sendMessage({ to, text }) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      if (Math.random() < failureRate) throw new Error('simulated transient network failure');
      delivered += 1;
      logger.log(`[outbound:fake] to=${to} text="${text}"`);
      return { delivered, to, text };
    },
  };
}

export function createCloudTransport({ token, phoneId, apiVersion = 'v21.0', logger = console } = {}) {
  if (!token || !phoneId) {
    throw new Error('WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are required for the cloud transport');
  }
  const endpoint = `https://graph.facebook.com/${apiVersion}/${phoneId}/messages`;

  return {
    name: 'cloud',
    async sendMessage({ to, text }) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        // 4xx (except 429) will never succeed on retry, so fail loudly and let the
        // caller decide whether to dead-letter.
        throw new Error(`graph ${response.status}: ${body.slice(0, 200)}`);
      }

      const data = await response.json();
      logger.log(`[outbound:cloud] to=${to} message_id=${data.messages?.[0]?.id}`);
      return { messageId: data.messages?.[0]?.id };
    },
  };
}

export function buildTransport(env = process.env) {
  if (env.TRANSPORT === 'cloud') {
    return createCloudTransport({ token: env.WHATSAPP_TOKEN, phoneId: env.WHATSAPP_PHONE_ID });
  }
  return createFakeTransport({
    failureRate: Number(env.FAKE_FAILURE_RATE ?? 0.15),
  });
}
