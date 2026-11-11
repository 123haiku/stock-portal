// Read the live resolved API base and the on-screen label from the WebView.
// Between launches the in-memory cache is empty, so this shows what the probe
// picked on this boot: the stashed value, or a fresh probe result.
import { execFileSync } from 'node:child_process';

const ADB = process.env.ADB || 'adb';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const raw = execFileSync(ADB, ['shell', 'cat', '/proc/net/unix'], { encoding: 'utf8' });
const socket = raw.match(/(webview_devtools_remote_\d+)/)[1];
execFileSync(ADB, ['forward', 'tcp:9333', `localabstract:${socket}`]);
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = list.find((t) => t.type === 'page') || list[0];

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) return { __error: res.exceptionDetails.text };
  return res.result.value;
};

async function label() {
  const text = await evaluate(`document.body.innerText`);
  const line = String(text).split('\n').find((l) => l.startsWith('API:')) || 'API: (label missing)';
  return line.trim();
}

console.log('label now:', await label());

// Wait for the probe to settle if it is still running.
for (let i = 0; i < 12; i += 1) {
  const line = await label();
  if (!line.includes('not resolved')) break;
  await sleep(1000);
}
console.log('label settled:', await label());

// Exercise the same resolution path the app used, read from the bundle's own state.
console.log('cached:', JSON.stringify(await evaluate(`Object.fromEntries(Object.entries(localStorage))`)));

// Perform a real login through the app's axios stack by submitting the form.
const login = await evaluate(`(async () => {
  const email = document.querySelector('input[type=email]');
  const password = document.querySelector('input[type=password]');
  const form = document.querySelector('form');
  email.value = 'admin@portal.local';
  email.dispatchEvent(new Event('input', { bubbles: true }));
  password.value = 'demo1234';
  password.dispatchEvent(new Event('input', { bubbles: true }));
  form.requestSubmit();
  await new Promise((r) => setTimeout(r, 2500));
  return {
    stored: Object.fromEntries(Object.entries(localStorage)),
    text: document.body.innerText.slice(0, 500)
  };
})()`);
console.log('after submit:', JSON.stringify(login, null, 2));

ws.close();
process.exit(0);
