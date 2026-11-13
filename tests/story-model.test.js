import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  FPS,
  LIMITS,
  importAsset,
  addScene,
  removeScene,
  moveScene,
  updateScene,
  selectScene,
  removeAsset,
  locateTime,
  totalFrames,
  sceneStart,
  durationFrames,
} from "../story-model.js";
import {
  sceneCommand,
  joinCommand,
  verifyStoryOutput,
} from "../story-export.js";
const video = (duration = 4, name = "clip.mp4") => ({
  kind: "video",
  name,
  duration,
  size: 1024,
});
const image = () => ({ kind: "image", name: "map.png", size: 1024 });
test("New project has no scenes or selected asset", () => {
  const p = createProject();
  assert.equal(totalFrames(p), 0);
  assert.equal(locateTime(p, 0), null);
});
test("Import multiple assets creates ordered selected scenes", () => {
  const p = createProject();
  const a = importAsset(p, video());
  const b = importAsset(p, image());
  assert.equal(p.assets.length, 2);
  assert.deepEqual(p.scenes, [a, b]);
  assert.equal(p.selectedId, b.id);
  assert.equal(totalFrames(p), 7 * FPS);
});
test("Selection leaves revision and timings unchanged", () => {
  const p = createProject(),
    a = importAsset(p, video()),
    b = importAsset(p, image());
  const rev = p.revision;
  selectScene(p, a.id);
  assert.equal(p.revision, rev);
  assert.equal(sceneStart(p, b.id), 4);
});
test("Scene reordering preserves IDs and duration", () => {
  const p = createProject();
  const a = importAsset(p, video()),
    b = importAsset(p, image());
  assert.equal(moveScene(p, a.id, -1), false);
  assert.equal(moveScene(p, b.id, 1), false);
  assert.equal(moveScene(p, b.id, -1), true);
  assert.deepEqual(p.scenes, [b, a]);
  assert.equal(sceneStart(p, a.id), 3);
  assert.equal(totalFrames(p), 7 * FPS);
});
test("Remove scene preserves reusable asset and chooses adjacent scene", () => {
  const p = createProject();
  const a = importAsset(p, video()),
    b = importAsset(p, image());
  removeScene(p, b.id);
  assert.equal(p.selectedId, a.id);
  assert.equal(p.assets.length, 2);
  removeScene(p, a.id);
  assert.equal(p.selectedId, null);
  assert.equal(totalFrames(p), 0);
});
test("Assets can be reused and only unused assets can be removed", () => {
  const p = createProject(),
    a = importAsset(p, video());
  const b = addScene(p, a.assetId);
  assert.throws(() => removeAsset(p, a.assetId), /scenes/);
  removeScene(p, a.id);
  removeScene(p, b.id);
  removeAsset(p, a.assetId);
  assert.equal(p.assets.length, 0);
});
test("Video trims use source times and update timeline boundaries", () => {
  const p = createProject(),
    a = importAsset(p, video()),
    b = importAsset(p, image());
  updateScene(p, a.id, 1, 3);
  assert.equal(durationFrames(a), 2 * FPS);
  assert.equal(sceneStart(p, b.id), 2);
  assert.equal(locateTime(p, 1.99).scene.id, a.id);
  assert.equal(locateTime(p, 2).scene.id, b.id);
  assert.equal(locateTime(p, 999).atEnd, true);
  assert.equal(locateTime(p, -1).local, 0);
});
test("Frame quantization does not accumulate millisecond rounding drift", () => {
  const p = createProject(),
    a = importAsset(p, video());
  updateScene(p, a.id, 0.333, 0.667);
  assert.equal(a.inFrame, 8);
  assert.equal(a.outFrame, 16);
  assert.equal(totalFrames(p), 8);
});
test("Invalid trims leave model and revision unchanged", () => {
  const p = createProject(),
    a = importAsset(p, video()),
    revision = p.revision;
  for (const times of [
    [-1, 2],
    [-0.001, 2],
    [2, 1],
    [0, 5],
    [0, 0.1],
    [NaN, 2],
    [0, Infinity],
  ])
    assert.throws(() => updateScene(p, a.id, ...times));
  assert.equal(p.revision, revision);
  assert.equal(durationFrames(a), 96);
});
test("Image duration limits are enforced", () => {
  const p = createProject(),
    a = importAsset(p, image());
  updateScene(p, a.id, 0, 1.5);
  assert.equal(durationFrames(a), 36);
  for (const times of [
    [0, 31],
    [1, 3],
    [0, 0],
  ])
    assert.throws(() => updateScene(p, a.id, ...times));
});
test("Project size and asset limits are atomic", () => {
  const p = createProject();
  assert.throws(
    () => importAsset(p, { ...video(), size: 2048 }, 1024),
    /memory safety/,
  );
  assert.equal(p.assets.length, 0);
  for (let i = 0; i < LIMITS.assets; i++) importAsset(p, video(1));
  const rev = p.revision;
  assert.throws(() => importAsset(p, video()), /assets/);
  assert.equal(p.revision, rev);
});
test("Duration and scene-count limits prevent unlimited exports", () => {
  const p = createProject(),
    a = importAsset(p, video(120));
  assert.throws(() => importAsset(p, image()), /120 seconds/);
  assert.equal(p.assets.length, 1);
  assert.throws(() => updateScene(p, a.id, 0, 121));
  const q = createProject(),
    b = importAsset(q, video(1));
  for (let i = 1; i < LIMITS.scenes; i++) addScene(q, b.assetId);
  assert.throws(() => addScene(q, b.assetId), /12 scenes/);
});
test("Invalid sources do not leave orphan assets", () => {
  for (const details of [
    video(NaN),
    video(0),
    { ...image(), size: 0 },
    { ...image(), kind: "audio" },
  ]) {
    const p = createProject();
    assert.throws(() => importAsset(p, details));
    assert.equal(p.assets.length, 0);
  }
});
test("Scene renderer generates fixed geometry, bounded frames and sample-exact PCM", () => {
  const p = createProject(),
    a = importAsset(p, video());
  updateScene(p, a.id, 1, 3);
  const command = sceneCommand(a, p.assets[0], true, 0);
  assert.equal(command.frames, 48);
  assert.equal(command.samples, 96000);
  assert.match(command.args.join(" "), /scale=960:540/);
  assert.match(command.args.join(" "), /atrim=end_sample=96000/);
  assert.ok(!command.args.includes("anullsrc=r=48000:cl=stereo"));
  assert.ok(command.args.indexOf("-ss") < command.args.indexOf("-i"));
});
test("Silent scene has synthetic silence; image loops; final join encodes AAC once", () => {
  const p = createProject(),
    a = importAsset(p, image());
  const command = sceneCommand(a, p.assets[0], false, 1);
  assert.ok(command.args.includes("-loop"));
  assert.ok(command.args.includes("anullsrc=r=48000:cl=stereo"));
  const args = joinCommand(2, 120);
  assert.ok(args.includes("concat:scene-0.pcm|scene-1.pcm"));
  assert.ok(args.includes("copy"));
  assert.ok(args.includes("aac"));
  assert.throws(() => joinCommand(0, 0));
});

test("2–7s trim stores source frames 48–168 and exports only 120 frames / 240000 audio samples", () => {
  const p = createProject(),
    scene = importAsset(p, video(10));
  updateScene(p, scene.id, 2, 7);
  assert.equal(scene.inFrame, 48);
  assert.equal(scene.outFrame, 168);
  assert.equal(durationFrames(scene), 120);
  assert.equal(totalFrames(p), 120);
  assert.equal(p.assets[0].duration, 10);
  assert.equal(p.assets[0].frames, 240);
  for (const [time, sourceTime] of [
    [0, 2],
    [2.5, 4.5],
    [4.999, 6.999],
  ]) {
    const location = locateTime(p, time);
    assert.ok(
      Math.abs(location.scene.inFrame / FPS + location.local - sourceTime) <
        0.0001,
    );
  }
  assert.equal(locateTime(p, 5).atEnd, true);
  for (const hasAudio of [false, true]) {
    const command = sceneCommand(scene, p.assets[0], hasAudio, 0);
    assert.equal(command.args[command.args.indexOf("-ss") + 1], "2");
    assert.equal(command.args[command.args.indexOf("-t") + 1], "5");
    assert.equal(command.frames, 120);
    assert.equal(command.samples, 240000);
    assert.match(command.args.join(" "), /atrim=end_sample=240000/);
  }
  const join = joinCommand(1, totalFrames(p));
  assert.equal(join[join.indexOf("-t") + 1], "5");
  const copy = addScene(p, scene.assetId);
  assert.equal(durationFrames(copy), 240);
  assert.equal(scene.inFrame, 48);
  assert.equal(totalFrames(p), 360); // full-source duplicate + five-second cut.
});

test("Actual export verification rejects original duration or wrong frame count", () => {
  const meta = {
    format: { duration: "5.000000" },
    streams: [
      { codec_type: "video", nb_frames: "120", duration: "5.000000" },
      { codec_type: "audio", duration: "5.000000" },
    ],
  };
  assert.doesNotThrow(() => verifyStoryOutput(meta, 120));
  for (const change of [
    (m) => {
      m.format.duration = "10";
    },
    (m) => {
      m.streams[0].duration = "10";
    },
    (m) => {
      m.streams[0].nb_frames = "240";
    },
    (m) => {
      m.streams[0].nb_frames = "119";
    },
    (m) => {
      m.streams.pop();
    },
    (m) => {
      m.format.duration = "N/A";
    },
  ]) {
    const invalid = structuredClone(meta);
    change(invalid);
    assert.throws(
      () => verifyStoryOutput(invalid, 120),
      /timing verification failed/,
    );
  }
});
