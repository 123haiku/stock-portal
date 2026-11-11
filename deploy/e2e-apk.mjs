// Drive the installed Stock Portal APK over the DevTools protocol through adb
// port-forward: log in against the Pi-hosted API, then read back the resolved
// API base and the products payload. Prints a JSON summary.
import { execFileSync } from 'node:child_process';

const ADB = process.env.ADB || 'adb';
const API_BASE = process.env.EXPECT_API || 'http://192.168.37.200:4000/api';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sh(args) {
  return execFileSync(ADB, args, { encoding: 'utf8' }).trim();
}

async function devtoolsTargets() {
  for (let i = 0; i < 20; i += 1) {
    try {
      const raw = execFileSync(ADB, ['shell', 'cat', '/proc/net/unix'], { encoding: 'utf8' });
      const match = raw.match(/@?devtools_remote[\w.-]*/);
      if (match) return match[0].replace(/^@/, '');
    } catch {
      /* keep polling */
    }
    await sleep(500);
  }
  throw new Error('no devtools socket found');
}

async function waitForWebView() {
  for (let i = 0; i < 30; i += 1) {
    const out = execFileSync(ADB, ['shell', 'cat', '/proc/net/unix'], { encoding: 'utf8' });
    const socket = out.match(/(webview_devtools_remote_\d+)/);
    if (socket) return socket[1];
    await sleep(500);
  }
  throw new Error('WebView devtools socket did not appear');
}

async function main() {
  const socket = await waitForWebView();
  console.log('socket:', socket);

  execFileSync(ADB, ['forward', 'tcp:9333', `localabstract:${socket}`]);
  const list = await (await fetch('http://127.0.0.1:9333/json')).json();
  const page = list.find((t) => t.type === 'page') || list[0];
  if (!page) throw new Error('no inspectable page');
  console.log('page:', page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  await new Promise((resolve) => ws.addEventListener('open', resolve));
  await send('Runtime.enable');
  await sleep(1500);

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result.value;
  };

  // The probe runs once per page load; give it time to settle before reading.
  for (let i = 0; i < 10; i += 1) {
    const base = await evaluate(`localStorage.getItem('portal.apiBase')`);
    if (base) break;
    await sleep(1000);
  }

  const diagnostics = await evaluate(`(() => ({
    url: location.href,
    apiBase: localStorage.getItem('portal.apiBase'),
    hasLoginForm: !!document.querySelector('input[type=email]'),
    bodyText: document.body.innerText.slice(0, 400)
  }))()`);
  console.log('diagnostics:', JSON.stringify(diagnostics, null, 2));

  const loginResult = await evaluate(`(async () => {
    const res = await fetch(localStorage.getItem('portal.apiBase') + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.local', password: 'demo1234' })
    });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem('portal.token', data.token);
      localStorage.setItem('portal.user', JSON.stringify(data.user));
    }
    return { status: res.status, user: data.user || null, error: data.error || null };
  })()`);
  console.log('login:', JSON.stringify(loginResult));

  if (loginResult.status === 200) {
    // Reload so the app boots into the authenticated view using the stored token.
    await send('Page.enable').catch(() => {});
    await send('Page.reload').catch(() => {});
    await sleep(3000);
    const authed = await evaluate(`(() => ({
      apiBase: localStorage.getItem('portal.apiBase'),
      productsTab: !!document.querySelector('table, .card'),
      signOut: document.body.innerText.includes('Sign out'),
      sample: document.body.innerText.slice(0, 300)
    }))()`);
    console.log('authed:', JSON.stringify(authed, null, 2));
  }

  const expectedOk = loginResult.status === 200 && diagnostics.apiBase === API_BASE;
  console.log('RESULT', expectedOk ? 'PASS' : 'FAIL');
  ws.close();
  return expectedOk ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('ERROR', err.message);
    process.exit(2);
  });
