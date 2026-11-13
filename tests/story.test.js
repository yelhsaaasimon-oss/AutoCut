// Actual Increment A acceptance checks. Run npm run serve first; all media stays local.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { launchBrowser, ANDROID } from "./browser-setup.js";

const base = process.env.TEST_URL || "http://localhost:5173/AutoCut/";
const browser = await launchBrowser();
const context = await browser.newContext(ANDROID);
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [],
  requests = [],
  badResponses = [],
  report = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (req) => {
  if (/^https?:/.test(req.url()))
    requests.push({ url: req.url(), method: req.method() });
});
page.on("response", (res) => {
  if (res.status() >= 400)
    badResponses.push({ url: res.url(), status: res.status() });
});
await mkdir("tests/fixtures", { recursive: true });
await mkdir(".arena", { recursive: true });
function pass(name, evidence) {
  report.push({ name, status: "PASS", evidence });
  console.log(`PASS: ${name} — ${evidence}`);
}
async function waitIdle() {
  await page.waitForFunction(
    () => !document.querySelector("#story-import").disabled,
    null,
    { timeout: 120000 },
  );
}
async function select(index) {
  await page.locator("#story-scenes .story-scene-select").nth(index).tap();
}
async function applyVideo(start, end) {
  await page.locator("#story-in").fill(String(start));
  await page.locator("#story-out").fill(String(end));
  await page.locator("#story-apply").tap();
}
async function applyImage(duration) {
  await page.locator("#story-duration").fill(String(duration));
  await page.locator("#story-apply").tap();
}
async function exportProject() {
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
  return Buffer.from(
    await page.evaluate(async () =>
      Array.from(
        new Uint8Array(
          await (
            await fetch(document.querySelector("#story-download").href)
          ).arrayBuffer(),
        ),
      ),
    ),
  );
}
try {
  const response = await page.goto(base);
  assert.equal(response.status(), 200);
  await page.waitForFunction(
    () =>
      !!navigator.serviceWorker.controller &&
      document.querySelector("#story-mode"),
  );
  await page.locator("#story-mode").tap();
  assert.equal(await page.locator("#story-editor").isVisible(), true);
  assert.equal(await page.locator("#quick-editor").isHidden(), true);
  assert.equal(await page.locator("#story-export").isDisabled(), true);
  pass(
    "Opt-in workspace, empty-state controls and project-relative load",
    "Quick edit remains default; Story mode starts empty with export disabled.",
  );

  const generated = await page.evaluate(async () => {
    const { FFmpeg } = await import("./vendor/ffmpeg/index.js");
    const ff = new FFmpeg();
    const logs = [];
    ff.on("log", ({ message }) => logs.push(message));
    try {
      await ff.load({
        coreURL: new URL("./vendor/core/ffmpeg-core.js", location.href).href,
        wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", location.href).href,
      });
      let code = await ff.exec([
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=320x240:r=24:d=3,drawbox=color=lime:t=fill:enable='gte(t,1)*lt(t,2)',drawbox=color=blue:t=fill:enable='gte(t,2)'",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=44100:duration=3",
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
        "-shortest",
        "audible.mp4",
      ]);
      if (code) throw new Error(logs.join("\n"));
      code = await ff.exec([
        "-f",
        "lavfi",
        "-i",
        "color=c=yellow:s=240x320:r=30:d=1",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "silent.mp4",
      ]);
      if (code) throw new Error(logs.join("\n"));
      return {
        audible: Array.from(await ff.readFile("audible.mp4")),
        silent: Array.from(await ff.readFile("silent.mp4")),
      };
    } finally {
      ff.terminate();
    }
  });
  await writeFile(
    "tests/fixtures/story-audible.mp4",
    Buffer.from(generated.audible),
  );
  await writeFile(
    "tests/fixtures/story-silent.mp4",
    Buffer.from(generated.silent),
  );
  await sharp({
    create: { width: 320, height: 180, channels: 3, background: "#cc00cc" },
  })
    .jpeg()
    .toFile("tests/fixtures/story-image.jpg");
  await sharp({
    create: { width: 180, height: 240, channels: 3, background: "#00ffff" },
  })
    .png()
    .toFile("tests/fixtures/story-map.png");
  const chooserEvent = page.waitForEvent("filechooser");
  await page.locator("#story-import").tap();
  await (
    await chooserEvent
  ).setFiles([
    "tests/fixtures/story-audible.mp4",
    "tests/fixtures/story-silent.mp4",
    "tests/fixtures/story-image.jpg",
    "tests/fixtures/story-map.png",
  ]);
  await waitIdle();
  assert.equal(await page.locator("#story-assets .story-asset").count(), 4);
  assert.equal(await page.locator("#story-scenes .story-scene").count(), 4);
  assert.equal(
    await page.locator("#story-timeline .story-timeline-scene").count(),
    4,
  );
  for (const thumb of await page
    .locator("#story-assets img")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        complete: node.complete,
        width: node.naturalWidth,
      })),
    ))
    assert.ok(thumb.complete && thumb.width === 160);
  assert.match(await page.locator("#story-total").textContent(), /10.00s/);
  pass(
    "Batch video, JPG and PNG import, assets and thumbnails",
    "Actual multi-file chooser imported 2 different-size/fps videos (one silent), a JPG and a PNG; four assets/scenes/thumbnails shown.",
  );

  await select(0);
  await applyVideo(1, 3);
  assert.match(await page.locator("#story-total").textContent(), /9.00s/);
  await applyVideo(3, 2);
  assert.match(await page.locator("#story-message").textContent(), /end must/i);
  assert.match(await page.locator("#story-total").textContent(), /9.00s/);
  await applyVideo(0, 99);
  assert.match(
    await page.locator("#story-message").textContent(),
    /cannot exceed/,
  );
  await applyVideo(1, 3);
  await select(2);
  await applyImage(1);
  await select(3);
  await applyImage(1);
  await applyImage(31);
  assert.match(await page.locator("#story-message").textContent(), /between/);
  await applyImage(1);
  assert.match(await page.locator("#story-total").textContent(), /5.00s/);
  pass(
    "Per-scene video trimming and image duration",
    "Video is trimmed from 1–3s; both images set to 1s. Invalid bounds leave durations unchanged; total is 5s.",
  );

  for (let i = 3; i > 0; i--)
    await page
      .locator("#story-scenes .story-scene")
      .nth(i)
      .getByRole("button", { name: `Move scene ${i + 1} earlier`, exact: true })
      .tap();
  assert.match(
    await page
      .locator("#story-scenes .story-scene-select")
      .first()
      .textContent(),
    /story-map.png/,
  );
  await page
    .locator("#story-scenes .story-scene")
    .first()
    .getByRole("button", { name: "Move scene 1 later", exact: true })
    .tap();
  await page
    .locator("#story-scenes .story-scene")
    .nth(1)
    .getByRole("button", { name: "Move scene 2 earlier", exact: true })
    .tap();
  assert.equal(
    await page
      .getByRole("button", { name: "Move scene 1 earlier", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Move scene 4 later", exact: true })
      .isDisabled(),
    true,
  );
  pass(
    "Select and move scenes in both directions",
    "IDs/order survive reordering; first/last boundary controls disabled. Final order: cyan PNG, trimmed video, silent video, purple JPG.",
  );

  await select(0);
  await page.locator("#story-play").tap();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#story-preview-label")
        .textContent.includes("Scene 2") &&
      document.querySelector("#story-video").currentTime > 1.1,
    null,
    { timeout: 20000 },
  );
  const frame = await page.evaluate(() => {
    const v = document.querySelector("#story-video"),
      c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const x = c.getContext("2d");
    x.drawImage(v, 0, 0, 1, 1);
    return Array.from(x.getImageData(0, 0, 1, 1).data);
  });
  assert.ok(
    frame[1] > 220 && frame[0] < 20 && frame[2] < 20,
    JSON.stringify(frame),
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector("#story-preview-label")
        .textContent.includes("Scene 4"),
    null,
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#story-clock").textContent.startsWith("5.00") &&
      document.querySelector("#story-play").getAttribute("aria-label") ===
        "Play story",
    null,
    { timeout: 10000 },
  );
  assert.equal(
    await page.locator("#story-play").getAttribute("aria-label"),
    "Play story",
  );
  await page.locator("#story-scrub").evaluate((node) => {
    node.value = "1.5";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#story-preview-label")
      .textContent.includes("Scene 2"),
  );
  await page.waitForFunction(
    () =>
      Math.abs(document.querySelector("#story-video").currentTime - 1.5) < 0.05,
  );
  assert.ok(
    parseFloat(
      await page.locator("#story-playhead").evaluate((node) => node.style.left),
    ) > 0,
  );
  pass(
    "Sequential playback, trims, image hold, seek and playhead",
    "Native playback crossed all four scenes, showed trimmed green content, stopped at 5s, and slider sought to the correct source time.",
  );

  const output = await exportProject();
  assert.equal(output.subarray(4, 8).toString(), "ftyp");
  await writeFile(".arena/story-result.mp4", output);
  const metrics = await page.evaluate(async (bytes) => {
    const { FFmpeg } = await import("./vendor/ffmpeg/index.js");
    const ff = new FFmpeg();
    const logs = [];
    ff.on("log", ({ message }) => logs.push(message));
    try {
      await ff.load({
        coreURL: new URL("./vendor/core/ffmpeg-core.js", location.href).href,
        wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", location.href).href,
      });
      await ff.writeFile("result.mp4", new Uint8Array(bytes));
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
      const metadata = JSON.parse(await ff.readFile("meta.json", "utf8"));
      const decode = await ff.exec([
        "-v",
        "error",
        "-i",
        "result.mp4",
        "-f",
        "null",
        "-",
      ]);
      if (decode) throw new Error(logs.join("\n"));
      const colors = [];
      for (const time of [0.5, 1.25, 2.5, 3.5, 4.5]) {
        const code = await ff.exec([
          "-ss",
          String(time),
          "-i",
          "result.mp4",
          "-frames:v",
          "1",
          "-vf",
          "crop=16:16:(iw-16)/2:(ih-16)/2",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          "-threads",
          "1",
          "-y",
          "frame.rgb",
        ]);
        if (code) throw new Error(logs.join("\n"));
        const data = await ff.readFile("frame.rgb");
        const rgb = [0, 0, 0];
        for (let i = 0; i < data.length; i += 3)
          for (let c = 0; c < 3; c++) rgb[c] += data[i + c] / 256;
        colors.push(rgb);
      }
      await ff.exec([
        "-i",
        "result.mp4",
        "-vn",
        "-f",
        "s16le",
        "-ar",
        "48000",
        "-ac",
        "1",
        "audio.pcm",
      ]);
      const audio = await ff.readFile("audio.pcm");
      const view = new DataView(
          audio.buffer,
          audio.byteOffset,
          audio.byteLength,
        ),
        rms = [];
      for (const time of [0.2, 0.8, 1.2, 2.5, 3.2, 4.4]) {
        let sum = 0;
        for (let n = 0; n < 4800; n++) {
          const v =
            view.getInt16((Math.floor(time * 48000) + n) * 2, true) / 32768;
          sum += v * v;
        }
        rms.push(Math.sqrt(sum / 4800));
      }
      return {
        metadata,
        colors,
        rms,
        decode,
        audioSamples: audio.byteLength / 2,
      };
    } finally {
      ff.terminate();
    }
  }, Array.from(output));
  await writeFile(
    ".arena/story-metrics.json",
    JSON.stringify(metrics, null, 2),
  );
  const v = metrics.metadata.streams.find(
      (stream) => stream.codec_type === "video",
    ),
    a = metrics.metadata.streams.find(
      (stream) => stream.codec_type === "audio",
    );
  assert.equal(v.codec_name, "h264");
  assert.equal(v.width, 960);
  assert.equal(v.height, 540);
  assert.equal(v.nb_frames, "120");
  assert.equal(v.avg_frame_rate, "24/1");
  assert.equal(a.codec_name, "aac");
  assert.ok(Math.abs(Number(metrics.metadata.format.duration) - 5) < 0.06);
  const [cyan, green, blue, yellow, purple] = metrics.colors;
  assert.ok(
    cyan[0] < 20 && cyan[1] > 220 && cyan[2] > 220,
    JSON.stringify(metrics.colors),
  );
  assert.ok(green[1] > 220 && green[0] < 20 && green[2] < 20);
  assert.ok(blue[2] > 220 && blue[0] < 20 && blue[1] < 20);
  assert.ok(yellow[0] > 220 && yellow[1] > 220 && yellow[2] < 20);
  assert.ok(purple[0] > 180 && purple[2] > 180 && purple[1] < 20);
  assert.ok(
    metrics.rms[0] < 0.002 &&
      metrics.rms[1] < 0.002 &&
      metrics.rms[4] < 0.002 &&
      metrics.rms[5] < 0.002,
    JSON.stringify(metrics.rms),
  );
  assert.ok(
    metrics.rms[2] > 0.03 && metrics.rms[3] > 0.03,
    JSON.stringify(metrics.rms),
  );
  pass(
    "Real mixed-scene MP4 export and hard-cut order",
    `${output.length} bytes; 960×540 H.264, 120 frames at 24fps, 5s; decoded centers confirm cyan→green→blue→yellow→purple; full-file decode passes.`,
  );
  pass(
    "Silent/audible scene alignment",
    "Decoded PCM is silent in images/silent video and audible within the trimmed video’s 1–3s timeline slot, including after a silent first scene.",
  );
  await page.locator("#story-result-video").evaluate(async (node) => {
    node.muted = true;
    await node.play();
  });
  await page.waitForFunction(
    () => document.querySelector("#story-result-video").currentTime > 0.2,
  );
  await page.locator("#story-result-video").evaluate((node) => node.pause());
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#story-download").tap();
  const download = await downloadEvent;
  await download.saveAs(".arena/story-downloaded.mp4");
  assert.equal(await download.failure(), null);
  assert.match(
    download.suggestedFilename(),
    /^autocut-story-5p00s-\d{8}-\d{6}-\d{3}\.mp4$/,
  );
  assert.equal(
    createHash("sha256")
      .update(await readFile(".arena/story-downloaded.mp4"))
      .digest("hex"),
    createHash("sha256").update(output).digest("hex"),
  );
  pass(
    "Exported native preview and saved download",
    "The MP4 plays in Chrome and completed download SHA-256 equals the export.",
  );

  await select(0);
  assert.equal(await page.locator("#story-result").isVisible(), true);
  await applyImage(1.25);
  assert.equal(await page.locator("#story-result").isHidden(), true);
  assert.equal(
    await page.locator("#story-download").getAttribute("href"),
    null,
  );
  await applyImage(1);
  await page.locator("#story-export").tap();
  await page.waitForFunction(
    () => !document.querySelector("#story-progress-region").hidden,
  );
  assert.equal(await page.locator("#quick-mode").isDisabled(), true);
  assert.equal(await page.locator("#story-input").isDisabled(), true);
  await page.locator("#story-cancel").tap();
  await waitIdle();
  assert.match(await page.locator("#story-message").textContent(), /cancelled/);
  assert.equal(await page.locator("#story-result").isHidden(), true);
  await exportProject();
  pass(
    "Invalidation, exclusive processing, cancellation and retry",
    "Timing edits revoke stale output; mode/input locked during export; cancellation preserves scenes; subsequent export succeeds.",
  );

  await page.getByRole("button", { name: "Remove scene 4", exact: true }).tap();
  assert.equal(await page.locator("#story-scenes .story-scene").count(), 3);
  assert.equal(await page.locator("#story-assets .story-asset").count(), 4);
  const jpgAsset = page
    .locator("#story-assets .story-asset")
    .filter({ hasText: "story-image.jpg" });
  await jpgAsset.getByRole("button", { name: /^Add (another )?scene$/ }).tap();
  await select(3);
  await applyImage(1);
  const mapAsset = page
    .locator("#story-assets .story-asset")
    .filter({ hasText: "story-map.png" });
  await mapAsset.getByRole("button", { name: /^Add (another )?scene$/ }).tap();
  await select(4);
  await applyImage(1);
  await page.getByRole("button", { name: "Remove scene 5", exact: true }).tap();
  pass(
    "Scene removal and asset reuse",
    "Removing a scene preserves its library asset; adding the same asset creates a new independent scene; removal updates the timeline.",
  );

  for (const width of [320, 360, 390, 412, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `overflow at ${width}`,
    );
    await select(0);
    await page.locator("#story-timeline .story-timeline-scene").nth(1).tap();
    assert.match(
      await page.locator("#story-selection").textContent(),
      /Scene 2/,
    );
    await page.screenshot({
      path: `.arena/story-${width}.png`,
      fullPage: true,
    });
  }
  pass(
    "Android-sized timeline and editing controls",
    "320/360/390/412/768/1440px: no page overflow; timeline scrolls independently; touch scene selection works.",
  );

  await page.locator("#story-input").setInputFiles([
    { name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("bad") },
    { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) },
    {
      name: "broken.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("broken"),
    },
  ]);
  await waitIdle();
  assert.match(
    await page.locator("#story-message").textContent(),
    /No files imported/,
  );
  assert.equal(await page.locator("#story-assets .story-asset").count(), 4);
  assert.equal(await page.locator("#story-export").isEnabled(), true);
  await page
    .locator("#story-input")
    .setInputFiles("tests/fixtures/story-map.png");
  await waitIdle();
  assert.equal(await page.locator("#story-assets .story-asset").count(), 5);
  await page.getByRole("button", { name: "Remove scene 5", exact: true }).tap();
  await page
    .locator("#story-assets .story-asset")
    .last()
    .getByRole("button", { name: "Remove asset", exact: true })
    .tap();
  assert.equal(await page.locator("#story-assets .story-asset").count(), 4);
  for (let i = 0; i < 8; i++)
    await mapAsset
      .getByRole("button", { name: /^Add (another )?scene$/ })
      .tap();
  assert.equal(await page.locator("#story-scenes .story-scene").count(), 12);
  await mapAsset.getByRole("button", { name: /^Add (another )?scene$/ }).tap();
  assert.match(
    await page.locator("#story-message").textContent(),
    /at most 12/,
  );
  assert.equal(await page.locator("#story-scenes .story-scene").count(), 12);
  for (let i = 12; i > 4; i--)
    await page
      .getByRole("button", { name: `Remove scene ${i}`, exact: true })
      .tap();
  pass(
    "Invalid media, limits and import recovery",
    "Empty, unsupported and corrupt files rejected without orphan scenes; later import works; unused assets removed; 12-scene limit enforced without mutation.",
  );

  await page.locator("#quick-mode").tap();
  assert.equal(await page.locator("#quick-editor").isVisible(), true);
  await page
    .locator("#video-input")
    .setInputFiles("tests/fixtures/story-silent.mp4");
  await page.locator("#instructions").fill("Mute the audio");
  await page.locator("#process-button").tap();
  assert.equal(await page.locator("#story-mode").isDisabled(), true);
  await page.waitForFunction(
    () => document.querySelector("#progress-region").hidden,
    null,
    { timeout: 120000 },
  );
  assert.equal(
    await page.locator("#download-button").getAttribute("aria-disabled"),
    "false",
  );
  await page.locator("#story-mode").tap();
  assert.equal(await page.locator("#story-scenes .story-scene").count(), 4);
  await page.waitForFunction(
    async () =>
      !!(await caches.match(
        new URL("./vendor/core/ffmpeg-core.wasm", location.href),
      )),
  );
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector("#story-mode"));
  await page.locator("#story-mode").tap();
  const assetCache = await page.evaluate(async () =>
    Promise.all(
      [
        "story.js",
        "story-model.js",
        "story-media.js",
        "story-export.js",
        "story.css",
      ].map(
        async (path) => !!(await caches.match(new URL(path, location.href))),
      ),
    ),
  );
  assert.ok(assetCache.every(Boolean));
  await page
    .locator("#story-input")
    .setInputFiles([
      "tests/fixtures/story-silent.mp4",
      "tests/fixtures/story-map.png",
    ]);
  await waitIdle();
  await select(1);
  await applyImage(0.5);
  const offline = await exportProject();
  assert.ok(offline.length > 1000);
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  assert.deepEqual(badResponses, []);
  assert.ok(
    requests.every(
      (req) =>
        req.method === "GET" &&
        new URL(req.url).origin === new URL(base).origin,
    ),
  );
  pass(
    "Stage 1 mode switching, PWA offline export and privacy",
    "Story survives workspace switching; all new modules cached under /AutoCut/; cold offline reload accepts local assets and exports a real mixed MP4; no external requests or uploads.",
  );
  for (let i = 2; i > 0; i--)
    await page
      .getByRole("button", { name: `Remove scene ${i}`, exact: true })
      .tap();
  assert.equal(await page.locator("#story-export").isDisabled(), true);
  assert.equal(await page.locator("#story-play").isDisabled(), true);
  assert.equal(await page.locator("#story-preview-empty").isVisible(), true);
  while (await page.locator("#story-assets .story-asset").count())
    await page
      .locator("#story-assets .story-asset")
      .first()
      .getByRole("button", { name: "Remove asset", exact: true })
      .tap();
  assert.match(
    await page.locator("#story-asset-count").textContent(),
    /0 \/ 8/,
  );
  await page
    .locator("#story-input")
    .setInputFiles("tests/fixtures/story-map.png");
  await waitIdle();
  await select(0);
  await applyImage(0.25);
  const minimal = await exportProject();
  assert.ok(minimal.byteLength > 1000);
  pass(
    "Empty-project recovery and image-only minimum-duration export",
    "Removing every scene/assets restores disabled empty state; a new image-only 0.25s project imports and exports successfully.",
  );

  const betweenScenes = await page.evaluate(async (bytes) => {
    const model = await import("./story-model.js");
    const { exportStory } = await import("./story-export.js");
    const p = model.createProject();
    const file = new File([new Uint8Array(bytes)], "source.mp4", {
      type: "video/mp4",
    });
    model.importAsset(p, { kind: "video", size: file.size, duration: 3, file });
    model.addScene(p, p.assets[0].id);
    const control = new AbortController();
    let engine,
      completed = 0;
    try {
      await exportStory(p, {
        signal: control.signal,
        onEngine: (value) => (engine = value),
        onStatus: (status) => {
          if (status.completed === 1) {
            completed = 1;
            control.abort();
          }
        },
      });
      return { cancelled: false };
    } catch (error) {
      return {
        cancelled: error.name === "AbortError",
        completed,
        engineReleased: !engine.loaded,
      };
    }
  }, generated.audible);
  assert.equal(betweenScenes.cancelled, true);
  assert.equal(betweenScenes.completed, 1);
  assert.equal(betweenScenes.engineReleased, true);
  pass(
    "Cancellation between completed scene renders",
    "Real first scene renders, abort stops before scene two, promise rejects as AbortError and WASM worker is terminated.",
  );
  console.log(`ALL ${report.length} STORY ACCEPTANCE GROUPS PASSED`);
} catch (error) {
  report.push({
    name: "Interrupted acceptance test",
    status: "FAIL",
    evidence: error.stack,
  });
  await page
    .screenshot({ path: ".arena/story-failure.png", fullPage: true })
    .catch(() => {});
  console.error(await page.locator("#story-message").textContent());
  throw error;
} finally {
  await context.setOffline(false).catch(() => {});
  await writeFile(
    ".arena/story-test-report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
