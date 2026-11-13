# AutoCut Stage 2 — Increment A acceptance report

**Date:** 2026-11-12

**Branch:** `arena/4b30bfe8-autocut`, based on merged Stage 1 `main` commit `2350f04860b50e908708110d1edc287843e7da7e`.

**Scope:** multiple video/JPG/PNG assets, ordered scenes, horizontal timeline, playhead, per-scene timing, source sequence preview, local joined MP4 export, hard cuts and source audio. No captions, image animation, transitions, narration/music tracks, backend or paid API was added.

**Verdict:** Increment A's automated/browser acceptance criteria PASS in the environment described below. Real Android hardware and a new production deployment are explicitly NOT TESTED. Nothing has been merged or deployed as part of this increment.

## How it was tested

- Chromium 153, Android Chrome user agent and mobile/touch emulation. Web security remains enabled; the single-thread engine runs without SharedArrayBuffer/cross-origin isolation.
- Served beneath `/AutoCut/`, including service-worker and module-worker paths.
- Real media generated with the **shipped FFmpeg.wasm engine**: a 320×240 24fps red/green/blue video with AAC audio, plus a silent 240×320 30fps yellow video. Test images are an actual JPG and PNG produced locally by the test-only sharp dependency.
- Video is trimmed, images retimed, scenes reordered, then exported. Tests inspect decoded frames, audio samples, container/stream metadata, native playback, and actual downloaded bytes. Processing is not mocked.
- Phone/tablet/desktop widths tested: **320, 360, 390, 412, 768, 1440px**. Screenshots inspected at 390 and 1440px.
- Generated media, screenshots and detailed metrics are ignored under `.arena/` and `tests/fixtures/`; they are not committed as application files.

## Requested feature results

| # | Feature | Result | Evidence |
|---|---|---|---|
| 1 | Import multiple video clips | **PASS** | A real multiple-file chooser imports two different-size/frame-rate videos together. |
| 2 | Import JPG and PNG images | **PASS** | Both image types decode, create thumbnails and become scenes. Image-only export is also exercised. |
| 3 | Display all imported assets | **PASS** | Library holds all four accepted assets, including those whose scenes are later removed; library scrolls independently. |
| 4 | Ordered scene list | **PASS** | Four stable scene identities retain references to assets and their timing through reorder/remove operations. |
| 5 | Select/remove scenes | **PASS** | Selection updates the inspector and preview; removing scenes updates duration/timeline without deleting reusable assets. Removing all scenes restores an empty disabled state. |
| 6 | Move earlier/later | **PASS** | Real touch events move scenes both ways. Invalid boundary moves are disabled. Exported frame order matches the new order. |
| 7 | Visual horizontal timeline | **PASS** | Duration-scaled scene buttons scroll within the timeline rather than overflow the page; touch selection works at all tested widths. |
| 8 | Thumbnails and durations | **PASS** | Real decoded thumbnails load at 160px wide; scene durations reflect image edits and video trim points. Thumbnails show source material, not regenerated trim-start frames. |
| 9 | Playhead | **PASS** | Playhead moves during playback; slider seeking maps a project time to the correct video source time. Timeline auto-follows playback. |
| 10 | Video start/end trim | **PASS** | Source 1–3s becomes a 2s scene; decoded export shows green then blue, excluding the red first second. Out-of-range/reversed trims are rejected. |
| 11 | Image duration | **PASS** | Images initially last 3s, are changed to 1s, and appear in the output for the correct slots. A separate 0.25s image-only job exports successfully. Invalid >30s input is rejected. |
| 12 | Preview in correct order | **PASS** | Native playback crosses PNG → trimmed audible video → silent video → JPG; a rendered source frame confirms the green trimmed section. Playback stops at the 5s project end. |
| 13 | One playable MP4 | **PASS** | Joined file has H.264/AAC, 960×540, 24fps, 120 video frames and 5.000000s duration. Whole-file FFmpeg decode and native Chrome playback succeed. Download completes and SHA-256 matches the exported Blob. |
| 14 | Silent and audible scenes | **PASS** | Decoded audio is silent in image/silent-video slots and audible in the trimmed video's 1–3s project slot, including when an image precedes that clip. Fully silent video/image export also succeeds offline. |

## Original Increment A acceptance criteria

| Criterion from the inspection plan | Result | Verification |
|---|---|---|
| Existing Stage 1 suites still pass | **PASS** | 25 original unit tests, all 17 Stage 1 acceptance groups, and the existing media integration suite rerun successfully. `app.js`, `editor.js` and `styles.css` are unchanged. |
| Add/select/reorder/remove multiple videos and images | **PASS** | Actual chooser/touch workflows, reusable assets and empty-state recovery tested. |
| Correct timeline duration/playhead after edits | **PASS** | Frame-based model tests plus 5s edited sequence and source-time seek checks. |
| Preview follows scene order and trim points | **PASS** | Sequential native playback, rendered color inspection and image hold durations tested. |
| Mixed project exports playable MP4 | **PASS** | Four-source mixed export decoded and played. |
| Decoded frames prove order and image duration | **PASS** | Five timestamped samples identify cyan → green → blue → yellow → purple; total video has exactly 120 frames. |
| Silent/audible joins preserve audio placement | **PASS** | Audio RMS windows match scene timeline slots. Normalized exact-sample PCM is encoded to AAC once, rather than adding AAC encoder padding at every scene. |
| Cancellation, invalid files and project limits recover | **PASS** | Cancel/retry via UI; abort after a real first scene render; corrupt/empty/unsupported file rejection; later valid imports; 12-scene UI cap; asset/byte/time limits checked in pure-model tests. |
| Android-sized touch controls | **PASS** | Browser emulation across the six widths above; no horizontal page overflow; touch timeline and list selection work. Physical-device certification remains pending. |
| Project-relative paths and offline assets | **PASS** | All new modules are cached under `/AutoCut/`. Cold offline reload imports local assets and exports a real mixed MP4. No external runtime requests or non-GET upload requests occur. |

## Measured export evidence

The main test story is reordered to:

1. Cyan PNG, 1s.
2. Audible source video trimmed from 1–3s, 2s.
3. Silent portrait yellow video, 1s.
4. Purple JPG, 1s.

Actual output:

- Size: **50,234 bytes** for these simple fixtures.
- Video: H.264 Constrained Baseline, **960×540**, square pixels, 24fps, **120 frames**, start time 0.
- Audio: AAC-LC, stereo, 48kHz; container audio duration 5s.
- Container duration: **5.000000s**.
- Center RGB samples at 0.5 / 1.25 / 2.5 / 3.5 / 4.5s:
  - `[0,254,254]`, `[0,253,0]`, `[0,0,253]`, `[253,254,0]`, `[202,0,201]`.
- Decoded audio RMS at 0.2 / 0.8 / 1.2 / 2.5 / 3.2 / 4.4s:
  - `0`, `0`, approximately `0.06257`, `0.06223`, `0`, `0`.
- Complete-file decode exit code: **0**.
- Native exported playback advances; saved download hashes exactly match the exported bytes.

AAC can contain normal encoder padding at the final file boundary; the MP4 timeline declares the intended duration. Tests do not claim that raw decoded AAC has no final encoder-padding samples.

## Tests added and results

- `npm test`: **40/40 PASS** — the original 25 tests plus 15 new model/export-command tests.
- `npm run test:story`: **15/15 acceptance groups PASS** — new actual-browser/media checks, including scene-only images, late cancellation, offline processing, invalidation and exclusive worker use across workspaces.
- `npm run test:stage1`: **17/17 groups PASS**.
- `npm run test:browser`: **PASS**, existing actual-media integration suite.
- `npm audit`: **0 reported vulnerabilities** at test time (not a comprehensive audit of compiled codecs).

Test scripts require no services beyond the optional static development server. They are maintainer tools, not a requirement for using the app on a phone.

## Issues found and fixed during implementation

- **Negative sub-frame start times:** input such as `-0.001` could round to zero. The model now checks the original negative value before accepting the frame-rounded trim. A regression case covers it.
- **End-of-preview test race:** a displayed time can round to `5.00s` just before playback stops. The test now waits for both the end time and paused transport state; it does not infer completion from rounded text alone.
- **Audio cut padding risk:** avoided by design and checked with decoded audio. Each scene produces an exact-length PCM segment and normalized video; AAC is encoded only once at the final join.

No unresolved functional failure was observed in the tested Increment A paths.

## NOT TESTED / known limitations

| Area | Result / limitation |
|---|---|
| Physical Android Chrome, installation and thermal/battery behavior | **NOT TESTED** — no physical phone is attached. |
| New GitHub Pages production deployment | **NOT TESTED** — intentionally not merged, deployed or configured automatically. Local project-subpath and offline tests pass. |
| Real low-memory/OS tab termination or maximum-size projects | **NOT TESTED** — bounded fixtures are used; pure-model limit enforcement is tested, but the size caps do not guarantee a real phone will fit every allowed source. |
| Every codec, variable-frame-rate timestamp layout, camera rotation, HDR/color management | **NOT TESTED exhaustively** — native Chrome decoding is required for Story import. Inputs unreadable by Chrome are rejected here; Stage 1's conversion attempt remains available. |
| Continuous gapless interactive source preview | Preview switches local media sources at cuts and can briefly buffer. It is not a rendered timeline. The exported MP4 is the timing reference and is separately previewable. |
| Thumbnail regeneration after trimming | Thumbnails represent source assets. The inspector, preview and export honor scene trims; thumbnails are not regenerated for every trim. |
| Persistence | No saved projects, autosave, background export or reload recovery. Download before leaving. Switching Quick/Story mode preserves the in-memory story. |
| Editing scope | Story timing controls affect only the selected scene. Stage 1 text instructions remain in Quick edit and do not silently affect Story scenes. |
| Safety bounds | 8 assets, 12 scenes, 120 seconds, 100 MiB aggregate originals (50 MiB when Chrome reports ≤2GB RAM); video ≤75 MiB and ≤120s; JPG/PNG ≤15 MiB and ≤20MP; scene ≥0.25s; image ≤30s; fixed 960×540/24fps output; 80 MiB normalized temporary-media budget. |

## Phone-only review steps

Use the branch preview—not the production site—to review these unmerged changes:

1. Tap **Story project**, then **Import videos & images**. Choose two short videos and a JPG/PNG.
2. Tap a scene, change video source start/end or image duration, then tap **Apply scene timing**.
3. Use **Earlier / Later**; swipe the visual timeline or seek with its slider.
4. Tap **Play** and verify sequence/trim boundaries. **Quiet preview** changes preview playback only, not export audio.
5. Tap **Export story**, keeping Chrome open and the phone unlocked. Play the resulting MP4 preview, then download.
6. Open `autocut-story.mp4` in Chrome Downloads and verify scene order, duration and sound.
7. Switch back to **Quick edit** to confirm the existing single-video workflow remains available.

This report does not authorize an automatic merge or production deployment.
