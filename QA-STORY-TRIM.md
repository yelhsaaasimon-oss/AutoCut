# Story 2–7 second trim pipeline investigation

Date: 2026-11-12. Branch: `arena/4b30bfe8-autocut`; previous commit: `21d398f`. No merge or deployment.

## Finding and verification limits

The phone report is that applying source 2–7 changes the selected scene to five seconds but preview and export contain the original footage. This investigation does **not** claim that the exact single-scene phone export failure was reproduced: on the baseline, an applied single-scene 2–7 trim already produced a real five-second preview and downloaded MP4 in Chromium.

Two independently reproducible issues were identified:

1. **Preview end enforcement depended exclusively on requestAnimationFrame.** With animation callbacks withheld while native media continues, the old preview runs beyond the trim end. The regression failed on baseline `story.js`: video was still not paused after 6.5 seconds of playback of a five-second scene. This is a controlled scheduler-delay simulation, not physical Android certification. Media `timeupdate` and `ended` events now enforce the same existing scene-boundary logic as the animation loop.
2. **Import followed by Add scene creates two separate scenes.** Import already inserts a full-source scene. Adding the asset again and trimming the second instance leaves the first instance untrimmed. A ten-second source plus its 2–7 second cut yielded a real 15-second, 360-frame export: full original first, trimmed copy second. Removing the untrimmed scene yielded a real five-second, 120-frame output. This workflow reproduces full footage remaining in the story, but it is **not confirmed** that the user had duplicate scenes. Reuse remains intentional and is not silently removed. The UI now labels this action **Add another scene**, explains automatic scene creation, and displays both applied per-scene timing and the total of all scenes that will be exported.

If the user's project truly has **1 SCENE · 5.00s**, but the actual downloaded result remains full length, that device/file-specific issue remains unverified here. The final-file verification below now rejects a duration/frame-count mismatch instead of offering it as a successful result. It does not prove content correctness for every possible source codec or timestamp layout; the independent pixel/audio regressions cover the supplied local fixture.

## Model → preview → export trace

- The timing form submits `updateScene(project, sceneId, 2, 7)`. At 24 output fps this stores `inFrame=48`, `outFrame=168`, and duration `120` frames. Original asset duration/frames stay unchanged. Existing frame-model code was verified, not rewritten.
- Mutation invalidates the old output and seeks the selected scene start. Project zero maps to source time 2. Preview seeking still uses the cancellation/readiness helpers from the preceding fix. Its clock maps source playback back to the trimmed project duration; media events now provide a second path to stop/cut when animation callbacks are delayed.
- Actual worker command capture confirms source `-ss 2`, input `-t 5`, video `-frames:v 120`, audio `atrim=end_sample=240000`, and final join `-t 5`. Existing scene rendering and joining command construction already passed the exact requested trim; it was not replaced with a speculative alternative.
- Before returning an export Blob, the app now probes the **actual joined MP4**, requiring the expected video frame count, video duration and container duration (one output-frame tolerance), plus an audio track. A mismatch throws an explicit timing-verification error; the UI's existing error path does not expose a download. The dedicated error is preserved rather than misclassified by FFmpeg diagnostic-log memory matching.

## New regression suite

Run `npm run serve`, then `npm run test:story-trim`. Default test URL is `http://localhost:5173/AutoCut/`; `TEST_URL` can override it. No build/backend or remote footage is used.

`tests/story-trim.test.js` generates a real ten-second **30fps H.264/AAC** fixture using shipped FFmpeg.wasm, with a ten-second GOP and B-frames:

| Source time | Picture | Tone |
| --- | --- | --- |
| 0–2s | Red | 440Hz |
| 2–5s | Green | 880Hz |
| 5–7s | Blue | 880Hz |
| 7–10s | Yellow | 1760Hz |

Nine browser checks pass:

1. Applying 2–7 sets scene/timeline to five seconds and seeks the ten-second original to source 2.
2. Real native preview plays green then blue, stops around source 7 with a `5.00 / 5.00s` project clock, without playing the whole ten-second source.
3. Independent FFprobe/FFmpeg inspection confirms a **5.000000-second MP4, 120 frames at 24fps**. Samples at output 0, 0.25 and 2.75s are green; at 3.25 and 4.8s they are blue. Whole-file decode succeeds. Decoded audio samples have the expected trimmed 880Hz tone, not the outside 440/1760Hz tones.
4. The output plays natively, its native duration is five seconds, and the actual browser download SHA-256 matches the inspected export bytes.
5. Import plus Add another scene produces independent ten- and five-second scenes, total 15s, rather than silently sharing trim edits.
6. That two-scene export really contains 360 frames / 15 seconds with the original before the cut.
7. With animation-frame callbacks withheld, media-event boundary enforcement stops playback by the out-point plus one native `timeupdate` interval (tested under 0.4s), with the project clock clamped to five seconds. The normal animation path stops near source 7.00; this fallback is not a sample-accurate rendering API.
8. Removing the original-length duplicate leaves a real five-second / 120-frame trimmed export, with decoded green→blue content.
9. A controlled **final-probe metadata fault** reports the actual rendered file as ten seconds; export must reject before returning a Blob. This is explicitly fault injection, not a naturally reproduced bad encoder result.

Two new pure tests verify source/model/command values for 2–7 (including silent-audio command construction and independent asset reuse), and rejection of original duration, wrong frame counts, absent audio or unreadable duration metadata.

### Red/green evidence

- Temporarily restored only `story.js` from `21d398f`, keeping the new regression and other changed files: the delayed-animation preview test failed, exit 1 / timeout 6500ms. Restored the fix: PASS.
- Temporarily restored only `story-export.js` from `21d398f`: the final-validation regression failed, exit 1. The baseline never performed the final probe, so it returned the valid rendered Blob without reaching the injected metadata fault. With the new final probe, the fault is injected exactly once and the export rejects with the timing error. This establishes the verification gate, not a claim that baseline naturally encoded an original-length single scene.
- Exact single-scene normal preview and 2–7 export passed **both baseline and changed code**. This distinction matters; there is no invented failing export reproduction.
- Ignored local evidence: `.arena/story-trim-baseline.log`, `.arena/story-trim-red.log`, `.arena/story-trim-export-red.log`, `.arena/story-trim-after.log`, `.arena/story-trim-report.json`, and `.arena/story-trim-output.mp4`. Fixture media is ignored under `tests/fixtures/`.

## Validation results

All suites rerun sequentially against the changed code:

| Command/check | Result |
| --- | --- |
| `npm test` | **PASS**, 42 tests (25 Stage 1 + 17 Story) |
| `npm run test:story-trim` | **PASS**, all 9 browser checks above under `/AutoCut/`; rerun also passed with `TEST_URL=http://localhost:5173/` at domain root |
| `npm run test:story-preview` | **PASS**, existing readiness/cancellation/watchdog regressions |
| `npm run test:story` | **PASS**, all 15 Story acceptance groups, including mixed MP4 frame/audio checks, cancellation, image-only export and cold offline export |
| `npm run test:stage1` | **PASS**, all 17 Stage 1 acceptance groups |
| `npm run test:browser` | **PASS**, existing processing/download/offline integration checks |
| Formatting and `git diff --check` | **PASS** |
| Physical Android retest of these changes | **NOT TESTED** here |
| Merge / deployment | **NOT PERFORMED** |

No Stage 1 processing, editor, styles, vendor binaries or tests were changed. `index.html` changes are inside Story sections only. Processing remains local and the browser test observes no external runtime requests. No dependency or mandatory account was added.

## Exact changed files

- `story.js`: applied timing/all-scenes export summaries, explicit duplicate action, media-event boundary enforcement.
- `story-export.js`: final-file duration/frame verification and specific failure handling.
- `index.html`: Story-only explanations and summary elements.
- `service-worker.js`: shell version `autocut-v1.1.0-increment-a.3` so updated files can replace the previous offline shell.
- `package.json`: add `test:story-trim` command.
- `tests/story-trim.test.js`: new real-media end-to-end regression suite.
- `tests/story-model.test.js`: two trim/verification regressions.
- `tests/story.test.js`: existing reuse tests recognize the clearer Add another scene label.
- `README.md`, `TESTING.md`, `QA-STORY-TRIM.md`: workflow clarification, reproduction instructions and evidence/limits.

## Android retest

After updating the local checkout, close other AutoCut tabs and reopen so the updated service worker can activate; reloading an open old tab alone does not guarantee activation. Import once (this already adds the scene), select it, enter 2 and 7, then tap **Apply scene timing**. Verify **Applied to this scene: 5.00s · source 2.00–7.00s** and **1 SCENE · 5.00s**. The export summary must also say all 1 scene / 5.00s. If a second full-length scene exists, remove that scene rather than the source asset. Preview, export and play the newly downloaded file. If a one-scene project still fails, report whether the new timing-verification error appears and the original/output durations; private footage does not need to be uploaded.
