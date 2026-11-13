// Regression for the Android trim/selection loading bug. Real media plus controlled
// pending-play simulation; no export implementation is mocked or changed.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { launchBrowser, ANDROID } from "./browser-setup.js";

const browser = await launchBrowser();
const context = await browser.newContext(ANDROID);
const page = await context.newPage();
const base = process.env.TEST_URL || "http://localhost:5173/AutoCut/";
const timeoutOnly = process.argv.includes("--timeout-only");
const report = [],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await mkdir("tests/fixtures", { recursive: true });
await mkdir(".arena", { recursive: true });
function record(name, evidence) {
  report.push({ name, ...evidence });
  console.log(name, JSON.stringify(evidence));
}
async function settled(time, channel) {
  await page.waitForFunction(
    (time) => {
      const v = document.querySelector("#story-video");
      return (
        document.querySelector("#story-preview-loading").hidden &&
        !v.seeking &&
        v.readyState >= 2 &&
        Math.abs(v.currentTime - time) < 0.05
      );
    },
    time,
    { timeout: 20000 },
  );
  const rgb = await page.evaluate(() => {
    const v = document.querySelector("#story-video"),
      c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
  });
  assert.ok(
    rgb[channel] > 220 &&
      rgb.filter((_, i) => i !== channel).every((value) => value < 20),
    JSON.stringify(rgb),
  );
  return rgb;
}
async function trim(start, end) {
  await page.locator("#story-in").fill(String(start));
  await page.locator("#story-out").fill(String(end));
  await page.locator("#story-apply").tap();
}
try {
  await page.goto(base);
  await page.waitForFunction(
    () =>
      !!navigator.serviceWorker.controller &&
      document.querySelector("#story-mode"),
  );
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
      const result = await ff.exec([
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=320x240:r=24:d=6,drawbox=color=lime:t=fill:enable='gte(t,2)*lt(t,4)',drawbox=color=blue:t=fill:enable='gte(t,4)'",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=6:sample_rate=44100",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-g",
        "144",
        "-bf",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        "1",
        "-c:a",
        "aac",
        "-shortest",
        "camera.mp4",
      ]);
      if (result) throw new Error(logs.join("\n"));
      return Array.from(await ff.readFile("camera.mp4"));
    } finally {
      ff.terminate();
    }
  });
  await writeFile("tests/fixtures/preview-camera.mp4", Buffer.from(bytes));
  await sharp({
    create: { width: 320, height: 180, channels: 3, background: "#ffffff" },
  })
    .png()
    .toFile("tests/fixtures/preview-image.png");
  await page.locator("#story-mode").tap();
  await page
    .locator("#story-input")
    .setInputFiles([
      "tests/fixtures/preview-camera.mp4",
      "tests/fixtures/preview-image.png",
    ]);
  await page.waitForFunction(
    () =>
      !document.querySelector("#story-import").disabled &&
      document.querySelector("#story-preview-loading").hidden,
  );

  // Selection and trim in one event turn: the second request reuses the same URL
  // while the first request is still waiting for loadedmetadata.
  const cold = await page.evaluate(() => {
    const v = document.querySelector("#story-video");
    document.querySelectorAll(".story-scene-select")[0].click();
    document.querySelector("#story-in").value = "2.25";
    document.querySelector("#story-out").value = "5.5";
    document.querySelector("#story-timing").requestSubmit();
    return {
      loading: !document.querySelector("#story-preview-loading").hidden,
      readyState: v.readyState,
      time: v.currentTime,
    };
  });
  record("Cold selection immediately followed by trim", cold);
  if (!timeoutOnly)
    assert.equal(
      cold.loading,
      true,
      "Must not report preview ready before metadata/seek/frame readiness",
    );
  const green = await settled(2.25, 1);
  record("Trim start displays a decoded green frame", {
    status: "PASS",
    rgb: green,
  });

  await trim(4.25, 5.75);
  await settled(4.25, 2);
  await trim(4.25, 5.5);
  await settled(4.25, 2); // End-only change / no-op source seek.
  await trim(4.25, 5.5);
  await settled(4.25, 2); // Apply same values: no new seeked event required.
  await trim(0, 1.5);
  await settled(0, 0);
  record("Start-only, end-only, unchanged trims and seek to zero", {
    status: "PASS",
  });

  // Multiple outstanding image/video seeks and trim submissions: only newest wins.
  await page.evaluate(() => {
    for (const start of [2.25, 0.5, 4.25]) {
      document.querySelectorAll(".story-scene-select")[1].click();
      document.querySelectorAll(".story-scene-select")[0].click();
      document.querySelector("#story-in").value = String(start);
      document.querySelector("#story-out").value = "5.5";
      document.querySelector("#story-timing").requestSubmit();
    }
  });
  await settled(4.25, 2);
  record("Rapid video/image selection and trim supersession", {
    status: "PASS",
    finalTime: 4.25,
  });

  // Reproduce a browser decoder/play request that never settles. Old seek() had
  // no watchdog around video.play(), so this outlived its metadata timeout.
  await page.clock.install();
  await page.evaluate(() => {
    const v = document.querySelector("#story-video");
    window.nativePreviewPlay = v.play;
    v.play = () =>
      new Promise((resolve) => {
        window.resolveStalledPreviewPlay = resolve;
      });
  });
  await page.locator("#story-play").tap();
  await page.waitForFunction(
    () => !document.querySelector("#story-preview-loading").hidden,
  );
  await page.clock.fastForward(16000);
  const stalled = await page.evaluate(() => ({
    loading: !document.querySelector("#story-preview-loading").hidden,
    message: document.querySelector("#story-message").textContent,
    label: document.querySelector("#story-play").getAttribute("aria-label"),
  }));
  record("After 16s of a pending play request following trims", stalled);
  {
    assert.equal(
      stalled.loading,
      false,
      "Pending native play must not leave Loading scene indefinitely",
    );
    assert.match(stalled.message, /timed out/i);
    assert.equal(stalled.label, "Play story");
  }
  await page.evaluate(() => {
    const v = document.querySelector("#story-video");
    v.play = window.nativePreviewPlay;
    window.resolveStalledPreviewPlay();
  });
  {
    // Timeout recovery must leave the real decoder and updated trim usable.
    await page.locator("#story-play").tap();
    await page.waitForFunction(
      () =>
        document.querySelector("#story-video").currentTime > 4.4 &&
        document.querySelector("#story-play").getAttribute("aria-label") ===
          "Pause story",
    );
    await page.locator("#story-play").tap();
    assert.equal(await page.locator("#story-preview-loading").isHidden(), true);
    record("Native playback recovers after timeout", { status: "PASS" });

    // A decoder can also stall on seek without play() ever being requested.
    await page.evaluate(() =>
      Object.defineProperty(document.querySelector("#story-video"), "seeking", {
        configurable: true,
        get: () => true,
      }),
    );
    await trim(2.25, 5.5);
    assert.equal(
      await page.locator("#story-preview-loading").isHidden(),
      false,
    );
    await page.clock.fastForward(16000);
    assert.equal(await page.locator("#story-preview-loading").isHidden(), true);
    assert.match(
      await page.locator("#story-message").textContent(),
      /timed out/i,
    );
    await page.evaluate(() => {
      delete document.querySelector("#story-video").seeking;
    });
    await trim(4.25, 5.5);
    await settled(4.25, 2);
    record("Trim-only stalled seek is bounded and a subsequent trim recovers", {
      status: "PASS",
    });

    // Cancel a pending play by selecting an image; a late result must not change it.
    await page.evaluate(() => {
      document.querySelector("#story-video").play = () =>
        new Promise((resolve) => {
          window.resolveOldPlay = resolve;
        });
    });
    await page.locator("#story-play").tap();
    await page.waitForFunction(
      () => !document.querySelector("#story-preview-loading").hidden,
    );
    await page.locator(".story-scene-select").nth(1).tap();
    await page.waitForFunction(
      () =>
        document.querySelector("#story-preview-loading").hidden &&
        !document.querySelector("#story-image").hidden,
    );
    await page.evaluate(() => {
      window.resolveOldPlay();
      document.querySelector("#story-video").play = window.nativePreviewPlay;
    });
    assert.match(
      await page.locator("#story-preview-label").textContent(),
      /Scene 2/,
    );
    assert.equal(
      await page.locator("#story-play").getAttribute("aria-label"),
      "Play story",
    );
    record("Pending play cancellation and late stale completion", {
      status: "PASS",
    });
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(".arena/preview-after.json", JSON.stringify(report, null, 2));
  await browser.close();
}
