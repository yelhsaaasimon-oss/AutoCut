// Audio references for storyboard planning. They are NOT mixed into Story exports yet.
import { mediaReady } from "./story-media.js";
import { AUDIO_LIMITS } from "./creator-model.js";
export async function readAudioReference(file, signal) {
  if (!file.size || file.size > AUDIO_LIMITS.fileBytes)
    throw new Error("Choose nonempty audio under 10 MiB.");
  if (
    !file.type.startsWith("audio/") &&
    !/\.(mp3|wav|m4a|aac|ogg|webm)$/i.test(file.name)
  )
    throw new Error(
      "Choose recorded audio, MP3, WAV, M4A, AAC, OGG or WebM audio.",
    );
  const audio = document.createElement("audio"),
    url = URL.createObjectURL(file);
  try {
    const ready = mediaReady(audio, "loadedmetadata", 15000, signal);
    audio.preload = "metadata";
    audio.src = url;
    await ready;
    signal?.throwIfAborted();
    if (
      !Number.isFinite(audio.duration) ||
      audio.duration <= 0 ||
      audio.duration > 600
    )
      throw new Error(
        "Audio references must have a readable duration up to 10 minutes.",
      );
    return {
      name: file.name.slice(0, 255),
      file,
      duration: audio.duration,
      role: "narration",
      start: 0,
    };
  } finally {
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  }
}
