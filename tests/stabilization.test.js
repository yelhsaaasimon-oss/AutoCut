import test from "node:test";
import assert from "node:assert/strict";
import {
  createMediaEngine,
  MediaError,
  mediaErrorMessage,
  ENGINE_PATHS,
  verifyQuickOutput,
  probeMedia,
  verifyMediaDecode,
  keepScreenAwake,
  exportFileName,
} from "../media-engine.js";
import {
  createProject,
  importAsset,
  removeScene,
  addScene,
  updateScene,
  arrangeScenes,
  setProjectFormat,
  validateProject,
  totalFrames,
} from "../story-model.js";
import { sceneCommand, verifyStoryOutput } from "../story-export.js";
import { parseInstructions, buildCommand, timing } from "../editor.js";
import { storySnapshot } from "../project-store.js";

function fakeEngine(overrides = {}) {
  const state = { terminated: 0 };
  const engine = {
    terminate: () => state.terminated++,
    ...Object.fromEntries(
      ["load", "exec", "ffprobe", "writeFile", "readFile", "deleteFile"].map(
        (method) => [method, async () => 0],
      ),
    ),
    ...overrides,
  };
  return { engine, state };
}
test("A non-answering worker has a deadline and is terminated exactly once", async () => {
  const f = fakeEngine({ exec: () => new Promise(() => {}) });
  const engine = createMediaEngine({
    factory: () => f.engine,
    taskTimeout: 10,
  });
  await assert.rejects(engine.exec([]), /timed out/);
  assert.equal(f.state.terminated, 1);
  await assert.rejects(engine.readFile("output"), /timed out/);
  engine.terminate();
  assert.equal(f.state.terminated, 1);
});
test("Aborting a hung worker rejects every pending operation, not just current UI", async () => {
  const f = fakeEngine({
    writeFile: () => new Promise(() => {}),
    exec: () => new Promise(() => {}),
  });
  const abort = new AbortController();
  const engine = createMediaEngine({
    factory: () => f.engine,
    signal: abort.signal,
  });
  const a = engine.exec([]),
    b = engine.writeFile("source", new Uint8Array());
  const checks = [
    assert.rejects(a, { name: "AbortError" }),
    assert.rejects(b, { name: "AbortError" }),
  ];
  abort.abort();
  await Promise.all(checks);
  assert.equal(f.state.terminated, 1);
});
test("Already-aborted requests never invoke native operations", async () => {
  const abort = new AbortController();
  abort.abort();
  let calls = 0;
  const f = fakeEngine({ exec: async () => calls++ });
  const engine = createMediaEngine({
    factory: () => f.engine,
    signal: abort.signal,
  });
  await assert.rejects(engine.exec([]), { name: "AbortError" });
  assert.equal(calls, 0);
});
test("A late native rejection after timeout is observed, not unhandled", async () => {
  let rejectNative;
  const f = fakeEngine({
    exec: () =>
      new Promise((_, reject) => {
        rejectNative = reject;
      }),
  });
  const engine = createMediaEngine({ factory: () => f.engine, taskTimeout: 5 });
  await assert.rejects(engine.exec([]), /timed out/);
  rejectNative(new Error("late native failure"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(f.state.terminated, 1);
});
test("Loader forces same-module local worker, core and WASM URLs", async () => {
  const old = globalThis.Worker;
  globalThis.Worker = class {};
  let config;
  const f = fakeEngine({
    load: async (value) => {
      config = value;
      return true;
    },
  });
  const engine = createMediaEngine({ factory: () => f.engine });
  try {
    await engine.load({ coreURL: "https://example.invalid/paid.js" });
    assert.deepEqual(config, ENGINE_PATHS);
    for (const url of Object.values(config))
      assert.match(url, /AutoCut\/vendor\//);
  } finally {
    engine.terminate();
    if (old === undefined) delete globalThis.Worker;
    else globalThis.Worker = old;
  }
});
test("Raw rejection without an Error is still a rejection", async () => {
  const f = fakeEngine({ exec: () => Promise.reject(undefined) }),
    engine = createMediaEngine({ factory: () => f.engine });
  let rejected = false;
  await engine.exec([]).then(
    () => assert.fail("Must reject"),
    () => {
      rejected = true;
    },
  );
  assert.equal(rejected, true);
  engine.terminate();
});
test("FFmpeg build MEMORY_GROWTH banner does not hide a useful error", () => {
  assert.equal(
    mediaErrorMessage(new Error("Source has no audio"), [
      "configuration: -sALLOW_MEMORY_GROWTH=1",
    ]),
    "Source has no audio",
  );
  assert.match(
    mediaErrorMessage(new Error("RuntimeError: memory access out of bounds")),
    /ran out of memory/,
  );
  assert.equal(
    mediaErrorMessage(new MediaError("Exact recovery instruction"), [
      "allocation failed",
    ]),
    "Exact recovery instruction",
  );
});
test("Quick output gate validates duration, codecs, mute, audio and geometry", () => {
  const meta = {
    format: { duration: "5" },
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 320,
        height: 180,
        avg_frame_rate: "24/1",
      },
      { codec_type: "audio", codec_name: "aac" },
    ],
  };
  assert.equal(verifyQuickOutput(meta, 5, "mp4", true), 5);
  for (const change of [
    (m) => {
      m.format.duration = "10";
    },
    (m) => {
      m.streams[0].width = 319;
    },
    (m) => {
      m.streams[0].codec_name = "hevc";
    },
    (m) => {
      m.streams.pop();
    },
  ]) {
    const invalid = structuredClone(meta);
    change(invalid);
    assert.throws(
      () => verifyQuickOutput(invalid, 5, "mp4", true),
      /integrity/,
    );
  }
  assert.throws(() => verifyQuickOutput(meta, 5, "mp4", false), /integrity/);
  assert.equal(
    verifyQuickOutput(
      {
        format: { duration: "5.04" },
        streams: [{ codec_type: "audio", codec_name: "mp3" }],
      },
      5,
      "mp3",
      true,
    ),
    5.04,
  );
});
test("Probe validates FFprobe -1 JSON; full decode failure is not downloadable", async () => {
  let deleted;
  const engine = {
    ffprobe: async () => -1,
    readFile: async () =>
      JSON.stringify({ streams: [], format: { duration: 5 } }),
    deleteFile: async (name) => {
      deleted = name;
    },
    exec: async () => 1,
  };
  assert.equal((await probeMedia(engine, "result.mp4")).format.duration, 5);
  assert.equal(deleted, "verified.json");
  await assert.rejects(
    verifyMediaDecode(engine, "result.mp4"),
    /full-file decode/,
  );
  engine.readFile = async () => "not json";
  await assert.rejects(probeMedia(engine, "result.mp4"), /unreadable/);
});
test("New horizontal prompt is deterministic; unsupported features stay rejected", () => {
  const plan = parseInstructions("Make the video horizontal (16:9)");
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.aspect, "16:9");
  assert.match(buildCommand(plan, 5).args.join(" "), /ih\*16\/9/);
  assert.ok(
    parseInstructions("add automatic captions and music").errors.length,
  );
  assert.throws(() => timing(parseInstructions(""), 601), /10 minutes/);
});
test("Quick audio preserves leading delay before applying speed/fades", () => {
  const args = buildCommand(parseInstructions("speed 0.5x, fade-in"), 4).args;
  assert.match(
    args[args.indexOf("-af") + 1],
    /^aresample=async=1:first_pts=0,atempo=0.5,afade/,
  );
});
test("Saved trimmed scenes restore within limits without full-source intermediate scenes", () => {
  const p = createProject();
  for (const name of ["clip10.mp4", "clip2.mp4"]) {
    const initial = importAsset(p, {
      kind: "video",
      name,
      size: 100,
      duration: 120,
    });
    removeScene(p, initial.id);
  }
  for (const asset of p.assets)
    addScene(p, asset.id, { inFrame: 48, outFrame: 168 });
  validateProject(p);
  assert.equal(totalFrames(p), 240);
  const selected = p.selectedId;
  arrangeScenes(p);
  assert.equal(
    p.assets.find((a) => a.id === p.scenes[0].assetId).name,
    "clip2.mp4",
  );
  assert.equal(p.selectedId, selected);
  assert.ok(p.scenes.every((s) => s.inFrame === 48 && s.outFrame === 168));
  const rev = p.revision;
  arrangeScenes(p);
  assert.equal(p.revision, rev);
  assert.throws(() =>
    addScene(p, p.assets[0].id, { inFrame: -1, outFrame: 100 }),
  );
});
test("Story portrait geometry is applied to real scene commands and snapshots", () => {
  const p = createProject(),
    scene = importAsset(p, {
      kind: "video",
      name: "clip.mp4",
      size: 100,
      duration: 10,
    });
  updateScene(p, scene.id, 2, 7);
  setProjectFormat(p, "9:16");
  assert.match(
    sceneCommand(scene, p.assets[0], true, 0, p.format).args.join(" "),
    /scale=540:960/,
  );
  assert.equal(storySnapshot(p).format, "9:16");
  assert.deepEqual(storySnapshot(p).scenes, [
    { asset: 0, inFrame: 48, outFrame: 168 },
  ]);
  assert.throws(() => setProjectFormat(p, "fake"));
  assert.equal(p.format, "9:16");
});
test("Project validation rejects missing sources and corrupted frame limits", () => {
  const p = createProject(),
    scene = importAsset(p, {
      kind: "video",
      name: "clip.mp4",
      size: 100,
      duration: 10,
    });
  scene.outFrame = 999;
  assert.throws(() => validateProject(p));
  scene.outFrame = 120;
  p.assets[0].frames = NaN;
  assert.throws(() => validateProject(p));
  p.assets = [];
  assert.throws(() => validateProject(p));
});

test("Late optional wake-lock acquisition is released and cannot block an export", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let resolveLock,
    released = 0,
    assigned = 0,
    active = true;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      wakeLock: {
        request: () =>
          new Promise((resolve) => {
            resolveLock = resolve;
          }),
      },
    },
  });
  try {
    assert.equal(
      keepScreenAwake(
        () => active,
        () => assigned++,
      ),
      undefined,
    );
    active = false;
    resolveLock({ release: async () => released++ });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(assigned, 0);
    assert.equal(released, 1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
  }
});
test("Story runtime verifies selected geometry, H.264/AAC and normalized audio", () => {
  const meta = {
    format: { duration: "5" },
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        duration: "5",
        nb_frames: "120",
        width: 540,
        height: 960,
        r_frame_rate: "24/1",
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
        channels: 2,
      },
    ],
  };
  assert.doesNotThrow(() => verifyStoryOutput(meta, 120, "9:16"));
  assert.throws(() => verifyStoryOutput(meta, 120, "16:9"));
  meta.streams[1].sample_rate = "44100";
  assert.throws(() => verifyStoryOutput(meta, 120, "9:16"));
});

test("Android export filenames identify duration and time and exclude path characters", () => {
  const time = new Date("2026-11-12T12:34:56.789Z");
  assert.equal(
    exportFileName("autocut-story", 5, "mp4", time),
    "autocut-story-5p00s-20261112-123456-789.mp4",
  );
  assert.ok(!exportFileName("bad/path:clip", 2, "mp4", time).includes("/"));
});
