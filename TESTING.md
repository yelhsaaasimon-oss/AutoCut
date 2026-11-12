# AutoCut verification

Tested on **2026-11-12**. This is a working static-browser application, not a simulated processing flow.

## Automated results

- `npm test`: **25 passing tests** for all requested example instructions, composed commands, decimal timings, unknown clauses, conflicting instructions, supported speed and volume bounds, trim validation, correct input-duration handling for slow motion, mute, audio-only restrictions, chained tempo filters, bounded fades, blank-input conversion, required files, and manifest/icon dimensions.
- `npm run test:browser`: **passed** using Chromium 153 with Playwright, Android Chrome user agent, touch/mobile emulation, and 390px/360px viewports. A 1440px screenshot was also inspected. The site was served under `/AutoCut/`, not just the domain root.
- `npm audit`: **0 reported vulnerabilities**, including development dependencies at test time. This is not a security guarantee for all upstream compiled codecs.

### Real browser/media checks

1. Application loads without page errors or horizontal overflow at tested phone widths.
2. Service worker installs, activates, and controls the project URL.
3. The shipped, single-threaded FFmpeg engine initializes with **crossOriginIsolated=false** and **SharedArrayBuffer unavailable**. Tests do not disable web security or relax SharedArrayBuffer restrictions.
4. The actual WASM engine creates a four-second H.264/AAC test fixture locally. No remote sample service is used.
5. Unsupported instructions disable processing and display an understandable error.
6. A composed edit applies start/end trim, vertical crop, grayscale, brighten, fade-in/out, lower volume, and 2× speed. The generated MP4 is probed: **H.264 video, AAC audio, 134×240 even-dimension center crop, approximately 1.5 seconds**.
7. Actual output frames are decoded: their RGB channels confirm grayscale; the start frame is black and the later frame contains image detail, confirming a real fade-in.
8. A real browser download has the correct `-autocut.mp4` filename.
9. A trim that removes the entire video produces a persistent error and preserves the original.
10. MP3 export produces **one MP3 audio stream, approximately eight seconds** for a four-second source slowed to half speed.
11. Mute produces an MP4 with **only a video stream**.
12. Cancel terminates processing and restores controls. A later job still succeeds.
13. After caching the engine, the browser goes offline, reloads from cold, and creates an actual **240×240 square MP4** from the cached app and WASM engine.
14. No external HTTP requests are made by the runtime, and no uncaught page errors occur.

## Limits of this verification

- A **physical Android phone and a real home-screen install were not available** in this environment. Mobile browser emulation does not prove memory/performance compatibility on every Android device.
- GitHub Pages production deployment and repository Settings → Pages are not changed by the app files. Use the phone-only instructions in README after the changes are merged to `main`.
- Tests use short, low-resolution footage. Actual large/4K sources can exceed phone memory even below the protective file-size cap. The user gets a warning, not a promise that every file will fit.
- Files with every possible codec, HDR, variable frame rate, camera rotation, and unusual timestamp layouts have not been exhaustively tested. A codec unsupported by Chrome can be attempted in FFmpeg; success is not guaranteed. There is no HDR color-management pipeline.
- Offline availability depends on browser storage retention and completion of the first engine download. Installation and persistent storage are browser decisions.
- Normal caught errors are shown in the app. Android killing a tab under memory pressure cannot be caught.

## Optional maintainer reproduction

These are **not required to deploy or use AutoCut from a phone**:

1. `npm install` (Node 22+; development dependencies only).
2. `npm test`.
3. `npm run serve` (development-only static server, port 5173, binds 0.0.0.0; no backend processing).
4. In another terminal, `npm run test:browser`.

The automated browser test uses the Linux x64 Chromium binary from npm and its bundled NSS libraries so it does not require a blocked external Playwright browser download in a minimal sandbox. Standard compatible Linux system libraries are still needed. `TEST_URL` can point to a different test host; the default deliberately includes `/AutoCut/`. Generated media, browser libraries, and screenshots are ignored under `tests/fixtures/` and `.arena/`. They are not application assets or repository deliverables.

For a published-site phone smoke test: open the site in Android Chrome, edit and download a short MP4, install from Chrome's menu, close/reopen the app, then repeat after turning on airplane mode. Confirm that a local video remains readable while offline.
