# avi

avi is a local-first AI video editor. The product is a native desktop app for macOS, Windows, and Linux. Media stays on the computer. Cloud sign-in and Gemini are optional.

## Desktop app

Install [Rust](https://rustup.rs/) and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/), then:

```bash
npm install
npm run tauri:dev
```

That opens a native **avi** window. It does not open a browser tab.

`npm start` is the same command. `npm run tauri:build` produces the installable bundle for the OS you are on.

Before the first build, also install the pixel-filter toolchain:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

`npm run tauri:dev` and `npm run tauri:build` run `./wasm/build.sh` when `app/src/wasm-pkg` is missing.

### Linux

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

WebKitGTK 4.1 is the system webview. The runtime package is not enough. The `-dev` package supplies `webkit2gtk-4.1.pc` and `javascriptcoregtk-4.1.pc`.

Playback uses that webview's GStreamer plugins. If an imported file stays on a media error, install `gstreamer1.0-libav` and `gstreamer1.0-plugins-good`.

### macOS

Install Xcode Command Line Tools. The system WebKit is the webview. Build on a Mac. This repo does not cross-compile.

### Windows

Install the WebView2 runtime and Visual Studio Build Tools with the C++ workload. Build on Windows. This repo does not cross-compile or sign installers.

### Optional tools

`ffmpeg` on `PATH` creates 720p playback proxies. Editing and export work without it, and preview then uses the original file.

Copy `.env.example` only if you want Supabase sync or the Gemini proxy. Without those variables the desktop app still opens, edits, and exports offline.

## Web preview

`npm run dev` starts the same UI in a browser on http://127.0.0.1:3000, plus the optional API on port 4000. That path is for development. It has no native file dialogs. Use `npm run tauri:dev` to run avi.

See `ARCHITECTURE.md` for the editing model, the offline AI path, and the desktop content security policy.
