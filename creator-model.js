// Local deterministic planning only. No network, language model, generated media or FFmpeg.
import {
  FPS,
  LIMITS,
  MIN_FRAMES,
  createProject,
  addScene,
  validateProject,
  FORMATS,
} from "./story-model.js";
export const AUDIO_LIMITS = Object.freeze({
  count: 4,
  fileBytes: 10 * 1024 * 1024,
  bytes: 20 * 1024 * 1024,
});
export const emptyCreator = () => ({
  prompt: "",
  notes: "",
  draft: null,
  audio: [],
});
const text = (value, max) => typeof value === "string" && value.length <= max;
const tokens = (value) =>
  String(value)
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter(
      (t) =>
        t.length > 2 &&
        ![
          "the",
          "and",
          "use",
          "video",
          "scene",
          "with",
          "this",
          "that",
          "create",
          "make",
          "seconds",
        ].includes(t),
    ) || [];
export function planStoryboard(prompt, notes, assets, audioReferences = []) {
  if (!text(prompt, 2000) || !prompt.trim())
    throw new Error("Describe your video in 1–2000 characters.");
  if (!text(notes, 6000))
    throw new Error("Scene notes must be at most 6000 characters.");
  const lengths = [
    ...prompt.matchAll(
      /(?<![\w.])(-?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:-\s*)?(seconds?|secs?|s\b|minutes?|mins?)/gi,
    ),
  ];
  if (!lengths.length && /\b(?:seconds?|secs?|minutes?|mins?)\b/i.test(prompt))
    throw new Error("Use a numeric duration such as 60 seconds or 1 minute.");
  if (lengths.length > 1)
    throw new Error(
      "Use one total duration in the prompt; edit individual scene times in the storyboard.",
    );
  const duration = lengths.length
    ? Number(lengths[0][1]) * (/^m/i.test(lengths[0][2]) ? 60 : 1)
    : 30;
  const frames = Math.round(duration * FPS);
  if (!Number.isFinite(duration) || duration < 0.25 || duration > 120)
    throw new Error("Choose a total duration from 0.25 to 120 seconds.");
  const vertical = /9\s*:\s*16|\bvertical\b/i.test(prompt),
    horizontal = /16\s*:\s*9|\bhorizontal\b/i.test(prompt);
  if (vertical && horizontal)
    throw new Error("Choose one aspect ratio: 9:16 or 16:9.");
  const lines = notes
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.some((s) => s.length > 500) || lines.length > LIMITS.scenes)
    throw new Error(
      "Use up to 12 scene-note lines, at most 500 characters each.",
    );
  const explicit = prompt.match(/(?<![\w.])(-?\d+(?:\.\d+)?)\s+scenes?\b/i);
  if (
    explicit &&
    (!Number.isInteger(Number(explicit[1])) ||
      Number(explicit[1]) < 1 ||
      Number(explicit[1]) > 12)
  )
    throw new Error("Choose a whole scene count from 1 to 12.");
  if (explicit && lines.length && lines.length !== Number(explicit[1]))
    throw new Error(
      "Your scene-note line count must match the requested scene count, or remove the count from the prompt.",
    );
  const fast = /fast cuts?|quick cuts?|fast.paced/i.test(prompt);
  const count =
    lines.length ||
    (explicit
      ? Number(explicit[1])
      : Math.min(
          LIMITS.scenes,
          Math.max(1, Math.ceil(duration / (fast ? 3 : 6))),
        ));
  if (
    count < 1 ||
    count > LIMITS.scenes ||
    Math.floor(frames / count) < MIN_FRAMES
  )
    throw new Error("Choose 1–12 scenes with at least 0.25 seconds per scene.");
  const title =
    prompt
      .replace(/^\s*(?:create|make|edit)\s+(?:a\s+)?/i, "")
      .split(/[.!?\n]/)[0]
      .slice(0, 160)
      .trim() || "My story";
  const uses = new Map();
  const scenes = Array.from({ length: count }, (_, i) => {
    const durationFrames =
      Math.floor(frames / count) + (i < frames % count ? 1 : 0);
    const description =
      lines[i] ||
      `${i === 0 ? "Opening hook" : i === count - 1 ? "Closing beat" : "Supporting beat"}: ${title}. Add your own verified details.`;
    const words = new Set(tokens(description));
    const candidates = assets
      .filter((a) =>
        a.kind === "image"
          ? durationFrames <= 30 * FPS
          : a.frames >= durationFrames,
      )
      .map((a, index) => ({
        a,
        index,
        score:
          tokens(a.name).filter((t) => words.has(t)).length * 10 -
          (uses.get(a.id) || 0),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const asset = candidates[0]?.a;
    if (asset) uses.set(asset.id, (uses.get(asset.id) || 0) + 1);
    return {
      assetId: asset?.id || null,
      durationFrames,
      sourceStart: 0,
      description,
      script:
        lines[i] || "Write or record your own factual narration for this beat.",
      caption: lines[i]?.slice(0, 160) || `Scene ${i + 1}: add your caption`,
      visual:
        "Review this filename-based match; the planner cannot see or understand footage.",
      motion: /zoom|pan/i.test(prompt)
        ? "Suggested pan/zoom — planning only"
        : "Static frame",
      transition: /transition|dissolve|crossfade/i.test(prompt)
        ? "Suggested transition — planning only"
        : "Hard cut",
      audio: /music|narration|sound effects?|sfx|audio/i.test(prompt)
        ? `${((Math.floor(frames / count) * i + Math.min(i, frames % count)) / FPS).toFixed(2)}s: ${
            audioReferences.length
              ? audioReferences
                  .map((a) => `${a.role}: ${a.name}`)
                  .join("; ")
                  .slice(0, 350)
              : "Missing supplied audio — import narration/music/SFX references"
          }. Planning only; not mixed.`
        : "Keep source audio",
    };
  });
  return {
    version: 1,
    request: { prompt, notes },
    title,
    format: vertical ? "9:16" : "16:9",
    targetFrames: frames,
    scenes,
  };
}
export function validateDraft(draft) {
  if (
    !draft ||
    draft.version !== 1 ||
    !text(draft.request?.prompt, 2000) ||
    !text(draft.request?.notes, 6000) ||
    !text(draft.title, 160) ||
    !Object.hasOwn(FORMATS, draft.format) ||
    !Number.isInteger(draft.targetFrames) ||
    draft.targetFrames < MIN_FRAMES ||
    draft.targetFrames > LIMITS.frames ||
    !Array.isArray(draft.scenes) ||
    !draft.scenes.length ||
    draft.scenes.length > LIMITS.scenes
  )
    throw new Error("Invalid storyboard.");
  let total = 0;
  for (const row of draft.scenes) {
    if (
      !row ||
      !(row.assetId === null || text(row.assetId, 100)) ||
      !Number.isInteger(row.durationFrames) ||
      row.durationFrames < MIN_FRAMES ||
      !Number.isInteger(row.sourceStart) ||
      row.sourceStart < 0 ||
      [
        "description",
        "script",
        "caption",
        "visual",
        "motion",
        "transition",
        "audio",
      ].some((key) => !text(row[key], 500))
    )
      throw new Error(
        "Invalid storyboard scene. Check timing and text limits.",
      );
    total += row.durationFrames;
  }
  if (total > LIMITS.frames) throw new Error("Storyboard exceeds 120 seconds.");
  return total;
}
export function draftProblems(draft, assets) {
  validateDraft(draft);
  return draft.scenes.flatMap((row, i) => {
    const a = assets.find((a) => a.id === row.assetId);
    if (!a) return [`Scene ${i + 1}: assign an uploaded visual asset.`];
    if (
      a.kind === "image" &&
      (row.durationFrames > 30 * FPS || row.sourceStart !== 0)
    )
      return [
        `Scene ${i + 1}: images need a duration ≤30s and source start 0.`,
      ];
    if (a.kind === "video" && row.sourceStart + row.durationFrames > a.frames)
      return [
        `Scene ${i + 1}: selected range exceeds this source; shorten it or reassign.`,
      ];
    return [];
  });
}
// Build a staged Story project. Never partially mutate live scenes on failure.
export function applyStoryboard(project, draft, byteLimit = LIMITS.bytes) {
  const problems = draftProblems(draft, project.assets);
  if (problems.length) throw new Error(problems.join("\n"));
  const next = createProject();
  next.assets = project.assets.slice();
  next.format = draft.format;
  for (const row of draft.scenes)
    addScene(next, row.assetId, {
      inFrame: row.sourceStart,
      outFrame: row.sourceStart + row.durationFrames,
    });
  validateProject(next, byteLimit);
  next.selectedId = next.scenes[0]?.id || null;
  return next;
}
export function validateCreator(creator, assets, byteLimit = LIMITS.bytes) {
  if (
    !creator ||
    !text(creator.prompt, 2000) ||
    !text(creator.notes, 6000) ||
    !Array.isArray(creator.audio) ||
    creator.audio.length > AUDIO_LIMITS.count
  )
    throw new Error("Invalid saved creator workspace.");
  if (creator.draft) validateDraft(creator.draft);
  let bytes = 0;
  for (const a of creator.audio) {
    if (
      !a ||
      !(a.file instanceof Blob) ||
      !a.file.size ||
      a.file.size > AUDIO_LIMITS.fileBytes ||
      !text(a.name, 255) ||
      !["narration", "music", "sfx"].includes(a.role) ||
      !Number.isFinite(a.duration) ||
      a.duration <= 0 ||
      a.duration > 600 ||
      !Number.isFinite(a.start) ||
      a.start < 0 ||
      a.start > 120
    )
      throw new Error("Invalid saved audio reference.");
    bytes += a.file.size;
  }
  if (
    bytes > AUDIO_LIMITS.bytes ||
    bytes + assets.reduce((n, a) => n + a.size, 0) > byteLimit
  )
    throw new Error(
      "Visuals and audio references exceed the local project memory budget.",
    );
}
export function creatorSnapshot(creator, assets) {
  if (!creator) return undefined;
  validateCreator(creator, assets);
  return {
    ...creator,
    draft: creator.draft
      ? {
          ...creator.draft,
          scenes: creator.draft.scenes.map(({ assetId, ...row }) => ({
            ...row,
            asset: assets.findIndex((a) => a.id === assetId),
          })),
        }
      : null,
  };
}
export function restoreCreator(saved, assets, byteLimit = LIMITS.bytes) {
  if (saved === undefined) return emptyCreator(); // Backward compatible saved Story slots.
  const creator = { ...saved };
  if (saved?.draft) {
    if (
      !Array.isArray(saved.draft.scenes) ||
      saved.draft.scenes.length > LIMITS.scenes
    )
      throw new Error("Invalid saved storyboard.");
    creator.draft = {
      ...saved.draft,
      scenes: saved.draft.scenes.map(({ asset, ...row }) => {
        if (!Number.isInteger(asset) || asset < -1 || asset >= assets.length)
          throw new Error("Invalid saved storyboard source reference.");
        return { ...row, assetId: assets[asset]?.id || null };
      }),
    };
  }
  validateCreator(creator, assets, byteLimit);
  return creator;
}
