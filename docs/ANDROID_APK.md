# Android APK - install and run

`release/StockPortal-1.2.apk` (4.05 MB) is a signed debug build of the portal
wrapped in a Capacitor native shell. It is the same Vue codebase as the web app,
compiled into the APK, so it runs without a browser or a dev server.

## What the APK expects

The shell serves the bundle from `http://localhost` inside the WebView, so a
relative `/api` has nowhere to go. `web/src/apiBase.js` resolves the API origin
at startup by probing a candidate list and caching the winner in
`localStorage` under `portal.apiBase`:

| Order | Candidate | Why |
| --- | --- | --- |
| 1 | cached `portal.apiBase` | written by the previous successful launch |
| 2 | build-time `VITE_API_URL` | pins one origin and skips the probe entirely |
| 3 | `window.location.origin + /api` | a real browser host, same-origin |
| 4 | `https://portal.ngc6543.tech/api` | public Cloudflare Tunnel endpoint, works on any network |
| 5 | `http://192.168.37.200:4000/api` | the Raspberry Pi on the home LAN |
| 6 | `http://localhost:4000/api` | `adb reverse tcp:4000 tcp:4000` over USB |
| 7 | `http://10.0.2.2:4000/api` | Android emulator host loopback |

The first candidate whose `GET /api/health` returns `{"ok":true}` wins and is
stored. Every request waits on that same probe, so the first login is never
raced against an unresolved base URL.

The login screen prints the address in use at the bottom (`API: ...`). Tapping it
opens a field that rewrites the cached value and reloads the WebView, so a phone
can be pointed at a different server without rebuilding the APK.

Version 1.0 of the APK baked a single address (`http://192.168.37.142:4000/api`)
into the bundle. When that laptop address moved, every request sat for 10 s and
surfaced `timeout of 10000ms exceeded`; the login itself never failed.

## Install on the phone

1. Copy `StockPortal-1.1.apk` to the phone: USB cable, Google Drive, WhatsApp to
   yourself, or email attachment.
2. Tap the file in the phone's Files app.
3. Android asks to allow installs from this source - accept it (Settings >
   Apps > Special access > Install unknown apps > Files > Allow).
4. Install, then open **Stock Portal**.

The app shows a splash screen, then the login page. Sign in with
`admin@portal.local` / `demo1234`.

## The API on the Raspberry Pi

The API and the static web bundle run as systemd user units on the Pi
(`192.168.37.200`, Tailscale `100.124.72.105`), from `~/stock-portal`:

| URL | What |
| --- | --- |
| `https://portal.ngc6543.tech/` | public: the Vue bundle through Cloudflare Tunnel |
| `https://portal.ngc6543.tech/api/health` | public: the API through the same tunnel |
| `http://192.168.37.200:4000/api/health` | LAN: API liveness |
| `http://192.168.37.200:8088/` | LAN: the same Vue bundle |

```bash
ssh pi4 'systemctl --user status stock-portal-api.service'
ssh pi4 'systemctl --user status stock-portal-web.service'
ssh pi4 'journalctl --user -u stock-portal-api.service -n 30 --no-pager'
ssh pi4 'curl -s http://127.0.0.1:4000/api/health'
```

## Cloudflare Tunnel routing

The Pi runs one named tunnel (`209278a2-be88-4639-a032-096f7a3ccb45`,
`cloudflared.service`, token in `/etc/cloudflared/token`). Its ingress keeps every
existing hostname and adds the portal entries:

```
api.ngc6543.tech        -> localhost:8000   (pre-existing, untouched)
portal.ngc6543.tech/api/.* -> localhost:4000
portal.ngc6543.tech     -> localhost:8088
catch-all               -> http_status:404
```

`deploy/cf-setup.mjs` performs the merge through the Cloudflare API and creates
the proxied CNAME. It needs a token from
<https://dash.cloudflare.com/profile/api-tokens> with `Zone > DNS:Edit`
(scoped to `ngc6543.tech`) and `Account > Cloudflare Tunnel:Edit`:

```powershell
cd stock-portal
$env:CLOUDFLARE_API_TOKEN = "<token>"
$env:CLOUDFLARE_ACCOUNT_ID = "c2d025ab2cbcafa619beb6e5a7ddb5c7"
node deploy\cf-setup.mjs --dry-run   # prints ingress before/after, writes nothing
node deploy\cf-setup.mjs             # applies ingress + DNS
Remove-Item Env:CLOUDFLARE_API_TOKEN
```

The script verifies the token on `/user/tokens/verify`. Tokens created in the
dashboard are user-owned: `/accounts/{id}/tokens/verify` rejects them with
`1000 Invalid API Token` even when they are valid, so that endpoint is the wrong
probe.

`cloudflared` pulls the remote configuration at startup; no local `config.yml` is
involved. A tunnel-token credential can only register the tunnel - it cannot
change DNS or ingress, which is why the API token (or the dashboard) is required.

Deployment is scripted from the repository root (PowerShell, Windows host):

```powershell
python deploy\stage.py                       # copy server/ + web/dist into build/stage
scp -r "build\stage\*" pi4:stock-portal-stage/
ssh pi4 'bash /tmp/pi-deploy.sh ~/stock-portal-stage'
```

`deploy/pi-deploy.sh` rsyncs the staged tree into `~/stock-portal`, runs
`npm ci --omit=dev`, writes `.env` (random `JWT_SECRET`, absolute `DB_PATH`) and
(re)installs the two systemd units. `deploy/pi-verify.sh` runs the API test
suite plus live login / auth-negative checks against the deployed service.

The Pi needs Node 22 or newer: `server/src/db.js` imports `node:sqlite`, which
Debian 13's Node 20 does not provide (`ERR_UNKNOWN_BUILTIN_MODULE`).

## Rebuilding with a different API address

```powershell
cd web

# Pin one origin (skips the runtime probe):
$env:VITE_API_URL="http://<HOST>:4000/api"
npx vite build
npx cap sync android

cd android
$env:JAVA_HOME="C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleDebug
# signed APK: app\build\outputs\apk\debug\app-debug.apk
```

Set `JAVA_TOOL_OPTIONS=-Duser.language=en -Duser.country=US` (user environment
variable) before building. With a non-English default locale Gradle can stop
before packaging, leaving the previous APK in `outputs/` untouched - the build
prints `BUILD SUCCESSFUL` while the artifact on disk is the old one.

## Verifying the installed APK

```powershell
$env:ADB="$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
node deploy\e2e-label.mjs     # reads the resolved base, submits the login form
node deploy\e2e-probe.mjs     # probes every candidate from inside the WebView
```

Both attach over `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`
and speak CDP to the app's WebView. A passing run prints the resolved base
(`http://192.168.37.200:4000/api`), the stored JWT and the rendered product list.

## Rebuilding checklist

| Symptom | Cause | Fix |
| --- | --- | --- |
| `timeout` / `Network Error` toast with a host in parentheses | that host did not answer `/api/health` | start the API, or open the `API:` field on the login screen and point it elsewhere |
| `API: not resolved` after 10 s | no candidate answered | check the phone is on the same Wi-Fi as the server, or that `adb reverse` is up |
| App opens to a blank white page | `npx cap sync` skipped after `vite build` | run `npx cap sync android`, rebuild |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | a different build with the same package id is installed | `adb uninstall com.weisheng.stockportal` first |
| Gradle fails with `Unsupported class file major version` | JDK too new | `JAVA_HOME` to JDK 21 |
| APK on disk does not change after `BUILD SUCCESSFUL` | Gradle stopped before packaging (locale/daemon) | set `JAVA_TOOL_OPTIONS` as above, rerun with `--console=plain` and read the tail |

## Technical notes for the interview

- **Same codebase, two shells.** `web/` builds once; the browser loads it over
  HTTP, the APK loads the identical bundle from `android/app/src/main/assets/public`.
- **The API origin is resolved, not compiled in.** `apiBase.js` probes a
  candidate list at startup and caches the hit, which is what makes one build
  work against the Pi, an emulator and a USB-tethered phone.
- **Capacitor provides the bridge** (WebView, splash screen, app lifecycle) while
  Vue provides the interface.
- **Debug signing** is used here: `apksigner verify` reports `CN=Android Debug`.
  A Play Store release needs a private keystore and an `assembleRelease` build.
