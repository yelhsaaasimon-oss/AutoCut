// Pure, frame-based project model. No DOM, uploads, storage or worker side effects.
export const FPS = 24;
export const OUTPUT = Object.freeze({
  width: 960,
  height: 540,
  fps: FPS,
  sampleRate: 48000,
});
export const LIMITS = Object.freeze({
  assets: 8,
  scenes: 12,
  frames: 120 * FPS,
  bytes: 100 * 1024 * 1024,
  imageBytes: 15 * 1024 * 1024,
  imagePixels: 20_000_000,
});
export const MIN_FRAMES = 6; // 0.25 second, including after a video trim.
let nextId = 0;
const id = (prefix) => `${prefix}-${++nextId}`;
export function createProject() {
  return { assets: [], scenes: [], selectedId: null, revision: 0 };
}
export function assetFor(project, scene) {
  return project.assets.find((asset) => asset.id === scene.assetId);
}
export function durationFrames(scene) {
  return scene.outFrame - scene.inFrame;
}
export function totalFrames(project) {
  return project.scenes.reduce((sum, scene) => sum + durationFrames(scene), 0);
}
export function sceneStart(project, sceneId) {
  let frames = 0;
  for (const scene of project.scenes) {
    if (scene.id === sceneId) return frames / FPS;
    frames += durationFrames(scene);
  }
  return 0;
}
export function locateTime(project, seconds) {
  if (!project.scenes.length) return null;
  const total = totalFrames(project);
  const frame = Math.max(
    0,
    Math.min(total, Number.isFinite(seconds) ? seconds * FPS : 0),
  );
  let start = 0;
  for (let index = 0; index < project.scenes.length; index++) {
    const scene = project.scenes[index],
      end = start + durationFrames(scene);
    if (frame < end || index === project.scenes.length - 1)
      return {
        scene,
        index,
        start: start / FPS,
        local: Math.min(frame - start, durationFrames(scene)) / FPS,
        atEnd: frame === total,
      };
    start = end;
  }
}
function validateAddition(project, frames) {
  if (project.scenes.length >= LIMITS.scenes)
    throw new Error(
      `A story can contain at most ${LIMITS.scenes} scenes. Remove a scene first.`,
    );
  if (frames < MIN_FRAMES)
    throw new Error("A scene must last at least 0.25 seconds.");
  if (totalFrames(project) + frames > LIMITS.frames)
    throw new Error(
      "Stories are limited to 120 seconds for phone memory. Shorten or remove a scene first.",
    );
}
export function importAsset(project, details, byteLimit = LIMITS.bytes) {
  if (project.assets.length >= LIMITS.assets)
    throw new Error(
      `Import at most ${LIMITS.assets} assets. Remove unused assets first.`,
    );
  if (
    project.assets.reduce((sum, asset) => sum + asset.size, 0) + details.size >
    byteLimit
  )
    throw new Error(
      `Project files exceed the ${Math.round(byteLimit / 1024 / 1024)} MiB memory safety limit. Remove unused assets or choose smaller files.`,
    );
  if (
    !["video", "image"].includes(details.kind) ||
    !Number.isFinite(details.size) ||
    details.size <= 0
  )
    throw new Error("Choose a nonempty video, JPG or PNG file.");
  const frames =
    details.kind === "image"
      ? 3 * FPS
      : Math.floor(details.duration * FPS + 1e-6);
  if (!Number.isFinite(frames))
    throw new Error("This file has no readable duration.");
  validateAddition(project, frames); // Atomic: a failed import must not leave orphaned model entries.
  const asset = { ...details, id: id("asset"), frames };
  project.assets.push(asset);
  return addScene(project, asset.id);
}
export function addScene(project, assetId) {
  const asset = project.assets.find((item) => item.id === assetId);
  if (!asset) throw new Error("That asset is no longer available.");
  const frames = asset.kind === "image" ? 3 * FPS : asset.frames;
  validateAddition(project, frames);
  const scene = { id: id("scene"), assetId, inFrame: 0, outFrame: frames };
  project.scenes.push(scene);
  project.selectedId = scene.id;
  project.revision++;
  return scene;
}
export function selectScene(project, sceneId) {
  if (!project.scenes.some((scene) => scene.id === sceneId))
    throw new Error("That scene is no longer available.");
  project.selectedId = sceneId;
}
export function removeScene(project, sceneId) {
  const index = project.scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) return;
  project.scenes.splice(index, 1);
  if (project.selectedId === sceneId)
    project.selectedId =
      project.scenes[Math.min(index, project.scenes.length - 1)]?.id || null;
  project.revision++;
}
export function moveScene(project, sceneId, direction) {
  if (![-1, 1].includes(direction))
    throw new Error("Move a scene one place earlier or later.");
  const index = project.scenes.findIndex((scene) => scene.id === sceneId),
    target = index + direction;
  if (index < 0 || target < 0 || target >= project.scenes.length) return false;
  [project.scenes[index], project.scenes[target]] = [
    project.scenes[target],
    project.scenes[index],
  ];
  project.revision++;
  return true;
}
export function updateScene(project, sceneId, startSeconds, endSeconds) {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error("Select a scene first.");
  const asset = assetFor(project, scene);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds))
    throw new Error("Enter valid start and end times in seconds.");
  const start = Math.round(startSeconds * FPS),
    end = Math.round(endSeconds * FPS);
  if (startSeconds < 0 || start < 0 || end - start < MIN_FRAMES)
    throw new Error(
      "Start must be nonnegative; end must be at least 0.25 seconds after start.",
    );
  if (asset.kind === "image" && (start !== 0 || end > 30 * FPS))
    throw new Error("Image durations must be between 0.25 and 30 seconds.");
  if (asset.kind === "video" && end > asset.frames)
    throw new Error(
      `End cannot exceed the source's ${(asset.frames / FPS).toFixed(3)} seconds.`,
    );
  if (
    totalFrames(project) - durationFrames(scene) + end - start >
    LIMITS.frames
  )
    throw new Error("Stories are limited to 120 seconds.");
  scene.inFrame = start;
  scene.outFrame = end;
  project.revision++;
  return scene;
}
export function removeAsset(project, assetId) {
  if (project.scenes.some((scene) => scene.assetId === assetId))
    throw new Error("Remove this asset’s scenes from the timeline first.");
  const index = project.assets.findIndex((asset) => asset.id === assetId);
  if (index >= 0) {
    project.assets.splice(index, 1);
    project.revision++;
  }
}
