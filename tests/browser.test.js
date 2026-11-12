// Optional maintainer test. Start `npm run serve` first; no backend is used by the app.
import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
// Minimal Linux sandboxes may lack NSS. Use the test browser's own bundled libraries.
const libraryDir = resolve('.arena/browser-libs');
await mkdir(libraryDir, { recursive: true });
const archive = resolve('.arena/browser-libs.tar');
await writeFile(archive, brotliDecompressSync(await readFile(new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url))));
execFileSync('tar', ['-xf', archive, '-C', libraryDir]);
const browserEnv = { ...process.env, LD_LIBRARY_PATH: `${libraryDir}/lib:${process.env.LD_LIBRARY_PATH || ''}` };
const base = process.env.TEST_URL || 'http://localhost:5173/AutoCut/';
// Keep web security and SharedArrayBuffer restrictions enabled, as on GitHub Pages.
const safeArgs = chromium.args.filter(arg => !arg.includes('disable-web-security') && !arg.includes('enable-features=SharedArrayBuffer'));
const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: safeArgs, env: browserEnv, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true,
  isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR:', error.message); });
const remote = [];
page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(new URL(base).origin)) remote.push(request.url()); });
await mkdir('.arena', { recursive: true });
await mkdir('tests/fixtures', { recursive: true });
try {
  await page.goto(base); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.equal(await page.title(), 'AutoCut — Your footage. Your direction.');
  assert.equal(await page.evaluate(() => crossOriginIsolated), false);
  assert.equal(await page.evaluate(() => typeof SharedArrayBuffer), 'undefined');
  assert.match(await page.evaluate(async () => (await fetch('./THIRD_PARTY_NOTICES.md')).text()), /engine provenance/);
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors, []);
  assert.match(manifest.data, /AutoCut/);
  await cdp.detach();
  await page.locator('#help-button').click();
  assert.equal(await page.locator('#guide-dialog').isVisible(), true);
  await page.locator('#command-list button').first().click();
  assert.equal(await page.locator('#instructions').inputValue(), 'Trim the first 5 seconds');
  await page.locator('#instructions').fill('');
  console.log('PASS: browser accepts the manifest; help dialog and supported-command buttons work.');
  await page.screenshot({ path: '.arena/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.arena/mobile.png', fullPage: true });
  console.log('PASS: mobile layout has no horizontal overflow; service worker controls project subpath.');
  // Generate a real four-second H.264/AAC fixture locally with the exact shipped engine.
  const fixture = await page.evaluate(async () => {
    const { FFmpeg } = await import('./vendor/ffmpeg/index.js');
    const engine = new FFmpeg(); window.testEngine = engine;
    window.testLog = []; engine.on('log', ({message}) => window.testLog.push(message));
    await engine.load({ coreURL: new URL('./vendor/core/ffmpeg-core.js', location.href).href, wasmURL: new URL('./vendor/core/ffmpeg-core.wasm', location.href).href });
    const code = await engine.exec(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-threads', '1', '-c:a', 'aac', '-shortest', 'fixture.mp4']);
    if (code) throw new Error('Fixture generation failed: ' + window.testLog.join('\n'));
    const data = await engine.readFile('fixture.mp4'); engine.terminate();
    return Array.from(data);
  });
  await writeFile('tests/fixtures/source.mp4', Buffer.from(fixture));
  console.log(`PASS: single-threaded FFmpeg initialized without SharedArrayBuffer; fixture ${fixture.length} bytes.`);
  await page.locator('#video-input').setInputFiles('tests/fixtures/source.mp4');
  await page.waitForFunction(() => document.querySelector('#preview-video').videoWidth === 320);
  await page.locator('#instructions').fill('Add animated captions');
  assert.equal(await page.locator('#process-button').isDisabled(), true);
  assert.match(await page.locator('#instruction-errors').textContent(), /Not supported/);
  await page.locator('#instructions').fill('Trim the first 0.5 seconds, remove the last 0.5 seconds, make it vertical, convert to black and white, brighten the video, add fade-in and fade-out, lower the audio volume, increase the video speed to 2x');
  assert.equal(await page.locator('#process-button').isEnabled(), true);
  await page.locator('#process-button').click();
  await page.waitForFunction(() => document.querySelector('#download-button').hasAttribute('href') || (!document.querySelector('#process-button').disabled && !document.querySelector('#instruction-errors').hidden), { timeout: 120000 });
  assert.equal(await page.locator('#instruction-errors').isVisible(), false, await page.locator('#instruction-errors').textContent());
  assert.equal(await page.locator('#download-button').getAttribute('aria-disabled'), 'false');
  // Inspect the actual exported bytes, not just the UI.
  async function probeOutput() {
    return page.evaluate(async () => {
      const { FFmpeg } = await import('./vendor/ffmpeg/index.js');
      const ff = new FFmpeg();
      await ff.load({ coreURL: new URL('./vendor/core/ffmpeg-core.js', location.href).href, wasmURL: new URL('./vendor/core/ffmpeg-core.wasm', location.href).href });
      const bytes = new Uint8Array(await (await fetch(document.querySelector('#download-button').href)).arrayBuffer());
      await ff.writeFile('result', bytes);
      await ff.ffprobe(['-v', 'error', '-show_streams', '-show_format', '-of', 'json', 'result', '-o', 'meta.json']);
      const metadata = JSON.parse(await ff.readFile('meta.json', 'utf8'));
      // Decode real pixels to verify the black & white and fade operations.
      if (document.querySelector('#instructions').value.includes('black and white')) {
        metadata.frameStats = [];
        for (const time of [0, 0.7]) {
          await ff.exec(['-ss', String(time), '-i', 'result', '-frames:v', '1', '-vf', 'scale=16:16', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-threads', '1', '-y', 'frame.rgb']);
          const pixels = await ff.readFile('frame.rgb');
          let brightness = 0; let chromaDifference = 0;
          for (let i = 0; i < pixels.length; i += 3) {
            brightness += (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
            chromaDifference += Math.abs(pixels[i] - pixels[i+1]) + Math.abs(pixels[i+1] - pixels[i+2]);
          }
          metadata.frameStats.push({ brightness: brightness / (pixels.length / 3), chromaDifference: chromaDifference / (pixels.length / 3) });
        }
      }
      ff.terminate(); return metadata;
    });
  }
  let meta = await probeOutput();
  const video = meta.streams.find(stream => stream.codec_type === 'video');
  assert.equal(video.codec_name, 'h264'); assert.equal(video.width, 134); assert.equal(video.height, 240);
  assert.ok(Math.abs(Number(meta.format.duration) - 1.5) < .2, meta.format.duration);
  assert.equal(meta.streams.find(stream => stream.codec_type === 'audio').codec_name, 'aac');
  assert.ok(meta.frameStats[0].brightness < 3, JSON.stringify(meta.frameStats));
  assert.ok(meta.frameStats[1].brightness > 20, JSON.stringify(meta.frameStats));
  assert.ok(meta.frameStats[1].chromaDifference < 3, JSON.stringify(meta.frameStats));
  console.log('PASS: decoded result pixels confirm grayscale and a real fade-in, not just an edit-plan label.');
  const downloadEvent = page.waitForEvent('download'); await page.locator('#download-button').click();
  assert.match((await downloadEvent).suggestedFilename(), /-autocut.mp4$/);
  console.log('PASS: composed edits produced downloadable H.264/AAC MP4, center-cropped and sped up to expected duration.');
  await page.screenshot({ path: '.arena/mobile-result.png', fullPage: true });
  await page.locator('#instructions').fill('trim the first 99 seconds');
  await page.locator('#process-button').click();
  await page.waitForFunction(() => !document.querySelector('#progress-region').hidden || !document.querySelector('#instruction-errors').hidden);
  await page.waitForFunction(() => !document.querySelector('#instruction-errors').hidden, { timeout: 120000 });
  assert.match(await page.locator('#instruction-errors').textContent(), /entire/);
  console.log('PASS: invalid trims produce a persistent, understandable error.');
  await page.locator('#instructions').fill('slow the video down to half speed, lower the audio volume');
  await page.locator('#export-format').selectOption('mp3');
  await page.locator('#process-button').click();
  await page.waitForFunction(() => document.querySelector('#download-button').hasAttribute('href'), { timeout: 120000 });
  meta = await probeOutput();
  assert.equal(meta.streams.length, 1); assert.equal(meta.streams[0].codec_name, 'mp3');
  assert.ok(Math.abs(Number(meta.format.duration) - 8) < .25, meta.format.duration);
  console.log('PASS: MP3 export contains real audio with expected slow-motion duration.');
  await page.locator('#instructions').fill('mute the audio');
  await page.locator('#export-format').selectOption('mp4');
  await page.locator('#process-button').click();
  await page.waitForFunction(() => document.querySelector('#download-button').hasAttribute('href'), { timeout: 120000 });
  meta = await probeOutput(); assert.equal(meta.streams.length, 1); assert.equal(meta.streams[0].codec_type, 'video');
  console.log('PASS: mute removes the output audio track.');
  await page.locator('#instructions').fill('make it square');
  await page.locator('#process-button').click(); await page.locator('#cancel-button').click();
  assert.equal(await page.locator('#progress-region').isHidden(), true);
  assert.match(await page.locator('#app-notice').textContent(), /cancelled/);
  console.log('PASS: cancellation releases worker and restores controls.');
  // Cache persisted engine then test a cold offline page and processing run.
  await page.waitForFunction(async () => {
    for (const key of await caches.keys()) if (await (await caches.open(key)).match(new URL('./vendor/core/ffmpeg-core.wasm', location.href))) return true;
    return false;
  });
  await context.setOffline(true); await page.reload();
  await page.waitForFunction(() => document.querySelector('#command-list').children.length > 0);
  await page.locator('#video-input').setInputFiles('tests/fixtures/source.mp4');
  await page.locator('#instructions').fill('make it square');
  await page.locator('#process-button').click();
  await page.waitForFunction(() => document.querySelector('#download-button').hasAttribute('href'), { timeout: 120000 });
  meta = await probeOutput();
  assert.equal(meta.streams[0].width, 240); assert.equal(meta.streams[0].height, 240);
  console.log('PASS: cold offline reload and real video editing work from cached application and WASM.');
  await context.setOffline(false);
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(remote, []); assert.deepEqual(errors, []);
  console.log('PASS: 360px layout, no page errors, no external runtime requests.');
} catch (error) {
  await page.screenshot({ path: '.arena/failure.png', fullPage: true }).catch(() => {});
  console.error(await page.locator('#instruction-errors').textContent());
  throw error;
} finally { await browser.close(); }
