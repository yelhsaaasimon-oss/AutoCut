// Real-media Quick Edit investigation. Android UA/touch emulation is NOT Android hardware.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { launchBrowser, ANDROID } from "./browser-setup.js";
import { inspectMedia, outputBytes } from "./media-tools.js";

const base = process.env.TEST_URL || "http://localhost:5173/AutoCut/";
await mkdir(".arena", { recursive: true });
const browser = await launchBrowser();
// Block SW here so network faults reach the actual worker rather than its cache.
// Cache/offline behavior is covered independently in the stabilization suite.
const context = await browser.newContext({
  ...ANDROID,
  serviceWorkers: "block",
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [],
  report = [];
page.on("pageerror", (error) => errors.push(error.message));
const deadline = setTimeout(() => {
  console.error("Quick investigation exceeded 240s");
  process.exitCode = 1;
  browser.close();
}, 240000);
const pass = (name, evidence) => {
  report.push({ name, status: "PASS", evidence });
  console.log("PASS:", name, JSON.stringify(evidence));
};
async function reset() {
  await page.goto(base);
  await page.locator("#process-button").waitFor();
}
async function load(name, bytes, instruction = "", format = "mp4") {
  await page
    .locator("#video-input")
    .setInputFiles({ name, mimeType: "video/mp4", buffer: bytes });
  await page.waitForFunction(
    () => document.querySelector("#preview-video").readyState >= 1,
  );
  await page.locator("#instructions").fill(instruction);
  await page.locator("#export-format").selectOption(format);
}
async function run() {
  await page.locator("#process-button").tap();
  await page.waitForFunction(
    () => document.querySelector("#progress-region").hidden,
    null,
    { timeout: 90000 },
  );
  return {
    ok:
      (await page.locator("#download-button").getAttribute("aria-disabled")) ===
      "false",
    error: await page.locator("#instruction-errors").textContent(),
    diagnostic: JSON.parse(
      await page.locator("#export-diagnostics-text").textContent(),
    ),
  };
}
try {
  await reset();
  const fixtures = await page.evaluate(async () => {
    const { FFmpeg } = await import("./vendor/ffmpeg/index.js");
    const ff = new FFmpeg(),
      logs = [];
    ff.on("log", ({ message }) => logs.push(message));
    const timeout = setTimeout(() => ff.terminate(), 60000);
    const out = {};
    try {
      await ff.load({
        coreURL: new URL("./vendor/core/ffmpeg-core.js", location.href).href,
        wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", location.href).href,
      });
      for (const [name, video, audio] of [
        ["balanced", 4, 4],
        ["long-audio", 2, 4],
        ["short-audio", 4, 2],
      ]) {
        const args = [
          "-f",
          "lavfi",
          "-i",
          `testsrc2=size=320x240:rate=30:duration=${video}`,
          "-f",
          "lavfi",
          "-i",
          `sine=frequency=880:sample_rate=48000:duration=${audio}`,
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-threads",
          "1",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          `${name}.mp4`,
        ];
        if (await ff.exec(args)) throw new Error(logs.join("\n"));
        out[name] = Array.from(await ff.readFile(`${name}.mp4`));
      }
      if (
        await ff.exec([
          "-i",
          "balanced.mp4",
          "-c",
          "copy",
          "-metadata:s:v:0",
          "rotate=90",
          "rotated.mp4",
        ])
      )
        throw new Error(logs.join("\n"));
      out.rotated = Array.from(await ff.readFile("rotated.mp4"));
      if (
        await ff.exec([
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=320x240:rate=30:duration=4",
          "-vf",
          "select='if(lt(t,2),not(mod(n,2)),1)'",
          "-vsync",
          "vfr",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-threads",
          "1",
          "vfr.mp4",
        ])
      )
        throw new Error(logs.join("\n"));
      out.vfr = Array.from(await ff.readFile("vfr.mp4"));
      if (
        await ff.exec([
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=1920x1080:rate=30:duration=1",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-threads",
          "1",
          "phone1080.mp4",
        ])
      )
        throw new Error(logs.join("\n"));
      out.phone1080 = Array.from(await ff.readFile("phone1080.mp4"));
      return out;
    } finally {
      clearTimeout(timeout);
      ff.terminate();
    }
  });
  for (const name of Object.keys(fixtures))
    fixtures[name] = Buffer.from(fixtures[name]);
  const sources = {};
  for (const name of ["long-audio", "short-audio", "rotated", "vfr"]) {
    const inspected = await inspectMedia(page, fixtures[name]);
    assert.equal(inspected.decode, 0);
    sources[name] = inspected.metadata;
  }
  await writeFile(
    ".arena/quick-pipeline-sources.json",
    JSON.stringify(sources, null, 2),
  );
  pass(
    "Independent real-source probes expose unequal A/V durations, rotation and VFR",
    Object.fromEntries(
      Object.entries(sources).map(([name, meta]) => [
        name,
        {
          duration: meta.format.duration,
          tracks: meta.streams.map((s) => ({
            type: s.codec_type,
            duration: s.duration,
            rate: s.avg_frame_rate,
            side: s.side_data_list,
          })),
        },
      ]),
    ),
  );

  await load("confidential-footage", fixtures.balanced, "captions please");
  assert.equal(await page.locator("#process-button").isDisabled(), true);
  await page
    .locator("#instructions")
    .fill("trim the first 0.5 seconds, remove the last 0.5 seconds");
  assert.equal(await page.locator("#process-button").isEnabled(), true);
  let outcome = await run();
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const successfulDiagnostic = outcome.diagnostic;
  let bytes = await outputBytes(page, "#download-button");
  let inspected = await inspectMedia(page, bytes, {
    frameTimes: [0.2],
    audioTimes: [0.3],
  });
  assert.equal(inspected.decode, 0);
  assert.ok(Math.abs(Number(inspected.metadata.format.duration) - 3) < 0.15);
  assert.ok(inspected.audio[0].rms > 0.02);
  const event = page.waitForEvent("download");
  await page.locator("#download-button").tap();
  const download = await event;
  await download.saveAs(".arena/quick-investigation-download.mp4");
  assert.equal(await download.failure(), null);
  const hash = (b) => createHash("sha256").update(b).digest("hex");
  assert.equal(
    hash(await readFile(".arena/quick-investigation-download.mp4")),
    hash(bytes),
  );
  await page.locator("#preview-video").evaluate((v) => v.play());
  await page.waitForFunction(
    () => document.querySelector("#preview-video").currentTime > 0.2,
  );
  pass(
    "Import, metadata, parser/state, encode, validation, native playback and download bytes",
    {
      duration: inspected.metadata.format.duration,
      bytes: bytes.length,
      sha256: hash(bytes),
    },
  );

  // Probe cases independently so the baseline records every failure rather than stopping at the first.
  const failures = [];
  for (const [name, format, instruction, expected] of [
    ["long-audio", "mp4", "mute", 2],
    ["long-audio", "mp4", "", 2],
    ["short-audio", "mp3", "", 4],
    ["rotated", "mp4", "", 4],
    ["vfr", "mp4", "", 4],
    ["phone1080", "mp4", "", 1],
  ]) {
    await load(`${name}.mp4`, fixtures[name], instruction, format);
    outcome = await run();
    if (!outcome.ok) {
      failures.push({ name, format, instruction, ...outcome });
      console.log("REPRODUCED FAILURE:", JSON.stringify(failures.at(-1)));
      continue;
    }
    bytes = await outputBytes(page, "#download-button");
    inspected = await inspectMedia(
      page,
      bytes,
      format === "mp3" ? { audioTimes: [0.4, 3.2] } : {},
    );
    assert.equal(inspected.decode, 0);
    if (
      Math.abs(Number(inspected.metadata.format.duration) - expected) >= 0.15
    ) {
      failures.push({
        name,
        format,
        instruction,
        actualDuration: inspected.metadata.format.duration,
        expectedDuration: expected,
      });
      console.log(
        "REPRODUCED DURATION MISMATCH:",
        JSON.stringify(failures.at(-1)),
      );
      continue;
    }
    if (name === "phone1080") {
      const v = inspected.metadata.streams.find(
        (s) => s.codec_type === "video",
      );
      assert.equal(v.width, 1280);
      assert.equal(v.height, 720);
    }
    if (name === "rotated") {
      const v = inspected.metadata.streams.find(
        (s) => s.codec_type === "video",
      );
      assert.equal(v.width, 240);
      assert.equal(v.height, 320);
    }
    if (name === "short-audio") {
      assert.ok(inspected.audio[0].rms > 0.02);
      assert.equal(inspected.audio[1].rms, 0);
    }
    pass(`Quick ${name} / ${format} ${instruction}`, {
      duration: inspected.metadata.format.duration,
      tracks: inspected.metadata.streams.map((s) => ({
        codec: s.codec_name,
        width: s.width,
        height: s.height,
      })),
      audio: inspected.audio,
    });
  }
  await writeFile(
    ".arena/quick-pipeline-reproduced.json",
    JSON.stringify(failures, null, 2),
  );
  assert.deepEqual(
    failures,
    [],
    "Actual encoded sources reproduced Quick Edit failures; inspect .arena/quick-pipeline-reproduced.json",
  );

  assert.equal(successfulDiagnostic.build, "1.2.0-rc.2");
  assert.equal(successfulDiagnostic.pipeline.stage, "ready");
  assert.equal(successfulDiagnostic.pipeline.encodeExitCode, 0);
  assert.deepEqual(
    successfulDiagnostic.pipeline.events.map((e) => e.stage),
    [
      "load-engine",
      "read-source",
      "probe-source",
      "build-command",
      "encode",
      "probe-output",
      "decode-output",
      "read-output",
    ],
  );
  assert.ok(!JSON.stringify(successfulDiagnostic).includes("confiden"));
  assert.ok(successfulDiagnostic.pipeline.command.includes("input.bin"));

  // Missing core is a real worker load failure, not a synthetic resolved UI promise.
  await reset();
  await context.route("**/vendor/core/ffmpeg-core.js", (route) =>
    route.abort("failed"),
  );
  await load("balanced.mp4", fixtures.balanced);
  outcome = await run();
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /engine could not start/);
  assert.equal(outcome.diagnostic.pipeline.stage, "load-engine");
  assert.equal(await page.locator("#process-button").isEnabled(), true);
  await context.unroute("**/vendor/core/ffmpeg-core.js");
  outcome = await run();
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  pass(
    "Actual worker/core load failure releases controls; same imported file retries successfully",
    {},
  );
  // Real non-answering class worker; shorten only the existing load deadline
  // in this test page (production remains 120 seconds). No success-path mocks.
  await reset();
  await context.route("**/vendor/ffmpeg/worker.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "self.onmessage = () => {};",
    }),
  );
  await page.evaluate(() => {
    window.originalTimer = window.setTimeout;
    window.setTimeout = (fn, ms, ...args) =>
      window.originalTimer(fn, ms === 120000 ? 150 : ms, ...args);
  });
  await load("balanced.mp4", fixtures.balanced);
  outcome = await run();
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /did not start within two minutes/);
  assert.equal(outcome.diagnostic.pipeline.stage, "load-engine");
  assert.equal(await page.locator("#process-button").isEnabled(), true);
  await context.unroute("**/vendor/ffmpeg/worker.js");
  await page.evaluate(() => {
    window.setTimeout = window.originalTimer;
  });
  outcome = await run();
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  pass(
    "Non-answering real worker hits the startup deadline, releases UI and permits a real retry",
    { testDeadlineMs: 150, productionDeadlineMs: 120000 },
  );

  await page.evaluate(() => {
    window.nativePostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (
        message.type === "EXEC" &&
        message.data.args.at(-1) === "output.mp4"
      ) {
        message = {
          ...message,
          data: {
            ...message.data,
            args: ["-i", "input.mp4", "-c:v", "no_such_encoder", "output.mp4"],
          },
        };
      }
      return window.nativePostMessage.call(this, message, ...rest);
    };
  });
  outcome = await run();
  assert.equal(outcome.ok, false);
  assert.equal(outcome.diagnostic.pipeline.stage, "encode");
  assert.notEqual(outcome.diagnostic.pipeline.encodeExitCode, 0);
  assert.equal(await page.locator("#process-button").isEnabled(), true);
  await page.evaluate(() => {
    Worker.prototype.postMessage = window.nativePostMessage;
  });
  outcome = await run();
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  pass(
    "Actual FFmpeg command failure records an encoding exit code and real retry succeeds",
    {},
  );

  await page.evaluate(() => {
    window.nativePostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message.type === "EXEC" && message.data.args.at(-1) === "output.mp4")
        return;
      return window.nativePostMessage.call(this, message, ...rest);
    };
    window.originalTimer = window.setTimeout;
    window.setTimeout = (fn, ms, ...args) =>
      window.originalTimer(
        fn,
        ms === 900000 &&
          JSON.parse(
            document.querySelector("#export-diagnostics-text").textContent,
          ).pipeline?.stage === "encode"
          ? 500
          : ms,
        ...args,
      );
  });
  outcome = await run();
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /Processing timed out/);
  assert.equal(outcome.diagnostic.pipeline.stage, "encode");
  assert.equal(await page.locator("#process-button").isEnabled(), true);
  await page.evaluate(() => {
    Worker.prototype.postMessage = window.nativePostMessage;
    window.setTimeout = window.originalTimer;
  });
  outcome = await run();
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  pass(
    "Non-answering encoding operation hits its task deadline and allows real retry",
    { testDeadlineMs: 500, productionDeadlineMs: 900000 },
  );

  await page.locator("#video-input").setInputFiles({
    name: "broken.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("not an MP4; deliberate corrupt input"),
  });
  outcome = await run();
  assert.equal(outcome.ok, false);
  assert.equal(outcome.diagnostic.pipeline.stage, "probe-source");
  assert.equal(
    await page.locator("#download-button").getAttribute("href"),
    null,
  );
  assert.equal(await page.locator("#process-button").isEnabled(), true);
  pass(
    "Corrupt real file fails at source probe, never offers a download, and releases controls",
    { stage: outcome.diagnostic.pipeline.stage, error: outcome.error },
  );
  assert.deepEqual(errors, []);
} finally {
  clearTimeout(deadline);
  await writeFile(
    ".arena/quick-pipeline-report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
