import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  importAsset,
  FPS,
  totalFrames,
  removeScene,
} from "../story-model.js";
import {
  emptyCreator,
  planStoryboard,
  validateDraft,
  draftProblems,
  applyStoryboard,
  validateCreator,
  creatorSnapshot,
  restoreCreator,
} from "../creator-model.js";
import { storySnapshot } from "../project-store.js";
const library = () => {
  const p = createProject();
  importAsset(p, { kind: "image", name: "red battle.png", size: 1024 });
  importAsset(p, { kind: "image", name: "blue ending.png", size: 1024 });
  return p;
};
test("Plain prompt extracts total duration, fast cuts, aspect and explicit scene count", () => {
  const plan = planStoryboard(
    "Create a 60-second funny historical video, vertical, with fast cuts, captions, zoom and music",
    "",
    [],
  );
  assert.equal(plan.format, "9:16");
  assert.equal(plan.scenes.length, 12);
  assert.equal(validateDraft(plan), 60 * FPS);
  assert.ok(plan.scenes.every((s) => s.assetId === null));
  assert.match(plan.scenes[0].script, /your own factual/);
  assert.match(plan.scenes[0].motion, /planning only/);
  assert.equal(
    planStoryboard("Make a 1 minute horizontal video with 3 scenes", "", [])
      .scenes.length,
    3,
  );
});
test("Provided scene notes become script/description; matching is filename-based and deterministic", () => {
  const p = library(),
    plan = planStoryboard("4 seconds", "blue ending\nred battle", p.assets);
  assert.equal(plan.scenes[0].assetId, p.assets[1].id);
  assert.equal(plan.scenes[0].script, "blue ending");
  assert.equal(plan.scenes[1].assetId, p.assets[0].id);
  assert.deepEqual(
    planStoryboard("4 seconds", "blue ending\nred battle", p.assets),
    plan,
  );
});
test("Reject unsupported duration, conflicts, overlong input and impossible scene counts without mutating project", () => {
  const p = library(),
    before = JSON.stringify(p);
  for (const prompt of [
    "0 seconds",
    "121 seconds",
    "1 second 2 minutes",
    "vertical horizontal",
    "0 scenes",
    "13 scenes",
    "0.25 seconds with 2 scenes",
    "",
  ])
    assert.throws(() => planStoryboard(prompt, "", p.assets));
  assert.throws(() => planStoryboard("test", "x".repeat(6001), p.assets));
  assert.throws(() =>
    planStoryboard("test", Array(13).fill("scene").join("\n"), p.assets),
  );
  assert.equal(JSON.stringify(p), before);
});
test("Unspecified duration is an explicit 30-second template, not arbitrary semantic AI", () => {
  assert.equal(planStoryboard("Tell a story", "", []).targetFrames, 720);
});
test("Frame rounding distributes target duration exactly", () => {
  const d = planStoryboard("4.1 seconds with 3 scenes", "", []);
  assert.equal(validateDraft(d), Math.round(4.1 * FPS));
});
test("Missing footage stays missing; apply is atomic and preserves live scenes", () => {
  const p = library(),
    d = planStoryboard("4 seconds with 2 scenes", "", []),
    before = JSON.stringify(p);
  assert.equal(draftProblems(d, p.assets).length, 2);
  assert.throws(() => applyStoryboard(p, d), /assign an uploaded/);
  assert.equal(JSON.stringify(p), before);
});
test("Planner does not stretch short videos or exceed image timing limits", () => {
  const p = createProject();
  importAsset(p, { kind: "video", name: "shot.mp4", size: 1, duration: 1 });
  const d = planStoryboard("4 seconds with 1 scene", "", p.assets);
  assert.equal(d.scenes[0].assetId, null);
  d.scenes[0].assetId = p.assets[0].id;
  assert.match(draftProblems(d, p.assets)[0], /exceeds/);
  const image = library(),
    long = planStoryboard("60 seconds with 1 scene", "", image.assets);
  assert.equal(long.scenes[0].assetId, null);
});
test("Reviewed cuts become a staged Story project with exact order, ranges and selected format", () => {
  const p = library(),
    old = JSON.stringify(p),
    d = planStoryboard(
      "4 seconds vertical",
      "blue ending\nred battle",
      p.assets,
    ),
    next = applyStoryboard(p, d);
  assert.equal(next.format, "9:16");
  assert.equal(next.scenes[0].assetId, p.assets[1].id);
  assert.equal(totalFrames(next), 96);
  assert.equal(next.selectedId, next.scenes[0].id);
  assert.equal(JSON.stringify(p), old);
});
test("Invalid reviewed text, timing or format is rejected before application", () => {
  const p = library(),
    base = planStoryboard("4 seconds", "blue\nred", p.assets);
  for (const change of [
    (d) => (d.format = "1:1"),
    (d) => (d.request = null),
    (d) => (d.scenes[0].durationFrames = NaN),
    (d) => (d.scenes[0].sourceStart = -1),
    (d) => (d.scenes[0].caption = "a".repeat(501)),
  ]) {
    const d = structuredClone(base);
    change(d);
    assert.throws(() => applyStoryboard(p, d));
  }
});
test("Audio references share the byte budget and validate count, role, placement and Blob", () => {
  const c = emptyCreator();
  const audio = {
    file: new Blob(["1234"], { type: "audio/wav" }),
    name: "voice.wav",
    duration: 1,
    start: 0,
    role: "narration",
  };
  c.audio.push(audio);
  validateCreator(c, []);
  assert.throws(() => validateCreator(c, [{ size: 5 }], 8), /budget/);
  for (const a of [
    { ...audio, role: "fake" },
    { ...audio, start: 121 },
    { ...audio, file: "url" },
    { ...audio, duration: Infinity },
  ])
    assert.throws(() => validateCreator({ ...c, audio: [a] }, []));
  assert.throws(() =>
    validateCreator({ ...c, audio: Array(5).fill(audio) }, []),
  );
});
test("Local snapshot remaps asset IDs on restore and retains script/audio Blobs", () => {
  const p = library();
  p.creator = emptyCreator();
  p.creator.prompt = "4 seconds";
  p.creator.draft = planStoryboard(
    "4 seconds",
    "blue ending\nred battle",
    p.assets,
  );
  p.creator.audio = [
    {
      file: new Blob(["audio"]),
      name: "recording.wav",
      duration: 1,
      start: 1,
      role: "music",
    },
  ];
  const saved = storySnapshot(p),
    restored = library(),
    c = restoreCreator(structuredClone(saved.creator), restored.assets);
  assert.equal(c.draft.scenes[0].assetId, restored.assets[1].id);
  assert.equal(c.draft.scenes[0].script, "blue ending");
  assert.ok(c.audio[0].file instanceof Blob);
  assert.equal(c.audio[0].start, 1);
});
test("Old saved Story snapshots without creator data remain compatible", () => {
  assert.deepEqual(restoreCreator(undefined, []), emptyCreator());
});
test("Missing removed sources stay unresolved after save, never silently reassigned", () => {
  const p = library(),
    c = emptyCreator();
  c.draft = planStoryboard("4 seconds", "blue ending\nred battle", p.assets);
  p.assets.pop();
  const restored = restoreCreator(creatorSnapshot(c, p.assets), p.assets);
  assert.equal(restored.draft.scenes[0].assetId, null);
  assert.equal(draftProblems(restored.draft, p.assets).length, 1);
});
test("Corrupt restored storyboard references and audio fail before live project replacement", () => {
  const p = library(),
    c = emptyCreator();
  c.draft = planStoryboard("4 seconds", "blue ending\nred battle", p.assets);
  const saved = creatorSnapshot(c, p.assets);
  saved.draft.scenes[0].asset = 99;
  assert.throws(() => restoreCreator(saved, p.assets), /reference/);
  assert.throws(() =>
    restoreCreator(
      { prompt: "", notes: "", audio: [{ file: "not a blob" }] },
      p.assets,
    ),
  );
});

test("Reject negative/decimal scene counts and conflicting notes; accept leading-dot seconds", () => {
  for (const prompt of [
    "-5 seconds",
    "-1 scenes",
    "1.5 scenes",
    "ten seconds",
    "one-minute video",
  ])
    assert.throws(() => planStoryboard(prompt, "", []));
  assert.throws(
    () => planStoryboard("4 seconds with 2 scenes", "one\ntwo\nthree", []),
    /line count/,
  );
  assert.equal(
    planStoryboard(".5 seconds with 1 scene", "", []).targetFrames,
    12,
  );
});
test("Audio placement notes reference supplied roles and planned scene time, never generated audio", () => {
  const d = planStoryboard(
    "4 seconds with 2 scenes and music",
    "",
    [],
    [{ role: "music", name: "my-music.wav" }],
  );
  assert.match(d.scenes[0].audio, /0.00s: music: my-music.wav/);
  assert.match(d.scenes[1].audio, /2.00s:/);
  assert.match(d.scenes[1].audio, /not mixed/);
});

test("Applying a reviewed video source range maps frames exactly and preserves source assets", () => {
  const p = createProject();
  importAsset(p, { kind: "video", name: "camera.mp4", size: 32, duration: 4 });
  const d = planStoryboard(
    "2 seconds horizontal with 1 scene",
    "camera",
    p.assets,
  );
  d.scenes[0].sourceStart = 48;
  const next = applyStoryboard(p, d);
  assert.equal(next.scenes[0].inFrame, 48);
  assert.equal(next.scenes[0].outFrame, 96);
  assert.equal(totalFrames(next), 48);
  assert.equal(p.scenes[0].inFrame, 0);
});
