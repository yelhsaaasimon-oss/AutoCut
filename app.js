import {
  createMediaEngine,
  MediaError,
  mediaErrorMessage,
  probeMedia,
  verifyMediaDecode,
  verifyQuickOutput,
  exportDiagnostics,
  keepScreenAwake,
  exportFileName,
} from "./media-engine.js";
import { projectStore } from "./project-store.js";
import {
  EXAMPLES,
  parseInstructions,
  buildCommand,
  quickSourceDuration,
} from "./editor.js";

const $ = (id) => document.getElementById(id);
const state = {
  file: null,
  sourceURL: null,
  outputURL: null,
  duration: 0,
  busy: false,
  engine: null,
  operation: 0,
  outputDuration: 0,
  outputFormat: null,
  progress: 0,
  logs: [],
  wakeLock: null,
  trace: null,
  startedAt: 0,
};
const MB = 1024 * 1024;
const maxSize =
  (navigator.deviceMemory && navigator.deviceMemory <= 2 ? 150 : 300) * MB;
let installPrompt = null;

// No media names, arbitrary instructions, source tags or raw FFmpeg logs.
// Keep the last known stage visible while an async operation is pending.
function quickReport(status, details = {}) {
  exportDiagnostics("Quick Edit", status, {
    expectedDuration: state.outputDuration || undefined,
    ...details,
    pipeline: state.trace
      ? {
          ...state.trace,
          elapsedMs: state.startedAt
            ? Math.round(performance.now() - state.startedAt)
            : 0,
          progressPercent: state.progress,
        }
      : undefined,
  });
}
function quickStage(stage, detail) {
  state.trace.stage = stage;
  state.trace.events.push({
    stage,
    elapsedMs: Math.round(performance.now() - state.startedAt),
  });
  $("progress-detail").textContent = detail;
  quickReport("In progress");
}
function sourceSummary(metadata) {
  return {
    containerDuration: metadata.format?.duration,
    tracks: metadata.streams?.map(
      ({
        codec_type,
        codec_name,
        duration,
        start_time,
        width,
        height,
        avg_frame_rate,
        sample_rate,
        channels,
      }) => ({
        codec_type,
        codec_name,
        duration,
        start_time,
        width,
        height,
        avg_frame_rate,
        sample_rate,
        channels,
      }),
    ),
  };
}
function notice(message) {
  $("app-notice").textContent = message;
  $("app-notice").hidden = !message;
}
function showErrors(messages) {
  const box = $("instruction-errors");
  box.replaceChildren();
  box.hidden = messages.length === 0;
  if (messages.length) {
    const list = document.createElement("ul");
    messages.forEach((message) => {
      const li = document.createElement("li");
      li.textContent = message;
      list.append(li);
    });
    box.append(list);
  }
}
function seconds(value) {
  if (!Number.isFinite(value)) return "00:00";
  const total = Math.max(0, Math.floor(value));
  return `${Math.floor(total / 60)
    .toString()
    .padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}
function clearOutput() {
  if (state.outputURL) URL.revokeObjectURL(state.outputURL);
  state.outputURL = null;
  state.outputFormat = null;
  $("edited-tab").disabled = true;
  $("download-button").removeAttribute("href");
  $("download-button").removeAttribute("download");
  $("download-button").classList.add("disabled");
  $("download-button").setAttribute("aria-disabled", "true");
  $("export-note").textContent = "Your next great video is one cut away.";
}
function invalidateOutput() {
  if (state.outputURL) {
    showPreview(false);
    clearOutput();
  }
}
function renderPlan() {
  const plan = parseInstructions($("instructions").value);
  $("character-count").textContent = `${$("instructions").value.length} / 2000`;
  const errors = [...plan.errors];
  if ($("export-format").value === "mp3") {
    if (plan.aspect || plan.grayscale || plan.brighten)
      errors.push(
        "MP3 is audio only. Remove visual edits, or choose MP4 video.",
      );
    if (plan.volume === 0)
      errors.push(
        "Muted audio has nothing to export. Remove “mute” or choose MP4.",
      );
  }
  showErrors(errors);
  $("edit-count").textContent = plan.edits.length
    ? `${plan.edits.length} EDIT${plan.edits.length === 1 ? "" : "S"} PLANNED`
    : "NO EDITS YET";
  const list = document.createElement("ul");
  plan.edits.forEach((edit) => {
    const li = document.createElement("li");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-check");
    icon.append(use);
    li.append(icon, document.createTextNode(edit.label));
    list.append(li);
  });
  if (plan.edits.length) $("edit-plan").replaceChildren(list);
  else
    $("edit-plan").innerHTML =
      '<div class="empty-plan"><span class="plan-line"></span><p>Your instructions become a plan.<br><span>Add an edit to see what’s changing.</span></p></div>';
  $("process-button").disabled = state.busy || !state.file || errors.length > 0;
  return plan;
}
function setBusy(busy) {
  state.busy = busy;
  if (busy) $("preview-video").pause();
  [
    "video-input",
    "dropzone",
    "replace-button",
    "instructions",
    "export-format",
    "quick-save",
    "quick-load",
    "quick-forget",
  ].forEach((id) => ($(id).disabled = busy));
  document
    .querySelectorAll("[data-command], #command-list button")
    .forEach((button) => (button.disabled = busy));
  $("process-button").querySelector("span").textContent = busy
    ? "Making your cut…"
    : "Make the cut";
  $("progress-region").hidden = !busy;
  $("original-tab").disabled = busy || !state.file;
  $("edited-tab").disabled = busy || !state.outputURL;
  renderPlan();
}
function updateProgress(value, status) {
  state.progress = Math.max(state.progress, Math.min(99, value));
  $("progress").value = state.progress;
  if (status) $("progress-status").textContent = status;
}
function showPreview(edited) {
  const video = $("preview-video");
  video.pause();
  if (edited && !state.outputURL) return;
  const url = edited ? state.outputURL : state.sourceURL;
  if (!url) return;
  if (video.getAttribute("src") !== url) {
    video.src = url;
    video.load();
  }
  video.hidden = false;
  $("empty-preview").hidden = true;
  $("original-tab").classList.toggle("selected", !edited);
  $("edited-tab").classList.toggle("selected", edited);
  $("original-tab").setAttribute("aria-pressed", String(!edited));
  $("edited-tab").setAttribute("aria-pressed", String(edited));
  $("preview-status").textContent = edited
    ? state.outputFormat === "mp3"
      ? "Edited audio · ready to export"
      : "Edited video · ready to export"
    : "Original video";
  $("preview-dot").classList.add("ready");
}
async function selectFile(file, restoring = false) {
  if (!file || (state.busy && !restoring)) return;
  notice("");
  showErrors([]);
  state.trace = {
    stage: "import",
    source: {
      bytes: file.size,
      mime: /^video\/[a-z0-9.+-]+$/i.test(file.type) ? file.type : "unknown",
    },
    events: [],
  };
  state.startedAt = 0;
  state.outputDuration = 0;
  state.progress = 0;
  quickReport("File selected");
  if (!file.size) {
    quickReport("Import rejected", { error: "Empty file" });
    notice("This file is empty. Choose a video with content.");
    return;
  }
  if (
    !(
      file.type.startsWith("video/") ||
      /\.(mp4|mov|m4v|mkv|avi|webm|3gp|mpeg|mpg|mts|m2ts)$/i.test(file.name)
    )
  ) {
    quickReport("Import rejected", { error: "Unsupported file type" });
    notice("Choose a video file, such as MP4, MOV, or WebM.");
    return;
  }
  if (file.size > maxSize) {
    quickReport("Import rejected", {
      error: "Source exceeds device size budget",
    });
    notice(
      `This file is too large for safe browser editing (${Math.round(file.size / MB)} MB). Choose a clip under ${maxSize / MB} MB. Shorter clips work best on phones.`,
    );
    return;
  }
  quickDirty();
  clearOutput();
  const video = $("preview-video");
  video.pause();
  video.removeAttribute("src");
  video.load();
  if (state.sourceURL) URL.revokeObjectURL(state.sourceURL);
  state.file = file;
  state.duration = 0;
  state.sourceURL = URL.createObjectURL(file);
  $("dropzone").hidden = true;
  $("source-file").hidden = false;
  $("file-name").textContent = file.name;
  $("file-meta").textContent =
    `${(file.size / MB).toFixed(1)} MB · Reading video…`;
  $("file-warning").hidden = file.size < 75 * MB;
  $("file-warning").textContent =
    "Large videos use several times their file size in memory. Close other tabs, keep AutoCut open, and try a shorter clip if processing fails.";
  showPreview(false);
  renderPlan();
}
function quickDirty() {
  $("quick-project-status").textContent =
    "Current edits are not autosaved. Save project locally before closing.";
}
async function quickProject(action) {
  if (state.busy) return;
  if (action === "save" && !state.file) {
    notice("Import a video before saving a project.");
    return;
  }
  const operation = ++state.operation;
  setBusy(true);
  $("cancel-button").disabled = true;
  $("progress-status").textContent =
    `${action === "load" ? "Restoring" : action === "save" ? "Saving" : "Removing"} local project…`;
  $("progress-detail").textContent =
    "Browser storage only. No media is uploaded.";
  try {
    const saved = await projectStore(
      action,
      "quick",
      action === "save"
        ? {
            file: state.file,
            name: state.file.name,
            instructions: $("instructions").value,
            format: $("export-format").value,
          }
        : undefined,
    );
    if (operation !== state.operation) return;
    if (action === "load") {
      if (!saved)
        throw new Error(
          "No Quick Edit project has been saved on this browser origin yet.",
        );
      if (
        saved.version !== 1 ||
        !(saved.file instanceof Blob) ||
        !saved.file.size ||
        saved.file.size > maxSize ||
        typeof saved.instructions !== "string" ||
        saved.instructions.length > 2000 ||
        !["mp4", "mp3"].includes(saved.format) ||
        typeof saved.name !== "string" ||
        !(
          saved.file.type.startsWith("video/") ||
          /\.(mp4|mov|m4v|mkv|avi|webm|3gp|mpeg|mpg|mts|m2ts)$/i.test(
            saved.name,
          )
        )
      )
        throw new Error(
          "The saved Quick Edit project is invalid or exceeds this device's limits. Current work was not replaced.",
        );
      await selectFile(
        new File([saved.file], saved.name || "restored.mp4", {
          type: saved.file.type,
        }),
        true,
      );
      $("instructions").value = saved.instructions;
      $("export-format").value = saved.format;
      $("export-format").dispatchEvent(new Event("change"));
      renderPlan();
    }
    $("quick-project-status").textContent =
      action === "delete"
        ? "Saved Quick Edit snapshot removed. Current work and original files are unchanged."
        : `${action === "load" ? "Restored" : "Saved"} Quick Edit project locally. Later changes require Save again; exports are not saved.`;
  } catch (error) {
    $("quick-project-status").textContent =
      error.message || "Local project storage failed.";
  } finally {
    if (operation === state.operation) {
      $("cancel-button").disabled = false;
      setBusy(false);
    }
  }
}
$("quick-save").addEventListener("click", () => quickProject("save"));
$("quick-load").addEventListener("click", () => quickProject("load"));
$("quick-forget").addEventListener("click", () => quickProject("delete"));
$("video-input").addEventListener("change", (event) => {
  selectFile(event.target.files[0]);
  event.target.value = "";
});
$("dropzone").addEventListener("click", () => $("video-input").click());
$("replace-button").addEventListener("click", () => $("video-input").click());
for (const event of ["dragenter", "dragover"])
  $("dropzone").addEventListener(event, (e) => {
    e.preventDefault();
    if (!state.busy) $("dropzone").classList.add("dragging");
  });
for (const event of ["dragleave", "drop"])
  $("dropzone").addEventListener(event, (e) => {
    e.preventDefault();
    $("dropzone").classList.remove("dragging");
  });
$("dropzone").addEventListener("drop", (e) =>
  selectFile(e.dataTransfer.files[0]),
);
$("preview-video").addEventListener("loadedmetadata", () => {
  const video = $("preview-video");
  if ($("original-tab").getAttribute("aria-pressed") === "true" && state.file) {
    state.duration = video.duration;
    if (state.trace)
      state.trace.source.native = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      };
    if (!state.busy && state.trace?.stage === "import")
      quickReport("Source preview metadata ready");
    $("file-meta").textContent =
      `${(state.file.size / MB).toFixed(1)} MB · ${seconds(video.duration)} · ${video.videoWidth} × ${video.videoHeight}`;
    if (video.videoWidth * video.videoHeight > 1920 * 1080) {
      $("file-warning").hidden = false;
      $("file-warning").textContent =
        "High-resolution footage needs extra memory. MP4 exports are limited to a 1280px long edge for phone-friendly processing.";
    }
  }
  $("preview-duration").textContent = `00:00 / ${seconds(video.duration)}`;
});
$("preview-video").addEventListener("timeupdate", () => {
  const v = $("preview-video");
  $("preview-duration").textContent =
    `${seconds(v.currentTime)} / ${seconds(v.duration)}`;
});
$("preview-video").addEventListener("error", () => {
  if (!state.file || !$("preview-video").getAttribute("src")) return;
  if (!state.busy)
    quickReport("Browser preview unavailable", {
      error: "Native media error; FFmpeg conversion may still work",
    });
  $("preview-status").textContent = "Browser cannot preview this codec";
  $("file-meta").textContent =
    `${(state.file.size / MB).toFixed(1)} MB · Preview unavailable`;
  notice(
    "Chrome cannot preview this file. You can still try processing it into MP4. If conversion fails, choose an H.264 MP4 source.",
  );
});
$("original-tab").addEventListener("click", () => showPreview(false));
$("edited-tab").addEventListener("click", () => showPreview(true));
$("instructions").addEventListener("input", () => {
  quickDirty();
  invalidateOutput();
  renderPlan();
});
function appendCommand(command) {
  if (state.busy) return;
  quickDirty();
  const current = $("instructions")
    .value.trim()
    .replace(/[,;.]+$/, "");
  const next = `${current}${current ? ", " : ""}${command}`;
  if (next.length > 2000) {
    notice(
      "Your instructions are at the 2,000 character limit. Remove an instruction before adding another.",
    );
    return;
  }
  $("instructions").value = next;
  invalidateOutput();
  renderPlan();
}
$("suggestions").addEventListener("click", (event) => {
  const button = event.target.closest("[data-command]");
  if (button) appendCommand(button.dataset.command);
});
$("export-format").addEventListener("change", () => {
  quickDirty();
  invalidateOutput();
  const audio = $("export-format").value === "mp3";
  $("format-detail").textContent = audio
    ? "MP3 · 192 kbps"
    : "H.264 · AAC audio";
  $("download-button").querySelector("span").textContent = audio
    ? "Export your audio"
    : "Export your video";
  $("download-button").querySelector(".export-extension").textContent = audio
    ? ".mp3"
    : ".mp4";
  renderPlan();
});

async function loadEngine(operation) {
  if (state.engine?.loaded) return state.engine;
  const engine = createMediaEngine();
  state.engine = engine;
  state.logs = [];
  engine.on("log", ({ message }) => {
    if (operation !== state.operation || !state.busy) return;
    state.logs.push(message);
    if (state.logs.length > 50) state.logs.shift();
    const match = message.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match && state.outputDuration && state.trace?.stage === "encode") {
      const elapsed = +match[1] * 3600 + +match[2] * 60 + +match[3];
      const amount = Math.min(98, 12 + (elapsed / state.outputDuration) * 85);
      updateProgress(amount, `Applying your edits · ${Math.floor(amount)}%`);
      quickReport("Encoding");
    }
  });
  // Loading is indeterminate: do not display an invented download percentage.
  $("progress").removeAttribute("value");
  $("progress-status").textContent = "Loading the editing engine…";
  quickStage(
    "load-engine",
    "First use downloads ~31 MB. Keep this tab open. Later visits can use the offline cache. Startup deadline: 2 minutes; Cancel remains available.",
  );
  $("engine-status").textContent = "Downloading & starting FFmpeg…";
  try {
    await engine.load();
  } catch (error) {
    if (error instanceof MediaError) throw error;
    if (operation === state.operation)
      throw new MediaError(
        `The editing engine could not start. Check your connection and that the local worker, core and WASM files are present, reload, and retry in Android Chrome. ${mediaErrorMessage(error)}`,
      );
    throw error;
  }
  $("engine-status").textContent =
    "FFmpeg ready · private, on-device processing";
  $("engine-dot").classList.add("ready");
  return engine;
}
function friendlyError(error) {
  return mediaErrorMessage(error, state.logs);
}
$("process-button").addEventListener("click", async () => {
  if (state.busy || !state.file) return;
  const plan = renderPlan();
  if (plan.errors.length || $("process-button").disabled) return;
  if (!plan.edits.length && !$("instructions").value.trim())
    notice(
      "No edits requested. AutoCut will convert your source to the selected export format.",
    );
  else notice("");
  invalidateOutput();
  $("preview-video").pause();
  const operation = ++state.operation;
  const format = $("export-format").value;
  // Do not put an extensionless source basename into commands/diagnostics.
  // FFmpeg detects content for other MIME-valid videos using the .bin fallback.
  const extension =
    state.file.name
      .match(/\.(mp4|mov|m4v|mkv|avi|webm|3gp|mpeg|mpg|mts|m2ts)$/i)?.[1]
      .toLowerCase() || "bin";
  const inputName = `input.${extension}`;
  let engine;
  let success = false;
  let failureMessage = "";
  state.progress = 0;
  state.outputDuration = 0;
  state.startedAt = performance.now();
  state.trace = {
    stage: "parse",
    events: [],
    format,
    source: {
      bytes: state.file.size,
      mime: /^video\/[a-z0-9.+-]+$/i.test(state.file.type)
        ? state.file.type
        : "unknown",
    },
    plan: Object.fromEntries(
      [
        "trimStart",
        "trimEnd",
        "aspect",
        "speed",
        "volume",
        "grayscale",
        "brighten",
        "fadeIn",
        "fadeOut",
      ].map((key) => [key, plan[key]]),
    ),
  };
  setBusy(true);
  quickReport("Starting local export");
  try {
    keepScreenAwake(
      () => operation === state.operation && state.busy,
      (lock) => {
        state.wakeLock = lock;
      },
    );
    if (operation !== state.operation) return;
    engine = await loadEngine(operation);
    if (operation !== state.operation) return;
    $("progress").value = 3;
    $("progress-status").textContent = "Reading your video…";
    quickStage(
      "read-source",
      "Copying the selected file into the local worker. Keep Chrome in the foreground; Cancel remains available.",
    );
    state.logs = [];
    await engine.writeFile(
      inputName,
      new Uint8Array(await state.file.arrayBuffer()),
    );
    quickStage(
      "probe-source",
      "Reading source tracks and timing with FFprobe. Worker-operation deadline: 15 minutes.",
    );
    const probeCode = await engine.ffprobe([
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,codec_name,duration,duration_ts,time_base,width,height,avg_frame_rate,start_time,sample_rate,channels",
      "-of",
      "json",
      inputName,
      "-o",
      "probe.json",
    ]);
    state.trace.probeExitCode = probeCode;
    // Core 0.12.10 ffprobe can return -1 on success; validate its JSON output too.
    if (probeCode !== 0 && probeCode !== -1)
      throw new Error(
        "The file could not be read. Try a standard H.264 MP4 video.",
      );
    let metadata;
    try {
      metadata = JSON.parse(await engine.readFile("probe.json", "utf8"));
    } catch {
      throw new Error(
        "This file could not be read. Try a standard H.264 MP4 video.",
      );
    }
    state.trace.source = { ...state.trace.source, ...sourceSummary(metadata) };
    const duration = quickSourceDuration(metadata, state.duration);
    state.trace.source.selectedVideoDuration = duration;
    quickStage(
      "build-command",
      "Building the supported edit from the first video track's timeline.",
    );
    if (
      format === "mp3" &&
      !metadata.streams.some((s) => s.codec_type === "audio")
    )
      throw new Error(
        "This video has no audio track. Choose MP4 or select a video with audio.",
      );
    const command = buildCommand(plan, duration, format, inputName);
    state.outputDuration = command.outputDuration;
    state.trace.command = command.args;
    quickStage(
      "encode",
      "Encoding on this device. Progress uses actual FFmpeg timestamps, not a predicted clock. Each worker operation is limited to 15 minutes.",
    );
    updateProgress(12, "Applying your edits…");
    const result = await engine.exec(command.args);
    state.trace.encodeExitCode = result;
    if (result !== 0)
      throw new Error(
        "Processing failed. Try a shorter H.264 MP4 video, or close other tabs to free memory.",
      );
    await engine.deleteFile(inputName);
    await engine.deleteFile("probe.json");
    updateProgress(99, "Verifying the generated file…");
    quickStage(
      "probe-output",
      "Inspecting generated duration, codecs and dimensions before allowing a download.",
    );
    const actual = await probeMedia(engine, `output.${format}`);
    state.trace.output = sourceSummary(actual);
    verifyQuickOutput(
      actual,
      command.outputDuration,
      format,
      plan.volume !== 0 &&
        metadata.streams.some((stream) => stream.codec_type === "audio"),
    );
    quickStage(
      "decode-output",
      "Decoding the entire output to check integrity. This is a separate pass, not a frozen encoding percentage.",
    );
    await verifyMediaDecode(engine, `output.${format}`);
    quickStage(
      "read-output",
      "Preparing the verified file for local preview and download.",
    );
    const data = await engine.readFile(`output.${format}`);
    if (!data.byteLength)
      throw new Error(
        "The result was empty. Try a different source video or shorter trim.",
      );
    if (operation !== state.operation) return;
    const blob = new Blob([data], {
      type: format === "mp4" ? "video/mp4" : "audio/mpeg",
    });
    state.outputURL = URL.createObjectURL(blob);
    state.outputFormat = format;
    $("edited-tab").disabled = false;
    const download = $("download-button");
    download.href = state.outputURL;
    download.download = exportFileName(
      `${state.file.name.replace(/\.[^.]+$/, "")}-autocut`,
      command.outputDuration,
      format,
    );
    download.classList.remove("disabled");
    download.setAttribute("aria-disabled", "false");
    $("export-note").textContent =
      `Ready · ${(blob.size / MB).toFixed(1)} MB · ${seconds(command.outputDuration)} · No watermark`;
    showPreview(true);
    success = true;
    state.trace.stage = "ready";
    quickReport("Verified and ready", {
      expectedDuration: command.outputDuration,
      metadata: actual,
    });
    notice(
      "Your cut is ready. Preview it, then tap Export to save it to your device.",
    );
  } catch (error) {
    if (operation === state.operation) {
      failureMessage = friendlyError(error);
      // Expose the exact pending phase without private FFmpeg metadata/logs.
      state.trace.errorHints = [
        [
          /out of memory|memory access out of bounds|cannot allocate|allocation failed/i,
          "allocation-or-memory",
        ],
        [/decoder.*not found|unknown decoder/i, "decoder-unavailable"],
        [/error while decoding|invalid data|moov atom/i, "media-decode"],
        [/error initializing|error opening encoder/i, "encoder-initialization"],
      ]
        .filter(([pattern]) => state.logs.some((line) => pattern.test(line)))
        .map(([, hint]) => hint);
      quickReport("Export failed", {
        expectedDuration: state.outputDuration,
        error: failureMessage,
      });
      notice("Your original video has not been changed.");
    }
  } finally {
    // Release the entire WASM heap after each job; keeping it alive can exhaust a phone.
    if (engine) engine.terminate();
    if (operation === state.operation) {
      state.engine?.terminate();
      state.engine = null;
      if (state.wakeLock) {
        state.wakeLock.release().catch(() => {});
        state.wakeLock = null;
      }
      setBusy(false);
      if (!success && failureMessage) showErrors([failureMessage]);
      $("engine-status").textContent =
        "Engine released to save memory · ready for your next cut";
      $("engine-dot").classList.remove("ready");
    }
  }
});
$("cancel-button").addEventListener("click", () => {
  ++state.operation;
  state.engine?.terminate();
  state.engine = null;
  state.wakeLock?.release().catch(() => {});
  state.wakeLock = null;
  setBusy(false);
  quickReport("Cancelled; worker released");
  $("engine-status").textContent = "Cancelled · ready when you are";
  $("engine-dot").classList.remove("ready");
  notice("Editing cancelled. Your original video is unchanged.");
});
$("download-button").addEventListener("click", (event) => {
  if (!state.outputURL) event.preventDefault();
  else
    notice(
      `Download started: ${$("download-button").download}. Find this NEW file in Chrome → ⋮ → Downloads; older exports may still be there.`,
    );
});
window.addEventListener("beforeunload", (event) => {
  if (state.busy) {
    event.preventDefault();
    event.returnValue = "";
  }
});

function openGuide() {
  if (!$("guide-dialog").open) $("guide-dialog").showModal();
}
["guide-open", "help-button", "commands-open"].forEach((id) =>
  $(id).addEventListener("click", openGuide),
);
$("guide-close").addEventListener("click", () => $("guide-dialog").close());
$("guide-dialog").addEventListener("click", (event) => {
  if (event.target === $("guide-dialog")) {
    const r = $("guide-dialog").getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      $("guide-dialog").close();
  }
});
EXAMPLES.forEach((command) => {
  const button = document.createElement("button");
  button.textContent = command;
  button.addEventListener("click", () => {
    appendCommand(command);
    $("guide-dialog").close();
    $("instructions").focus();
  });
  $("command-list").append(button);
});
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
});
$("install-button").addEventListener("click", async () => {
  if (window.matchMedia("(display-mode: standalone)").matches) {
    notice("AutoCut is already open as an installed app.");
    return;
  }
  if (installPrompt) {
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
  } else {
    openGuide();
    $("guide-dialog").scrollTo({
      top: $("guide-dialog").scrollHeight,
      behavior: "smooth",
    });
  }
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  notice("AutoCut is installed. Find it on your home screen.");
});
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register(new URL("./service-worker.js", import.meta.url))
    .then((registration) => {
      const updateNotice = () => {
        if (registration.waiting)
          $("app-build").textContent =
            "An AutoCut update is ready. Save projects, close ALL AutoCut tabs, then reopen to activate it.";
      };
      updateNotice();
      registration.addEventListener("updatefound", () =>
        registration.installing?.addEventListener("statechange", updateNotice),
      );
    })
    .catch(() =>
      notice(
        "Offline caching is unavailable in this browser session. You can still edit while online.",
      ),
    );
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "ENGINE_CACHED")
      $("engine-status").textContent = state.busy
        ? $("engine-status").textContent
        : "Editing engine cached · available offline";
  });
}
renderPlan();
