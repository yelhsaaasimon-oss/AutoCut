import { FFmpeg } from "./vendor/ffmpeg/index.js";
import {
  FPS,
  OUTPUT,
  assetFor,
  durationFrames,
  totalFrames,
} from "./story-model.js";

const MAX_TEMP_BYTES = 80 * 1024 * 1024;
export function sceneCommand(scene, asset, hasAudio, index) {
  const seconds = durationFrames(scene) / FPS;
  const frames = durationFrames(scene);
  const input = `input-${index}.${asset.kind === "image" ? "png" : "video"}`;
  const args = ["-hide_banner", "-y", "-threads", "1"];
  if (asset.kind === "image")
    args.push("-loop", "1", "-framerate", String(FPS), "-i", input);
  else
    args.push(
      "-ss",
      String(scene.inFrame / FPS),
      "-t",
      String(seconds),
      "-i",
      input,
    );
  if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  const vf = `setpts=PTS-STARTPTS,fps=${FPS},scale=${OUTPUT.width}:${OUTPUT.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${OUTPUT.width}:${OUTPUT.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${seconds}`;
  args.push(
    "-map",
    "0:v:0",
    "-vf",
    vf,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "25",
    "-threads",
    "1",
    "-frames:v",
    String(frames),
    "-video_track_timescale",
    "24000",
    `scene-${index}.mp4`,
  );
  // One final AAC encode avoids per-scene encoder padding accumulating at hard cuts.
  const samples = frames * (OUTPUT.sampleRate / FPS);
  args.push(
    "-map",
    hasAudio ? "0:a:0" : "1:a:0",
    "-vn",
    "-af",
    `aresample=48000:async=1:first_pts=0,aformat=sample_fmts=s16:channel_layouts=stereo,apad,atrim=end_sample=${samples},asetpts=N/SR/TB`,
    "-t",
    String(seconds),
    "-c:a",
    "pcm_s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "s16le",
    `scene-${index}.pcm`,
  );
  return { args, input, seconds, frames, samples };
}
export function joinCommand(sceneCount, frames) {
  if (!Number.isInteger(sceneCount) || sceneCount < 1)
    throw new Error("Add a scene before exporting.");
  const audio = Array.from(
    { length: sceneCount },
    (_, index) => `scene-${index}.pcm`,
  ).join("|");
  return [
    "-hide_banner",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "scenes.txt",
    "-f",
    "s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-i",
    `concat:${audio}`,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-threads",
    "1",
    "-t",
    String(frames / FPS),
    "-movflags",
    "+faststart",
    "-map_metadata",
    "-1",
    "story.mp4",
  ];
}

export async function exportStory(
  project,
  { signal, onStatus = () => {}, onEngine = () => {} } = {},
) {
  if (!project.scenes.length) throw new Error("Add a scene before exporting.");
  const ff = new FFmpeg();
  let logs = [];
  let loadTimer;
  const abort = () => ff.terminate();
  const assertActive = () => {
    if (signal?.aborted)
      throw new DOMException("Export cancelled", "AbortError");
  };
  ff.on("log", ({ message }) => {
    logs.push(message);
    if (logs.length > 25) logs.shift();
  });
  signal?.addEventListener("abort", abort, { once: true });
  onEngine(ff);
  try {
    assertActive();
    onStatus({ label: "Starting the editing engine…", completed: null });
    loadTimer = setTimeout(abort, 120000);
    try {
      await ff.load({
        coreURL: new URL("./vendor/core/ffmpeg-core.js", import.meta.url).href,
        wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", import.meta.url)
          .href,
      });
    } catch {
      assertActive();
      throw new Error(
        "The editing engine could not start. Connect to the internet for its first download, reload, and try again.",
      );
    } finally {
      clearTimeout(loadTimer);
    }
    let temporaryBytes = 0;
    for (let index = 0; index < project.scenes.length; index++) {
      assertActive();
      const scene = project.scenes[index],
        asset = assetFor(project, scene);
      onStatus({
        label: `Preparing scene ${index + 1} of ${project.scenes.length}…`,
        completed: index,
      });
      logs = [];
      const input = `input-${index}.${asset.kind === "image" ? "png" : "video"}`;
      await ff.writeFile(
        input,
        new Uint8Array(await (asset.prepared || asset.file).arrayBuffer()),
      );
      assertActive();
      let hasAudio = false;
      if (asset.kind === "video") {
        await ff.ffprobe([
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type:format=duration",
          "-of",
          "json",
          input,
          "-o",
          "probe.json",
        ]);
        let probe;
        try {
          probe = JSON.parse(await ff.readFile("probe.json", "utf8"));
        } catch {
          throw new Error(
            `Scene ${index + 1} could not be decoded. Choose a standard MP4 source.`,
          );
        }
        if (!probe.streams?.some((stream) => stream.codec_type === "video"))
          throw new Error(`Scene ${index + 1} has no video track.`);
        hasAudio = probe.streams.some(
          (stream) => stream.codec_type === "audio",
        );
        await ff.deleteFile("probe.json");
      }
      const command = sceneCommand(scene, asset, hasAudio, index);
      onStatus({
        label: `Rendering scene ${index + 1} of ${project.scenes.length}…`,
        completed: index,
      });
      const code = await ff.exec(command.args);
      assertActive();
      if (code !== 0)
        throw new Error(
          `Scene ${index + 1} could not be rendered. Try a shorter or lower-resolution MP4.`,
        );
      await ff.deleteFile(input); // Only one source resides in WASM at a time.
      // Inspect FS sizes without copying intermediate files back into browser memory.
      await ff.ffprobe([
        "-v",
        "error",
        "-show_entries",
        "format=size:stream=nb_frames",
        "-of",
        "json",
        `scene-${index}.mp4`,
        "-o",
        "probe.json",
      ]);
      const meta = JSON.parse(await ff.readFile("probe.json", "utf8"));
      if (Number(meta.streams?.[0]?.nb_frames) !== command.frames)
        throw new Error(
          `Scene ${index + 1} did not render all expected frames. Try a different source.`,
        );
      temporaryBytes += Number(meta.format?.size || 0) + command.samples * 4;
      if (temporaryBytes > MAX_TEMP_BYTES)
        throw new Error(
          "This story creates too much temporary data for safe phone editing. Shorten the project or use simpler, lower-resolution clips.",
        );
      await ff.deleteFile("probe.json");
      onStatus({ label: `Scene ${index + 1} ready`, completed: index + 1 });
    }
    assertActive();
    const list = project.scenes
      .map((_, index) => `file 'scene-${index}.mp4'`)
      .join("\n");
    await ff.writeFile("scenes.txt", new TextEncoder().encode(list));
    onStatus({
      label: "Joining scenes and encoding audio…",
      completed: project.scenes.length,
    });
    const code = await ff.exec(
      joinCommand(project.scenes.length, totalFrames(project)),
    );
    assertActive();
    if (code !== 0)
      throw new Error(
        "The scenes could not be joined. Try fewer or shorter scenes.",
      );
    // Drop all intermediates before copying the final file out of WASM.
    for (let index = 0; index < project.scenes.length; index++) {
      await ff.deleteFile(`scene-${index}.mp4`);
      await ff.deleteFile(`scene-${index}.pcm`);
    }
    const data = await ff.readFile("story.mp4");
    if (!data.byteLength)
      throw new Error("The export was empty. Try a shorter project.");
    onStatus({
      label: "Your story is ready",
      completed: project.scenes.length + 1,
    });
    return new Blob([data], { type: "video/mp4" });
  } catch (error) {
    assertActive();
    if (
      /memory|allocation|out of bounds|unreachable|Aborted|FS error/i.test(
        `${error} ${logs.join(" ")}`,
      )
    )
      throw new Error(
        "Your phone ran out of editing memory or could not decode a scene. Close other tabs and use fewer, shorter, lower-resolution clips. Original files are unchanged.",
      );
    throw error;
  } finally {
    clearTimeout(loadTimer);
    signal?.removeEventListener("abort", abort);
    ff.terminate();
  }
}
