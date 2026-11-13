import { FPS } from "./story-model.js";
import {
  emptyCreator,
  planStoryboard,
  validateDraft,
  draftProblems,
  applyStoryboard,
  validateCreator,
} from "./creator-model.js";
import { readAudioReference } from "./creator-audio.js";
const $ = (id) => document.getElementById(id);
const node = (tag, text) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  return el;
};
export function mountCreator({
  project,
  byteLimit,
  isBusy,
  onApply,
  onDirty,
  onAudioBusy,
  onAudition,
}) {
  project.creator ||= emptyCreator();
  let shown = null,
    shownAssets = "",
    importing = false;
  const urls = new Map();
  const status = (text, error = false) => {
    $("creator-status").textContent = text;
    $("creator-status").classList.toggle("error", error);
  };
  const dirty = () => {
    onDirty();
    $("creator-ack").checked = false;
    summary();
  };
  function field(
    parent,
    label,
    value,
    change,
    { type = "textarea", max = 500 } = {},
  ) {
    const wrap = node("label", label),
      input = node(type === "textarea" ? "textarea" : "input");
    if (type !== "textarea") input.type = type;
    input.value = value;
    input.maxLength = max;
    if (type === "number") {
      input.min = 0;
      input.max = 120;
      input.step = 1 / FPS;
    }
    input.addEventListener("change", () => {
      change(input.value);
      dirty();
      summary();
    });
    wrap.append(input);
    parent.append(wrap);
    return input;
  }
  function summary() {
    const draft = project.creator.draft;
    let problems = [];
    if (draft) {
      try {
        const frames = validateDraft(draft);
        problems = draftProblems(draft, project.assets);
        if (
          draft.request.prompt !== project.creator.prompt ||
          draft.request.notes !== project.creator.notes
        )
          problems.push(
            "Prompt or script notes changed. Draft again before Apply (or restore the original prompt/notes).",
          );
        $("creator-summary").textContent =
          `${draft.scenes.length} scenes · ${(frames / FPS).toFixed(2)}s planned / ${(draft.targetFrames / FPS).toFixed(2)}s target · ${draft.format}. ${problems.join(" ")}`;
      } catch (error) {
        problems = [error.message];
        $("creator-summary").textContent = error.message;
      }
    } else
      $("creator-summary").textContent =
        "No storyboard yet. Import visuals above or plan first and assign them later.";
    $("creator-apply").disabled =
      isBusy() || !draft || problems.length > 0 || !$("creator-ack").checked;
  }
  function renderDraft() {
    const area = $("creator-scenes");
    area.replaceChildren();
    const draft = project.creator.draft;
    $("creator-review").hidden = !draft;
    if (!draft) return;
    $("creator-title").value = draft.title;
    $("creator-format").value = draft.format;
    draft.scenes.forEach((row, i) => {
      const card = node("fieldset"),
        legend = node("legend", `Scene ${i + 1}`);
      card.append(legend);
      const label = node("label", "Uploaded visual (manual reassignment)"),
        select = node("select");
      select.dataset.scene = String(i);
      const missing = node(
        "option",
        "Missing footage — choose an uploaded asset",
      );
      missing.value = "";
      select.append(missing);
      for (const asset of project.assets) {
        const option = node("option", `${asset.name} · ${asset.kind}`);
        option.value = asset.id;
        select.append(option);
      }
      select.value = project.assets.some((a) => a.id === row.assetId)
        ? row.assetId
        : "";
      select.addEventListener("change", () => {
        row.assetId = select.value || null;
        dirty();
        summary();
      });
      label.append(select);
      card.append(label);
      field(
        card,
        "Duration (seconds)",
        (row.durationFrames / FPS).toFixed(3),
        (value) => {
          row.durationFrames = Math.round(Number(value) * FPS);
        },
        { type: "number" },
      );
      field(
        card,
        "Start in uploaded video (seconds; images use 0)",
        (row.sourceStart / FPS).toFixed(3),
        (value) => {
          row.sourceStart = Math.round(Number(value) * FPS);
        },
        { type: "number" },
      );
      for (const [key, title] of [
        ["description", "Scene description"],
        ["script", "Your script / narration draft (not generated speech)"],
        ["caption", "Caption draft — not rendered"],
        ["visual", "Visual instructions — planning notes"],
        ["motion", "Motion suggestion — not rendered"],
        ["transition", "Transition suggestion — only hard cuts are rendered"],
        ["audio", "Audio placement notes — no extra tracks rendered"],
      ])
        field(card, title, row[key], (value) => {
          row[key] = value;
        });
      const actions = node("div");
      for (const [title, offset] of [
        ["Earlier", -1],
        ["Later", 1],
      ]) {
        const b = node("button", title);
        b.type = "button";
        b.dataset.boundary = String(
          i + offset < 0 || i + offset >= draft.scenes.length,
        );
        b.disabled = b.dataset.boundary === "true";
        b.addEventListener("click", () => {
          [draft.scenes[i], draft.scenes[i + offset]] = [
            draft.scenes[i + offset],
            draft.scenes[i],
          ];
          dirty();
          renderDraft();
          summary();
        });
        actions.append(b);
      }
      card.append(actions);
      area.append(card);
    });
  }
  function renderAudio() {
    const list = $("creator-audio-list"),
      files = new Set(project.creator.audio.map((a) => a.file));
    for (const [file, url] of urls)
      if (!files.has(file)) {
        URL.revokeObjectURL(url);
        urls.delete(file);
      }
    for (const audio of list.querySelectorAll("audio")) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    list.replaceChildren();
    project.creator.audio.forEach((a, index) => {
      const row = node("fieldset");
      row.append(node("legend", a.name));
      const label = node("label", "Planning role"),
        role = node("select");
      for (const type of ["narration", "music", "sfx"]) {
        const option = node("option", type);
        option.value = type;
        role.append(option);
      }
      role.value = a.role;
      role.addEventListener("change", () => {
        a.role = role.value;
        dirty();
      });
      label.append(role);
      row.append(label);
      field(
        row,
        "Suggested placement (seconds; planning only)",
        a.start,
        (value) => {
          a.start = Number(value);
        },
        { type: "number" },
      );
      if (!urls.has(a.file)) urls.set(a.file, URL.createObjectURL(a.file));
      const audio = node("audio");
      audio.controls = true;
      audio.preload = "none";
      audio.src = urls.get(a.file);
      audio.addEventListener("play", () => {
        for (const other of list.querySelectorAll("audio"))
          if (other !== audio) other.pause();
        onAudition?.();
      });
      row.append(audio);
      const remove = node("button", "Remove audio reference");
      remove.type = "button";
      remove.addEventListener("click", () => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        project.creator.audio.splice(index, 1);
        dirty();
        renderAudio();
      });
      row.append(remove);
      list.append(row);
    });
  }
  function refresh() {
    if (!project.creator) project.creator = emptyCreator();
    const keys = project.assets.map((a) => a.id).join("|");
    if (shown !== project.creator || shownAssets !== keys) {
      shown = project.creator;
      shownAssets = keys;
      $("creator-prompt").value = project.creator.prompt;
      $("creator-notes").value = project.creator.notes;
      renderDraft();
      renderAudio();
      $("creator-ack").checked = false;
    }
    for (const control of $("creator-workspace").querySelectorAll(
      "input,textarea,select,button",
    ))
      control.disabled = isBusy() || control.dataset.boundary === "true";
    if (isBusy())
      for (const audio of $("creator-audio-list").querySelectorAll("audio"))
        audio.pause();
    $("creator-generate").disabled = isBusy();
    summary();
  }
  for (const [id, key] of [
    ["creator-prompt", "prompt"],
    ["creator-notes", "notes"],
  ])
    $(id).addEventListener("input", (e) => {
      project.creator[key] = e.target.value;
      dirty();
    });
  $("creator-generate").addEventListener("click", () => {
    if (isBusy()) return;
    try {
      project.creator.draft = planStoryboard(
        project.creator.prompt,
        project.creator.notes,
        project.assets,
        project.creator.audio,
      );
      dirty();
      renderDraft();
      summary();
      status(
        "Draft ready. Review every scene. Existing Story scenes are unchanged until Apply.",
      );
    } catch (error) {
      status(error.message, true);
    }
  });
  $("creator-title").addEventListener("input", (e) => {
    if (project.creator.draft) {
      project.creator.draft.title = e.target.value;
      dirty();
      summary();
    }
  });
  $("creator-format").addEventListener("change", (e) => {
    if (project.creator.draft) {
      project.creator.draft.format = e.target.value;
      dirty();
      summary();
    }
  });
  $("creator-ack").addEventListener("change", summary);
  $("creator-apply").addEventListener("click", () => {
    if (isBusy() || !$("creator-ack").checked || $("creator-apply").disabled)
      return;
    try {
      validateCreator(project.creator, project.assets, byteLimit);
      const next = applyStoryboard(project, project.creator.draft, byteLimit);
      onApply(next);
      $("creator-ack").checked = false;
      summary();
      status(
        "Applied cuts, timing and aspect to Story Mode. Review/play/edit the scenes below, then Export story. Draft captions, motion and audio references are NOT in the MP4.",
      );
    } catch (error) {
      status(error.message, true);
    }
  });
  $("creator-audio-import").addEventListener("change", async (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    if (isBusy() || !files.length) return;
    const controller = new AbortController();
    importing = true;
    onAudioBusy(controller);
    const failures = [];
    try {
      for (const file of files) {
        if (controller.signal.aborted) break;
        try {
          // Validate size/count BEFORE browser decode, not after allocating resources.
          const candidate = {
            ...project.creator,
            audio: [
              ...project.creator.audio,
              {
                file,
                name: file.name.slice(0, 255),
                duration: 1,
                start: 0,
                role: "narration",
              },
            ],
          };
          validateCreator(candidate, project.assets, byteLimit);
          const reference = await readAudioReference(file, controller.signal);
          project.creator.audio.push(reference);
          dirty();
        } catch (error) {
          if (error.name === "AbortError") break;
          failures.push(`${file.name}: ${error.message}`);
        }
      }
    } finally {
      importing = false;
      onAudioBusy(null);
      renderAudio();
      refresh();
      status(
        `${controller.signal.aborted ? "Import cancelled. " : ""}${project.creator.audio.length} audio references organized for planning only. ${failures.join(" ")}`,
        failures.length > 0,
      );
    }
  });
  window.addEventListener("beforeunload", () => {
    for (const url of urls.values()) URL.revokeObjectURL(url);
  });
  return {
    refresh,
    pauseAudio: () => {
      for (const audio of $("creator-audio-list").querySelectorAll("audio"))
        audio.pause();
    },
    get importing() {
      return importing;
    },
  };
}
