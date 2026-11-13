# AutoCut

**Your footage. Your direction.** A free, mobile-first video editor that turns supported plain-word instructions into real FFmpeg edits. Videos stay on the user's device. No account, paid API, backend, build step, or subscription.

## Stage 2, Increment A — Story project

Increment A extends the existing app; **Quick edit** still provides every Stage 1 feature. The new **Story project** workspace imports several videos and JPG/PNG images, lets you arrange and time scenes, previews their sequence, and exports one MP4 with hard cuts. No captions, image animation, transitions, narration/music tracks or paid services are included in this increment.

**These branch changes are for review. They are not merged or deployed automatically.** Use the development preview to test them before deciding to publish. The acceptance report and outstanding physical-device checks are in [QA-INCREMENT-A.md](./QA-INCREMENT-A.md).

### Make a story on your phone

1. Tap **Story project → Import videos & images**. Choose several short local videos and/or JPG/PNG images. If your Android file picker only allows one item at a time, import repeatedly.
2. Each accepted asset appears in the source library and adds a scene. Images initially last three seconds. Use **Add scene** to reuse an asset.
3. Tap a scene in the list or timeline. Use **Earlier / Later** to reorder it and **Remove** to remove it. Assets stay available until you explicitly remove them; remove their scenes before removing an asset.
4. For a video, enter **Start in source** and **End in source**. For an image, enter its duration. Tap **Apply scene timing**. Values are rounded to 24fps; a scene must be at least 0.25s and an image can last at most 30s.
5. Swipe the horizontal timeline, use the playhead slider to seek, or tap **Play** to preview the sequence. The inspector continues to show the selected scene; source playback can briefly buffer at cuts. Source thumbnails do not regenerate after every trim.
6. Tap **Export story**, keep Chrome in the foreground and your phone unlocked. The engine downloads on first use; later cached use can work offline. **Cancel** preserves your scenes and original files.
7. Play the final MP4 preview, then tap **Download story MP4**. Find `autocut-story.mp4` in Chrome → ⋮ → Downloads. Save it before leaving or refreshing.

### Story export and memory limits

- Fixed **960×540, 16:9, 24fps H.264/AAC MP4**, with fit/letterboxing rather than cropping. Sources smaller than the export canvas may be upscaled; transparency is flattened onto black. This does not change Quick edit's existing export settings.
- Source audio is preserved where available. Image/silent-video slots receive silence. Audio is normalized to stereo 48kHz and encoded once at the final join so scene AAC padding does not accumulate.
- Up to **8 assets, 12 scenes and 120 seconds**. Aggregate original-file budget: **100 MiB**, or **50 MiB** when Chrome reports 2GB RAM or less.
- Each video: at most **75 MiB / 120 seconds** and must be readable by native Chrome for Story preview. Each JPG/PNG: at most **15 MiB / 20 megapixels**. Files that cannot be imported may still be convertible using Stage 1 Quick edit.
- Scene rendering is sequential: one source is copied into WASM at a time and deleted after use. Images are prepared at reduced resolution. Normalized video plus PCM intermediates have an **80 MiB** safety budget; worker memory is released after each export/cancellation.
- These bounds reduce risk, not eliminate it. Start with short 720p/1080p clips; high-resolution decoding can exhaust phone memory even below the file cap.
- No autosave, project persistence or background processing yet. Switching Quick/Story workspaces retains the in-memory story; refreshing/closing does not. Stage 1 text instructions only affect Quick edit, not Story scenes.

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

**Not implemented:** captions, animated image motion, transitions between clips, background removal, separate music/narration tracks, beat detection, AI scripts, voices, generated footage, or arbitrary FFmpeg command input. Multiple-clip timelines are available separately in **Story project**; Quick edit remains single-source.

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
editor.js                  Stage 1 instruction parser and FFmpeg command builder
story.js / story.css       Increment A controls, timeline, preview and styling
story-model.js             Pure frame-based assets/scenes/timing model
story-media.js             Local media validation, thumbnails, reduced-size images
story-export.js            Sequential scene normalization, audio and MP4 joining
QA-INCREMENT-A.md          Feature results, tests and device limitations
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
