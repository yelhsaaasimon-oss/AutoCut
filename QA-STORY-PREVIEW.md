# Story trim-preview regression investigation

Date: 2026-11-12. Branch: `arena/4b30bfe8-autocut`. Baseline: `bbfb317` (PR #2). No merge or deployment.

## Status and evidence limits

The user reported a persistent **Loading scene** indicator after changing video Start/End on physical Android. Their other import, ordering, sequential-preview and export workflows worked. That report supersedes any implication that the original automated acceptance report certified phone trim-preview behavior.

**The exact physical-device trim-only hang was not reproduced here.** Real Chromium tests with mobile/touch emulation initially completed ordinary trims. The changes address two independently reproduced preview lifecycle defects, with failing-before/passing-after tests. They are not proof that the user's specific phone/codec issue is resolved. A phone retest remains required; no new deployment was made.

## Trace and confirmed defects

`chooseScene()` renders/selects and calls `seek()`. Submitting scene timing calls `mutate()`, pauses preview, updates the model/UI, invalidates the old export, then seeks the selected scene start. This remains the existing implementation, not a replacement editor.

1. **Same-source readiness race.** Old `seek()` awaited metadata only when changing `src`. A trim superseding a cold scene selection reused its URL while `readyState` was still 0, assigned `currentTime`, and immediately hid loading. It did not await metadata or `seeked`/current-frame readiness. Actual baseline observation: `{ loading: false, readyState: 0, time: 2.25 }`. This proves premature readiness, not a persistent hang on this machine.
2. **Unbounded native play wait.** Only the metadata/image event wait had a timeout. `await video.play()` had none. Tokens prevented stale UI writes but did not cancel pending waits. A controlled never-settling native play promise after trims left loading visible after 16 seconds. This deterministically reproduces a persistent-loading failure path, but simulates a browser stall; it does not establish that this is what the user's phone did on trim alone.

The loading markup/CSS uses the existing `[hidden]` rule; it was not replaced. Export rendering, import preparation, the scene model and Stage 1 processing were not changed.

## Scoped change

- `story-preview.js`: preview-only helpers for readiness predicates, event listener cleanup, cancellation, and cancellable observation of native `play()`.
- `story.js`: abort superseded/paused preview work; wait for metadata even on a reused URL, then seek and await a current frame; handle unchanged/zero seeks without assuming a future `seeked` event; bound the entire preview request to 15 seconds. A timeout stops playback, clears loading and displays an explicit retry message. Newer requests own the UI; late old completions cannot overwrite it.
- `service-worker.js`: cache the new local module and bump shell version from `increment-a.1` to `increment-a.2`, avoiding a mixed old/new offline shell when an update is actually served.
- `tests/story-preview.test.js`: new real-browser regression suite. Locally generates a six-second H.264/AAC fixture with a long GOP/B-frames and red/green/blue sections using the shipped FFmpeg.wasm engine. Actual decoded canvas pixels validate trim-start content. Native pending-play and stalled-seek cases are explicitly controlled simulations; virtual time exercises the watchdog.
- `package.json`: add `npm run test:story-preview`.
- `TESTING.md` and this report: reproduction/results/limitations.

All application processing remains on-device; no backend, upload, paid service or runtime dependency was added. Generated fixtures/logs stay ignored in `tests/fixtures/` and `.arena/`.

## Failing-before / passing-after evidence

The new suite was run against baseline `story.js` temporarily restored from `git show HEAD:story.js`, then the changed file was restored. No branch switch was used.

| Check | Baseline | Changed code |
| --- | --- | --- |
| Cold selection + immediate trim keeps loading until ready | **FAIL**, exit 1: `false !== true`, readyState 0 | **PASS** |
| Pending native play clears loading by watchdog | **FAIL**, exit 1: loading still true after 16s | **PASS**, timeout message, loading false, Play enabled |
| Trim start displays actual green/blue/red frame | **PASS** in ordinary baseline runs | **PASS** |
| Start/end edits, identical timing, seek to zero | Ordinary baseline did not hang | **PASS** |
| Rapid video/image selection + superseding trims | Ordinary baseline did not hang | **PASS**, latest time/frame wins |
| Native playback after watchdog timeout | Not reached in failing baseline | **PASS** |
| Simulated trim-only stalled seek, timeout and subsequent trim recovery | Old code did not await seek completion | **PASS** |
| Select image during pending play, then resolve stale promise | Not reached in failing baseline | **PASS**, image selection remains current |

For the second independent baseline failure, `node tests/story-preview.test.js --timeout-only` skips just the initial cold-loading assertion, allowing the pending-play assertion to fail independently. The normal command runs all assertions. Baseline logs were saved locally in ignored `.arena/preview-red.log` and `.arena/preview-timeout-red.log`; final observations are in `.arena/preview-after.json`.

## Full validation rerun

| Command/check | Result |
| --- | --- |
| `npm test` | **PASS**, 40 tests |
| `npm run test:story-preview` | **PASS**, all preview regression assertions beneath `/AutoCut/`; also passed at domain root with `TEST_URL=http://localhost:5173/` |
| `npm run test:story` | **PASS**, all 15 acceptance groups, including real mixed MP4 frame/audio checks, downloads, cancellation and cold offline export |
| `npm run test:stage1` | **PASS**, all 17 acceptance groups |
| `npm run test:browser` | **PASS**, existing integration checks, including actual FFmpeg edits and offline processing |
| `git diff --check` | **PASS** |
| Physical Android retest of this change | **NOT TESTED** |
| GitHub Pages deployment / new public preview | **NOT TESTED / NOT PERFORMED** |

The shared ignored fixture directories are unchanged in purpose. Run suites sequentially when reproducing locally. With `npm run serve` already running, execute the commands above; browser tests default to `/AutoCut/` on port 5173. No build step is required.

## Phone retest needed

Once this branch's updated files are available in the user's local test setup, reload so the new service worker activates (cache version `autocut-v1.1.0-increment-a.2`). Import a previously affected short video; change Start, then End, apply repeatedly, switch between a video and image, then play and export. Confirm the preview shows the new trim-start frame. A genuine decoding stall must now produce a retry message rather than endless loading. If it still fails, the Chrome version, video format/dimensions and whether a timeout message appears will help narrow the remaining device-specific cause. There is no need to upload private footage.
