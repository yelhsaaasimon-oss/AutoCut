// Preview-only readiness/cancellation. Import and export media paths are unchanged.
export function waitForPreview(element, ready, events, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      for (const event of events) element.removeEventListener(event, check);
      element.removeEventListener("error", fail);
      signal.removeEventListener("abort", abort);
    };
    const finish = (error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (ready()) finish();
    };
    const fail = () =>
      finish(new Error("Chrome could not decode this preview."));
    const abort = () => finish(signal.reason);
    for (const event of events) element.addEventListener(event, check);
    element.addEventListener("error", fail);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else if (element.error) fail();
    else check();
  });
}

// Native play() can stay pending while Android is loading/decoding. Observe its
// late rejection too, but allow a new selection or the watchdog to stop waiting.
export function previewPlay(video, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        if (signal.aborted) throw signal.reason;
        return video.play();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function preparePreviewVideo(video, url, time, signal) {
  if (video.getAttribute("src") !== url) {
    video.src = url;
    video.load();
  }
  // A superseding trim can have the same URL but still be loading metadata.
  await waitForPreview(
    video,
    () => video.readyState >= 1,
    ["loadedmetadata", "loadeddata", "canplay"],
    signal,
  );
  if (signal.aborted) throw signal.reason;
  if (Math.abs(video.currentTime - time) > 0.001) video.currentTime = time;
  // Do not wait solely for a future seeked event: a no-op seek need not emit it.
  await waitForPreview(
    video,
    () => !video.seeking && video.readyState >= 2,
    ["seeked", "loadeddata", "canplay", "timeupdate"],
    signal,
  );
}
