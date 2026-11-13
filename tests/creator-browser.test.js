import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { launchBrowser, ANDROID } from "./browser-setup.js";
import { inspectMedia, outputBytes } from "./media-tools.js";
const base = process.env.TEST_URL || "http://localhost:5173/AutoCut/";
await mkdir(".arena", { recursive: true });
const browser = await launchBrowser(),
  context = await browser.newContext(ANDROID),
  page = await context.newPage();
page.setDefaultTimeout(20000);
const report = [],
  errors = [],
  external = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (
    /^https?:/.test(r.url()) &&
    new URL(r.url()).origin !== new URL(base).origin
  )
    external.push(r.url());
});
const deadline = setTimeout(() => {
  console.error("Creator suite exceeded 180s");
  process.exitCode = 1;
  browser.close();
}, 180000);
const pass = (name, evidence = {}) => {
  report.push({ name, status: "PASS", evidence });
  console.log("PASS:", name, JSON.stringify(evidence));
};
const wav = Buffer.alloc(44 + 48000 * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(48000, 24);
wav.writeUInt32LE(96000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 48000; i++)
  wav.writeInt16LE(
    Math.round(4000 * Math.sin((i * 2 * Math.PI * 440) / 48000)),
    44 + i * 2,
  );
try {
  await page.goto(base);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.locator("#story-mode").tap();
  await page
    .locator("#creator-prompt")
    .fill(
      "Create a 4-second vertical video with 2 scenes, animated captions, zoom and background music",
    );
  await page
    .locator("#creator-notes")
    .fill("blue opening: my verified fact\nred closing: my conclusion");
  await page.locator("#creator-generate").tap();
  assert.equal(await page.locator("#creator-scenes fieldset").count(), 2);
  await page.locator("#creator-ack").check();
  assert.equal(await page.locator("#creator-apply").isDisabled(), true);
  assert.match(
    await page.locator("#creator-summary").textContent(),
    /assign an uploaded/,
  );
  assert.equal(await page.locator(".story-scene").count(), 0);
  pass(
    "Plan without footage retains explicit missing assignments and cannot invent/apply scenes",
  );
  const images = [];
  for (const [name, color] of [
    ["red-map.png", "red"],
    ["blue-map.png", "blue"],
  ])
    images.push({
      name,
      mimeType: "image/png",
      buffer: await sharp({
        create: { width: 320, height: 240, channels: 3, background: color },
      })
        .png()
        .toBuffer(),
    });
  await page.locator("#story-input").setInputFiles(images);
  await page.waitForFunction(
    () => !document.querySelector("#story-input").disabled,
  );
  assert.equal(await page.locator(".story-scene").count(), 2);
  assert.match(
    await page.locator("#story-export-summary").textContent(),
    /6.00s/,
  );
  await page
    .getByText("Organize supplied audio (planning references only)", {
      exact: true,
    })
    .tap();
  await page.locator("#creator-audio-import").setInputFiles({
    name: "my-recording.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await page.waitForFunction(
    () => !document.querySelector("#story-input").disabled,
  );
  assert.equal(await page.locator("#creator-audio-list audio").count(), 1);
  await page.locator("#creator-audio-list select").selectOption("music");
  await page
    .getByLabel("Suggested placement (seconds; planning only)", { exact: true })
    .fill("1.5");
  await page
    .getByLabel("Suggested placement (seconds; planning only)", { exact: true })
    .press("Tab");
  await page.locator("#story-play").tap();
  await page.waitForFunction(
    () =>
      document.querySelector("#story-play").getAttribute("aria-label") ===
      "Pause story",
  );
  await page.locator("#creator-audio-list audio").evaluate((a) => a.play());
  assert.equal(
    await page.locator("#story-play").getAttribute("aria-label"),
    "Play story",
  );
  await page.waitForFunction(
    () => document.querySelector("#creator-audio-list audio").currentTime > 0.1,
  );
  await page.locator("#creator-audio-list audio").evaluate((a) => a.pause());
  pass(
    "Real local recorded audio imports, auditions and organizes role/placement as planning references",
  );
  await page.locator("#creator-audio-import").setInputFiles({
    name: "broken.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("deliberate invalid audio"),
  });
  await page.waitForFunction(
    () => !document.querySelector("#story-input").disabled,
  );
  assert.equal(await page.locator("#creator-audio-list audio").count(), 1);
  await page.evaluate(() => {
    window.audioSrcDescriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "src",
    );
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      ...window.audioSrcDescriptor,
      set(value) {
        if (this.tagName === "AUDIO" && this.preload === "metadata") {
          window.audioImportStalled = true;
          return;
        }
        window.audioSrcDescriptor.set.call(this, value);
      },
    });
  });
  await page
    .locator("#creator-audio-import")
    .setInputFiles({ name: "pending.wav", mimeType: "audio/wav", buffer: wav });
  await page.waitForFunction(() => window.audioImportStalled === true);
  assert.equal(await page.locator("#story-save").isDisabled(), true);
  await page.locator("#story-import-cancel").tap();
  await page.waitForFunction(
    () => !document.querySelector("#story-input").disabled,
  );
  await page.evaluate(() =>
    Object.defineProperty(
      HTMLMediaElement.prototype,
      "src",
      window.audioSrcDescriptor,
    ),
  );
  assert.equal(await page.locator("#creator-audio-list audio").count(), 1);
  assert.match(
    await page.locator("#creator-status").textContent(),
    /cancelled/,
  );
  assert.equal(await page.locator(".story-scene").count(), 2);
  pass(
    "Corrupt audio and a deliberately stalled/cancelled import preserve accepted references and Story scenes",
  );

  await page.locator("#creator-generate").tap();
  const originalPrompt = await page.locator("#creator-prompt").inputValue();
  await page
    .locator("#creator-prompt")
    .fill("Create a 5-second vertical video with 2 scenes");
  await page.locator("#creator-ack").check();
  assert.equal(await page.locator("#creator-apply").isDisabled(), true);
  assert.match(
    await page.locator("#creator-summary").textContent(),
    /notes changed/,
  );
  await page.locator("#creator-prompt").fill(originalPrompt);
  const rows = page.locator("#creator-scenes fieldset");
  assert.match(
    await rows.nth(0).locator("select option:checked").textContent(),
    /blue-map/,
  );
  assert.match(
    await rows.nth(1).locator("select option:checked").textContent(),
    /red-map/,
  );
  assert.match(
    await page.locator("#story-export-summary").textContent(),
    /6.00s/,
  ); // generation is not apply
  assert.equal(await page.locator("#creator-apply").isDisabled(), true);
  await rows
    .nth(0)
    .getByLabel("Caption draft — not rendered", { exact: true })
    .fill("<img src=x onerror=alert(1)> My draft caption");
  await rows
    .nth(0)
    .getByLabel("Caption draft — not rendered", { exact: true })
    .press("Tab");
  assert.equal(await page.locator("#creator-scenes img").count(), 0);
  await rows.nth(0).locator("select").selectOption("");
  await page.locator("#creator-ack").check();
  assert.equal(await page.locator("#creator-apply").isDisabled(), true);
  const blue = await rows
    .nth(0)
    .locator("option")
    .filter({ hasText: "blue-map" })
    .getAttribute("value");
  await rows.nth(0).locator("select").selectOption(blue);
  await rows
    .nth(0)
    .getByLabel("Duration (seconds)", { exact: true })
    .fill("31");
  await rows
    .nth(0)
    .getByLabel("Duration (seconds)", { exact: true })
    .press("Tab");
  await page.locator("#creator-ack").check();
  assert.equal(await page.locator("#creator-apply").isDisabled(), true);
  assert.match(
    await page.locator("#story-export-summary").textContent(),
    /6.00s/,
  );
  await rows.nth(0).getByLabel("Duration (seconds)", { exact: true }).fill("2");
  await rows
    .nth(0)
    .getByLabel("Duration (seconds)", { exact: true })
    .press("Tab");
  await page.locator("#creator-ack").check();
  await page.locator("#creator-apply").tap();
  assert.match(
    await page.locator("#creator-status").textContent(),
    /Applied cuts/,
  );
  assert.match(
    await page.locator("#story-export-summary").textContent(),
    /4.00s/,
  );
  assert.equal(await page.locator("#story-format").inputValue(), "9:16");
  assert.match(
    await page.locator(".story-scene strong").first().textContent(),
    /blue-map/,
  );
  pass(
    "Filename matching, manual reassignment, text-safe review and invalid-range rejection precede atomic Apply",
  );
  // Reorder the draft, then restore order: controls must affect real scene drafts.
  await rows.nth(0).getByRole("button", { name: "Later", exact: true }).tap();
  assert.match(
    await rows.nth(0).locator("select option:checked").textContent(),
    /red-map/,
  );
  await rows.nth(0).getByRole("button", { name: "Later", exact: true }).tap();
  await page.locator("#story-save").tap();
  await page.waitForFunction(
    () => !document.querySelector("#story-save").disabled,
  );
  assert.match(
    await page.locator("#story-project-status").textContent(),
    /Saved Story/,
  );
  await page.reload();
  await page.locator("#story-mode").tap();
  await page.locator("#story-load").tap();
  await page.waitForFunction(
    () => !document.querySelector("#story-load").disabled,
  );
  assert.match(
    await page.locator("#story-project-status").textContent(),
    /Restored/,
  );
  assert.match(await page.locator("#creator-prompt").inputValue(), /4-second/);
  assert.equal(
    await page.locator("#creator-audio-list select").inputValue(),
    "music",
  );
  assert.equal(
    await page
      .getByLabel("Suggested placement (seconds; planning only)", {
        exact: true,
      })
      .inputValue(),
    "1.5",
  );
  assert.match(
    await page
      .locator("#creator-scenes fieldset")
      .nth(0)
      .getByLabel("Caption draft — not rendered", { exact: true })
      .inputValue(),
    /<img/,
  );
  assert.match(
    await page
      .locator("#creator-scenes select option:checked")
      .first()
      .textContent(),
    /blue-map/,
  );
  pass(
    "Manual draft order, text, assignments and original audio Blob/role/placement survive saved-project reload",
  );
  async function exportBytes() {
    await page.locator("#story-export").tap();
    await page.waitForFunction(
      () => document.querySelector("#story-progress-region").hidden,
      null,
      { timeout: 90000 },
    );
    assert.equal(
      await page.locator("#story-result").isVisible(),
      true,
      await page.locator("#story-message").textContent(),
    );
    return outputBytes(page, "#story-download");
  }
  let bytes = await exportBytes(),
    inspected = await inspectMedia(page, bytes, {
      frameTimes: [0.5, 2.5],
      audioTimes: [0.5, 2.5],
    });
  await writeFile(".arena/creator-portrait.mp4", bytes);
  assert.equal(inspected.decode, 0);
  assert.equal(inspected.metadata.streams[0].width, 540);
  assert.equal(inspected.metadata.streams[0].height, 960);
  assert.equal(Number(inspected.metadata.format.duration), 4);
  assert.ok(inspected.colors[0].rgb[2] > 240);
  assert.ok(inspected.colors[1].rgb[0] > 240);
  assert.ok(inspected.audio.every((a) => a.rms === 0));
  pass(
    "Applied storyboard uses existing FFmpeg: real 4s 9:16 blue→red MP4; unimplemented audio is not secretly mixed",
    {
      bytes: bytes.length,
      duration: inspected.metadata.format.duration,
      colors: inspected.colors,
    },
  );
  await context.setOffline(true);
  await page.reload();
  await page.locator("#story-mode").tap();
  await page.locator("#story-load").tap();
  await page.waitForFunction(
    () => !document.querySelector("#story-load").disabled,
  );
  assert.match(
    await page.locator("#story-project-status").textContent(),
    /Restored/,
  );
  await page.locator("#creator-ack").check();
  await page.locator("#creator-apply").tap();
  bytes = await exportBytes();
  inspected = await inspectMedia(page, bytes);
  assert.equal(inspected.decode, 0);
  assert.equal(Number(inspected.metadata.format.duration), 4);
  pass(
    "Cold offline restore, reviewed re-Apply and actual export use cached creator modules and existing engine",
  );
  await context.setOffline(false);
  const camera = await page.evaluate(async () => {
    const { FFmpeg } = await import("./vendor/ffmpeg/index.js");
    const ff = new FFmpeg();
    const timer = setTimeout(() => ff.terminate(), 45000);
    try {
      await ff.load({
        coreURL: new URL("./vendor/core/ffmpeg-core.js", location.href).href,
        wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", location.href).href,
      });
      const code = await ff.exec([
        "-f",
        "lavfi",
        "-i",
        "color=red:s=320x240:r=24:d=2",
        "-f",
        "lavfi",
        "-i",
        "color=lime:s=320x240:r=24:d=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=4",
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map",
        "[v]",
        "-map",
        "2:a:0",
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
        "camera.mp4",
      ]);
      if (code) throw new Error("Camera fixture encode failed");
      return Array.from(await ff.readFile("camera.mp4"));
    } finally {
      clearTimeout(timer);
      ff.terminate();
    }
  });
  await page.locator("#story-input").setInputFiles({
    name: "camera.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from(camera),
  });
  await page.waitForFunction(
    () => !document.querySelector("#story-input").disabled,
  );
  await page
    .locator("#creator-prompt")
    .fill("Create a 4-second horizontal video with 2 scenes");
  await page.locator("#creator-notes").fill("blue opening\ncamera main event");
  await page.locator("#creator-generate").tap();
  assert.match(
    await page
      .locator("#creator-scenes select option:checked")
      .nth(1)
      .textContent(),
    /camera.mp4/,
  );
  await page
    .locator("#creator-scenes fieldset")
    .nth(1)
    .getByLabel("Start in uploaded video (seconds; images use 0)", {
      exact: true,
    })
    .fill("2");
  await page
    .locator("#creator-scenes fieldset")
    .nth(1)
    .getByLabel("Start in uploaded video (seconds; images use 0)", {
      exact: true,
    })
    .press("Tab");
  await page.locator("#creator-ack").check();
  await page.locator("#creator-apply").tap();
  bytes = await exportBytes();
  inspected = await inspectMedia(page, bytes, {
    frameTimes: [0.5, 2.5],
    audioTimes: [0.5, 2.5],
  });
  assert.equal(inspected.decode, 0);
  assert.equal(inspected.metadata.streams[0].width, 960);
  assert.equal(inspected.metadata.streams[0].height, 540);
  assert.equal(Number(inspected.metadata.format.duration), 4);
  assert.ok(inspected.colors[0].rgb[2] > 240);
  assert.ok(inspected.colors[1].rgb[1] > 240);
  assert.equal(inspected.audio[0].rms, 0);
  assert.ok(inspected.audio[1].rms > 0.02);
  await writeFile(".arena/creator-mixed.mp4", bytes);
  pass(
    "Planner reassignment/source trim exports a real 16:9 image→video project with correct green frames and original clip audio",
    {
      duration: inspected.metadata.format.duration,
      colors: inspected.colors,
      audio: inspected.audio,
    },
  );
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator("#creator-scenes")
    .evaluate((node) => (node.scrollTop = 0));
  await page
    .locator("#creator-workspace")
    .screenshot({ path: ".arena/creator-mobile.png" });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  pass(
    "Creator stays inside touch viewports with no page errors, uploads, external APIs or login",
  );
} finally {
  clearTimeout(deadline);
  await writeFile(
    ".arena/creator-browser-report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
