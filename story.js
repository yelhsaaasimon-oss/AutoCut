import {
  FPS,
  LIMITS,
  createProject,
  assetFor,
  durationFrames,
  totalFrames,
  sceneStart,
  locateTime,
  importAsset,
  addScene,
  selectScene,
  removeScene,
  moveScene,
  updateScene,
  removeAsset,
  arrangeScenes,
  setProjectFormat,
  validateProject,
  FORMATS,
} from "./story-model.js";
import { projectStore, storySnapshot } from "./project-store.js";
import { readAsset } from "./story-media.js";
import {
  preparePreviewVideo,
  previewPlay,
  waitForPreview,
} from "./story-preview.js";
import { exportStory } from "./story-export.js";
import {
  exportDiagnostics,
  keepScreenAwake,
  exportFileName,
} from "./media-engine.js";

const $ = (id) => document.getElementById(id);
const project = createProject();
const byteLimit =
  navigator.deviceMemory && navigator.deviceMemory <= 2
    ? LIMITS.bytes / 2
    : LIMITS.bytes;
const state = {
  mode: "quick",
  importing: false,
  storing: false,
  importAbort: null,
  restoreAbort: null,
  exporting: false,
  playing: false,
  time: 0,
  previewToken: 0,
  previewAbort: null,
  raf: 0,
  epoch: 0,
  epochTime: 0,
  outputURL: null,
  abort: null,
  scale: 48,
  wakeLock: null,
};
const video = $("story-video");
const image = $("story-image");
const seconds = (frames) => (frames / FPS).toFixed(2);
const busy = () => state.importing || state.exporting || state.storing;
function message(text, error = false) {
  $("story-message").textContent = text;
  $("story-message").hidden = !text;
  $("story-message").classList.toggle("error", error);
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, action, disabled = false, className = "") {
  const node = el("button", className, text);
  node.type = "button";
  node.disabled = busy() || disabled;
  node.addEventListener("click", action);
  return node;
}
function thumb(asset) {
  const img = el("img");
  img.src = asset.thumbnail;
  img.alt = "";
  return img;
}
function invalidateOutput() {
  const result = $("story-result-video");
  result.pause();
  result.removeAttribute("src");
  result.load();
  if (state.outputURL) URL.revokeObjectURL(state.outputURL);
  state.outputURL = null;
  $("story-result").hidden = true;
  $("story-download").removeAttribute("href");
  $("story-download").removeAttribute("download");
}
function modeButtons() {
  const quickBusy = !$("progress-region").hidden;
  $("quick-mode").disabled = busy() || quickBusy;
  $("story-mode").disabled = busy() || quickBusy;
}
new MutationObserver(modeButtons).observe($("progress-region"), {
  attributes: true,
  attributeFilter: ["hidden"],
});
function setMode(mode) {
  if (busy() || !$("progress-region").hidden) return;
  pausePreview();
  $("preview-video").pause();
  $("story-result-video").pause();
  state.mode = mode;
  $("quick-editor").hidden = mode !== "quick";
  $("story-editor").hidden = mode !== "story";
  $("quick-mode").setAttribute("aria-pressed", String(mode === "quick"));
  $("story-mode").setAttribute("aria-pressed", String(mode === "story"));
  if (mode === "story") {
    render();
    if (project.scenes.length) seek(state.time);
  }
}
$("quick-mode").addEventListener("click", () => setMode("quick"));
$("story-mode").addEventListener("click", () => setMode("story"));
$("story-byte-limit").textContent = `${byteLimit / 1024 / 1024} MiB`;
function renderAssets() {
  const area = $("story-assets");
  area.replaceChildren();
  if (!project.assets.length)
    area.append(
      el(
        "p",
        "story-empty",
        "Your footage, maps and illustrations live here. Each import also adds a scene.",
      ),
    );
  for (const asset of project.assets) {
    const row = el("div", "story-asset");
    row.dataset.assetId = asset.id;
    const body = el("div", "story-asset-body");
    body.append(
      el("strong", "", asset.name),
      el(
        "small",
        "",
        `${asset.kind === "image" ? "IMAGE" : `${seconds(asset.frames)}s VIDEO`} · ${(asset.size / 1024 / 1024).toFixed(1)} MiB`,
      ),
    );
    const actions = el("div", "story-asset-actions");
    const used = project.scenes.some((scene) => scene.assetId === asset.id);
    const add = button(used ? "Add another scene" : "Add scene", () =>
      mutate(() => addScene(project, asset.id)),
    );
    add.title =
      "Import already adds one scene. This adds a separate copy with full source timing.";
    actions.append(add);
    const remove = button(
      "Remove asset",
      () => {
        mutate(() => {
          removeAsset(project, asset.id);
          URL.revokeObjectURL(asset.url);
        });
      },
      used,
    );
    remove.title = used
      ? "Remove this asset’s scenes from the timeline first"
      : "Remove unused source from this project";
    actions.append(remove);
    body.append(actions);
    row.append(thumb(asset), body);
    area.append(row);
  }
  $("story-asset-count").textContent =
    `${project.assets.length} / ${LIMITS.assets} ASSETS`;
}
function chooseScene(id) {
  if (busy()) return;
  selectScene(project, id);
  render();
  seek(sceneStart(project, id));
}
function renderScenes() {
  const list = $("story-scenes");
  list.replaceChildren();
  if (!project.scenes.length)
    list.append(
      el("li", "story-empty", "No scenes yet. Import your first asset above."),
    );
  project.scenes.forEach((scene, index) => {
    const asset = assetFor(project, scene),
      row = el(
        "li",
        `story-scene${scene.id === project.selectedId ? " selected" : ""}`,
      );
    row.dataset.sceneId = scene.id;
    const select = button(
      "",
      () => chooseScene(scene.id),
      false,
      "story-scene-select",
    );
    select.setAttribute(
      "aria-pressed",
      String(scene.id === project.selectedId),
    );
    const label = el("span");
    label.append(
      el("strong", "", `${index + 1}. ${asset.name}`),
      el(
        "small",
        "",
        `${seconds(durationFrames(scene))}s · ${asset.kind === "image" ? "STILL IMAGE" : `SOURCE ${(scene.inFrame / FPS).toFixed(2)}–${(scene.outFrame / FPS).toFixed(2)}s`}`,
      ),
    );
    select.append(thumb(asset), label);
    const actions = el("div", "story-scene-actions");
    const earlier = button(
      "← Earlier",
      () => mutate(() => moveScene(project, scene.id, -1)),
      index === 0,
    );
    earlier.setAttribute("aria-label", `Move scene ${index + 1} earlier`);
    const later = button(
      "Later →",
      () => mutate(() => moveScene(project, scene.id, 1)),
      index === project.scenes.length - 1,
    );
    later.setAttribute("aria-label", `Move scene ${index + 1} later`);
    const remove = button(
      "Remove",
      () => mutate(() => removeScene(project, scene.id)),
      false,
      "story-remove",
    );
    remove.setAttribute("aria-label", `Remove scene ${index + 1}`);
    actions.append(earlier, later, remove);
    row.append(select, actions);
    list.append(row);
  });
}
function renderTimeline() {
  const area = $("story-timeline");
  area.replaceChildren();
  const total = totalFrames(project) / FPS;
  state.scale = Math.max(
    48,
    ($("story-timeline-scroll").clientWidth || 300) / Math.max(1, total),
  );
  area.style.width = total ? `${total * state.scale}px` : "100%";
  if (!project.scenes.length)
    area.append(
      el("div", "story-empty", "Every story starts with a first scene."),
    );
  project.scenes.forEach((scene, index) => {
    const asset = assetFor(project, scene);
    const node = button(
      "",
      (event) => {
        event.stopPropagation();
        chooseScene(scene.id);
      },
      false,
      "story-timeline-scene",
    );
    node.style.width = `${(durationFrames(scene) / FPS) * state.scale}px`;
    node.setAttribute(
      "aria-label",
      `Select scene ${index + 1}: ${asset.name}, ${seconds(durationFrames(scene))} seconds`,
    );
    node.setAttribute("aria-pressed", String(scene.id === project.selectedId));
    node.append(
      thumb(asset),
      el("span", "", `${index + 1} · ${seconds(durationFrames(scene))}s`),
    );
    area.append(node);
  });
  const cursor = el("div", "story-playhead");
  cursor.id = "story-playhead";
  cursor.hidden = !project.scenes.length;
  area.append(cursor);
  $("story-total").textContent =
    `${project.scenes.length} SCENE${project.scenes.length === 1 ? "" : "S"} · ${total.toFixed(2)}s`;
}
function renderInspector() {
  const scene = project.scenes.find((item) => item.id === project.selectedId);
  $("story-timing").hidden = !scene;
  $("story-applied-timing").textContent = scene
    ? `Applied to this scene: ${seconds(durationFrames(scene))}s${assetFor(project, scene).kind === "video" ? ` · source ${seconds(scene.inFrame)}–${seconds(scene.outFrame)}s` : ""}. Preview and export use these applied values.`
    : "";
  if (!scene) {
    $("story-selection").textContent = "Select a scene to adjust its timing.";
    return;
  }
  const asset = assetFor(project, scene),
    imageScene = asset.kind === "image";
  $("story-selection").textContent =
    `Scene ${project.scenes.indexOf(scene) + 1} · ${asset.name}`;
  $("story-video-fields").hidden = imageScene;
  $("story-image-fields").hidden = !imageScene;
  $("story-in").value = (scene.inFrame / FPS).toFixed(3);
  $("story-out").value = (scene.outFrame / FPS).toFixed(3);
  $("story-duration").value = (durationFrames(scene) / FPS).toFixed(3);
  $("story-in").max = asset.duration || 0;
  $("story-out").max = asset.duration || 0;
}
function render() {
  renderAssets();
  renderScenes();
  renderTimeline();
  renderInspector();
  updateClock();
  modeButtons();
  $("story-import").disabled = busy();
  $("story-input").disabled = busy();
  $("story-play").disabled = busy() || !project.scenes.length;
  $("story-scrub").disabled = busy() || !project.scenes.length;
  $("story-export").disabled = busy() || !project.scenes.length;
  for (const id of [
    "story-save",
    "story-load",
    "story-forget",
    "story-format",
    "story-arrange",
  ])
    $(id).disabled = busy();
  $("story-arrange").disabled = busy() || project.scenes.length < 2;
  $("story-import-cancel").hidden = !state.importing && !state.restoreAbort;
  $("story-import-cancel").textContent = state.restoreAbort
    ? "Cancel restore"
    : "Cancel import";
  $("story-format").value = project.format;
  $("story-fit-label").textContent = `${project.format} · FIT, NOT CROP`;
  document.querySelector(".story-stage").style.aspectRatio =
    project.format.replace(":", "/");
  const geometry = FORMATS[project.format];
  $("story-output-size").textContent =
    `${geometry.width} × ${geometry.height} · ${project.format}`;
  $("story-export-summary").textContent =
    `Exports all ${project.scenes.length} scene${project.scenes.length === 1 ? "" : "s"} · ${seconds(totalFrames(project))}s total, not just the selected scene.`;
  for (const node of $("story-timing").querySelectorAll("input,button"))
    node.disabled = busy();
}
function mutate(action) {
  if (busy()) return;
  try {
    action();
    $("story-project-status").textContent =
      "Current edits are not autosaved. Save project locally before closing.";
    pausePreview();
    invalidateOutput();
    message("");
    state.time = Math.min(state.time, totalFrames(project) / FPS);
    render();
    seek(project.selectedId ? sceneStart(project, project.selectedId) : 0);
  } catch (error) {
    message(error.message, true);
  }
}
$("story-format").addEventListener("change", (event) =>
  mutate(() => setProjectFormat(project, event.target.value)),
);
$("story-arrange").addEventListener("click", () =>
  mutate(() => arrangeScenes(project)),
);
$("story-import-cancel").addEventListener("click", () => {
  state.importAbort?.abort();
  state.restoreAbort?.abort();
});
async function storyProject(action) {
  if (busy() || !$("progress-region").hidden) return;
  pausePreview();
  state.storing = true;
  if (action === "load") state.restoreAbort = new AbortController();
  render();
  const created = [];
  try {
    const saved = await projectStore(
      action,
      "story",
      action === "save" ? storySnapshot(project) : undefined,
    );
    if (action === "load") {
      const signal = state.restoreAbort.signal;
      signal.throwIfAborted();
      if (!saved)
        throw new Error(
          "No Story project has been saved on this browser origin yet.",
        );
      if (
        saved.version !== 1 ||
        !Array.isArray(saved.assets) ||
        !Array.isArray(saved.scenes) ||
        saved.assets.length > LIMITS.assets ||
        saved.scenes.length > LIMITS.scenes ||
        !Object.hasOwn(FORMATS, saved.format)
      )
        throw new Error(
          "The saved Story project is invalid. Current work was not replaced.",
        );
      const restored = createProject();
      setProjectFormat(restored, saved.format);
      for (const entry of saved.assets) {
        if (!(entry.file instanceof Blob) || typeof entry.name !== "string")
          throw new Error(
            "A saved source is missing. Current work was not replaced.",
          );
        const asset = await readAsset(
          new File([entry.file], entry.name, { type: entry.file.type }),
          { signal },
        );
        created.push(asset.url);
        const initial = importAsset(restored, asset, byteLimit);
        removeScene(restored, initial.id);
      }
      for (const entry of saved.scenes) {
        if (!Number.isInteger(entry.asset) || !restored.assets[entry.asset])
          throw new Error("A saved scene has no source.");
        addScene(restored, restored.assets[entry.asset].id, entry);
      }
      validateProject(restored, byteLimit);
      signal.throwIfAborted();
      restored.selectedId =
        restored.scenes[saved.selected]?.id || restored.scenes[0]?.id || null;
      invalidateOutput();
      for (const asset of project.assets) URL.revokeObjectURL(asset.url);
      Object.assign(project, restored);
      created.length = 0;
      state.time = project.selectedId
        ? sceneStart(project, project.selectedId)
        : 0;
    }
    $("story-project-status").textContent =
      action === "delete"
        ? "Saved Story snapshot removed. Current work and original files are unchanged."
        : `${action === "load" ? "Restored" : "Saved"} Story project locally. Later changes require Save again; exports are not saved.`;
  } catch (error) {
    $("story-project-status").textContent =
      error.name === "AbortError"
        ? "Restore cancelled. Current project was not replaced."
        : error.message || "Local project storage failed.";
  } finally {
    for (const url of created) URL.revokeObjectURL(url);
    state.storing = false;
    state.restoreAbort = null;
    render();
    if (action === "load") seek(state.time);
  }
}
$("story-save").addEventListener("click", () => storyProject("save"));
$("story-load").addEventListener("click", () => storyProject("load"));
$("story-forget").addEventListener("click", () => storyProject("delete"));
$("story-timing").addEventListener("submit", (event) => {
  event.preventDefault();
  const scene = project.scenes.find((item) => item.id === project.selectedId);
  if (!scene) return;
  const imageScene = assetFor(project, scene).kind === "image";
  mutate(() => {
    if (
      (imageScene && !$("story-duration").value) ||
      (!imageScene && (!$("story-in").value || !$("story-out").value))
    )
      throw new Error("Enter the required scene times in seconds.");
    updateScene(
      project,
      scene.id,
      imageScene ? 0 : Number($("story-in").value),
      Number($(imageScene ? "story-duration" : "story-out").value),
    );
  });
});
$("story-import").addEventListener("click", () => $("story-input").click());
$("story-input").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files);
  event.target.value = "";
  if (busy() || !files.length) return;
  pausePreview();
  state.importing = true;
  state.importAbort = new AbortController();
  render();
  const failures = [];
  let imported = 0;
  try {
    for (const file of files) {
      if (state.importAbort.signal.aborted) break;
      let asset;
      try {
        if (project.assets.length >= LIMITS.assets)
          throw new Error(
            "Asset limit reached (8). Remove unused assets first.",
          );
        if (
          project.assets.reduce((sum, item) => sum + item.size, 0) + file.size >
          byteLimit
        )
          throw new Error(
            `Project exceeds the ${byteLimit / 1024 / 1024} MiB file limit.`,
          );
        message(`Reading ${file.name}…`);
        asset = await readAsset(file, { signal: state.importAbort.signal });
        importAsset(project, asset, byteLimit);
        imported++;
        invalidateOutput();
      } catch (error) {
        if (asset?.url) URL.revokeObjectURL(asset.url);
        if (error.name === "AbortError") break;
        failures.push(`${file.name}: ${error.message}`);
      }
    }
  } finally {
    const cancelled = state.importAbort.signal.aborted;
    state.importAbort = null;
    state.importing = false;
    if (imported)
      $("story-project-status").textContent =
        "Current edits are not autosaved. Save project locally before closing.";
    render();
    message(
      `${cancelled ? "Import cancelled. " : ""}${imported ? `Imported ${imported} asset${imported === 1 ? "" : "s"} and added ${imported} scene${imported === 1 ? "" : "s"}.` : "No files imported."}${failures.length ? "\n" + failures.join("\n") : ""}`,
      failures.length > 0,
    );
    if (imported) seek(sceneStart(project, project.selectedId));
  }
});
function updateClock() {
  const total = totalFrames(project) / FPS;
  $("story-clock").textContent =
    `${state.time.toFixed(2)} / ${total.toFixed(2)}s`;
  $("story-scrub").max = total;
  $("story-scrub").value = state.time;
  $("story-scrub").setAttribute(
    "aria-valuetext",
    `${state.time.toFixed(2)} of ${total.toFixed(2)} seconds`,
  );
  const cursor = $("story-playhead");
  if (cursor)
    cursor.style.left = `${Math.min(state.time, total) * state.scale}px`;
  $("story-play").textContent = state.playing ? "Ⅱ Pause" : "▶ Play";
  $("story-play").setAttribute(
    "aria-label",
    state.playing ? "Pause story" : "Play story",
  );
}
function pausePreview() {
  state.playing = false;
  ++state.previewToken;
  state.previewAbort?.abort();
  state.previewAbort = null;
  cancelAnimationFrame(state.raf);
  video.pause();
  $("story-preview-loading").hidden = true;
  updateClock();
}
async function seek(time, play = false) {
  if (busy()) return;
  const location = locateTime(project, time);
  const token = ++state.previewToken;
  state.previewAbort?.abort();
  const controller = new AbortController();
  state.previewAbort = controller;
  const { signal } = controller;
  cancelAnimationFrame(state.raf);
  video.pause();
  state.playing = false;
  if (!location) {
    $("story-preview-loading").hidden = true;
    state.previewAbort = null;
    video.removeAttribute("src");
    video.load();
    image.removeAttribute("src");
    video.hidden = true;
    image.hidden = true;
    $("story-preview-empty").hidden = false;
    state.time = 0;
    $("story-preview-label").textContent = "Import a scene to begin.";
    updateClock();
    return;
  }
  state.time = Math.min(Math.max(0, time), totalFrames(project) / FPS);
  updateClock();
  const asset = assetFor(project, location.scene);
  $("story-preview-empty").hidden = true;
  $("story-preview-loading").hidden = false;
  const timeout = setTimeout(() => {
    controller.abort(new Error("Preview loading timed out."));
  }, 15000);
  try {
    if (asset.kind === "video") {
      image.hidden = true;
      video.hidden = false;
      await preparePreviewVideo(
        video,
        asset.url,
        location.scene.inFrame / FPS +
          Math.min(location.local, (durationFrames(location.scene) - 1) / FPS),
        signal,
      );
      if (token !== state.previewToken) return;
      if (play) await previewPlay(video, signal);
    } else {
      video.hidden = true;
      image.hidden = false;
      if (image.getAttribute("src") !== asset.url) {
        image.src = asset.url;
      }
      await waitForPreview(
        image,
        () => image.complete && image.naturalWidth > 0,
        ["load"],
        signal,
      );
    }
    if (token !== state.previewToken) return;
    $("story-preview-label").textContent =
      `Scene ${location.index + 1} of ${project.scenes.length} · ${asset.name} · source preview`;
    state.playing = play && !location.atEnd;
    state.epoch = performance.now();
    state.epochTime = state.time;
    if (state.playing) state.raf = requestAnimationFrame(tick);
  } catch (error) {
    if (token === state.previewToken) {
      state.playing = false;
      video.pause();
      message(`Preview stopped. ${error.message} Tap Play to try again.`, true);
    }
  } finally {
    clearTimeout(timeout);
    if (token === state.previewToken) {
      state.previewAbort = null;
      $("story-preview-loading").hidden = true;
      updateClock();
    }
  }
}
function tick(now) {
  if (!state.playing) return;
  const location = locateTime(project, state.time);
  if (!location) {
    pausePreview();
    return;
  }
  const asset = assetFor(project, location.scene);
  const sceneEnd = location.start + durationFrames(location.scene) / FPS;
  const next =
    asset.kind === "video"
      ? location.start +
        Math.max(0, video.currentTime - location.scene.inFrame / FPS)
      : state.epochTime + (now - state.epoch) / 1000;
  if (next >= sceneEnd || (asset.kind === "video" && video.ended)) {
    if (location.index === project.scenes.length - 1) {
      state.time = totalFrames(project) / FPS;
      pausePreview();
    } else seek(sceneEnd, true);
    return;
  }
  state.time = Math.max(location.start, Math.min(next, sceneEnd));
  updateClock();
  const scroll = $("story-timeline-scroll"),
    x = state.time * state.scale;
  if (x > scroll.scrollLeft + scroll.clientWidth - 18 || x < scroll.scrollLeft)
    scroll.scrollLeft = Math.max(0, x - scroll.clientWidth / 2);
  state.raf = requestAnimationFrame(tick);
}
// Native media continues advancing when Android delays animation callbacks.
// Enforce scene out-points on media events too, keeping only one RAF scheduled.
video.addEventListener("timeupdate", () => {
  if (!state.playing || video.hidden) return;
  cancelAnimationFrame(state.raf);
  tick(performance.now());
});
video.addEventListener("ended", () => {
  if (!state.playing || video.hidden) return;
  cancelAnimationFrame(state.raf);
  tick(performance.now());
});
$("story-play").addEventListener("click", () => {
  if (state.playing) pausePreview();
  else {
    $("story-result-video").pause();
    seek(state.time >= totalFrames(project) / FPS ? 0 : state.time, true);
  }
});
$("story-scrub").addEventListener("input", (event) =>
  seek(Number(event.target.value)),
);
$("story-timeline").addEventListener("click", (event) => {
  if (!busy() && project.scenes.length)
    seek(
      (event.clientX - $("story-timeline").getBoundingClientRect().left) /
        state.scale,
    );
});
$("story-preview-mute").addEventListener("change", (event) => {
  video.muted = event.target.checked;
});
$("story-result-video").addEventListener("play", pausePreview);
let resizeFrame;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    if (state.mode === "story") {
      renderTimeline();
      updateClock();
    }
  });
});
$("story-export").addEventListener("click", async () => {
  if (busy() || !project.scenes.length) return;
  pausePreview();
  invalidateOutput();
  state.exporting = true;
  state.abort = new AbortController();
  render();
  $("story-progress-region").hidden = false;
  $("story-progress").max = project.scenes.length + 1;
  message("Exporting locally. Keep Chrome open and your phone unlocked.");
  exportDiagnostics("Story", "Starting local export", {
    expectedDuration: totalFrames(project) / FPS,
  });
  try {
    const controller = state.abort;
    keepScreenAwake(
      () =>
        state.abort === controller &&
        !controller.signal.aborted &&
        state.exporting,
      (lock) => {
        state.wakeLock = lock;
      },
    );
    const blob = await exportStory(project, {
      signal: state.abort.signal,
      onStatus: (status) => {
        $("story-progress-label").textContent = status.label;
        if (status.completed === null)
          $("story-progress").removeAttribute("value");
        else $("story-progress").value = status.completed;
      },
    });
    if (state.abort.signal.aborted) return;
    state.outputURL = URL.createObjectURL(blob);
    $("story-result-video").src = state.outputURL;
    $("story-result").hidden = false;
    $("story-download").href = state.outputURL;
    $("story-download").download = exportFileName(
      "autocut-story",
      totalFrames(project) / FPS,
      "mp4",
    );
    $("story-result-info").textContent =
      `${seconds(totalFrames(project))}s · ${(blob.size / 1024 / 1024).toFixed(2)} MiB · ${$("story-download").download} · Save before leaving.`;
    message(
      "Your story is ready. Play the exported preview, then download the MP4.",
    );
  } catch (error) {
    exportDiagnostics(
      "Story",
      state.abort.signal.aborted
        ? "Cancelled; worker released"
        : "Export failed",
      { expectedDuration: totalFrames(project) / FPS, error },
    );
    message(
      state.abort.signal.aborted
        ? "Export cancelled. Your assets and scenes are unchanged."
        : error.message || "Export failed. Try a smaller project.",
      !state.abort.signal.aborted,
    );
  } finally {
    if (state.wakeLock) {
      state.wakeLock.release().catch(() => {});
      state.wakeLock = null;
    }
    state.exporting = false;
    state.abort = null;
    $("story-progress-region").hidden = true;
    render();
  }
});
$("story-cancel").addEventListener("click", () => {
  state.abort?.abort();
});
$("story-download").addEventListener("click", (event) => {
  if (!state.outputURL) event.preventDefault();
  else
    message(
      `Download started: ${$("story-download").download}. Open this NEW file in Chrome → ⋮ → Downloads; older exports may still be there.`,
    );
});
window.addEventListener("beforeunload", (event) => {
  if (busy()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
render();
