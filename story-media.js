import { OUTPUT, LIMITS, MIN_FRAMES, FPS } from "./story-model.js";

export function mediaReady(element, event, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(
        new Error(
          "Chrome could not read this media. Try an H.264 MP4, JPG or PNG that opens on your phone.",
        ),
      );
    };
    const timer = setTimeout(fail, timeout);
    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener(event, done);
      element.removeEventListener("error", fail);
    };
    element.addEventListener(event, done, { once: true });
    element.addEventListener("error", fail, { once: true });
  });
}
function thumbnail(media, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 90;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0b100c";
  ctx.fillRect(0, 0, 160, 90);
  const scale = Math.min(160 / width, 90 / height);
  ctx.drawImage(
    media,
    (160 - width * scale) / 2,
    (90 - height * scale) / 2,
    width * scale,
    height * scale,
  );
  return canvas.toDataURL("image/jpeg", 0.65);
}
export async function readAsset(file) {
  if (!file.size) throw new Error("This file is empty.");
  const image =
    /\.(jpe?g|png)$/i.test(file.name) ||
    ["image/jpeg", "image/png"].includes(file.type);
  const video =
    file.type.startsWith("video/") ||
    /\.(mp4|webm|mov|m4v|3gp)$/i.test(file.name);
  if (!image && !video)
    throw new Error(
      "Choose a video, JPG or PNG. Other image formats and audio-only files are not supported in Increment A.",
    );
  if (file.size > (image ? LIMITS.imageBytes : 75 * 1024 * 1024))
    throw new Error(
      image
        ? "Choose an image under 15 MiB."
        : "Choose a video under 75 MiB. Short clips work best on phones.",
    );
  const url = URL.createObjectURL(file);
  let media;
  try {
    if (image) {
      media = new Image();
      const ready = mediaReady(media, "load");
      media.src = url;
      await ready;
      const width = media.naturalWidth,
        height = media.naturalHeight;
      if (!width || !height || width * height > LIMITS.imagePixels)
        throw new Error(
          "Choose an image under 20 megapixels to reduce phone memory use.",
        );
      const thumb = thumbnail(media, width, height);
      const scale = Math.min(1, OUTPUT.width / width, OUTPUT.height / height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(2, Math.round(width * scale));
      canvas.height = Math.max(2, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(media, 0, 0, canvas.width, canvas.height);
      const prepared = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!prepared)
        throw new Error(
          "This image could not be prepared. Try a smaller JPG or PNG.",
        );
      URL.revokeObjectURL(url);
      return {
        name: file.name,
        kind: "image",
        size: file.size,
        file,
        prepared,
        width,
        height,
        thumbnail: thumb,
        url: URL.createObjectURL(prepared),
      };
    }
    media = document.createElement("video");
    media.preload = "auto";
    media.muted = true;
    media.playsInline = true;
    const metadata = mediaReady(media, "loadedmetadata");
    media.src = url;
    await metadata;
    const duration = media.duration,
      width = media.videoWidth,
      height = media.videoHeight;
    if (
      !Number.isFinite(duration) ||
      duration * FPS < MIN_FRAMES ||
      !width ||
      !height
    )
      throw new Error("Choose a readable video at least 0.25 seconds long.");
    if (duration > LIMITS.frames / FPS)
      throw new Error(
        "Choose a source video no longer than 120 seconds for Story mode. Stage 1 remains available for trimming larger sources.",
      );
    if (media.readyState < 2) await mediaReady(media, "loadeddata");
    const thumb = thumbnail(media, width, height);
    return {
      name: file.name,
      kind: "video",
      size: file.size,
      file,
      duration,
      width,
      height,
      thumbnail: thumb,
      url,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    if (media instanceof HTMLVideoElement) {
      media.pause();
      media.removeAttribute("src");
      media.load();
    } else if (media) media.removeAttribute("src");
  }
}
