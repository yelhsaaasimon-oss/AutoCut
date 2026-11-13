import { FFmpeg } from "./vendor/ffmpeg/index.js";

export const ENGINE_PATHS = Object.freeze({
  classWorkerURL: new URL("./vendor/ffmpeg/worker.js", import.meta.url).href,
  coreURL: new URL("./vendor/core/ffmpeg-core.js", import.meta.url).href,
  wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", import.meta.url).href,
});

export class MediaError extends Error {}

// Wrap the upstream API, not its vendored source. A crashed worker may never
// answer; every operation must still finish or release its worker on a deadline.
export function createMediaEngine({
  signal,
  loadTimeout = 120000,
  taskTimeout = 900000,
  factory = () => new FFmpeg(),
} = {}) {
  const engine = factory();
  const terminate = engine.terminate.bind(engine);
  const pending = new Set();
  let stopped = null;
  const stop = (
    error = new DOMException("Processing cancelled", "AbortError"),
  ) => {
    if (stopped) return;
    stopped = error;
    signal?.removeEventListener("abort", abort);
    for (const reject of [...pending]) reject(error);
    terminate();
  };
  const abort = () =>
    stop(new DOMException("Processing cancelled", "AbortError"));
  engine.terminate = () => stop();
  for (const method of [
    "load",
    "exec",
    "ffprobe",
    "writeFile",
    "readFile",
    "deleteFile",
  ]) {
    const original = engine[method].bind(engine);
    engine[method] = (...args) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) abort();
        if (stopped) return reject(stopped);
        const timeout = method === "load" ? loadTimeout : taskTimeout;
        const finish = (error, value, failed = false) => {
          clearTimeout(timer);
          pending.delete(cancel);
          if (failed) reject(error);
          else resolve(value);
        };
        const cancel = (error) => finish(error, undefined, true);
        const timer = setTimeout(
          () =>
            stop(
              new MediaError(
                method === "load"
                  ? "The editing engine did not start within two minutes. Check the local worker/core files or connect once to cache the engine, then retry."
                  : "Processing timed out and the editing worker was released. Use a shorter or lower-resolution source, keep Chrome open, and retry.",
              ),
            ),
          timeout,
        );
        pending.add(cancel);
        Promise.resolve()
          .then(() => {
            if (stopped) throw stopped;
            if (method === "load") {
              if (
                typeof WebAssembly === "undefined" ||
                typeof Worker === "undefined"
              ) {
                throw new MediaError(
                  "WebAssembly and module workers are required. Open AutoCut in an updated Android Chrome, not an in-app browser.",
                );
              }
              args[0] = { ...args[0], ...ENGINE_PATHS };
            }
            return original(...args);
          })
          .then(
            (value) => finish(null, value),
            (error) => finish(error, undefined, true),
          );
      });
  }
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  return engine;
}

export function mediaErrorMessage(error, logs = []) {
  if (error instanceof MediaError) return error.message;
  // FFmpeg's build banner contains "ALLOW_MEMORY_GROWTH". It is NOT evidence
  // of an out-of-memory failure and must never hide the real error message.
  const detail = `${error} ${logs.filter((line) => !/configuration:|ffmpeg version|ffprobe version/i.test(line)).join(" ")}`;
  if (
    /out of memory|memory access out of bounds|cannot allocate|allocation failed|unreachable|FS error/i.test(
      detail,
    )
  )
    return "The editing worker ran out of memory or could not read this media. Close other tabs and use a shorter, lower-resolution H.264 MP4. Original files are unchanged.";
  if (/matches no streams|does not contain any stream/i.test(detail))
    return "No usable track was found for this export. Choose MP4 for silent footage; MP3 needs an audio track.";
  if (
    /Invalid data|Decoder.*not found|Error while decoding|moov atom/i.test(
      detail,
    )
  )
    return "This media could not be decoded. Try an H.264 MP4 that plays in Chrome; original files are unchanged.";
  return error instanceof Error
    ? error.message
    : String(error || "Processing failed. Try a short H.264 MP4 and retry.");
}

export async function probeMedia(engine, input, output = "verified.json") {
  const code = await engine.ffprobe([
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    input,
    "-o",
    output,
  ]);
  if (code !== 0 && code !== -1)
    throw new MediaError(
      "The generated media could not be inspected. No download was created.",
    );
  let metadata;
  try {
    metadata = JSON.parse(await engine.readFile(output, "utf8"));
  } catch {
    throw new MediaError(
      "The generated media metadata is unreadable. No download was created.",
    );
  }
  await engine.deleteFile(output);
  return metadata;
}

export function verifyQuickOutput(
  metadata,
  expectedDuration,
  format,
  expectAudio,
) {
  const video = metadata.streams?.find(
    (stream) => stream.codec_type === "video",
  );
  const audio = metadata.streams?.find(
    (stream) => stream.codec_type === "audio",
  );
  const [n, d] = String(video?.avg_frame_rate || "0/1")
    .split("/")
    .map(Number);
  const tolerance = Math.max(0.15, n > 0 && d > 0 ? (2 * d) / n : 0.15);
  const duration = Number(metadata.format?.duration);
  if (
    !Number.isFinite(duration) ||
    Math.abs(duration - expectedDuration) > tolerance ||
    (format === "mp4" &&
      (!video ||
        video.codec_name !== "h264" ||
        !Number.isInteger(video.width) ||
        video.width <= 0 ||
        !Number.isInteger(video.height) ||
        video.height <= 0 ||
        video.width % 2 ||
        video.height % 2 ||
        !!audio !== expectAudio ||
        (audio && audio.codec_name !== "aac"))) ||
    (format === "mp3" && (!audio || audio.codec_name !== "mp3" || video))
  ) {
    throw new MediaError(
      `Export integrity check failed (expected ${expectedDuration.toFixed(2)} seconds). No download was created. Try a shorter standard MP4 source.`,
    );
  }
  return duration;
}

export async function verifyMediaDecode(engine, path) {
  if (
    (await engine.exec([
      "-v",
      "error",
      "-xerror",
      "-i",
      path,
      "-f",
      "null",
      "-",
    ])) !== 0
  )
    throw new MediaError(
      "The generated media failed a full-file decode check. No download was created. Try a shorter standard H.264 source.",
    );
}

// Local, copyable diagnostics: no source names, file data or automatic telemetry.
export function exportDiagnostics(
  workspace,
  status,
  { expectedDuration, metadata, error, pipeline } = {},
) {
  const node = globalThis.document?.getElementById("export-diagnostics-text");
  if (!node) return;
  node.textContent = JSON.stringify(
    {
      build: "1.3.0-rc.1",
      workspace,
      status,
      browser: navigator.userAgent,
      secureContext: globalThis.isSecureContext,
      webAssembly: typeof WebAssembly !== "undefined",
      workers: typeof Worker !== "undefined",
      deviceMemoryGiB: navigator.deviceMemory ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      visibility: document.visibilityState,
      pipeline,
      paths: ENGINE_PATHS,
      expectedDuration,
      actualDuration: metadata?.format?.duration,
      tracks: metadata?.streams?.map(
        ({
          codec_type,
          codec_name,
          width,
          height,
          nb_frames,
          avg_frame_rate,
          r_frame_rate,
          sample_rate,
          channels,
        }) => ({
          codec_type,
          codec_name,
          width,
          height,
          nb_frames,
          avg_frame_rate,
          r_frame_rate,
          sample_rate,
          channels,
        }),
      ),
      error: error ? String(error.message || error) : undefined,
    },
    null,
    2,
  );
}

// Optional wake locks must never block processing or cancellation. A delayed
// request resolving after a job ended is released, not attached to the next job.
export function keepScreenAwake(isActive, assign) {
  try {
    globalThis.navigator?.wakeLock
      ?.request("screen")
      .then((lock) => {
        if (isActive()) assign(lock);
        else return lock.release();
      })
      .catch(() => {});
  } catch {
    /* Unsupported, denied or backgrounded: editing still works. */
  }
}

// Duration + UTC timestamp distinguish a new cut from older Android downloads.
export function exportFileName(base, seconds, format, now = new Date()) {
  const safe =
    base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 100) || "autocut";
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace(".", "-")
    .replace("Z", "");
  return `${safe}-${seconds.toFixed(2).replace(".", "p")}s-${stamp}.${format}`;
}
