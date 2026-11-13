import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { launchBrowser, ANDROID } from "./browser-setup.js";
import { inspectMedia, outputBytes } from "./media-tools.js";
const base = process.env.TEST_URL || "http://localhost:5173/AutoCut/";
const browser = await launchBrowser(),
  context = await browser.newContext(ANDROID),
  page = await context.newPage();
page.setDefaultTimeout(20000);
const deadline = setTimeout(() => {
  console.error("Stabilization browser test exceeded its overall deadline");
  process.exitCode = 1;
  browser.close();
}, 180000);
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
async function quickExport() {
  await page.locator("#process-button").tap();
  await page.waitForFunction(
    () => document.querySelector("#progress-region").hidden,
    null,
    { timeout: 180000 },
  );
  assert.equal(
    await page.locator("#download-button").getAttribute("aria-disabled"),
    "false",
    await page.locator("#instruction-errors").textContent(),
  );
  return outputBytes(page, "#download-button");
}
async function storyExport() {
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
  return outputBytes(page, "#story-download");
}
async function storyIdle() {
  await page.waitForFunction(
    () =>
      !document.querySelector("#story-import").disabled &&
      document.querySelector("#story-preview-loading").hidden,
  );
}
async function storageIdle(workspace) {
  await page.waitForFunction(
    (workspace) => !document.querySelector(`#${workspace}-load`).disabled,
    workspace,
  );
}
async function selectScene(index) {
  await page.locator(".story-scene-select").nth(index).tap();
}
async function setTiming(start, end) {
  await page.locator("#story-in").fill(String(start));
  await page.locator("#story-out").fill(String(end));
  await page.locator("#story-apply").tap();
}
try {
  await page.goto(base);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const generated = await page.evaluate(async () => {
    const { FFmpeg } = await import("./vendor/ffmpeg/index.js");
    const ff = new FFmpeg(),
      logs = [];
    ff.on("log", ({ message }) => logs.push(message));
    try {
      await ff.load({
        coreURL: new URL("./vendor/core/ffmpeg-core.js", location.href).href,
        wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", location.href).href,
      });
      if (
        await ff.exec([
          "-f",
          "lavfi",
          "-i",
          "color=c=lime:s=320x240:r=24:d=4",
          "-itsoffset",
          "1",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=3:sample_rate=48000",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          "-threads",
          "1",
          "-c:a",
          "aac",
          "delayed.mp4",
        ])
      )
        throw new Error(logs.join("\n"));
      const delayed = Array.from(await ff.readFile("delayed.mp4"));
      if (
        await ff.exec([
          "-f",
          "lavfi",
          "-i",
          "color=c=blue:s=240x320:r=30:d=3",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          "-threads",
          "1",
          "silent.mp4",
        ])
      )
        throw new Error(logs.join("\n"));
      return { delayed, silent: Array.from(await ff.readFile("silent.mp4")) };
    } finally {
      ff.terminate();
    }
  });
  await writeFile(
    "tests/fixtures/audit-shot10.mp4",
    Buffer.from(generated.delayed),
  );
  await writeFile(
    "tests/fixtures/audit-shot1.mp4",
    Buffer.from(generated.silent),
  );
  await sharp({
    create: { width: 320, height: 180, channels: 3, background: "#ff00ff" },
  })
    .jpeg()
    .toFile("tests/fixtures/audit-shot2.jpg");
  await page
    .locator("#video-input")
    .setInputFiles("tests/fixtures/audit-shot10.mp4");
  await page.waitForFunction(
    () => document.querySelector("#preview-video").readyState >= 2,
  );
  const source = await inspectMedia(page, Buffer.from(generated.delayed), {
    audioTimes: [0.3, 1.5],
  });
  assert.ok(
    source.audio[0].rms < 0.002 && source.audio[1].rms > 0.04,
    JSON.stringify(source.audio),
  );
  const untrimmed = await quickExport();
  const diagnostic = JSON.parse(
    await page.locator("#export-diagnostics-text").textContent(),
  );
  assert.equal(diagnostic.build, "1.2.0-rc.2");
  assert.equal(diagnostic.status, "Verified and ready");
  assert.equal(diagnostic.expectedDuration, 4);
  assert.equal(diagnostic.tracks[0].codec_name, "h264");
  assert.ok(
    !(await page.locator("#export-diagnostics-text").textContent()).includes(
      "audit-shot10",
    ),
  );
  const quick = await inspectMedia(page, untrimmed, {
    audioTimes: [0.3, 1.5],
    frameTimes: [0.2, 3.5],
  });
  assert.equal(quick.decode, 0);
  assert.ok(Math.abs(Number(quick.metadata.format.duration) - 4) < 0.15);
  assert.ok(
    quick.audio[0].rms < 0.002 && quick.audio[1].rms > 0.04,
    JSON.stringify(quick.audio),
  );
  await page.locator("#preview-video").evaluate((v) => v.play());
  await page.waitForFunction(
    () => document.querySelector("#preview-video").currentTime > 0.1,
  );
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#download-button").tap();
  const download = await downloadEvent,
    chunks = [];
  for await (const chunk of await download.createReadStream())
    chunks.push(chunk);
  assert.equal(
    createHash("sha256").update(Buffer.concat(chunks)).digest("hex"),
    createHash("sha256").update(untrimmed).digest("hex"),
  );
  await writeFile(".arena/audit-quick-untrimmed.mp4", untrimmed);
  pass(
    "Quick untrimmed export preserves source A/V delay, decodes, plays and downloads intact",
    {
      duration: quick.metadata.format.duration,
      bytes: untrimmed.length,
      audio: quick.audio,
    },
  );
  await page
    .locator("#instructions")
    .fill(
      "trim the first 1 seconds, remove the last 1 seconds, make the video horizontal (16:9), speed 0.5x",
    );
  const horizontal = await quickExport(),
    wide = await inspectMedia(page, horizontal, { audioTimes: [0.3, 3.2] });
  const wideVideo = wide.metadata.streams.find((s) => s.codec_type === "video");
  assert.equal(wide.decode, 0);
  assert.equal(wideVideo.width, 320);
  assert.equal(wideVideo.height, 180);
  assert.ok(Math.abs(Number(wide.metadata.format.duration) - 4) < 0.15);
  assert.ok(wide.audio.every((s) => s.rms > 0.04));
  pass(
    "Quick trim + horizontal prompt + half-speed export remain synchronized",
    {
      width: wideVideo.width,
      height: wideVideo.height,
      duration: wide.metadata.format.duration,
      audio: wide.audio,
    },
  );

  await page.locator("#instructions").fill("trim the first 1 seconds");
  await page.locator("#export-format").selectOption("mp3");
  await page.locator("#quick-save").tap();
  await storageIdle("quick");
  assert.match(
    await page.locator("#quick-project-status").textContent(),
    /^Saved/,
  );
  await page.reload();
  await page.locator("#quick-load").tap();
  await storageIdle("quick");
  assert.match(
    await page.locator("#quick-project-status").textContent(),
    /^Restored/,
  );
  assert.equal(
    await page.locator("#instructions").inputValue(),
    "trim the first 1 seconds",
  );
  assert.equal(await page.locator("#export-format").inputValue(), "mp3");
  assert.match(await page.locator("#format-detail").textContent(), /MP3/);
  const restoredAudio = await quickExport(),
    mp3 = await inspectMedia(page, restoredAudio, { audioTimes: [0.3, 2.4] });
  assert.equal(mp3.decode, 0);
  assert.equal(mp3.metadata.streams[0].codec_name, "mp3");
  assert.ok(Math.abs(Number(mp3.metadata.format.duration) - 3) < 0.15);
  pass(
    "Quick project persists media/instructions/format through cold reload; restored MP3 exports",
    { duration: mp3.metadata.format.duration, bytes: restoredAudio.length },
  );

  // Withhold one worker EXEC reply: cancellation must unlock both editing and retry.
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    window.auditPost = post;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message.type === "EXEC") return;
      return post.call(this, message, ...rest);
    };
  });
  await page.locator("#process-button").tap();
  await page.waitForFunction(() =>
    document.querySelector("#progress-status").textContent.includes("Applying"),
  );
  await page.locator("#cancel-button").tap();
  assert.equal(await page.locator("#process-button").isEnabled(), true);
  await page.evaluate(() => {
    Worker.prototype.postMessage = window.auditPost;
  });
  const retry = await quickExport();
  assert.ok(retry.length > 1000);
  pass(
    "Cancellation of a non-answering encoding worker releases controls and retry succeeds",
    { bytes: retry.length },
  );

  await page.locator("#story-mode").tap();
  await page
    .locator("#story-input")
    .setInputFiles([
      "tests/fixtures/audit-shot10.mp4",
      "tests/fixtures/audit-shot2.jpg",
      "tests/fixtures/audit-shot1.mp4",
    ]);
  await storyIdle();
  await selectScene(0);
  await setTiming(2, 3);
  await selectScene(1);
  await page.locator("#story-duration").fill("0.5");
  await page.locator("#story-apply").tap();
  await selectScene(2);
  await setTiming(0, 0.5);
  await page.locator("#story-arrange").tap();
  await storyIdle();
  const labels = await page
    .locator(".story-scene-select strong")
    .allTextContents();
  assert.ok(
    labels[0].includes("shot1.mp4") &&
      labels[1].includes("shot2.jpg") &&
      labels[2].includes("shot10.mp4"),
    JSON.stringify(labels),
  );
  await page.locator("#story-format").selectOption("9:16");
  await storyIdle();
  assert.match(
    await page.locator("#story-total").textContent(),
    /3 SCENES · 2.00s/,
  );
  const portrait = await storyExport(),
    vertical = await inspectMedia(page, portrait, {
      frameTimes: [0.2, 0.7, 1.2],
      audioTimes: [0.2, 0.7, 1.4],
    });
  const storyDiagnostic = JSON.parse(
    await page.locator("#export-diagnostics-text").textContent(),
  );
  assert.equal(storyDiagnostic.workspace, "Story");
  assert.equal(storyDiagnostic.tracks[0].height, 960);
  const video = vertical.metadata.streams.find((s) => s.codec_type === "video");
  assert.equal(video.width, 540);
  assert.equal(video.height, 960);
  assert.equal(Number(video.nb_frames), 48);
  assert.equal(vertical.decode, 0);
  assert.equal(Number(vertical.metadata.format.duration), 2);
  assert.ok(vertical.colors[0].rgb[2] > 230);
  assert.ok(vertical.colors[1].rgb[0] > 230 && vertical.colors[1].rgb[2] > 230);
  assert.ok(vertical.colors[2].rgb[1] > 230);
  assert.ok(
    vertical.audio[0].rms < 0.002 &&
      vertical.audio[1].rms < 0.002 &&
      vertical.audio[2].rms > 0.04,
  );
  await writeFile(".arena/audit-story-vertical.mp4", portrait);
  pass(
    "Natural scene arrangement and 9:16 mixed-media export preserve cuts, silence and tone",
    {
      width: video.width,
      height: video.height,
      frames: video.nb_frames,
      duration: vertical.metadata.format.duration,
      colors: vertical.colors,
      audio: vertical.audio,
      bytes: portrait.length,
    },
  );

  await page.locator("#story-save").tap();
  await storageIdle("story");
  assert.match(
    await page.locator("#story-project-status").textContent(),
    /^Saved/,
  );
  // Quota/write error must leave the previous committed snapshot intact.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.auditPut = put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    };
  });
  await page.locator("#story-save").tap();
  await storageIdle("story");
  assert.match(
    await page.locator("#story-project-status").textContent(),
    /quota/i,
  );
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.auditPut;
  });
  await context.setOffline(true);
  await page.reload();
  await page.locator("#story-mode").tap();
  await page.locator("#story-load").tap();
  await storageIdle("story");
  await storyIdle();
  assert.match(
    await page.locator("#story-project-status").textContent(),
    /^Restored/,
  );
  assert.equal(await page.locator("#story-format").inputValue(), "9:16");
  assert.match(
    await page.locator("#story-total").textContent(),
    /3 SCENES · 2.00s/,
  );
  const offline = await storyExport(),
    offlineMeta = await inspectMedia(page, offline, { audioTimes: [0.2, 1.4] });
  assert.equal(offlineMeta.decode, 0);
  assert.equal(Number(offlineMeta.metadata.format.duration), 2);
  assert.ok(
    offlineMeta.audio[0].rms < 0.002 && offlineMeta.audio[1].rms > 0.04,
  );
  await page
    .locator("#story-assets")
    .getByRole("button", { name: "Add another scene", exact: true })
    .first()
    .tap();
  await storyIdle();
  const ids = await page
    .locator(".story-scene")
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.sceneId));
  assert.equal(new Set(ids).size, 4);
  await page.getByRole("button", { name: "Remove scene 4", exact: true }).tap();
  pass(
    "Story media/ranges/order/format survive cold offline restore and export; quota failure preserves snapshot",
    {
      duration: offlineMeta.metadata.format.duration,
      bytes: offline.length,
      uniqueSceneIds: ids.length,
    },
  );

  // Cancel a pending image decode; accepted scenes and later imports must survive.
  await page.evaluate(() => {
    const ImageClass = window.Image;
    window.auditImage = ImageClass;
    window.Image = function () {
      const image = new ImageClass();
      Object.defineProperty(image, "src", {
        configurable: true,
        set() {},
        get() {
          return "";
        },
      });
      return image;
    };
  });
  await page
    .locator("#story-input")
    .setInputFiles("tests/fixtures/audit-shot2.jpg");
  await page.waitForFunction(
    () => !document.querySelector("#story-import-cancel").hidden,
  );
  await page.locator("#story-import-cancel").tap();
  await storyIdle();
  assert.equal(await page.locator(".story-scene-select").count(), 3);
  assert.match(
    await page.locator("#story-message").textContent(),
    /cancelled/i,
  );
  await page.evaluate(() => {
    window.Image = window.auditImage;
  });
  await page
    .locator("#story-input")
    .setInputFiles("tests/fixtures/audit-shot2.jpg");
  await storyIdle();
  assert.equal(await page.locator(".story-scene-select").count(), 4);
  pass(
    "Cancelling an unresponsive import preserves scenes and subsequent import succeeds",
    { scenes: 4 },
  );

  // Cancel after one restored source was prepared, without replacing live work.
  await page.evaluate(() => {
    const NativeImage = window.Image;
    window.auditRestoreImage = NativeImage;
    window.auditRestorePending = false;
    window.Image = function () {
      window.auditRestorePending = true;
      const image = new NativeImage();
      Object.defineProperty(image, "src", {
        configurable: true,
        set() {},
        get() {
          return "";
        },
      });
      return image;
    };
  });
  await page.locator("#story-load").tap();
  await page.waitForFunction(() => window.auditRestorePending);
  await page.locator("#story-import-cancel").tap();
  await storageIdle("story");
  await storyIdle();
  assert.match(
    await page.locator("#story-project-status").textContent(),
    /Restore cancelled/,
  );
  assert.equal(await page.locator(".story-scene-select").count(), 4);
  await page.evaluate(() => {
    window.Image = window.auditRestoreImage;
  });
  // Corrupt saved ranges fail only after assets have been decoded; commit stays atomic.
  await page.evaluate(async () => {
    const { projectStore } = await import("./project-store.js");
    window.auditGoodSnapshot = await projectStore("load", "story");
    const bad = structuredClone(window.auditGoodSnapshot);
    bad.scenes[0].outFrame = 99999;
    await projectStore("save", "story", bad);
  });
  await page.locator("#story-load").tap();
  await storageIdle("story");
  await storyIdle();
  assert.match(
    await page.locator("#story-project-status").textContent(),
    /Invalid saved scene timing/,
  );
  assert.equal(await page.locator(".story-scene-select").count(), 4);
  await page.evaluate(async () => {
    const { projectStore } = await import("./project-store.js");
    await projectStore("save", "story", window.auditGoodSnapshot);
  });
  pass(
    "Cancelled and corrupted Story restores do not replace the live project",
    { scenes: 4 },
  );

  await page.locator("#story-forget").tap();
  await storageIdle("story");
  await page.locator("#story-load").tap();
  await storageIdle("story");
  assert.match(
    await page.locator("#story-project-status").textContent(),
    /No Story project/,
  );
  assert.equal(await page.locator(".story-scene-select").count(), 4);
  await page.locator("#quick-mode").tap();
  await page.locator("#quick-load").tap();
  await storageIdle("quick");
  assert.match(
    await page.locator("#quick-project-status").textContent(),
    /^Restored/,
  );
  const offlineQuick = await quickExport(),
    offlineQuickMeta = await inspectMedia(page, offlineQuick);
  assert.equal(offlineQuickMeta.decode, 0);
  assert.equal(offlineQuickMeta.metadata.streams[0].codec_name, "mp3");
  await page.locator("#quick-forget").tap();
  await storageIdle("quick");
  pass(
    "Forget removes only the saved slot; missing restore is non-destructive; Quick restores/exports offline too",
    { quickBytes: offlineQuick.length },
  );

  await context.setOffline(false);
  for (const width of [320, 360, 390, 412, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const mode of ["quick", "story"]) {
      await page.locator(`#${mode}-mode`).tap();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `${mode} at ${width}`,
      );
      if (width === 390)
        await page.screenshot({
          path: `.arena/audit-${mode}-mobile.png`,
          fullPage: true,
        });
    }
  }
  pass(
    "All added project/format/arrangement controls fit six touch viewport widths",
    { widths: [320, 360, 390, 412, 768, 1440] },
  );
  // Migrate an existing .3 engine cache through an actual SW reinstallation.
  await page.evaluate(async () => {
    const wasm = new URL("./vendor/core/ffmpeg-core.wasm", location.href).href,
      scope = new URL("./", location.href).pathname;
    const response = await caches.match(wasm);
    if (!response) throw new Error("Expected warmed WASM cache");
    await (
      await caches.open(`autocut-v1.1.0-increment-a.3-${scope}`)
    ).put(wasm, response);
    for (const key of await caches.keys())
      if (key.startsWith("autocut-engine-") && key.endsWith(`-${scope}`))
        await caches.delete(key);
    await (await navigator.serviceWorker.getRegistration()).unregister();
  });
  await page.reload();
  await page.waitForFunction(async () => {
    const scope = new URL("./", location.href).pathname;
    return (
      !!navigator.serviceWorker.controller &&
      !!(await (
        await caches.open(`autocut-engine-0.12.10-${scope}`)
      ).match(new URL("./vendor/core/ffmpeg-core.wasm", location.href)))
    );
  });
  // Unregister/re-register is a test-only lifecycle. A fresh controlled
  // navigation is required before module workers can operate offline again.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  const migrated = await inspectMedia(page, Buffer.from(generated.silent));
  assert.equal(migrated.decode, 0);
  await context.setOffline(false);
  pass(
    "Existing .3 WASM cache survives an actual service-worker reinstall and decodes offline",
    { duration: migrated.metadata.format.duration },
  );
  for (const path of [
    ".git/config",
    ".arena/audit-quick-untrimmed.mp4",
    "node_modules/@sparticuz/chromium/package.json",
  ]) {
    assert.equal(
      (await context.request.get(new URL(path, base).href)).status(),
      403,
      path,
    );
  }
  pass(
    "Optional static server refuses Git metadata and ignored local artifacts",
    { denied: [".git", ".arena", "node_modules"] },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
} finally {
  clearTimeout(deadline);
  await writeFile(
    ".arena/stabilization-browser-report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
