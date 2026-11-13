import { creatorSnapshot } from "./creator-model.js";
// Explicit, local-only snapshots. Original Blob/File data stays in IndexedDB;
// object URLs and exported MP4s are never persisted. One slot per workspace.
const DB_NAME = `autocut-projects-${new URL("./", import.meta.url).pathname}`;
const STORE = "projects";
export async function projectStore(action, workspace, value) {
  if (!globalThis.indexedDB)
    throw new Error(
      "Local project storage is unavailable in this browser session.",
    );
  if (!["quick", "story"].includes(workspace))
    throw new Error("Unknown workspace.");
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(
        new Error(
          "Project storage is blocked. Close other AutoCut tabs and retry.",
        ),
      );
    }, 8000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
    request.onblocked = () => {
      expired = true;
      clearTimeout(timer);
      reject(new Error("Project storage is blocked by another tab."));
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) request.result.close();
      else resolve(request.result);
    };
  });
  db.onversionchange = () => db.close();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        STORE,
        action === "load" ? "readonly" : "readwrite",
      );
      const store = tx.objectStore(STORE);
      const timer = setTimeout(() => tx.abort(), 45000);
      const failure = (error) => {
        clearTimeout(timer);
        reject(
          new Error(
            `Project storage failed (${error?.name || "storage unavailable"}). Free browser storage or try outside private browsing. Your previous saved project was not replaced.`,
          ),
        );
      };
      let request;
      try {
        if (action === "load") request = store.get(workspace);
        else if (action === "save")
          request = store.put(
            { ...value, version: 1, savedAt: Date.now() },
            workspace,
          );
        else if (action === "delete") request = store.delete(workspace);
        else throw new Error("Unknown storage action.");
      } catch (error) {
        tx.abort();
        failure(error);
        return;
      }
      tx.oncomplete = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      tx.onabort = tx.onerror = () => failure(tx.error);
    });
  } finally {
    db.close();
  }
}

export function storySnapshot(project) {
  return {
    creator: creatorSnapshot(project.creator, project.assets),
    format: project.format,
    assets: project.assets.map((asset) => ({
      name: asset.name,
      file: asset.file,
    })),
    scenes: project.scenes.map((scene) => ({
      asset: project.assets.findIndex((asset) => asset.id === scene.assetId),
      inFrame: scene.inFrame,
      outFrame: scene.outFrame,
    })),
    selected: project.scenes.findIndex(
      (scene) => scene.id === project.selectedId,
    ),
  };
}
