// End-to-end 2–7 second trim regression: real local media, native preview,
// actual FFmpeg export, independent probe/decode, and downloaded file bytes.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { launchBrowser, ANDROID } from "./browser-setup.js";

const browser = await launchBrowser();
const context = await browser.newContext(ANDROID);
const page = await context.newPage();
page.setDefaultTimeout(20000);
const base = process.env.TEST_URL || "http://localhost:5173/AutoCut/";
const report = [],
  errors = [],
  external = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (
    /^https?:/.test(request.url()) &&
    new URL(request.url()).origin !== new URL(base).origin
  )
    external.push(request.url());
});
const pass = (name, evidence) => {
  report.push({ name, status: "PASS", evidence });
  console.log("PASS:", name, JSON.stringify(evidence));
};
await mkdir(".arena", { recursive: true });
await mkdir("tests/fixtures", { recursive: true });
async function exportUI() {
  await page.locator("#story-export").tap();
  await page.waitForFunction(
    () => document.querySelector("#story-progress-region").hidden,
    null,
    { timeout: 180000 },
  );
  assert.equal(
    await page.locator("#story-result").isVisible(),
    true,
    await page.locator("#story-message").textContent(),
  );
}
async function inspectUIExport(times) {
  return page.evaluate(async (times) => {
    const { FFmpeg } = await import("./vendor/ffmpeg/index.js");
    const ff = new FFmpeg();
    try {
      await ff.load({
        coreURL: new URL("./vendor/core/ffmpeg-core.js", location.href).href,
        wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", location.href).href,
      });
      await ff.writeFile(
        "check.mp4",
        new Uint8Array(
          await (
            await fetch(document.querySelector("#story-download").href)
          ).arrayBuffer(),
        ),
      );
      await ff.ffprobe([
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=nb_frames,codec_type",
        "-of",
        "json",
        "check.mp4",
        "-o",
        "probe.json",
      ]);
      const meta = JSON.parse(await ff.readFile("probe.json", "utf8"));
      const colors = [];
      for (const time of times) {
        const code = await ff.exec([
          "-ss",
          String(time),
          "-i",
          "check.mp4",
          "-frames:v",
          "1",
          "-vf",
          "crop=100:100,scale=1:1",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          "-y",
          "frame.rgb",
        ]);
        if (code) throw new Error("Decode failed");
        colors.push(Array.from(await ff.readFile("frame.rgb")));
      }
      return {
        duration: Number(meta.format.duration),
        frames: Number(
          meta.streams.find((s) => s.codec_type === "video").nb_frames,
        ),
        colors,
      };
    } finally {
      ff.terminate();
    }
  }, times);
}
try {
  await page.goto(base);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const bytes = await page.evaluate(async () => {
    const { FFmpeg } = await import("./vendor/ffmpeg/index.js");
    const ff = new FFmpeg();
    const logs = [];
    ff.on("log", ({ message }) => logs.push(message));
    try {
      await ff.load({
        coreURL: new URL("./vendor/core/ffmpeg-core.js", location.href).href,
        wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", location.href).href,
      });
      const code = await ff.exec([
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=320x240:r=30:d=10,drawbox=color=lime:t=fill:enable='gte(t,2)*lt(t,5)',drawbox=color=blue:t=fill:enable='gte(t,5)*lt(t,7)',drawbox=color=yellow:t=fill:enable='gte(t,7)'",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=if(lt(t\\,2)\\,0.3*sin(2*PI*440*t)\\,if(lt(t\\,7)\\,0.3*sin(2*PI*880*t)\\,0.3*sin(2*PI*1760*t))):s=48000:d=10",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-g",
        "300",
        "-sc_threshold",
        "0",
        "-bf",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        "1",
        "-c:a",
        "aac",
        "-shortest",
        "trim-source.mp4",
      ]);
      if (code) throw new Error(logs.join("\n"));
      return Array.from(await ff.readFile("trim-source.mp4"));
    } finally {
      ff.terminate();
    }
  });
  await writeFile("tests/fixtures/story-trim-source.mp4", Buffer.from(bytes));
  await page.locator("#story-mode").tap();
  await page
    .locator("#story-input")
    .setInputFiles("tests/fixtures/story-trim-source.mp4");
  await page.waitForFunction(
    () =>
      !document.querySelector("#story-import").disabled &&
      document.querySelector("#story-preview-loading").hidden,
  );
  assert.equal(await page.locator(".story-scene-select").count(), 1);
  await page.locator("#story-in").fill("2");
  await page.locator("#story-out").fill("7");
  await page.locator("#story-apply").tap();
  await page.waitForFunction(
    () =>
      document.querySelector("#story-preview-loading").hidden &&
      !document.querySelector("#story-video").seeking,
  );
  assert.match(
    await page.locator("#story-total").textContent(),
    /1 SCENE · 5.00s/,
  );
  assert.match(
    await page.locator(".story-scene-select").textContent(),
    /5.00s.*SOURCE 2.00–7.00s/,
  );
  const source = await page
    .locator("#story-video")
    .evaluate((v) => ({ time: v.currentTime, duration: v.duration }));
  assert.ok(Math.abs(source.time - 2) < 0.05, JSON.stringify(source));
  assert.ok(Math.abs(source.duration - 10) < 0.05);
  pass(
    "Applied model/UI source range 2–7, source file remains 10 seconds",
    source,
  );

  await page.evaluate(() => {
    const video = document.querySelector("#story-video");
    window.trimPlayback = [];
    video.addEventListener("timeupdate", () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, 1, 1);
      window.trimPlayback.push({
        time: video.currentTime,
        rgb: Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3),
      });
    });
  });
  const started = Date.now();
  await page.locator("#story-play").tap();
  await page.waitForFunction(
    () =>
      document.querySelector("#story-play").getAttribute("aria-label") ===
      "Pause story",
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#story-play").getAttribute("aria-label") ===
      "Play story",
    null,
    { timeout: 12000 },
  );
  const playback = await page.evaluate(() => ({
    samples: window.trimPlayback,
    paused: document.querySelector("#story-video").paused,
    time: document.querySelector("#story-video").currentTime,
    clock: document.querySelector("#story-clock").textContent,
  }));
  assert.ok(playback.paused);
  assert.ok(
    playback.time >= 7 && playback.time < 7.35,
    JSON.stringify(playback),
  );
  assert.match(playback.clock, /5.00 \/ 5.00s/);
  assert.ok(
    playback.samples.some(
      (s) => s.rgb[1] > 230 && s.rgb[0] < 20 && s.rgb[2] < 20,
    ),
  );
  assert.ok(
    playback.samples.some(
      (s) => s.rgb[2] > 230 && s.rgb[0] < 20 && s.rgb[1] < 20,
    ),
  );
  assert.ok(
    playback.samples.every((s) => s.time >= 1.95 && s.time < 7.35),
    JSON.stringify(playback),
  );
  pass("Native preview plays source 2–7 and stops at project 5s", {
    elapsedMs: Date.now() - started,
    sourceEnd: playback.time,
    clock: playback.clock,
    samples: playback.samples.length,
  });

  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    window.trimCommands = [];
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message.type === "EXEC")
        window.trimCommands.push([...message.data.args]);
      return post.call(this, message, ...rest);
    };
  });
  await exportUI();
  const result = await page.evaluate(async () => {
    const output = new Uint8Array(
      await (
        await fetch(document.querySelector("#story-download").href)
      ).arrayBuffer(),
    );
    const commands = window.trimCommands.map((args) => [...args]);
    const { FFmpeg } = await import("./vendor/ffmpeg/index.js");
    const ff = new FFmpeg();
    try {
      await ff.load({
        coreURL: new URL("./vendor/core/ffmpeg-core.js", location.href).href,
        wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", location.href).href,
      });
      await ff.writeFile("result.mp4", output.slice());
      await ff.ffprobe([
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        "result.mp4",
        "-o",
        "meta.json",
      ]);
      const meta = JSON.parse(await ff.readFile("meta.json", "utf8"));
      const colors = [];
      for (const time of [0, 0.25, 2.75, 3.25, 4.8]) {
        const code = await ff.exec([
          "-ss",
          String(time),
          "-i",
          "result.mp4",
          "-frames:v",
          "1",
          "-vf",
          "crop=100:100,scale=1:1",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          "-y",
          "frame.rgb",
        ]);
        if (code) throw new Error("Frame decode failed");
        colors.push({ time, rgb: Array.from(await ff.readFile("frame.rgb")) });
      }
      const decode = await ff.exec(["-i", "result.mp4", "-f", "null", "-"]);
      const audioCode = await ff.exec([
        "-i",
        "result.mp4",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "f32le",
        "audio.pcm",
      ]);
      if (audioCode) throw new Error("Audio decode failed");
      const audio = await ff.readFile("audio.pcm");
      const samples = new Float32Array(
        audio.buffer,
        audio.byteOffset,
        audio.byteLength / 4,
      );
      const tones = [];
      for (const time of [0.3, 2, 4.6]) {
        let crossings = 0;
        const start = Math.round(time * 48000),
          end = start + 4800;
        for (let i = start + 1; i < end; i++)
          if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
        tones.push(crossings * 10);
      }
      return {
        meta,
        colors,
        tones,
        decode,
        commands,
        bytes: Array.from(output),
      };
    } finally {
      ff.terminate();
    }
  });
  const stream = result.meta.streams.find((s) => s.codec_type === "video");
  assert.ok(
    Math.abs(Number(result.meta.format.duration) - 5) < 0.05,
    JSON.stringify(result.meta),
  );
  assert.equal(Number(stream.nb_frames), 120);
  assert.equal(stream.r_frame_rate, "24/1");
  assert.equal(result.decode, 0);
  for (const { time, rgb } of result.colors) {
    const channel = time < 3 ? 1 : 2;
    assert.ok(
      rgb[channel] > 230 &&
        rgb.filter((_, i) => i !== channel).every((c) => c < 20),
      JSON.stringify({ time, rgb }),
    );
  }
  assert.ok(
    result.tones.every((hz) => Math.abs(hz - 880) <= 20),
    JSON.stringify(result.tones),
  );
  pass(
    "Real exported MP4 is five seconds / 120 frames, only green→blue with trimmed 880Hz audio",
    {
      duration: result.meta.format.duration,
      frames: stream.nb_frames,
      colors: result.colors,
      tones: result.tones,
      commands: result.commands,
    },
  );
  await writeFile(".arena/story-trim-output.mp4", Buffer.from(result.bytes));
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#story-download").tap();
  const download = await downloadPromise;
  const chunks = [];
  for await (const chunk of await download.createReadStream())
    chunks.push(chunk);
  assert.equal(
    createHash("sha256").update(Buffer.concat(chunks)).digest("hex"),
    createHash("sha256").update(Buffer.from(result.bytes)).digest("hex"),
  );
  await page.locator("#story-result-video").evaluate((v) => v.play());
  await page.waitForFunction(
    () => document.querySelector("#story-result-video").currentTime > 0.1,
  );
  assert.ok(
    Math.abs(
      (await page.locator("#story-result-video").evaluate((v) => v.duration)) -
        5,
    ) < 0.05,
  );
  pass(
    "Native output playback and actual download match verified five-second output",
    { bytes: result.bytes.length },
  );
  // Reproduce import + Add scene as separate actions: import already creates
  // one full-source scene; trimming a second scene must not silently trim both.
  await page.reload();
  await page.locator("#story-mode").tap();
  await page
    .locator("#story-input")
    .setInputFiles("tests/fixtures/story-trim-source.mp4");
  await page.waitForFunction(
    () =>
      !document.querySelector("#story-import").disabled &&
      document.querySelector("#story-preview-loading").hidden,
  );
  await page
    .locator("#story-assets")
    .getByRole("button", { name: /^Add (another )?scene$/ })
    .tap();
  await page.locator("#story-in").fill("2");
  await page.locator("#story-out").fill("7");
  await page.locator("#story-apply").tap();
  assert.equal(await page.locator(".story-scene-select").count(), 2);
  assert.match(
    await page.locator(".story-scene-select").nth(0).textContent(),
    /10.00s.*SOURCE 0.00–10.00s/,
  );
  assert.match(
    await page.locator(".story-scene-select").nth(1).textContent(),
    /5.00s.*SOURCE 2.00–7.00s/,
  );
  assert.match(
    await page.locator("#story-total").textContent(),
    /2 SCENES · 15.00s/,
  );
  pass("Import then Add scene retains a separate full original scene", {
    total: await page.locator("#story-total").textContent(),
  });
  const duplicateSummary = await page.evaluate(
    () => document.querySelector("#story-export-summary")?.textContent || "",
  );
  await exportUI();
  const duplicateOutput = await inspectUIExport([0.1, 10.1, 13.5]);
  assert.equal(duplicateOutput.duration, 15);
  assert.equal(duplicateOutput.frames, 360);
  assert.ok(
    duplicateOutput.colors[0][0] > 230 && duplicateOutput.colors[0][1] < 20,
  );
  assert.ok(
    duplicateOutput.colors[1][1] > 230 && duplicateOutput.colors[1][0] < 20,
  );
  assert.ok(
    duplicateOutput.colors[2][2] > 230 && duplicateOutput.colors[2][0] < 20,
  );
  pass(
    "Two-scene export explains full original plus independent trimmed scene",
    duplicateOutput,
  );
  await page.getByRole("button", { name: "Remove scene 1", exact: true }).tap();
  assert.match(
    await page.locator("#story-total").textContent(),
    /1 SCENE · 5.00s/,
  );
  await page.waitForFunction(
    () => document.querySelector("#story-preview-loading").hidden,
  );

  // A phone can delay animation-frame callbacks while native media continues.
  // The trim boundary must not rely exclusively on the animation-frame loop.
  await page.evaluate(() => {
    window.nativeTrimRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
  });
  await page.locator("#story-play").tap();
  await page.waitForFunction(
    () =>
      document.querySelector("#story-play").getAttribute("aria-label") ===
      "Pause story",
    null,
    { polling: 100 },
  );
  await page.waitForFunction(
    () => document.querySelector("#story-video").paused,
    null,
    { polling: 100, timeout: 6500 },
  );
  const cutoff = await page
    .locator("#story-video")
    .evaluate((v) => v.currentTime);
  assert.ok(
    cutoff >= 7 && cutoff < 7.4,
    `Trim preview escaped source out point: ${cutoff}`,
  );
  assert.match(
    await page.locator("#story-clock").textContent(),
    /5.00 \/ 5.00s/,
  );
  await page.evaluate(() => {
    window.requestAnimationFrame = window.nativeTrimRAF;
  });
  pass(
    "Preview respects trim out point even with animation callbacks withheld",
    { sourceEnd: cutoff },
  );
  assert.match(duplicateSummary, /all 2 scenes · 15.00s/);
  assert.match(
    await page.locator("#story-applied-timing").textContent(),
    /5.00s · source 2.00–7.00s/,
  );
  await exportUI();
  const trimmedOnly = await inspectUIExport([0, 3.5, 4.8]);
  assert.equal(trimmedOnly.duration, 5);
  assert.equal(trimmedOnly.frames, 120);
  assert.ok(trimmedOnly.colors[0][1] > 230 && trimmedOnly.colors[0][0] < 20);
  assert.ok(trimmedOnly.colors[1][2] > 230 && trimmedOnly.colors[2][2] > 230);
  pass(
    "Removing the full-length duplicate leaves a real five-second trimmed export",
    trimmedOnly,
  );

  // Controlled output-metadata fault: the final file is really rendered, but
  // report its duration as 10s. The export must reject it, not return a Blob.
  const rejectedOutput = await page.evaluate(async () => {
    const { createProject, importAsset, updateScene } = await import(
      "./story-model.js"
    );
    const { exportStory } = await import("./story-export.js");
    const file = new File(
      [await (await fetch(document.querySelector("#story-video").src)).blob()],
      "source.mp4",
      { type: "video/mp4" },
    );
    const project = createProject();
    const scene = importAsset(project, {
      kind: "video",
      duration: 10,
      size: file.size,
      file,
    });
    updateScene(project, scene.id, 2, 7);
    let injected = 0;
    try {
      await exportStory(project, {
        onEngine(ff) {
          const read = ff.readFile;
          ff.readFile = async (...args) => {
            const value = await read(...args);
            if (args[0] === "probe.json" && typeof value === "string") {
              const meta = JSON.parse(value);
              if (
                meta.format?.duration &&
                meta.streams?.some((stream) => stream.nb_frames)
              ) {
                meta.format.duration = "10.000000";
                injected++;
                return JSON.stringify(meta);
              }
            }
            return value;
          };
        },
      });
      return { accepted: true, injected };
    } catch (error) {
      return { accepted: false, injected, message: error.message };
    }
  });
  assert.equal(
    rejectedOutput.accepted,
    false,
    "A duration-mismatched final export must not be returned as a successful Blob",
  );
  assert.equal(rejectedOutput.injected, 1);
  assert.match(rejectedOutput.message, /timing verification failed/);
  pass(
    "Export rejects a duration-mismatched final probe instead of returning a downloadable Blob",
    rejectedOutput,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
} finally {
  await writeFile(
    ".arena/story-trim-report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
