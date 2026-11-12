import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import {
  EXAMPLES,
  parseInstructions as parse,
  buildCommand,
  timing,
} from "../editor.js";

for (const command of EXAMPLES)
  test(`Supported: ${command}`, () => {
    const plan = parse(command);
    assert.deepEqual(plan.errors, []);
    assert.ok(plan.edits.length);
    assert.ok(buildCommand(plan, 60).args.includes("output.mp4"));
  });
test("Composed natural instructions and decimal times", () => {
  const plan = parse(
    "Please trim the first 2.5 seconds, make it vertical, and add fade-in and fade-out.",
  );
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.trimStart, 2.5);
  assert.equal(plan.aspect, "9:16");
  assert.equal(plan.edits.length, 4);
});
test("Does not silently ignore unsupported clauses", () => {
  const plan = parse("Mute the audio and remove the background");
  assert.equal(plan.volume, 0);
  assert.equal(plan.errors.length, 1);
  assert.throws(() => buildCommand(plan, 10), /unsupported/);
});
test("Rejects unknown text within an otherwise supported clause", () => {
  assert.equal(
    parse("Make it vertical with animated captions").errors.length,
    1,
  );
});
test("Conflicting aspect, audio and speed are rejected", () => {
  for (const text of [
    "make it square, make it vertical",
    "mute audio, lower the volume",
    "speed 2x, speed 0.5x",
  ])
    assert.ok(parse(text).errors.length);
});
test("Volume validation and explicit percentages", () => {
  assert.equal(parse("lower the audio volume to 25%").volume, 0.25);
  assert.equal(parse("lower the volume to 200%").errors.length, 1);
});
test("Speed bounds are enforced", () => {
  assert.equal(parse("speed 0x").errors.length, 1);
  assert.equal(parse("speed 100x").errors.length, 1);
});
test("Trim bounds and unknown duration", () => {
  assert.throws(() => timing(parse("trim the first 5 seconds"), 5), /entire/);
  assert.throws(() => timing(parse(""), NaN), /duration/);
});
test("Slow-motion limits input duration, not output duration", () => {
  const { args, outputDuration } = buildCommand(
    parse(
      "trim the first 2 seconds, remove the last 1 seconds, slow the video down to half speed",
    ),
    8,
  );
  assert.equal(outputDuration, 10);
  assert.ok(args.indexOf("-t") < args.indexOf("-i"));
  assert.equal(args[args.indexOf("-t") + 1], "5");
  assert.match(args[args.indexOf("-vf") + 1], /setpts=PTS\/0.5/);
  assert.match(args[args.indexOf("-af") + 1], /atempo=0.5/);
});
test("Mute really removes the audio stream", () => {
  const args = buildCommand(parse("mute the audio"), 10).args;
  assert.ok(args.includes("-an"));
  assert.ok(!args.includes("-af"));
});
test("MP3 restrictions are explicit", () => {
  assert.throws(
    () => buildCommand(parse("make it square"), 10, "mp3"),
    /visual edits/,
  );
  assert.throws(
    () => buildCommand(parse("mute the audio"), 10, "mp3"),
    /nothing to export/,
  );
  const args = buildCommand(parse("lower the volume"), 10, "mp3").args;
  assert.ok(args.includes("libmp3lame"));
  assert.ok(args.includes("output.mp3"));
});
test("At tempo chained outside 0.5 to 2 range", () => {
  assert.match(
    buildCommand(parse("speed 4x"), 10).args.join(" "),
    /atempo=2,atempo=2/,
  );
  assert.match(
    buildCommand(parse("speed 0.25x"), 10).args.join(" "),
    /atempo=0.5,atempo=0.5/,
  );
});
test("Short fade durations are bounded", () => {
  const args = buildCommand(parse("add fade-in and fade-out"), 0.5).args.join(
    " ",
  );
  assert.match(args, /fade=t=in:st=0:d=0.25/);
  assert.match(args, /fade=t=out:st=0.25:d=0.25/);
});
test("Blank instructions permit straightforward conversion", () => {
  const plan = parse("");
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.edits.length, 0);
  assert.ok(buildCommand(plan, 10).args.includes("output.mp4"));
});
test("Manifest and required deployment files exist", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url)),
  );
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) {
    const data = await readFile(new URL("../" + icon.src, import.meta.url));
    const [width, height] = icon.sizes.split("x").map(Number);
    assert.equal(data.readUInt32BE(16), width);
    assert.equal(data.readUInt32BE(20), height);
  }
  for (const path of [
    "index.html",
    "styles.css",
    "app.js",
    "editor.js",
    "service-worker.js",
    "vendor/core/ffmpeg-core.wasm",
    "vendor/ffmpeg/worker.js",
    ".nojekyll",
    "THIRD_PARTY_NOTICES.md",
  ])
    assert.ok((await stat(new URL("../" + path, import.meta.url))).isFile());
});
