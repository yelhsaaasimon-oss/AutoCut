// Independent test-side FFmpeg instance: never uses the app's engine wrapper.
export async function inspectMedia(
  page,
  bytes,
  { frameTimes = [], audioTimes = [] } = {},
) {
  return page.evaluate(
    async ({ bytes, frameTimes, audioTimes }) => {
      const { FFmpeg } = await import("./vendor/ffmpeg/index.js");
      const ff = new FFmpeg();
      const deadline = setTimeout(() => ff.terminate(), 45000);
      try {
        await ff.load({
          coreURL: new URL("./vendor/core/ffmpeg-core.js", location.href).href,
          wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", location.href)
            .href,
        });
        await ff.writeFile("media.bin", new Uint8Array(bytes));
        await ff.ffprobe([
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          "media.bin",
          "-o",
          "meta.json",
        ]);
        const metadata = JSON.parse(await ff.readFile("meta.json", "utf8"));
        const decode = await ff.exec([
          "-v",
          "error",
          "-xerror",
          "-i",
          "media.bin",
          "-f",
          "null",
          "-",
        ]);
        const colors = [];
        for (const time of frameTimes) {
          if (
            await ff.exec([
              "-ss",
              String(time),
              "-i",
              "media.bin",
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
            ])
          )
            throw new Error("Frame decode failed");
          colors.push({
            time,
            rgb: Array.from(await ff.readFile("frame.rgb")),
          });
        }
        const audio = [];
        if (audioTimes.length) {
          if (
            await ff.exec([
              "-i",
              "media.bin",
              "-vn",
              "-ac",
              "1",
              "-ar",
              "48000",
              "-af",
              "aresample=async=1:first_pts=0",
              "-f",
              "f32le",
              "samples.pcm",
            ])
          )
            throw new Error("Audio decode failed");
          const buffer = await ff.readFile("samples.pcm");
          const samples = new Float32Array(
            buffer.buffer,
            buffer.byteOffset,
            buffer.byteLength / 4,
          );
          for (const time of audioTimes) {
            let power = 0;
            const start = Math.round(time * 48000),
              n = 4800;
            for (let i = start; i < start + n; i++)
              power += (samples[i] || 0) ** 2;
            audio.push({ time, rms: Math.sqrt(power / n) });
          }
        }
        return { metadata, decode, colors, audio };
      } finally {
        clearTimeout(deadline);
        ff.terminate();
      }
    },
    { bytes: Array.from(bytes), frameTimes, audioTimes },
  );
}
export async function outputBytes(page, selector) {
  return Buffer.from(
    await page.evaluate(
      async (selector) =>
        Array.from(
          new Uint8Array(
            await (
              await fetch(document.querySelector(selector).href)
            ).arrayBuffer(),
          ),
        ),
      selector,
    ),
  );
}
