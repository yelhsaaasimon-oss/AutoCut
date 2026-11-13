# AutoCut coordinated audit and stabilization

**Release candidate:** 1.2.0-rc.1  
**Audit date:** 2026-11-12  
**Branch:** `arena/4b30bfe8-autocut`  
**Starting commit:** `f78fc6f`  
**Delivery:** current branch / PR #2 only. No merge, Pages change or deployment.

## Verdict

**Ready for final testing on the user's Android phone, not certified on physical Android here.** The entire existing Quick Edit and Story workflow was reviewed, coordinated repairs were made, and every existing suite plus new shared-engine, recovery, aspect-ratio and real-media checks passes. This is not a claim that all possible bugs or Android codec/device combinations have been eliminated.

The exact previously reported physical-phone single-scene trim/export failure remains **not reproduced in this environment**. The single-scene 2–7 cut passes real preview/export/decode/download tests; the new build adds bounded worker operations, final-file integrity gates, clearer scene/export state, distinct download names, and local diagnostics for any remaining device-specific problem. No source footage needs to be uploaded for testing.

## Audit coverage

Reviewed the parser/command generator, both UI modules, frame-based Story model, media imports, preview seeking/playback, FFmpeg render/join paths, worker loading, cancellation and wake locks, object URL lifetimes, service worker/cache lifecycle, manifest/icons, relative paths/static server, dependencies/licenses, existing tests and user instructions. Added tests around newly implemented behavior rather than relying only on existing suites.

### Complete list of findings from this audit and their disposition

“Gap” is a missing capability, not a claim that it was previously advertised as working. “Risk” identifies a code-level failure path; it does not mean the user's phone necessarily encountered it.

| ID | Kind | Finding | Repair / evidence |
| --- | --- | --- | --- |
| A01 | Confirmed bug | Quick Edit reset audio timestamps independently, removing an intentional source audio delay. | Preserve/pad the source timeline with `aresample=async=1:first_pts=0` before tempo/fades. Actual baseline early RMS 0.0889 → changed output RMS 0 at 0.3s, audible at 1.5s. |
| A02 | Reliability risk | A non-answering worker could leave exec/probe/filesystem promises pending indefinitely. | Shared engine wrapper bounds load to 2 minutes and each other operation to 15 minutes, releases the worker on timeout/cancel, and observes late results/rejections. Unit deadline/abort tests plus a deliberately non-answering real encoding-worker cancellation/retry pass. |
| A03 | Confirmed error-classification bug | Searching all FFmpeg logs for the word `memory` could mistake `ALLOW_MEMORY_GROWTH` in its build configuration for an OOM. | Ignore build-banner lines and match actual allocation/runtime failures; retain explicit actionable errors. Regression covers the banner and genuine out-of-bounds errors. |
| A04 | Integrity gap | Quick Edit enabled download after checking only nonempty bytes. | Probe actual output duration/codecs/geometry/audio presence, then decode the entire output with `-xerror` before exposing it. Silent, muted, MP3, trim, speed, horizontal and vertical paths pass. |
| A05 | Integrity gap | Story's final gate checked frames/duration but not selected geometry, codecs, normalized audio or whole-file decode. | Require H.264, selected 960×540 or 540×960 size, 24fps, expected frame count/duration, AAC 48kHz stereo, and successful full-file decode. |
| A06 | Memory risk | Quick Edit retained its entire source in WASM while copying the final output. | Delete source and source-probe data as soon as rendering finishes, before output verification/copy; terminate each job's WASM heap as before. This reduces peak live allocations, not a guarantee that large footage fits. |
| A07 | Async lifecycle bug/risk | Optional wake-lock requests were awaited; a pending request could delay cancellation, and a late old request could attach to a later job. | Nonblocking, job-scoped acquisition; late locks are released. Cleanup no longer waits for an optional release promise. Dedicated regression passes. |
| A08 | Workflow gap | Both projects were lost on refresh/tab termination. | Explicit IndexedDB Save / Restore / Forget per workspace, including original source media, Quick instructions/format, and Story ranges/order/format/selection. Cold offline restore/export passes. **Not autosave**, cloud backup or resumable encoding. |
| A09 | Format gap | Story only exported 16:9. | Real 9:16 option, matching preview aspect, portrait-aware image preparation and 540×960 render commands/output validation. Actual mixed portrait output decoded and inspected. |
| A10 | Prompt gap | Quick Edit's local parser lacked an explicit horizontal 16:9 instruction. | Deterministic horizontal center-crop command, a real guide example (12 total), unit tests and real trim/half-speed horizontal export. |
| A11 | Workflow gap | Slow or unresponsive Story media imports could not be cancelled. | Abortable media event waiters, Cancel import, cleanup and preservation of already accepted scenes. A stalled image import cancels and subsequent import succeeds. |
| A12 | Static-server exposure | Optional Termux/dev server could serve `.git`, ignored `.arena` media/artifacts and `node_modules` over its bound interface. | Deny hidden path components and dependency directories. Actual root and `/AutoCut/` HTTP checks return 403; normal app/worker/WASM requests still work. GitHub Pages itself is not this helper server. |
| A13 | Offline/data-usage defect | A shell cache bump discarded the unchanged ~31 MiB WASM engine. | Separate versioned core cache; migrate the known Increment A engine cache before deleting obsolete shells. Actual service-worker reinstall plus fresh controlled navigation and offline decode passes. |
| A14 | Storage failure risk | A CacheStorage read failure in an active worker could break an otherwise online fetch. | Cache reads now fall back to network if storage access throws; cache writes remain optional. Full storage denial is not physical-device certified; quota and offline behavior are tested separately. |
| A15 | Workflow gap | No automatic scene ordering was implemented. | Real local numeric filename arrangement, preserving IDs, selection and trims (shot1, shot2, shot10). No claim of AI scene understanding or content analysis. |
| A16 | Resource risk | Quick Edit could generate unbounded long outputs, particularly slowed video. | Explicit 10-minute output ceiling, existing source-size and 1280px long-edge bounds retained, operation deadlines and clear failure/retry. Multi-hour editing is not promised. |
| A17 | Troubleshooting gap | No common visible build identifier or useful local last-export report. | Shared build label, safe update-ready notice and copyable on-device diagnostics with capabilities, local engine paths, expected/actual duration, output tracks or failure. No telemetry/source names/media included. |
| A18 | Download ambiguity | Repeated constant filenames made old and new Android exports easy to confuse. | Duration + UTC timestamp filenames in both editors; completion notice identifies the new file. Actual downloads still byte-match inspected outputs. This is a workflow safeguard, not an assertion that it caused the reported phone bug. |
| A19 | New-feature hardening | Restoring full-length defaults could exceed scene limits before applying saved trims; reused saved IDs could collide. | Add validated trimmed ranges directly, regenerate IDs, validate source references/limits, then atomically replace the live project only after success. Saved media is re-read locally; transient URLs are revoked on failure/cancel. |
| A20 | New-feature hardening | Quota failure, blocked storage or corrupt snapshots must not erase current work or the previously saved slot. | Transactional writes, bounded open/transaction waits, late DB cleanup, schema/range/source validation, cancellation and non-destructive restore errors. Quota, corrupt-range, cancelled restore, missing slot and ID reuse tests pass. |
| A21 | Test/document consistency | Acceptance tests assumed exactly 11 commands; old copy said Story could not save and was fixed to 16:9. | Expected count now derives from the actual guide examples without weakening exact-count checks. UI/current docs reflect saved projects, both formats, real limits and future features. |

Previously fixed preview-loading/token races, no-op/zero seeks, delayed-animation trim cutoff, trim model boundaries, stale-output invalidation and scene reuse/duplication behavior were also rerun. They were not removed or replaced. Import still automatically creates a scene; **Add another scene** deliberately creates a separate copy, and export includes **all scenes**, not just the selected scene.

## What is complete versus future

| Capability | Status in this candidate |
| --- | --- |
| Free local prompt editing | **Complete within documented rules**: start/end removal, vertical/horizontal/square crops, grayscale, brighten, fades, mute/volume, 0.25–4× speed; no arbitrary language/LLM claims. |
| Multiple videos/JPG/PNG and reusable scenes | **Complete** within caps; select/remove/reorder, filename arrangement, timeline/playhead, per-scene trim/image duration, ordered preview. |
| Story MP4 / audio handling | **Complete within tested formats**: hard cuts, source audio and silent slots, sample-bounded PCM intermediates and one final AAC encode. |
| 16:9 / 9:16 / 1:1 | **Complete**: Story 16:9 or 9:16 fit/letterbox; Quick 16:9, 9:16 or 1:1 center-crop. |
| Local project save/recovery | **Complete manual snapshots**: one slot per workspace/browser origin/project path, source media included; explicit Restore/Forget. Save again after edits. Exported files and in-flight encoding are not saved. |
| Short-form / bounded longer output | **Complete within limits**: Story up to 2 minutes; Quick up to 10 minutes of output. Large/long hardware performance is not certified or unlimited. |
| Captions/text overlays | **Future / not implemented**. No fake controls. Needs a local font/text renderer, preview parity and export/escaping tests. |
| Image movement/zoom | **Future / not implemented**. Current images hold still. |
| Between-scene transitions | **Future / not implemented**. Quick clip fade-in/out works; Story cuts are hard cuts. |
| Separate music, sound effects, narration | **Future / not implemented**. Original source audio works; no extra track mixer. |
| Semantic/AI arrangement, speech transcription | **Future / not implemented**. Filename ordering is not content analysis. No paid service was substituted. |
| Autosave, portable project files, multiple named versions, resumable export | **Future / not implemented**. Manual local snapshots provide recovery of committed work only. |

## Actual export evidence

All rows use real generated local source files, real FFmpeg.wasm encoding, independent FFprobe/full-file decode, and appropriate pixel/audio assertions. File sizes refer to this test fixture, not a promise for arbitrary footage.

| Export | Actual result |
| --- | --- |
| Quick untrimmed with one-second delayed audio | **4.008s**, H.264/AAC, **53,700 bytes**. Early audio RMS 0; later 0.08777. Native playback advances; downloaded SHA-256 matches inspected output. |
| Quick trim + 16:9 + 0.5× speed | Expected about 4s; actual **3.984s**, **320×180**. Audio audible at 0.3/3.2s; full decode passes. Small duration differences reflect frame/audio quantization. |
| Quick restored MP3 | **3.024s**, MP3, **73,300 bytes**. Stored source/instructions/MP3 selection survive reload; restored online and offline exports decode. |
| Existing Stage 1 trim, grayscale, mute, composed vertical and square/offline edits | All previous real-media checks pass, including actual trim-start/end pixels, audio removal, native playback and downloaded-byte verification. |
| Single Story source 2–7 | **5.000s**, **120 frames / 24fps**, 960×540 H.264/AAC, **89,675 bytes**. Green→blue only, correct 880Hz section, full decode and actual download match. |
| Four-source landscape Story | **5.000s**, **120 frames**, **50,234 bytes**. Cyan→green→blue→yellow→purple; tone/silence occupy correct timeline slots. |
| New three-source portrait Story | **2.000s**, **48 frames**, **540×960**, H.264/AAC, **28,565 bytes**. Blue→magenta→green; silent first slots and audible last slot. Cold offline restored export has the same measured properties. |
| Image-only minimum Story | Existing acceptance passes a real **0.25s** export. |
| Deliberately mismatched final Story probe | **Rejected**, no successful export Blob. Fault injection, not a claim that the encoder naturally generated a bad single-scene file. |

At runtime, **both editors now probe and decode their actual output before enabling a download**. The test-side verifier uses a separate upstream FFmpeg instance, not the application's wrapper, so it does not merely trust the UI's own expected duration.

## Complete test results

Final full run: `TEST_URL=http://localhost:5176/AutoCut/ npm run test:all`, **exit 0**. Also reran the new suite at domain root, **exit 0**. The port is a development-only static server, not a deployed site/backend.

| Check | Final result |
| --- | --- |
| `npm test` | **60 PASS, 0 failed/skipped**: 26 Quick/parser/deployment, 17 Story/model/command, 17 new stabilization cases |
| `npm run test:stage1` | **17 acceptance groups PASS**, including all 12 guide commands |
| `npm run test:browser` | **PASS**, all existing actual processing/download/offline integration checks |
| `npm run test:story` | **15 acceptance groups PASS** |
| `npm run test:story-preview` | **PASS**, readiness/seek/cancellation/watchdog regressions |
| `npm run test:story-trim` | **9 checks PASS**, including actual five-second output, scheduler-delay fallback, duplicate-scene explanation and final probe gate |
| `npm run test:stabilization` | **12 acceptance groups PASS**, both `/AutoCut/` and `/` |
| Dependency audit | **0 reported vulnerabilities** at audit time; no runtime or development dependency added |
| Syntax / formatting / `git diff --check` | **PASS** |
| Touch viewports | **PASS**, 320/360/390/412/768/1440px, both workspaces; 390px screenshots also inspected |
| Privacy / relative paths | **PASS**, no external runtime requests/uploads; offline local-media restore/export passes |
| Physical Android / home-screen installation / large 4K workloads | **NOT TESTED here** |

### Failures encountered and resolved during the effort

- Baseline audio-delay regression **failed as expected** with RMS 0.0889 in the supposedly silent first second; fixed output is silent there. Logged in ignored `.arena/audit-audio-before.log`.
- An early acceptance rerun rejected the revised engine-start message because it omitted explicit connection guidance; that guidance was restored.
- Adding the horizontal guide example exposed hard-coded “11 commands” waits, causing cascading offline test failures. Tests now assert the exact current exported example count; all reruns pass.
- The added cache-migration test initially hung a raw test-side worker because its artificial unregister/re-register flow went offline before a fresh controlled navigation. The fixture now waits for activation and navigates fresh, matching close/reopen update instructions. Test-side decoding and the suite now have deadlines too. A transient headless-browser launch SIGSEGV during isolation did not reproduce in final runs.
- No tests remain failed in the final full run. Fault-injected failures are explicit expected rejection checks, not ignored failures.

Generated media, logs and screenshots remain ignored under `.arena/` and `tests/fixtures/`. Main evidence includes `audit-release-all.log`, `audit-release-root.log`, `stabilization-browser-report.json`, `story-trim-report.json`, `audit-quick-untrimmed.mp4`, `audit-story-vertical.mp4` and the mobile screenshots. No generated datasets or large new artifacts are committed.

## Android limits / honest remaining uncertainty

- Tests use Chromium 153, touch/mobile emulation, real media and normal web security. They are **not physical Android hardware tests**. The user's own footage/Chrome version/storage conditions may still expose another issue.
- Updated Android Chrome, WebAssembly and module workers are required. Use HTTPS or the phone's trusted localhost/127.0.0.1 URL. No SharedArrayBuffer/COOP/COEP special hosting is needed by the pinned single-thread engine.
- Quick source cap remains 300 MiB (150 MiB on reported ≤2GB RAM), 1280px maximum output long edge, now at most 10 minutes output. Story remains 8 assets / 12 scenes / 120s, 100 MiB aggregate (50 MiB on reported ≤2GB), 75 MiB per video / 120s source, 15 MiB / 20MP per image, 80 MiB intermediate budget. These are guards, **not guarantees of sufficient RAM**.
- HEVC/HDR, unusual timestamp layouts, every VFR/camera-rotation variant, 4K/large-footage performance and multi-hour projects are not exhaustively certified. Story requires native Chrome decoding for import/preview; Quick can attempt conversion of additional FFmpeg-readable sources.
- Keep Chrome foregrounded and the phone unlocked. Android may kill a tab, discard JS timers, revoke wake locks or evict storage. JavaScript cannot guarantee uninterrupted background export. Cancel stops the worker; interrupted jobs restart from the saved edit, not from a partially encoded file.
- Saved projects are **local, origin/path-bound, manual snapshots**. Private browsing, storage eviction, changing host/port/path or clearing site data can make them unavailable. Forget removes the saved slot, not the current edit or original device files. There is no automatic cloud backup.
- Delayed media-event preview cutoff can be about one `timeupdate` interval late; exports remain frame-bounded. Browser previews are not sample-accurate output renderers.
- A manual SW unregister/re-register requires a fresh controlled page before offline workers are reliable. Normal updates are deliberately not forced into an unsaved/busy page. Save, close all AutoCut tabs, reopen and check the build label.

## Changed implementation files

- `media-engine.js` (new): shared bounded engine adapter, local URLs, error classification, media verification, diagnostics, wake-lock helper and distinct output names.
- `project-store.js` (new): local IndexedDB snapshot transactions and Story serialization.
- `app.js`, `editor.js`: Quick reliability/integrity/audio fixes, horizontal rule, limits, project controls, update notice.
- `story.js`, `story-model.js`, `story-media.js`, `story-export.js`: Story format/arrangement/storage/import cancellation, validation and stronger output checks; existing preview helpers retained.
- `index.html`, `story.css`: real controls, build/diagnostic panel, accurate summaries, responsive layout.
- `service-worker.js`: new modules/version and reusable core cache with migration/fallback.
- `scripts/serve.js`: deny sensitive/internal paths and add common media MIME types.
- `package.json`, `package-lock.json`: candidate version/test scripts only; dependencies unchanged.
- `tests/stabilization.test.js`, `tests/stabilization-browser.test.js`, `tests/media-tools.js` (new): unit/recovery/real-media verification.
- Existing browser/Stage 1/Story acceptance tests: exact current command count and duration/timestamp filename expectations; media/hash/decode assertions retained.
- `README.md`, `TESTING.md`, this report and `UPDATE-TERMUX.md`: current workflow, evidence, feature boundaries and update/retest procedure.

Pinned vendor binaries/licenses, manifest and original styles are not rebuilt or replaced. All application files remain directly in the repository. No paid API, backend processing, mandatory account, deployment action or upload was added.

## Final phone handoff

Follow [UPDATE-TERMUX.md](./UPDATE-TERMUX.md). Check **Build v1.2.0-rc.1**, test a one-scene 2–7 cut, a mixed story, both formats, save/reload/restore, and downloaded playback. Open the **new duration/timestamped file**, not an older export. If the device still fails, the local **Export diagnostics** panel now shows the last workspace, capabilities, paths, expected/actual media and error; it can be copied without uploading footage. The final commit hash is supplied with the delivery and can be checked using `git rev-parse --short HEAD`.
