# Focused Quick Edit investigation — v1.2.0-rc.2

Date: 2026-11-12. Branch: `arena/4b30bfe8-autocut`. Starting application: `7666f32` / v1.2.0-rc.1. No merge, deployment, paid service or backend change.

## Finding and limits of the conclusion

**Two real-media Quick Edit export failures were reproduced against the original application and fixed. The cause of the user's physical Android failure is still unconfirmed.** No failure-stage answer, diagnostics, Chrome/device details or source characteristics were supplied during this investigation. It would be misleading to identify these reproducible source-specific defects as the proven cause on that phone.

The original code assumed that a file's **container duration**, its **video track duration** and its **audio track duration** were equal. That assumption is false even for valid H.264/AAC MP4 files. FFmpeg successfully encoded these inputs; failure occurred later at output verification, or an audio tail extended the MP4 beyond its visual content. Worker initialization was not the cause of these particular reproductions.

### Reproduced cases and fixes

| Real source | Original behavior | Corrected behavior |
| --- | --- | --- |
| 2s video + 4s audio, `mute`, MP4 | Reads container duration 4s; encodes valid 2s video; integrity gate rejects it: **“expected 4.00 seconds”**, no download. | Select the first video track's 2s timeline, matching `-map 0:v:0`; export is **2.000s H.264**, no audio, fully decodes. |
| Same source, no instructions, MP4 | Outputs 4s container with only 2s of actual video and a trailing audio tail. | Source audio is bounded to the selected video timeline; output is **2.000s H.264/AAC**. |
| 4s video + 2s audio, MP3 | Expects 4s but only encodes existing audio; integrity gate rejects it. | Pad the shorter audio and trim to the selected edit duration. Export is **4.032s MP3** (encoder padding), audible at 0.4s and silent at 3.2s. |

`quickSourceDuration` prefers the mapped video stream duration, then its duration ticks/time base, then container/native duration only when video duration is unavailable. The audio chain preserves initial delay, applies tempo, then uses **`apad,atrim=duration=<selected output duration>`** before volume/fades. Padding is bounded, not an indefinite silent encode. The existing full-decode/codec/duration checks remain in place; no validator was loosened to hide the failures.

These are desktop-Chromium reproductions using actual WASM-encoded files. Unequal track durations are not Android-specific. Matching the user's failure still requires the phone's evidence.

## End-to-end investigation of the seven requested areas

| Area | Investigation and result |
| --- | --- |
| File import / metadata | Real input selection, native metadata, independent FFprobe track/container measurements, empty/corrupt inputs and the existing size gates reviewed/tested. Root discrepancy demonstrated above. Source-probe diagnostics now include byte size, codecs, per-track duration/start time/rate/geometry and chosen video duration, without source names/tags. |
| Parsing / editing state | Unsupported text disables processing; changing it to supported trims re-enables it. Real start/end trim output is 3s from a 4s source. Existing 12 guide examples and parser bounds still pass. Diagnostics record only structured edit values, not arbitrary instruction text. |
| Worker initialization / execution | Actual shipped module worker/core/WASM paths used. Normal startup passes. Blocking the core produces a real worker import failure; retry succeeds with the same selected file. A non-answering class worker hits the bounded load deadline. Injecting an invalid encoder makes actual FFmpeg return a nonzero code, captured at the `encode` stage; retry succeeds. |
| Progress / timeouts | Encoding progress remains based on actual FFmpeg timestamps. Output decode no longer relabels verification as “Applying your edits” when its logs contain timestamps. Visible phase detail distinguishes startup, source read/probe, encoding, output probe and full decode. Both startup and encoding deadlines are exercised with non-answering operations; controls recover and real retry works. Tests shorten only their own page's deadline, not production settings. Existing cancellation/retry tests also pass. |
| A/V processing | Confirmed duration defects fixed. Existing delayed-audio, speed, mute, crop, fade, grayscale, MP3 and silent-video checks pass. New rotated-display-matrix and VFR sources pass real conversion. New short 1080p source exports at the existing 1280×720 cap. No new codec claims or resolution-limit reductions. |
| Validation / MP4 download | Actual output is probed and fully decoded. A real 3s trim is natively playable and its downloaded SHA-256 matches the verified Blob. Bad source/failed worker/failed encoder never offer a new output. Previous output is invalidated before another job. |
| Android Chrome / memory | Code reviewed for module-worker/secure-context paths, local assets, heap termination, source-size limits, output copy and preview lifetime. Actual 1080p downscale passes on emulated Chromium; all workers are released after completion/failure/cancel. **No physical Android, Android file-provider failure, mobile OOM or OS-killed-tab condition was reproduced or certified.** No speculative memory tuning was applied. |

## Improved evidence on the phone

The panel **Export diagnostics · on this device only** is populated on file selection and at each awaited Quick Edit phase, not only after export succeeds/fails. It now reports:

- Build **v1.2.0-rc.2**, browser, secure-context/worker/WASM support, visibility, reported memory and CPU concurrency.
- `pipeline.stage`: `import`, `load-engine`, `read-source`, `probe-source`, `build-command`, `encode`, `probe-output`, `decode-output`, `read-output`, or `ready`.
- A stage-event history, elapsed time **at the last report**, byte size, selected format/structured plan, generated command with internal filenames only, source/output track summaries and probe/encoding exit codes where available.
- A small set of error-category flags, not arbitrary source metadata or raw FFmpeg logs. Extensionless MIME-valid videos use an internal `input.bin` name; no source basename is mistaken for an extension and exposed in the command. Actual import/encode/playback/download for that case is covered.

No new network upload, telemetry, durable diagnostic logging or footage export was added. Do not interpret `navigator.deviceMemory` as free memory; it is an approximate device capability and can be absent. If Android kills the page, the in-memory report can be lost; the page cannot certify what the OS did.

## Regression evidence and reproducibility

New suite: **`npm run test:quick-pipeline`**, included in `npm run test:all`. New pure regressions cover video-vs-container duration, duration/time-base fallback/rejection and bounded padding after tempo/before fades.

**Red run:** restored only `app.js` and `editor.js` from `7666f32` under a cleanup trap and ran the same new real-media suite against them. It failed with the two export integrity errors and audio-tail mismatch listed above. The test blocks service workers to prevent cached application files from masking which code ran. The diagnostic renderer remained current during that controlled comparison; it does not change rendering or verification. The trap restored the working files; no baseline code was committed.

**Green run:** after restoring the corrected application, the focused suite passes all **13 groups**, including genuine success-path encoding and controlled failure-path checks. Fixtures are generated locally with the pinned FFmpeg engine, not downloaded from a sample service. Independent test-side FFmpeg probes/decode and actual browser playback/download are used in addition to the application's own integrity gate. Fault injection is explicitly limited to missing core, non-answering worker/messages, shortened test deadlines and an invalid encoder command.

```sh
npm ci
# Terminal 1:
npm run serve
# Terminal 2:
npm run test:all
# Or just the focused investigation:
npm run test:quick-pipeline
```

Optional URL override: `TEST_URL=http://localhost:5173/AutoCut/ npm run test:quick-pipeline`. The fixture generator/test helper runs in desktop Linux Chromium; npm/Playwright testing is **not required on the Android phone**.

### Final results

| Suite / check | Result |
| --- | --- |
| Unit tests | **63 PASS, 0 failed/skipped** (three new duration/padding regressions; prior delay-chain assertion updated to require bounded padding). |
| Stage 1 acceptance | **17 groups PASS**, all 12 guide examples. |
| Existing browser integration | **PASS**, including actual processing, playback/download and offline export. |
| Story acceptance | **15 groups PASS**. |
| Story preview regressions | **PASS**. |
| Story trim regressions | **9 checks PASS**. |
| Stabilization browser suite | **12 groups PASS**, storage/recovery/cancel/offline/migration/layout included. |
| New Quick pipeline investigation | **13 groups PASS**. |
| Dependency audit / syntax / formatting / diff check | **PASS**, zero reported dependency vulnerabilities; no dependency added. |
| Physical Android retest | **NOT TESTED here; user's failure cause remains UNCONFIRMED**. |

The final full-suite command exits **0**, explicitly captured in `.arena/quick-final-confirmed-exit.txt` after a fresh complete run on the final code (not inferred from the interrupted run). Main logs and generated fixtures remain ignored, not large Git artifacts: `.arena/quick-original-red.log`, `.arena/quick-pipeline-sources.json`, `.arena/quick-expanded-green.log`, `.arena/quick-final-confirmed-all.log`, `.arena/quick-pipeline-report.json` and `.arena/quick-investigation-download.mp4`. Later successful runs overwrite the intermediate reproduced-failures JSON with `[]`; the baseline log preserves the red evidence. The measured findings above are retained in this tracked report.

## Remaining limits and next physical-phone step

- Production deadlines remain **2 minutes to load** and **15 minutes per worker operation**. They do not make background Android execution reliable, and are not a deadline on native file-picker/Blob I/O outside the worker.
- Existing Quick size/1280px/10-minute bounds remain; file size is not a guarantee of decoder/encoder memory safety. A short 1080p fixture does not certify long 1080p or 4K footage. No mobile OOM diagnosis can be made from this desktop run.
- Formats with missing/incorrect track duration, complex edit lists, audio wholly outside a selected range, every camera timestamp layout, HEVC/HDR and OEM-specific decoders are not exhaustively certified by these tests. A passing fixture is not a universal compatibility claim.
- Stage-level diagnostics are intentionally in memory and user-visible. They are not an OS crash dump or automatic persistent monitoring.
- Story implementation/rendering code and vendor binaries are unchanged in this focused fix. Both complete mode suites are rerun; new metadata on their shared diagnostic renderer does not change Story's export commands.

Update using [UPDATE-TERMUX.md](./UPDATE-TERMUX.md). Confirm **v1.2.0-rc.2**, reproduce with the same file/instruction, and copy the diagnostics immediately after failure (or while stuck). If the page reloads or shows “Aw, Snap”, report that plus the last visible stage. A short nonprivate example with the same failing characteristics is useful if available, but private footage is not required. Until that evidence is available, this delivery fixes proven Quick defects and improves diagnosis—it does **not** certify that the reported physical-phone failure is solved.
