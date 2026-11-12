# AutoCut

**Your footage. Your direction.** A free, mobile-first video editor that turns supported plain-word instructions into real FFmpeg edits. Videos stay on the user's device. No account, paid API, backend, build step, or subscription.

## Publish from your Android phone

The website files are already in the repository, with `index.html` at the root. **You do not need a computer, terminal, ZIP download, npm, or hosting account.**

1. First make sure these changes have been **merged into `main`**. If you are viewing a pull request, tap **Files changed** to review it, then **Merge pull request → Confirm merge**. Do not delete `vendor/`: it contains the editing engine.
2. In Chrome, open [this GitHub repository](https://github.com/yelhsaaasimon-oss/AutoCut).
3. Tap **Settings → Pages**. If Settings is hidden, swipe the repository's tab bar or open its **…** menu. Chrome's **⋮ → Desktop site** can make GitHub settings easier to find.
4. Under **Build and deployment → Source**, choose **Deploy from a branch**.
5. Choose **main** and **/ (root)**, then tap **Save**.
6. Wait a few minutes. Return to **Settings → Pages** and tap **Visit site** once GitHub says the site is live.
7. The expected address for this repository is **https://yelhsaaasimon-oss.github.io/AutoCut/**. Use the exact address GitHub displays (including the project path and trailing slash).

Everything uses relative URLs, so a different repository/project name also works. `.nojekyll` disables unnecessary Jekyll processing. The engine is a normal ~31 MiB repository file, **not Git LFS**, and is small enough for GitHub's per-file limit. Deployment serves static files only; GitHub never processes your videos.

> Saving changes on a working branch is not the same as publishing `main`. This project does not change your Pages settings or automatically merge a pull request.

## Make your first edit

1. Open the published site in an updated **Android Chrome**.
2. Tap **browse files** and choose a short video. Start with a 10–30 second H.264 MP4 under 100 MB.
3. Tap a suggested edit, or type something like:
   ```text
   Trim the first 2 seconds, make it vertical, and add fade-in and fade-out
   ```
4. Check **Your edit, at a glance**. Unsupported or conflicting instructions are flagged before processing. AutoCut does not silently guess what an unsupported request means.
5. Keep **MP4 video** selected and tap **Make the cut**. The first edit downloads the ~31 MiB engine. Keep the tab open and your phone unlocked. **Cancel** stops the worker without changing your original.
6. Watch the **Edited** preview. **Original** lets you compare with the source.
7. Tap **Export your video**. Find it in **Chrome → ⋮ → Downloads** or your phone's Downloads folder. Download before closing or refreshing the app: source and output are not saved as projects.

You can edit the instructions and process again. Changing instructions or format invalidates the old export so you cannot accidentally download an outdated result. Leaving instructions empty performs a clearly identified format conversion.

## Supported instructions

Combine supported commands with commas, `and`, or new lines. The parser is a deterministic, local rule-based assistant, **not a generative AI model or arbitrary natural-language service**.

| Example | Actual operation |
| --- | --- |
| Trim the first 5 seconds | Input seek (`-ss`) |
| Remove the last 10 seconds | Limit input duration after subtracting end trim (`-t`) |
| Make the video vertical (9:16) | Center-crop to 9:16; even pixel dimensions |
| Make the video square (1:1) | Center-crop to 1:1 |
| Convert to black and white | `hue=s=0` |
| Brighten the video | `eq=brightness=0.08` |
| Add fade-in and fade-out | `fade` and `afade`, up to 1 second each |
| Mute the audio | Remove audio track (`-an`) |
| Lower the audio volume | `volume=0.5` |
| Lower the audio volume to 25% | `volume=0.25`; accepts 0–100% |
| Increase the video speed to 2x | `setpts=PTS/2` plus `atempo=2` |
| Slow the video down to half speed | `setpts=PTS/0.5` plus `atempo=0.5` |

Speed values between **0.25x and 4x** are supported (`Set video speed to 1.5x` also works). Only one instruction per setting is accepted; contradictory or repeated settings must be resolved explicitly. Decimal trim times work. Fades shorten automatically for tiny clips and are applied to the final playback timeline. Aspect changes crop the center, not intelligently track a subject.

**Not implemented:** captions, transitions between clips, background removal, music insertion, multi-clip timelines, beat detection, AI scripts, voices, generated footage, or arbitrary FFmpeg command input.

### Exports

- **MP4:** H.264, AAC when the source has audio, YUV420p, fast-start metadata; no added watermark. An ultrafast encoding preset and a **1280px maximum long edge** keep phone processing practical. Smaller sources are not upscaled. Metadata is removed where FFmpeg supports it.
- **MP3 audio only:** libmp3lame, 192 kbps. Applies trim, volume, speed (pitch-preserving), and audio fades. Requires an audio track. Visual instructions and mute are rejected for MP3 rather than silently ignored.
- Chrome may not preview every source codec. AutoCut can still attempt conversion, but a broken file or unsupported FFmpeg codec produces an error. MP4 file extensions alone do not guarantee a compatible codec.

## Install and use offline

1. Open the **published HTTPS site** in Android Chrome (not the GitHub file preview).
2. Tap **Install AutoCut**. If Chrome doesn't offer a prompt, tap **⋮ → Add to Home screen → Install**. Chrome may say **Create shortcut** on devices that do not offer PWA installation.
3. Launch AutoCut from your home screen.
4. Complete one edit while online, then allow a moment for engine caching. The app shell is cached on the first visit; the WASM engine is cached on its first use.
5. Later, open the same site/app offline and choose a locally stored video.

No external CDN is required. The initial engine download is from **your own GitHub Pages site**. Android/Chrome can evict caches when device storage is low; private browsing may not persist them. If offline initialization fails, reconnect and run another edit. Installing does not guarantee that offline data will never be evicted. An update activates after old tabs close; close/reopen the app to receive a newly deployed version.

## Phone limits and troubleshooting

- **Memory:** WASM decoding needs several times the file size, especially for high-resolution footage. A warning appears above 75 MiB or above 1080p. AutoCut rejects files over **300 MiB**, reduced to **150 MiB** when Chrome reports 2 GB RAM or less. These are protective limits, not a guarantee that smaller files will fit.
- **Slow edits:** single-threaded WASM can take longer than the video duration. Keep Chrome in the foreground. A screen wake lock is requested when available, but some devices deny it. No special server headers or SharedArrayBuffer are needed.
- **Chrome closes/reloads:** Android may kill the tab under memory pressure; that cannot be caught by JavaScript. Reopen and choose a shorter/lower-resolution clip. Originals remain unchanged.
- **Engine won't start:** update Chrome, reconnect, reload, and free memory. Engine startup has a two-minute timeout and can be cancelled.
- **Invalid trim:** the remaining video must be at least 0.1 seconds long. Read the error and reduce the trim times.
- **MP3 has no audio:** choose a video with an audio track. Muted/silent sources cannot produce a useful audio export.
- **404 after publishing:** check `main` contains `index.html` at root and Pages is set to `main / (root)`. Use the project URL from Settings → Pages, not only the username domain.
- **Old version:** close all AutoCut tabs and reopen. As a last resort, clear this site's storage in Chrome (this also removes offline caches).

## Privacy and licensing

Videos, instructions, and edited output are held in memory and local object URLs. They are **never uploaded**, logged to a remote service, or placed in service-worker caches. The engine worker is terminated after each job to release its WASM heap. The site uses no analytics, external fonts, advertisements, or third-party requests. Static hosting may have normal access logs for app-file downloads.

The app is GPL-3.0-or-later. FFmpeg wrapper and core versions, original notices, source/build links, and redistribution details are in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). The engine is **@ffmpeg/ffmpeg 0.12.15 + @ffmpeg/core 0.12.10 (single-threaded)**. No runtime package installation is needed.

## Repository layout

```text
index.html                 App entry point, root deployment
styles.css                 Responsive dark interface
app.js                     Upload, worker orchestration, preview and download
editor.js                  Instruction parser and FFmpeg command builder
manifest.json              Installable Android PWA metadata
service-worker.js          Versioned app-shell and on-demand engine cache
icons/                     SVG, 192px/512px PNG, maskable icon
vendor/ffmpeg/             Pinned upstream ESM wrapper and Web Worker
vendor/core/               Pinned single-thread WASM core and licenses
scripts/serve.js           Optional development-only static file server
tests/                     Parser, manifest, and real browser/media tests
TESTING.md                 Verification report and device-testing limits
```

### Optional maintainer commands (not needed on your phone)

There is no build pipeline. `npm install`, `npm test`, `npm run serve`, and `npm run test:browser` are only for maintainers running automated checks. Test fixture videos, screenshots, and `node_modules` are ignored by Git. See [TESTING.md](./TESTING.md) for test scope and environment details. Increment the service-worker cache version whenever changing a released app or engine asset.
