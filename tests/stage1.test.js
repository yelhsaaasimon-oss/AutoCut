// Stage 1 acceptance tests: actual chooser events, playback, WASM and downloaded bytes.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { launchBrowser, ANDROID } from "./browser-setup.js";
import { EXAMPLES } from "../editor.js";

const base = process.env.TEST_URL || "http://localhost:5173/AutoCut/";
const browser = await launchBrowser();
const context = await browser.newContext(ANDROID);
const page = await context.newPage();
page.setDefaultTimeout(15000);
const results = [];
const pageErrors = [],
  httpErrors = [],
  externalRequests = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("response", (response) => {
  if (response.status() >= 400)
    httpErrors.push({ url: response.url(), status: response.status() });
});
page.on("request", (request) => {
  if (
    /^https?:/.test(request.url()) &&
    new URL(request.url()).origin !== new URL(base).origin
  )
    externalRequests.push(request.url());
});
await mkdir(".arena", { recursive: true });
await mkdir("tests/fixtures", { recursive: true });
let fixture, trimmed, gray, muted, downloaded;
const artifacts = {};
async function check(id, title, fn) {
  try {
    const evidence = await fn();
    results.push({ id, title, status: "PASS", evidence });
    console.log(`PASS ${id}: ${title} — ${evidence}`);
  } catch (error) {
    const status = error.message.startsWith("NOT TESTED:")
      ? "NOT TESTED"
      : "FAIL";
    results.push({ id, title, status, evidence: error.message });
    console.error(`${status} ${id}: ${title} — ${error.message}`);
    await page
      .screenshot({ path: `.arena/stage1-${id}-failure.png`, fullPage: true })
      .catch(() => {});
  }
}
function needs(value, reason) {
  if (!value) throw new Error(`NOT TESTED: ${reason}`);
}
async function engineTask(bytes, task) {
  return page.evaluate(
    async ({ bytes, task }) => {
      const { FFmpeg } = await import("./vendor/ffmpeg/index.js");
      const ff = new FFmpeg(),
        logs = [];
      ff.on("log", ({ message }) => logs.push(message));
      try {
        await ff.load({
          coreURL: new URL("./vendor/core/ffmpeg-core.js", location.href).href,
          wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", location.href)
            .href,
        });
        if (task === "fixture") {
          const filters =
            "color=c=red:s=320x240:r=24:d=4,drawbox=color=lime:t=fill:enable='gte(t,1)*lt(t,2)',drawbox=color=blue:t=fill:enable='gte(t,2)*lt(t,3)',drawbox=color=yellow:t=fill:enable='gte(t,3)'";
          const code = await ff.exec([
            "-f",
            "lavfi",
            "-i",
            filters,
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=4:sample_rate=44100",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-threads",
            "1",
            "-c:a",
            "aac",
            "-shortest",
            "fixture.mp4",
          ]);
          if (code !== 0) throw new Error(logs.join("\n"));
          return { bytes: Array.from(await ff.readFile("fixture.mp4")) };
        }
        await ff.writeFile("input.mp4", new Uint8Array(bytes));
        await ff.ffprobe([
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          "input.mp4",
          "-o",
          "probe.json",
        ]);
        const metadata = JSON.parse(await ff.readFile("probe.json", "utf8"));
        // Decode the ENTIRE exported file, including audio, not just container metadata.
        const decodeCode = await ff.exec([
          "-v",
          "error",
          "-i",
          "input.mp4",
          "-f",
          "null",
          "-",
        ]);
        if (decodeCode !== 0)
          throw new Error(`Decode failed (${decodeCode}): ${logs.join("\n")}`);
        const frames = [];
        for (const time of task === "trim" ? [0.2, 1.7] : [0.2]) {
          const code = await ff.exec([
            "-ss",
            String(time),
            "-i",
            "input.mp4",
            "-frames:v",
            "1",
            "-vf",
            "scale=16:16",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "-threads",
            "1",
            "-y",
            "frame.rgb",
          ]);
          if (code !== 0) throw new Error(logs.join("\n"));
          const pixels = await ff.readFile("frame.rgb");
          if (pixels.length !== 16 * 16 * 3)
            throw new Error("Decoded frame is incomplete");
          const channels = [0, 0, 0];
          let difference = 0;
          for (let i = 0; i < pixels.length; i += 3) {
            for (let c = 0; c < 3; c++) channels[c] += pixels[i + c] / 256;
            difference +=
              (Math.abs(pixels[i] - pixels[i + 1]) +
                Math.abs(pixels[i + 1] - pixels[i + 2])) /
              256;
          }
          frames.push({ time, channels, difference });
        }
        return { metadata, frames, decodeCode };
      } finally {
        ff.terminate();
      }
    },
    { bytes: bytes ? Array.from(bytes) : null, task },
  );
}
async function processVideo(instructions) {
  await page.locator("#instructions").fill(instructions);
  await page.locator("#export-format").selectOption("mp4");
  assert.equal(await page.locator("#process-button").isEnabled(), true);
  await page.locator("#process-button").tap();
  // Correct Playwright signature: second arg is data; timeout belongs in the third arg.
  await page.waitForFunction(
    () => document.querySelector("#progress-region").hidden,
    null,
    { timeout: 120000 },
  );
  assert.equal(
    await page.locator("#instruction-errors").isVisible(),
    false,
    await page.locator("#instruction-errors").textContent(),
  );
  assert.equal(
    await page.locator("#download-button").getAttribute("aria-disabled"),
    "false",
  );
  return Buffer.from(
    await page.evaluate(async () =>
      Array.from(
        new Uint8Array(
          await (
            await fetch(document.querySelector("#download-button").href)
          ).arrayBuffer(),
        ),
      ),
    ),
  );
}
async function playPreview() {
  await page.evaluate(async () => {
    const video = document.querySelector("#preview-video");
    video.muted = true;
    video.currentTime = 0;
    await video.play();
  });
  await page.waitForFunction(() => {
    const video = document.querySelector("#preview-video");
    return video.currentTime > 0.2 && video.readyState >= 2 && !video.error;
  });
  return page.evaluate(() => {
    const video = document.querySelector("#preview-video");
    video.pause();
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, 1, 1);
    return {
      currentTime: video.currentTime,
      width: video.videoWidth,
      height: video.videoHeight,
      rgb: Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3),
    };
  });
}
try {
  await check(1, "Website loads without errors", async () => {
    const response = await page.goto(base);
    assert.equal(response.status(), 200);
    await page.waitForFunction(
      (expected) =>
        document.querySelector("#command-list").children.length === expected,
      EXAMPLES.length,
    );
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.equal(await page.title(), "AutoCut — Your footage. Your direction.");
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(httpErrors, []);
    return "HTTP 200; module initialization completed; no uncaught JavaScript errors or HTTP asset errors.";
  });
  await check(6, "FFmpeg.wasm initializes successfully", async () => {
    assert.equal(await page.evaluate(() => crossOriginIsolated), false);
    assert.equal(
      await page.evaluate(() => typeof SharedArrayBuffer),
      "undefined",
    );
    fixture = Buffer.from((await engineTask(null, "fixture")).bytes);
    await writeFile("tests/fixtures/stage1-source.mp4", fixture);
    artifacts.source = await engineTask(fixture, "probe");
    assert.ok(
      artifacts.source.metadata.streams.some((s) => s.codec_name === "h264"),
    );
    assert.ok(
      artifacts.source.metadata.streams.some((s) => s.codec_name === "aac"),
    );
    assert.equal(Number(artifacts.source.metadata.format.duration), 4);
    const [r, g, b] = artifacts.source.frames[0].channels;
    assert.ok(r > 230 && g < 15 && b < 15);
    return `Real single-thread WASM encoded and decoded ${fixture.length} bytes of H.264/AAC footage without SharedArrayBuffer.`;
  });
  await check(
    2,
    "Upload button opens a chooser and accepts a real video",
    async () => {
      needs(fixture, "FFmpeg fixture generation failed");
      const chooserEvent = page.waitForEvent("filechooser");
      await page.locator("#dropzone").tap();
      const chooser = await chooserEvent;
      await chooser.setFiles("tests/fixtures/stage1-source.mp4");
      await page.waitForFunction(
        () => document.querySelector("#preview-video").videoWidth === 320,
      );
      assert.equal(
        await page.locator("#file-name").textContent(),
        "stage1-source.mp4",
      );
      assert.equal(await page.locator("#source-file").isVisible(), true);
      assert.equal(await page.locator("#dropzone").isHidden(), true);
      return "A touch on browse files emitted an actual filechooser event; selection loaded the 320×240 source.";
    },
  );
  await check(3, "Uploaded video can actually play", async () => {
    needs(fixture, "No source fixture");
    const playback = await playPreview();
    artifacts.originalPlayback = playback;
    assert.equal(playback.width, 320);
    assert.equal(playback.height, 240);
    assert.ok(playback.rgb[0] > 230 && playback.rgb[1] < 15);
    return `Native video playback advanced to ${playback.currentTime.toFixed(2)}s; canvas read a real red frame.`;
  });
  await check(
    4,
    "Interpreter recognizes every documented example",
    async () => {
      needs(fixture, "No source fixture");
      for (const command of EXAMPLES) {
        await page.locator("#instructions").fill(command);
        assert.equal(
          await page.locator("#instruction-errors").isHidden(),
          true,
          command,
        );
        assert.equal(
          await page.locator("#process-button").isEnabled(),
          true,
          command,
        );
        assert.equal(
          await page.locator("#edit-plan li").count(),
          command.includes("fade-in") ? 2 : 1,
          command,
        );
      }
      return `All ${EXAMPLES.length} documented commands produced the expected edit-plan entries without interpreter errors.`;
    },
  );
  await check(
    5,
    "Interpreter rejects unsupported and conflicting commands",
    async () => {
      for (const text of [
        "Add animated captions",
        "Mute the audio and remove the background",
        "Make it vertical with subtitles",
        "Make it square, make it vertical",
        "Speed 0x",
        "Lower the volume to 200%",
        "<img src=x onerror=alert(1)>",
      ]) {
        await page.locator("#instructions").fill(text);
        assert.equal(
          await page.locator("#process-button").isDisabled(),
          true,
          text,
        );
        assert.equal(
          await page.locator("#instruction-errors").isVisible(),
          true,
          text,
        );
        assert.equal(await page.locator("#instruction-errors img").count(), 0);
      }
      return "Seven negative cases blocked processing, including mixed supported/unsupported instructions, conflicts, invalid ranges and literal HTML.";
    },
  );
  await check(
    7,
    "Trim removes the requested content, not just duration metadata",
    async () => {
      needs(fixture, "No source fixture");
      trimmed = await processVideo(
        "Trim the first 1 seconds, remove the last 1 seconds",
      );
      artifacts.trim = await engineTask(trimmed, "trim");
      assert.ok(
        Math.abs(Number(artifacts.trim.metadata.format.duration) - 2) < 0.1,
      );
      const [first, last] = artifacts.trim.frames.map((f) => f.channels);
      assert.ok(
        first[1] > 230 && first[0] < 15 && first[2] < 15,
        JSON.stringify(first),
      );
      assert.ok(
        last[2] > 230 && last[0] < 15 && last[1] < 15,
        JSON.stringify(last),
      );
      return `4s source → ${artifacts.trim.metadata.format.duration}s; decoded first frame is green and final sampled frame is blue, excluding the red/yellow ends.`;
    },
  );
  await check(
    8,
    "Black-and-white conversion changes actual pixels",
    async () => {
      needs(fixture, "No source fixture");
      gray = await processVideo("Convert to black and white");
      artifacts.grayscale = await engineTask(gray, "probe");
      const frame = artifacts.grayscale.frames[0];
      assert.ok(frame.difference < 3, JSON.stringify(frame));
      assert.ok(frame.channels.every((value) => value > 40 && value < 120));
      assert.ok(artifacts.source.frames[0].difference > 200);
      return `Colored source → decoded grayscale RGB ${frame.channels.map((n) => n.toFixed(1)).join("/")}; mean channel difference ${frame.difference.toFixed(2)}.`;
    },
  );
  await check(9, "Mute removes the audio track", async () => {
    needs(fixture, "No source fixture");
    muted = await processVideo("Mute the audio");
    artifacts.mute = await engineTask(muted, "probe");
    assert.equal(
      artifacts.source.metadata.streams.filter((s) => s.codec_type === "audio")
        .length,
      1,
    );
    assert.equal(
      artifacts.mute.metadata.streams.filter((s) => s.codec_type === "audio")
        .length,
      0,
    );
    assert.equal(
      artifacts.mute.metadata.streams.filter((s) => s.codec_type === "video")
        .length,
      1,
    );
    return "Source has AAC audio; exported MP4 has one H.264 video stream and no audio stream. Full-file decode succeeded.";
  });
  await check(10, "Exported MP4 is valid and playable", async () => {
    needs(muted, "Mute/export job failed");
    assert.equal(muted.subarray(4, 8).toString(), "ftyp");
    assert.equal(artifacts.mute.metadata.streams[0].codec_name, "h264");
    const playback = await playPreview();
    artifacts.editedPlayback = playback;
    assert.ok(playback.currentTime > 0.2);
    return "Actual MP4 file signature, H.264 stream and full-file decode verified; native Edited preview also plays rendered frames.";
  });
  await check(
    11,
    "Export downloads successfully and preserves the output bytes",
    async () => {
      needs(muted, "No exported MP4");
      const event = page.waitForEvent("download");
      await page.locator("#download-button").tap();
      const download = await event;
      assert.match(
        download.suggestedFilename(),
        /^stage1-source-autocut-\d+p\d{2}s-\d{8}-\d{6}-\d{3}\.mp4$/,
      );
      await download.saveAs(".arena/stage1-downloaded.mp4");
      assert.equal(await download.failure(), null);
      downloaded = await readFile(".arena/stage1-downloaded.mp4");
      assert.equal(
        createHash("sha256").update(downloaded).digest("hex"),
        createHash("sha256").update(muted).digest("hex"),
      );
      const inspected = await engineTask(downloaded, "probe");
      assert.equal(inspected.decodeCode, 0);
      return `Browser saved ${downloaded.length} bytes with the correct filename; SHA-256 equals the exported Blob; saved file decodes completely.`;
    },
  );
  await check(
    12,
    "Interface works at Android-sized touch viewports",
    async () => {
      for (const width of [320, 360, 390, 412, 768]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `Overflow at ${width}px`,
        );
        await page.locator("#instructions").fill("");
        await page.locator('[data-command="Mute the audio"]').tap();
        assert.equal(
          await page.locator("#instructions").inputValue(),
          "Mute the audio",
        );
        assert.equal(await page.locator("#process-button").isEnabled(), true);
        await page.locator("#help-button").tap();
        assert.equal(await page.locator("#guide-dialog").isVisible(), true);
        await page.locator("#guide-close").tap();
        await page.screenshot({
          path: `.arena/stage1-${width}px.png`,
          fullPage: true,
        });
      }
      return "320/360/390/412/768px: no horizontal overflow; touch suggestion buttons, textarea, processing controls and help dialog work. Physical Android hardware not tested.";
    },
  );
  await check(
    13,
    "PWA manifest and service worker are functional",
    async () => {
      const cdp = await context.newCDPSession(page);
      const manifestResult = await cdp.send("Page.getAppManifest");
      assert.deepEqual(manifestResult.errors, []);
      const manifest = JSON.parse(manifestResult.data);
      for (const icon of manifest.icons) {
        const response = await context.request.get(
          new URL(icon.src, base).href,
        );
        assert.equal(response.status(), 200);
        const buffer = await response.body();
        const dimensions = icon.sizes.split("x").map(Number);
        assert.equal(buffer.readUInt32BE(16), dimensions[0]);
        assert.equal(buffer.readUInt32BE(20), dimensions[1]);
      }
      await cdp.detach();
      const registration = await page.evaluate(async () => {
        const r = await navigator.serviceWorker.ready;
        return { scope: r.scope, state: r.active.state };
      });
      assert.equal(registration.state, "activated");
      assert.equal(registration.scope, base);
      await page.waitForFunction(
        async () =>
          !!(await caches.match(
            new URL("./vendor/core/ffmpeg-core.wasm", location.href),
          )),
      );
      await context.setOffline(true);
      await page.reload();
      await page.waitForFunction(
        (expected) =>
          document.querySelector("#command-list").children.length === expected,
        EXAMPLES.length,
      );
      await page
        .locator("#video-input")
        .setInputFiles("tests/fixtures/stage1-source.mp4");
      const offlineOutput = await processVideo("Mute the audio");
      const meta = await engineTask(offlineOutput, "probe");
      assert.equal(meta.decodeCode, 0);
      await context.setOffline(false);
      return "Chromium reports zero manifest errors; all icon sizes verified; scoped service worker activates; cold offline reload and actual offline MP4 edit/decode succeed. Home-screen installation not tested.";
    },
  );
  await check(14, "Paths work beneath a GitHub Pages project URL", async () => {
    assert.ok(new URL(base).pathname !== "/");
    assert.deepEqual(httpErrors, []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(externalRequests, []);
    const cachePaths = await page.evaluate(async () => {
      const paths = [];
      for (const name of await caches.keys())
        for (const req of await (await caches.open(name)).keys())
          paths.push(new URL(req.url).pathname);
      return paths;
    });
    assert.ok(cachePaths.length >= 19);
    assert.ok(
      cachePaths.every((path) => path.startsWith(new URL(base).pathname)),
    );
    const rootPage = await context.newPage();
    await rootPage.goto(new URL("/", base).href);
    await rootPage.waitForFunction(
      (expected) =>
        document.querySelector("#command-list").children.length === expected,
      EXAMPLES.length,
    );
    await rootPage.close();
    return "Shell, modules, worker, WASM, manifest and icons load at /AutoCut/ without 404s or cross-origin calls; cached paths stay under the project scope. Domain-root load also succeeds. Live GitHub Pages deployment not tested.";
  });
  // Additional negative/recovery cases beyond the requested fourteen acceptance checks.
  await check(
    15,
    "Invalid input files are rejected and processing recovers",
    async () => {
      for (const [name, mimeType, buffer, expected] of [
        ["empty.mp4", "video/mp4", Buffer.alloc(0), /empty/i],
        [
          "notes.txt",
          "text/plain",
          Buffer.from("not a video"),
          /choose a video/i,
        ],
      ]) {
        await page
          .locator("#video-input")
          .setInputFiles({ name, mimeType, buffer });
        assert.match(await page.locator("#app-notice").textContent(), expected);
      }
      await page.locator("#video-input").setInputFiles({
        name: "broken.mp4",
        mimeType: "video/mp4",
        buffer: Buffer.from("not a playable MP4"),
      });
      await page.locator("#instructions").fill("Mute the audio");
      await page.locator("#process-button").tap();
      await page.waitForFunction(
        () => document.querySelector("#progress-region").hidden,
        null,
        { timeout: 120000 },
      );
      assert.equal(await page.locator("#instruction-errors").isVisible(), true);
      assert.equal(
        await page.locator("#download-button").getAttribute("href"),
        null,
      );
      await page
        .locator("#video-input")
        .setInputFiles("tests/fixtures/stage1-source.mp4");
      await processVideo("Mute the audio");
      return "Empty, wrong-type and corrupt MP4 files handled without a crash; corrupt file produces no export; replacing it with valid footage restores editing.";
    },
  );
  await check(
    16,
    "Silent sources, blank conversion and stale export invalidation",
    async () => {
      needs(muted, "No silent MP4 fixture");
      await writeFile("tests/fixtures/stage1-silent.mp4", muted);
      const chooserEvent = page.waitForEvent("filechooser");
      await page.locator("#replace-button").tap();
      await (await chooserEvent).setFiles("tests/fixtures/stage1-silent.mp4");
      assert.equal(
        await page.locator("#download-button").getAttribute("href"),
        null,
      );
      const conversion = await processVideo("");
      const meta = await engineTask(conversion, "probe");
      assert.equal(meta.metadata.streams.length, 1);
      await page.locator("#instructions").fill("Lower the audio volume");
      assert.equal(
        await page.locator("#download-button").getAttribute("href"),
        null,
      );
      assert.equal(await page.locator("#edited-tab").isDisabled(), true);
      await page.locator("#export-format").selectOption("mp3");
      await page.locator("#process-button").tap();
      await page.waitForFunction(
        () => document.querySelector("#progress-region").hidden,
        null,
        { timeout: 120000 },
      );
      assert.match(
        await page.locator("#instruction-errors").textContent(),
        /no audio track/i,
      );
      assert.equal(
        await page.locator("#download-button").getAttribute("href"),
        null,
      );
      await page
        .locator("#video-input")
        .setInputFiles("tests/fixtures/stage1-source.mp4");
      await processVideo("");
      return "Replace chooser works; source with no audio exports valid MP4; empty instructions convert; MP3 rejects silent source clearly; changed instructions revoke stale export; retry succeeds.";
    },
  );
  await check(
    17,
    "Missing offline engine fails clearly and recovers online",
    async () => {
      const fresh = await browser.newContext(ANDROID);
      try {
        const tab = await fresh.newPage();
        await tab.goto(base);
        await tab.waitForFunction(() => !!navigator.serviceWorker.controller);
        assert.equal(
          await tab.evaluate(
            async () =>
              !!(await caches.match(
                new URL("./vendor/core/ffmpeg-core.wasm", location.href),
              )),
          ),
          false,
        );
        await fresh.setOffline(true);
        await tab.reload();
        await tab.waitForFunction(
          (expected) =>
            document.querySelector("#command-list").children.length ===
            expected,
          EXAMPLES.length,
        );
        await tab
          .locator("#video-input")
          .setInputFiles("tests/fixtures/stage1-source.mp4");
        await tab.locator("#instructions").fill("Mute the audio");
        await tab.locator("#process-button").tap();
        await tab.waitForFunction(
          () => document.querySelector("#progress-region").hidden,
          null,
          { timeout: 120000 },
        );
        assert.match(
          await tab.locator("#instruction-errors").textContent(),
          /engine could not start.*connection/i,
        );
        assert.equal(
          await tab.locator("#download-button").getAttribute("href"),
          null,
        );
        assert.equal(await tab.locator("#process-button").isEnabled(), true);
        await fresh.setOffline(false);
        await tab.locator("#process-button").tap();
        await tab.waitForFunction(
          () => document.querySelector("#progress-region").hidden,
          null,
          { timeout: 120000 },
        );
        assert.equal(
          await tab.locator("#download-button").getAttribute("aria-disabled"),
          "false",
        );
        return "Fresh shell-only cache loads offline; first edit reports missing engine/connection instead of hanging; reconnecting and retrying produces an export.";
      } finally {
        await fresh.close();
      }
    },
  );
} finally {
  await context.setOffline(false).catch(() => {});
  const report = {
    date: "2026-11-12",
    base,
    environment:
      "Chromium 153, Android user agent, touch/mobile emulation; no physical Android device",
    results: results.sort((a, b) => a.id - b.id),
    metrics: artifacts,
    pageErrors,
    httpErrors,
    externalRequests,
  };
  await writeFile(
    ".arena/stage1-results.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  if (results.some((result) => result.status !== "PASS")) process.exitCode = 1;
}
