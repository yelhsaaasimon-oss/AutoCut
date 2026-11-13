# Prompt-guided Creator workflow — Phase 1

**Build:** v1.3.0-rc.1  
**Branch:** `arena/4b30bfe8-autocut`  
**Base:** `f11e646` (includes the Quick Edit duration fixes and `7666f32`)  
**Delivery status:** branch review / Android testing only. No merge or deployment.

## What this phase implements

A real **Prompt → Storyboard → Review → Apply cuts to Story → existing local MP4 export** workflow. This extends the existing application; it does not replace either editor or duplicate FFmpeg.

The planner is **deterministic local JavaScript rules and templates, not an LLM or an InVideo-equivalent AI service**. It makes no API calls, uploads, generated media or realistic voices. It does not research history, invent facts or inspect image/video contents. Supplied script lines are retained; without them it produces an explicitly editable hook/support/closing scaffold rather than claiming to have written a factual historical script.

### Working now

- Ordinary English prompt keywords specify one numeric total duration in seconds/minutes, optional whole scene count, 9:16/vertical or 16:9/horizontal, and fast/quick cuts.
- Generates an editable title, ordered storyboard, frame-accurate suggested durations, script/scene-description scaffolds, caption drafts, visual/motion/transition notes and audio placement suggestions.
- Optional **one scene-note/script line per scene** uses the user's actual material. If a prompt count is also specified, it must agree with the line count.
- Matches only **uploaded** images/videos using filename words, source capacity and a reuse penalty. It can reuse sources but never fabricates one. Missing/unusable footage remains an explicit unassigned row.
- Review every row: reassign the source, change duration/source start, edit all script/caption/instruction text, move Earlier/Later, edit title/aspect.
- Apply is blocked if prompt/script inputs changed since drafting (until redrafted or reverted), by missing sources, invalid ranges, image limits or project limits. It requires an explicit acknowledgement that current Story scenes will be **replaced** and that planning-only effects/audio are not rendered.
- Valid application stages a normal Story project, then atomically replaces only its scene list/format/selection. Sources remain in the library. Existing Story preview, timeline, per-scene trims, reordering and local FFmpeg MP4 export do the actual editing.
- Supplied narration/music/SFX files can be imported as **planning references**, auditioned, assigned a role and given a suggested start. Draft audio notes identify uploaded roles/names and scene start times. No audio or voice is generated. Auditioning pauses Story playback; Story playback/export and switching workspaces pause references, avoiding a misleading apparent soundtrack mix.
- Manual **Save project locally** includes prompt, script notes, reviewed storyboard, assignments and original audio references/roles/placement, alongside existing visual source files/Story edits. Restore remaps source identifiers safely, preserves missing assignments and accepts older snapshots without Creator fields.
- Offline shell includes the three new modules. Drafting, recovery, application and export can all run offline after warming the app/engine cache.

### Planning-only, not implemented/rendered in this phase

| Requested feature | Current boundary |
| --- | --- |
| Captions / text overlays / animated captions | Editable **draft text only**. Not burned into preview/MP4. |
| Pan / zoom / dramatic motion | Editable suggestions only. Images remain static. |
| Crossfades / scene transitions | Suggestions only; Story still exports **hard cuts**. |
| Per-scene speed / volume controls | Not implemented in Creator/Story. Existing **Quick Edit speed/volume/fades/mute still work** on its input video. |
| Narration placement / background music / sound effects | Files, roles, audition and suggested placement are real; **no extra-track mixing into MP4 yet**. Original video audio still exports normally. |
| Factual/creative language-model script writing | Not implemented. Local scaffolds/user-provided lines are not claimed to be an AI-written factual script. |
| Content-aware media search/understanding | Not implemented. Filename matching is only a suggestion; always review it. |
| Multi-hour projects / unlimited assets / automatic background rendering | Not implemented; existing mobile caps remain. |

These boundaries are visible in the interface, on each planning field, in the audio section and in the required Apply acknowledgement. There are no controls claiming to render unimplemented effects. This phase is the automatic editable-project foundation, **not completion of every feature in the overall project goal**.

## Architecture and implementation plan

### Implemented in this increment

1. **Pure planning/model layer — `creator-model.js`:** bounded prompt parsing, exact frame allocation, template scenes, deterministic filename matches, draft validation and staged conversion through the existing `createProject`/`addScene`/`validateProject` APIs. It has no DOM/network/engine side effects.
2. **Native audio-reference reader — `creator-audio.js`:** uses the existing abortable `mediaReady` helper, native metadata and temporary Blob URLs. Input size/type/duration gates run locally; URLs/media are released on failure/cancel/success. It does not encode or mix.
3. **Review/controller — `creator-ui.js`:** safe DOM creation, editable rows, missing-source/invalid-range blockers, explicit replace acknowledgement, native audio audition and import cancellation. It communicates with Story via narrow busy/dirty/apply/audition callbacks.
4. **Story integration — `story.js`:** keeps existing preview/export behavior; shares import/cancel locks, combined file budget, output invalidation and staged restore. No new FFmpeg instance or renderer.
5. **Persistence/offline — `project-store.js`, `service-worker.js`:** optional Creator snapshot fields with source-index-to-runtime-ID mapping, legacy compatibility, original audio Blobs in IndexedDB, new shell cache version. Unchanged core bytes retain their existing reusable engine cache.
6. **Tests/docs:** pure regressions plus independent real-media browser checks, then every existing Stage 1/Story/trim/preview/offline/Quick pipeline suite.

### Subsequent increments (not silently included now)

- Implement one shared scene-render specification for preview/export parity before adding text, motion and speed. Text requires a free, bundled font/renderer with licensing, escaping and multilingual/device tests.
- Add bounded local audio timeline/mixing for supplied narration/music/SFX, including offsets, volume, silence, trims, ducking decisions, cancellation and real decoded audio assertions. Preserve current source-audio alignment.
- Add frame-defined transitions/motion with Android memory limits and exact output-duration tests. Do not advertise the controls until both preview and export implement them.
- Extend prompt vocabulary only when its meaning maps to actual render operations. Semantic AI is not a substitute for missing source media or unimplemented rendering.

## Limits and safeguards

- Defaults: **30 seconds**, **16:9**, one scene per roughly six seconds (three for fast cuts), capped at 12 scenes. Explicit scene notes define the count; conflicts are rejected. Numeric English duration syntax is required when duration units are mentioned (e.g. 60 seconds / 1 minute); spelled-out numbers are rejected rather than silently misread. Prompt ≤2000 characters; notes ≤6000 total / 500 per line; title ≤160; each scene text field ≤500.
- Total requested/planned duration **0.25–120s**, **24fps**, minimum scene 0.25s. Image scene ≤30s; video source ranges must fit actual imported frames. Changing reviewed durations changes the planned total; the summary shows planned versus target duration rather than pretending they still agree.
- Existing Story visual limits: **8 assets / 12 scenes / 120s**, 75 MiB per video, image 15 MiB / 20MP, aggregate original-file budget **100 MiB** or **50 MiB** on reported ≤2GB RAM.
- Audio references: **4 files**, ≤10 MiB each / 20 MiB combined, readable native audio duration up to 10 minutes, suggested start 0–120s. Audio and visual originals **share** the 50/100 MiB budget. These caps are guards, not a promise of sufficient RAM.
- Audio reference metadata waits time out after 15s and are cancellable with the existing Cancel import button. Accepted sources/references remain intact after cancelled/failed imports.
- Draft generation does not mutate the live Story scene list or existing verified output. Apply invalidates old output; failure leaves the live project intact. Each Apply needs a fresh acknowledgement.
- Draft and Story are deliberately separate: subsequent manual Story edits do not rewrite the draft. Applying again replaces the Story scene list. Manual Save is required; there is no autosave, portable project file or cloud backup.
- Save validation rejects invalid draft/reference records without replacing the prior saved slot. Restore validates before replacing the live project. Audio reference metadata is stored from import; audio is not re-encoded or decoded into the export during restore.
- No generated video/images/voices, paid API, cloud renderer, account requirement or backend was introduced. Native Blob URLs and IndexedDB stay on the device; clearing site data or changing origin/path can lose saved projects.

## Automated verification

Final command: `TEST_URL=http://localhost:5176/AutoCut/ npm run test:all`, **exit 0** (recorded in `.arena/creator-final-all-exit.txt`; log `.arena/creator-final-all.log`). Optional static helper server only; not a backend/deployment. The Creator suite was also run at domain root (`.arena/creator-final-root.log`).

| Suite | Result |
| --- | --- |
| Unit tests | **80 PASS**, 0 failures/skips; includes 17 new Creator cases |
| Stage 1 acceptance | **17 groups PASS**, all 12 existing guide commands |
| Existing browser integration | **PASS** |
| Story acceptance | **15 groups PASS** |
| Story preview regressions | **PASS** |
| Story trim regressions | **9 PASS** |
| Stabilization/recovery/offline | **12 groups PASS** |
| Quick duration/pipeline investigation | **13 groups PASS** |
| Creator browser suite | **9 groups PASS**, project subpath and root |
| Dependency audit / syntax / formatting / diff check | **PASS**, no added dependency; zero reported vulnerabilities |
| Physical Android / home-screen install | **NOT TESTED here** |

Actual media checks, not just mocked UI:

- Two uploaded PNGs → reviewed 4s vertical storyboard → **540×960 H.264/AAC MP4, 4.000000s, 10,274 bytes**. Independent full decode and sampled blue `[0,0,255]` → red `[254,0,0]` frames pass.
- A real imported WAV is natively played/organized/saved/restored. The image-only output remains silent, proving a planning reference is **not falsely claimed mixed**.
- Cold offline restore → reviewed re-Apply → real MP4 export/full decode passes with cached modules and engine.
- New image → trimmed video plan exports **960×540, 4.000000s**; decoded blue → green `[0,255,1]` confirms the video's selected 2–4s source section. RMS is **0** in the image slot and **0.08851** in the video slot, confirming original clip audio placement.
- Missing footage, invalid reviewed timing, text-safe rendering, manual reassignment/reorder, ID remapping, corrupt audio, a deliberately stalled/cancelled audio import, and 320/390/768px viewports pass. Expected fault injection is labelled in the tests; no claim that the browser naturally hung is made.

Evidence logs/reports/screenshots/media stay ignored under `.arena/` and fixtures under `tests/fixtures/`; measured results are retained here. Run `npm run test:creator` for the Creator browser suite, `npm test` for all pure tests, or `npm run test:all` for everything with the static server running. Tests use Chromium 153 with touch/mobile emulation and real FFmpeg, **not physical Android hardware**.

## Changed files

- New: `creator-model.js`, `creator-ui.js`, `creator-audio.js`, `tests/creator-model.test.js`, `tests/creator-browser.test.js`, this document.
- Integration: `story.js`, `project-store.js`, `index.html`, `story.css`, `service-worker.js`.
- Build label/scripts only: `media-engine.js`, `package.json`, `package-lock.json`; existing build-label assertions in `tests/stabilization-browser.test.js` and `tests/quick-pipeline.test.js` updated to the actual candidate.
- Documentation: `README.md`, `TESTING.md`, `UPDATE-TERMUX.md`.
- Quick Edit commands/app logic, Story render commands/model/preview helpers, pinned FFmpeg/vendor binaries and dependency versions are unchanged in this increment.

## Android handoff

Follow [UPDATE-TERMUX.md](./UPDATE-TERMUX.md), verify **Build v1.3.0-rc.1**, then:

1. Story Mode → import a few short videos/JPG/PNG with descriptive filenames.
2. Enter a short prompt, e.g. **Create a 10-second vertical video with 2 scenes**. Supply two lines of your actual script/notes if desired. Tap **Draft storyboard locally**.
3. Check title, source choices, missing footage, duration/start, script and planning-only labels. Reassign manually as needed. Nothing should replace the existing scene list yet.
4. Acknowledge the replace/render boundary, Apply, then review/play/trim/reorder the **actual Story scenes** below. Export with the existing button, download the new timestamped file and verify duration, pictures and source audio.
5. Import a narration/music/SFX reference in the audio section, audition it, set role/start, Save, reload and Restore. Expect **no reference audio in MP4 yet**.
6. Repeat offline after warming the cache. Test Cancel import/export and a small Quick Edit regression.

**The previous physical-phone Quick Edit failure remains unconfirmed/unverified here. This feature does not certify that issue fixed.** If it recurs, capture the v1.3.0-rc.1 export diagnostics and the exact failing stage/file characteristics. No private footage or credentials need be uploaded.
