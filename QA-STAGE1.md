# AutoCut Stage 1 — QA acceptance report

**Date:** 2026-11-12

**Application revision tested:** `87c3079` on `arena/f974ae6b-autocut`

**Verdict:** The important Stage 1 features **PASS in the tested browser environment**. This is not a blanket claim of completion on every Android phone or a sign-off on an untested production deployment.

## Test environment and method

- Chromium 153, Playwright, Android Chrome user agent, mobile/touch emulation. Web security remains enabled; `crossOriginIsolated` is false and `SharedArrayBuffer` is unavailable, as expected on ordinary GitHub Pages hosting.
- Static files served from `/AutoCut/` to exercise project-relative paths. The domain-root URL was also opened successfully. No backend video processing.
- Phone/tablet viewport widths: **320, 360, 390, 412, and 768 pixels**. Screenshots inspected at the narrowest width and tablet width; controls also exercised with touch events at every tested width.
- An actual four-second, 320×240, 24 fps H.264/AAC fixture was encoded by the shipped WASM engine. Its four one-second sections are red, green, blue, and yellow, with a sine-wave audio track. No external video sample, fake processing, or mocked FFmpeg was used.
- Tests inspect rendered native video frames, decoded RGB output, stream metadata, complete-file decoding, and real saved downloads—not just button visibility.

## Requested tests

| # | Check | Result | Actual evidence |
|---|---|---|---|
| 1 | Website loads without errors | **PASS** | HTTP 200, application modules initialize, all 11 guide commands render, service worker takes control. No uncaught page exceptions or HTTP asset errors in the positive acceptance flow. |
| 2 | Video upload button works | **PASS** | A touch on the visible upload button emits a real browser `filechooser` event. Selecting the fixture sets the filename, shows file details, and loads 320×240 video metadata. The Replace button also opens a chooser and accepts another file. |
| 3 | Uploaded video can be previewed | **PASS** | Native `<video>` playback advances beyond 0.2 seconds. A canvas captures an actual red frame from the source; width/height are verified. This checks playback, not merely assigning a Blob URL. |
| 4 | Supported instructions are recognized | **PASS** | All **11 documented example commands** are entered through the real textarea. Each produces its expected plan entries without errors; fade-in/out produces two entries. Existing unit tests additionally cover combinations, decimals and ranges. |
| 5 | Unsupported instructions are rejected | **PASS** | Seven browser cases block processing and show errors: captions; mixed mute/background removal; subtitles appended to a crop command; conflicting aspect ratios; 0× speed; 200% lowered volume; literal HTML. Literal HTML remains text, not executable markup. |
| 6 | FFmpeg.wasm initializes | **PASS** | The real single-threaded engine loads, encodes a **41,592-byte H.264/AAC fixture**, probes it, and decodes the entire four-second file without SharedArrayBuffer or cross-origin isolation. |
| 7 | Actual video trimming works | **PASS** | Removing the first and last second turns the four-second source into a **2.000000-second** output. Decoded output at 0.2s is green and at 1.7s is blue, proving the red/yellow ends were removed—not just changing duration metadata. |
| 8 | Actual black-and-white conversion works | **PASS** | The source frame is red. Independently exported grayscale video decodes to average RGB **74.0 / 74.0 / 74.0**, with mean channel difference **0.00**. Brightness is nonzero, so an empty black frame cannot make this test pass. |
| 9 | Actual mute works | **PASS** | The fixture contains an AAC stream. The muted export contains **one H.264 video stream and zero audio streams**; complete-file decoding succeeds. |
| 10 | A working MP4 can be exported | **PASS** | Exports have an MP4 `ftyp` signature and H.264 video. Entire exported files are decoded with FFmpeg. The native Edited preview also plays rendered frames. The combined-edit regression test separately confirms retained AAC audio. |
| 11 | The exported video can be downloaded | **PASS** | A real download event completes with no download failure. The browser saves **4,176 bytes** as `stage1-source-autocut.mp4`. Its SHA-256 matches the exported Blob, and the saved file decodes completely. |
| 12 | Android-sized interface works | **PASS** | No horizontal overflow at 320/360/390/412/768px. Touch events operate suggestions, help open/close, upload, processing and export; the instruction textarea remains usable. This is emulation, not physical-device certification. |
| 13 | Manifest and service worker are valid/functional | **PASS** | Chromium reports **zero manifest errors**. Every icon is fetched and its PNG dimensions match the manifest. Service worker is activated under `/AutoCut/`. After caching, a cold offline reload produces and completely decodes another actual edited MP4. |
| 14 | Paths are compatible with GitHub Pages | **PASS** | App shell, modules, engine worker, WASM, manifest and icons work under `/AutoCut/`, with no missing positive-flow resources or external runtime requests. Cached assets remain inside the project path. Domain-root loading also works. This verifies path compatibility locally, not a production deployment. |

## Additional negative and recovery checks

| Check | Result | Evidence |
|---|---|---|
| Empty video file | **PASS** | Clear empty-file notice; no crash. |
| Non-video file | **PASS** | Text file rejected with a choose-video notice. |
| Corrupt file named `.mp4` | **PASS** | Attempting processing produces a readable error and no downloadable result; a valid replacement then processes successfully. Expected media-decoder errors are intentional in this negative test. |
| Silent source MP4 | **PASS** | A video with no audio track still converts to a valid MP4. |
| MP3 from a silent source | **PASS** | Processing reports that the source has no audio track; no misleading export is created. |
| Empty instructions | **PASS** | The documented conversion-only path produces a valid MP4. |
| Stale edited results | **PASS** | Replacing the source or changing instructions revokes the old download and disables the Edited tab until another result is produced. |
| Missing offline engine | **PASS** | In a fresh browser context with only the shell cached, an offline edit fails clearly with engine/connection guidance instead of hanging. Reconnecting and retrying creates an export. |
| Invalid trim removing entire source | **PASS** | Existing regression test shows a persistent explanatory error and preserves the source. |
| Cancel/retry | **PASS** | Existing regression test restores controls after cancellation; a subsequent edit succeeds. |
| MP3 and slow motion | **PASS** | Existing regression test produces an eight-second MP3 from a four-second half-speed source. |
| Crop, speed and fades together | **PASS** | Existing integration test creates the expected 134×240, approximately 1.5s H.264/AAC output and checks grayscale/fade pixels. |

## Failures and fixes

**Unresolved Stage 1 product failures found: none in these test cases.** No application code change was needed to make the tested core paths pass.

Two issues in the test infrastructure were corrected so the report would be reliable:

1. **Timeout argument placement:** the existing integration test passed timeout options as `waitForFunction`'s data argument. They now occupy the correct third argument, so long video operations actually receive the intended 120-second test timeout.
2. **Test browser multi-context crash:** the packaged headless browser's `--single-process` option caused the new isolated-context recovery test to close the browser during navigation. Removing that test-launch option restored normal multi-process browser operation. The missing-offline-engine case then passed. This was a QA launcher problem, not an AutoCut processing failure; the WASM engine remains single-threaded.

Browser launch setup is shared in `tests/browser-setup.js`. The acceptance tests are committed in `tests/stage1.test.js`; fixtures, screenshots, downloaded media, and detailed generated metrics remain ignored in `.arena/` or `tests/fixtures/`.

## NOT TESTED — remaining release checks

| Check | Result | Reason / next action |
|---|---|---|
| Physical Android Chrome playback/edit/export | **NOT TESTED** | No physical phone is attached to this environment. Try a short clip on your phone; emulation cannot prove device memory/performance behavior. |
| Actual Android home-screen PWA installation | **NOT TESTED** | Manifest and service worker passed, but no Android home screen is available. Use Chrome → ⋮ → Add to Home screen → Install. |
| Published GitHub Pages HTTPS deployment | **NOT TESTED** | Tests used a static local project URL. This QA pass does not merge the PR, enable Pages, or change repository settings. Check the address from Settings → Pages after publishing. |
| Large/4K videos and memory exhaustion on real phones | **NOT TESTED** | Tests deliberately use short deterministic fixtures. Browser/Android tab termination under real memory pressure cannot be certified here. |
| Every input format, codec, HDR and rotation metadata combination | **NOT TESTED** | The verified fixture is H.264/AAC MP4. Do not interpret these results as universal codec or HDR support. |
| Persistent offline storage after Android evicts site data | **NOT TESTED** | Offline operation passed while data was retained. Storage retention is controlled by the browser/OS. |

## Reproduction and result totals

All commands below were rerun after correcting the test infrastructure:

- `npm test` — **25 / 25 passing** unit/file/manifest tests.
- `npm run test:stage1` — **17 / 17 passing** acceptance groups (the 14 requested checks plus three recovery groups).
- `npm run test:browser` — existing real-media integration regression suite **PASS**.
- `npm audit` — **0 reported vulnerabilities** at test time; not a blanket guarantee about all compiled codec code.
- `git diff --check` — **PASS** for the changes in this QA pass.

No terminal is required from you. From your phone, the remaining smoke test is: publish the reviewed changes, open the HTTPS site in Chrome, upload a short video, try a trim plus black-and-white edit, preview, export, check Chrome Downloads, install the PWA, and repeat an edit after going offline once the engine is cached.

**Release recommendation:** core Stage 1 functionality is verified in the automated browser environment. Keep physical Android installation/performance and production HTTPS deployment as explicit pending checks rather than declaring universal completion.
