# Android APK - install and run

`release/StockPortal-1.0.apk` (3.99 MB) is a signed debug build of the portal
wrapped in a Capacitor native shell. It is the same Vue codebase as the web app,
compiled into the APK, so it runs without a browser or a dev server.

## What the APK expects

The APK talks to the API on a fixed address baked in at build time:

| Build target | API URL baked into the bundle |
| --- | --- |
| This build (LAN) | `http://192.168.37.142:4000/api` |
| Emulator | `http://10.0.2.2:4000/api` |
| USB-tethered phone | `http://localhost:4000/api` + `adb reverse tcp:4000 tcp:4000` |

**The phone and the laptop must be on the same Wi-Fi**, and the API must be
running on the laptop. If the laptop's IP changes (DHCP, different network),
rebuild with the new address - see "Rebuilding" below.

## Install on the phone

1. Copy `StockPortal-1.0.apk` to the phone: USB cable, Google Drive, WhatsApp to
   yourself, or email attachment.
2. Tap the file in the phone's Files app.
3. Android asks to allow installs from this source - accept it (Settings >
   Apps > Special access > Install unknown apps > Files > Allow).
4. Install, then open **Stock Portal**.

The app shows a splash screen, then the login page. Sign in with
`admin@portal.local` / `demo1234`.

First launch while the API is down shows a red toast: `Network Error`. That means
the phone cannot reach the laptop, not that the app is broken.

## Start the backend before opening the app

```powershell
cd stock-portal\server
npm start          # must print "listening on http://localhost:4000"
```

Verify the phone can reach it - open `http://192.168.37.142:4000/api/health` in the
phone's browser. It must return `{"ok":true,...}`. If it does not, the Windows
firewall is blocking inbound port 4000:

```powershell
# run in an elevated PowerShell
New-NetFirewallRule -DisplayName "Stock Portal API 4000" -Direction Inbound `
  -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private,Domain
```

## Rebuilding with a different API address

```powershell
cd stock-portal\web

# 1. find the current LAN IP
ipconfig | Select-String "IPv4"

# 2. bake the address into the bundle and rebuild
$env:VITE_API_URL="http://<LAPTOP_IP>:4000/api"
npx vite build
npx cap sync android

# 3. compile the APK
cd android
$env:JAVA_HOME="C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleDebug

# 4. the signed APK is at
#    android\app\build\outputs\apk\debug\app-debug.apk
```

## Install over USB instead of Wi-Fi (no firewall changes)

```powershell
$adb="$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

# phone in developer mode, USB debugging on, cable connected
& $adb devices                       # must list your device as "device"
& $adb reverse tcp:4000 tcp:4000     # phone's localhost:4000 -> laptop:4000
& $adb install -r release\StockPortal-1.0.apk
```

With the reverse tunnel, rebuild using `VITE_API_URL=http://localhost:4000/api`.

## Rebuilding checklist

| Symptom | Cause | Fix |
| --- | --- | --- |
| Red `Network Error` toast | API not running, wrong IP, or firewall | Start the API, check the health URL in the phone browser |
| App opens to a blank white page | `npx cap sync` skipped after `vite build` | Run `npx cap sync android`, rebuild |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | A different build with the same package id is installed | Uninstall the old app first |
| Gradle fails with `Unsupported class file major version` | JDK too new | Set `JAVA_HOME` to JDK 21 (already installed at `C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot`) |

## Technical notes for the interview

- **Same codebase, two shells.** `web/` builds once; the browser loads it over
  HTTP, the APK loads the identical bundle from `android/app/src/main/assets/public`.
  No native UI is written by hand.
- **The API origin is the only difference**, injected at build time through
  `VITE_API_URL` and read in `web/src/api.js`. That is why one `vite build` can
  target an emulator, a LAN phone, or a deployed server.
- **Capacitor provides the bridge** (WebView, splash screen, app lifecycle) while
  Vue provides the interface.
- **Debug signing** is used here: `apksigner verify` reports
  `CN=Android Debug`. A Play Store release needs a private keystore and an
  `assembleRelease` build - deliberately out of scope for a demo.
