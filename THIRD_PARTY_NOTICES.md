# AutoCut: licenses and engine provenance

AutoCut's application code is available under GPL-3.0-or-later; see `LICENSE`. No paid APIs, remote processing, telemetry, third-party fonts, or runtime CDNs are used.

## Vendored runtime

- `vendor/ffmpeg/`: unmodified ESM JavaScript from **@ffmpeg/ffmpeg 0.12.15**, MIT, copyright 2019 Jerome Wu. License: `vendor/ffmpeg/LICENSE`. Source: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15/packages/ffmpeg . Original package: https://registry.npmjs.org/@ffmpeg/ffmpeg/-/ffmpeg-0.12.15.tgz
- `vendor/core/ffmpeg-core.js` and `ffmpeg-core.wasm`: unmodified single-threaded ESM **@ffmpeg/core 0.12.10**. Upstream package declares GPL-2.0-or-later; this distribution uses the GPLv3 option. Both GPLv2 (`vendor/core/COPYING.GPLv2`) and GPLv3 (`vendor/core/LICENSE`) texts are included. Original package metadata is preserved in `vendor/core/package-info.json`. Package: https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz
- Corresponding upstream source and build scripts: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1 (the core 0.12.10 release commit, not the similarly named wrapper tag). Downloadable source: https://github.com/ffmpegwasm/ffmpeg.wasm/archive/71aa99d37c02a7b4c435275ca9ef50e612f6efa1.tar.gz . The upstream Dockerfile and build scripts identify and build FFmpeg and codec dependencies, including x264 and libmp3lame. Review upstream licensing before redistributing altered builds. FFmpeg source: https://github.com/FFmpeg/FFmpeg ; x264 source: https://github.com/mirror/x264 ; LAME source mirror: https://github.com/rbrito/lame . FFmpeg and included libraries retain their original copyrights and licenses.

The WASM binary is about 31 MiB (32.2 MB decimal). It is intentionally stored as a normal repository file, not Git LFS, so GitHub Pages can serve it directly. No cross-origin isolation / COOP / COEP headers are required by the chosen single-threaded core. The JavaScript wrapper runs it in a module Web Worker. HTTPS (as provided by GitHub Pages) is required for service workers and installation.

## Optional developer tools

`package.json` and `package-lock.json` pin test-only development dependencies: Playwright (Apache-2.0), @sparticuz/chromium (MIT), and sharp (Apache-2.0, with bundled native dependency notices). They are **not shipped to visitors**, and there is no npm install or build step for deployment. Icons are original vector artwork, rendered to PNG with sharp.

## Privacy

The host serves static application files and the editing engine. Video data, editing instructions, and output are never sent to it. Files live in local object URLs and the worker's in-memory filesystem, not in service-worker caches. The service worker caches only an explicit list of application assets. Downloads and previews are local browser actions. Hosting providers may retain ordinary HTTP access logs for requests for the static site.
