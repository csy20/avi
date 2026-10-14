# avi

Local-first AI video editor. The web app lives in `app/`, the optional API in `api/`, and the Rust pixel filters in `wasm/`.

The project name is **avi**.

## Web

```bash
npm install
npm run dev
```

- App: http://localhost:3000
- API: http://localhost:4000

Copy `.env.example` before using Supabase or Gemini. Cloud save and the hosted model are optional. Without those variables the editor still opens and stores the timeline locally.

## Desktop

The desktop shell is Tauri 2 in `src-tauri/`. It loads the same Vite app.

```bash
npm install
npm run tauri:dev
npm run tauri:build
```

`npm run dev` is still the web app plus the optional API. `npm run tauri:dev` starts only the Vite app and the native window.

Install the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS, plus a stable Rust toolchain.

Linux (Debian or Ubuntu):

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

macOS needs Xcode Command Line Tools. Windows needs the WebView2 runtime and Visual Studio Build Tools with the C++ workload. Build each OS on that OS. This repository does not cross-compile or sign those installers.

`ffmpeg` on `PATH` enables 720p playback proxies. Editing and export work without it; preview then uses the original file.

Rebuild the pixel filters after changing `wasm/src`:

```bash
./wasm/build.sh
```

See `ARCHITECTURE.md` for the editing model, the offline AI path, and why the desktop content security policy is currently unset.
