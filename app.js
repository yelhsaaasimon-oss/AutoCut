import { FFmpeg } from "./vendor/ffmpeg/index.js";
import { EXAMPLES, parseInstructions, buildCommand } from "./editor.js";

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
};
const MB = 1024 * 1024;
const maxSize =
  (navigator.deviceMemory && navigator.deviceMemory <= 2 ? 150 : 300) * MB;
let installPrompt = null;

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
  [
    "video-input",
    "dropzone",
    "replace-button",
    "instructions",
    "export-format",
  ].forEach((id) => ($(id).disabled = busy));
  document
    .querySelectorAll("[data-command], #command-list button")
    .forEach((button) => (button.disabled = busy));
  $("process-button").querySelector("span").textContent = busy
    ? "Making your cut…"
    : "Make the cut";
  $("progress-region").hidden = !busy;
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
async function selectFile(file) {
  if (!file || state.busy) return;
  notice("");
  showErrors([]);
  if (!file.size) {
    notice("This file is empty. Choose a video with content.");
    return;
  }
  if (
    !(
      file.type.startsWith("video/") ||
      /\.(mp4|mov|m4v|mkv|avi|webm|3gp|mpeg|mpg|mts|m2ts)$/i.test(file.name)
    )
  ) {
    notice("Choose a video file, such as MP4, MOV, or WebM.");
    return;
  }
  if (file.size > maxSize) {
    notice(
      `This file is too large for safe browser editing (${Math.round(file.size / MB)} MB). Choose a clip under ${maxSize / MB} MB. Shorter clips work best on phones.`,
    );
    return;
  }
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
  invalidateOutput();
  renderPlan();
});
function appendCommand(command) {
  if (state.busy) return;
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
  const engine = new FFmpeg();
  state.engine = engine;
  state.logs = [];
  engine.on("log", ({ message }) => {
    if (operation !== state.operation || !state.busy) return;
    state.logs.push(message);
    if (state.logs.length > 50) state.logs.shift();
    const match = message.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match && state.outputDuration) {
      const elapsed = +match[1] * 3600 + +match[2] * 60 + +match[3];
      const amount = Math.min(98, 12 + (elapsed / state.outputDuration) * 85);
      updateProgress(amount, `Applying your edits · ${Math.floor(amount)}%`);
    }
  });
  // Loading is indeterminate: do not display an invented download percentage.
  $("progress").removeAttribute("value");
  $("progress-status").textContent = "Loading the editing engine…";
  $("progress-detail").textContent =
    "First use downloads ~31 MB. Keep this tab open. Later visits can use the offline cache.";
  $("engine-status").textContent = "Downloading & starting FFmpeg…";
  const timer = setTimeout(() => {
    if (operation === state.operation && !engine.loaded) engine.terminate();
  }, 120000);
  try {
    await engine.load({
      coreURL: new URL("./vendor/core/ffmpeg-core.js", import.meta.url).href,
      wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", import.meta.url).href,
    });
  } catch (error) {
    if (operation === state.operation)
      throw new Error(
        "The editing engine could not start. Check your connection, reload AutoCut, and try a short clip in an updated Android Chrome.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
  $("engine-status").textContent =
    "FFmpeg ready · private, on-device processing";
  $("engine-dot").classList.add("ready");
  return engine;
}
function friendlyError(error) {
  const detail = `${error} ${state.logs.join(" ")}`;
  if (
    /memory|allocation|out of bounds|unreachable|Aborted|FS error/i.test(detail)
  )
    return "Your device ran out of editing memory, or this file could not be decoded. Close other tabs and try a shorter, lower-resolution MP4. Your original video is safe.";
  if (/matches no streams|does not contain any stream/i.test(detail))
    return "This file has no usable audio or video track for the selected export. For MP3, choose a video with audio. For silent footage, choose MP4.";
  if (
    /Invalid data|Decoder.*not found|Error while decoding|moov atom/i.test(
      detail,
    )
  )
    return "This format or codec could not be decoded. Try an H.264 MP4 video that plays correctly on your phone.";
  return error instanceof Error
    ? error.message
    : "Processing failed. Try a shorter H.264 MP4 clip and check that your phone has free memory.";
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
  const extension =
    state.file.name
      .split(".")
      .pop()
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 8) || "bin";
  const inputName = `input.${extension}`;
  let engine;
  let success = false;
  let failureMessage = "";
  state.progress = 0;
  state.outputDuration = 0;
  setBusy(true);
  try {
    try {
      if ("wakeLock" in navigator)
        state.wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      /* Optional enhancement. */
    }
    if (operation !== state.operation) return;
    engine = await loadEngine(operation);
    if (operation !== state.operation) return;
    $("progress").value = 3;
    $("progress-status").textContent = "Reading your video…";
    $("progress-detail").textContent =
      "Keep this tab open and your phone unlocked. Processing can take longer than the video itself.";
    state.logs = [];
    await engine.writeFile(
      inputName,
      new Uint8Array(await state.file.arrayBuffer()),
    );
    const probeCode = await engine.ffprobe([
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,duration",
      "-of",
      "json",
      inputName,
      "-o",
      "probe.json",
    ]);
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
    const duration = Number(
      metadata.format?.duration ||
        metadata.streams?.find((s) => Number(s.duration) > 0)?.duration ||
        state.duration,
    );
    if (!metadata.streams?.some((s) => s.codec_type === "video"))
      throw new Error(
        "Choose a file with a video track. AutoCut edits existing videos.",
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
    updateProgress(12, "Applying your edits…");
    const result = await engine.exec(command.args);
    if (result !== 0)
      throw new Error(
        "Processing failed. Try a shorter H.264 MP4 video, or close other tabs to free memory.",
      );
    updateProgress(99, "Preparing your download…");
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
    download.download = `${state.file.name.replace(/\.[^.]+$/, "")}-autocut.${format}`;
    download.classList.remove("disabled");
    download.setAttribute("aria-disabled", "false");
    $("export-note").textContent =
      `Ready · ${(blob.size / MB).toFixed(1)} MB · ${seconds(command.outputDuration)} · No watermark`;
    showPreview(true);
    success = true;
    notice(
      "Your cut is ready. Preview it, then tap Export to save it to your device.",
    );
  } catch (error) {
    if (operation === state.operation) {
      failureMessage = friendlyError(error);
      notice("Your original video has not been changed.");
    }
  } finally {
    // Release the entire WASM heap after each job; keeping it alive can exhaust a phone.
    if (engine) engine.terminate();
    if (operation === state.operation) {
      state.engine?.terminate();
      state.engine = null;
      if (state.wakeLock) {
        await state.wakeLock.release().catch(() => {});
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
  $("engine-status").textContent = "Cancelled · ready when you are";
  $("engine-dot").classList.remove("ready");
  notice("Editing cancelled. Your original video is unchanged.");
});
$("download-button").addEventListener("click", (event) => {
  if (!state.outputURL) event.preventDefault();
  else
    notice(
      "Download started. On Android, find your file in Chrome → ⋮ → Downloads. Save it before leaving this page.",
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
