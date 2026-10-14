# avi architecture

avi is a local-first non-linear editor. The desktop app is the primary product. The browser build is the same React UI without native file access.

## Layout

```
avi/
├── app/          React + Vite editor
├── api/          Optional Express API (Gemini proxy)
├── wasm/         Rust pixel filters, compiled to WASM
└── src-tauri/    Tauri 2 desktop shell
```

Package names are `avi`, `@avi/app`, and `@avi/api`. The Rust desktop crate is `avi` and the WASM crate is `avi-wasm`.

## Desktop shell

Tauri 2 wraps the Vite app. The shell crate requires `tauri` 2.9, and `Cargo.lock` resolves that to 2.12.3. `@tauri-apps/cli` 2.12 drives it. The locked plugins are `tauri-build` 2.7.2, `tauri-plugin-dialog` 2.8.2, and `tauri-plugin-fs` 2.7.0. `src-tauri/tauri.conf.json` points `devUrl` at `http://127.0.0.1:1420` and `frontendDist` at `../app/dist`. `beforeDevCommand` and `beforeBuildCommand` set `cwd` to the repo root, so `npm run tauri:dev` and `npm run tauri:build` work from that root on macOS, Windows, and Linux. The browser preview stays on port 3000 and is not the product.

The window title is `avi`. The bundle identifier is `me.csy20.avi`.

Native open and save dialogs come from `tauri-plugin-dialog`. Export bytes are written with `tauri-plugin-fs`. Selected media is not copied into IndexedDB. `allow_media_path` registers the real file for the session. Playback does not use `convertFileSrc`: WebKitGTK reports media error 4 for `asset://` video URLs. The shell instead serves only those allowed files from `127.0.0.1` with HTTP range requests, and the editor points `<video>` at that URL.

`security.csp` is `null`. The editor loads Vite, WASM, Remotion media, and the Tauri asset origin. A strict CSP would block those before a dedicated policy exists. Tighten it before a public release.

Playback proxies are optional. When `ffmpeg` is on `PATH`, `generate_proxy` writes `proxies/{assetId}.mp4` in the app cache (`scale=-2:720`, libx264 veryfast, CRF 28). The preview prefers that file. Export always uses the original. Import does not wait for the proxy. If ffmpeg is missing, preview plays the original.

## Timeline

Tracks and clips stay the existing model: integer frames at the project `fps`, inclusive `startFrame` / `endFrame`, and source `mediaStart` / `mediaEnd`. Overlap on one track is legal. Later clips paint over earlier ones. Undo stores the last 50 full trees.

Move is a live update and becomes one history step on mouseup. Dragging snaps within 8 frames to frame 0, the playhead, and other clip edges. Arrow keys nudge by 1 frame, or 5 with Shift, and do not snap. Shift+Delete ripple-deletes. Roll edits are not implemented.

## Preview and color

Remotion Player is the compositor. While the playhead is moving, a clip `pixelFilter` is a CSS filter. While it is paused, the same frame is also drawn through the WASM filters (`grayscale`, `sepia`, `invert`, `brightness`, `color_matrix` for warm). If the canvas is tainted, the CSS image stays. Export runs the WASM filter on the original frames and skips the filter for a frame when the pixels cannot be read.

Export is a realtime MediaRecorder WebM, not a Remotion server render and not a WebCodecs MP4. The user can choose 720p (5 Mbps) or 1080p (8 Mbps). In the desktop app the file is written through a save dialog.

## Projects and AI

With no Supabase env vars the editor opens immediately. The working timeline is stored at `avi.localProject.v1` in `localStorage`. Media bytes for browser uploads stay in IndexedDB (`avi-local-assets`). Signing in promotes a non-empty local timeline to a new cloud project. Cloud save runs only while a session exists.

`POST /api/prompt` still prefers Gemini. The model id is `GEMINI_MODEL`, default `gemini-3.6-flash`. A missing key or a response that fails Zod validation uses the same keyword heuristics as the client. The prompt modal does not require a session: it calls the API when a token exists and otherwise runs `applyLocalPrompt`. The result is staged for accept or reject. `previewUrl` is not persisted; the client restores it from the current timeline by `assetId`.

Saved cloud JSON is still a bare `Track[]`. `projects.schema_version` is unused until a migrator exists. Unknown future document versions should be refused rather than guessed.

## What this host can verify

`npm test` passes. On this Linux machine `npm run tauri:dev` opens a native window titled **avi** and loads the editor from `http://127.0.0.1:1420`. A local H.264 file plays in that window through the loopback media server. `cargo test --lib media_server` covers range responses and the allow list.

`npm run tauri:build` produced unsigned Linux bundles: `avi_0.1.0_amd64.deb`, `avi-0.1.0-1.x86_64.rpm`, and `avi_0.1.0_amd64.AppImage`. The deb depends on `libwebkit2gtk-4.1-0` and `libgtk-3-0`. The bundle step needs `patchelf`, which is in the README package list. macOS and Windows bundles are configured (`bundle.targets` is `all`) and have to be built on those systems. Nothing here is signed.
