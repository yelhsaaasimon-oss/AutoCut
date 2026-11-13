# Update the existing AutoCut copy in Termux

This updates your **local branch copy only**. It does not merge PR #2, deploy GitHub Pages, require a paid service or upload videos. Use the same phone/browser address as before so existing local saved projects stay on the same browser origin.

## 1. Protect current work and stop the old static server

- Download any finished output you need. In the new build, also use **Save project locally** before closing or refreshing; **edits are not autosaved**. The older `f78fc6f` build cannot save projects, so do not expect its unsaved in-memory scenes to survive this first update.
- In the Termux session running AutoCut, press **Ctrl+C** to stop `npm run serve`. Restarting is important: the static server itself now has updated access protections.
- Close **all AutoCut Chrome tabs and installed-app windows**. Do not clear Chrome site data as an update step; that would delete saved projects and offline caches.

## 2. Check the existing checkout

```sh
cd ~/AutoCut
git branch --show-current
git status --short
```

If your folder is elsewhere, use its actual path instead of `~/AutoCut`.

The branch must be **`arena/4b30bfe8-autocut`** and `git status --short` should print nothing. If the branch differs or you have local changes, stop and preserve those changes first—do not use `git reset --hard`, delete the folder or overwrite work.

## 3. Pull the current branch without creating a merge

```sh
test "$(git branch --show-current)" = "arena/4b30bfe8-autocut" && git pull --ff-only origin arena/4b30bfe8-autocut
git log -1 --format='%h %s'
```

Compare the printed hash with the delivery message. If Git refuses the fast-forward, stop rather than forcing it. No GitHub password/token should be pasted into this chat. The public repository does not require an account to run the application.

## 4. Restart the same local static server

```sh
PORT=5173 npm run serve
```

Leave this Termux session running. **No npm install, build, Python/Flask, backend or cloud account is needed to run the app.** The included server uses Node built-ins. Automated test dependencies are for maintainers on compatible Linux—not required on your Android phone. Keep `vendor/` intact; its WASM file is the actual engine, not a download placeholder.

Open your previous address in Android Chrome, normally:

```text
http://127.0.0.1:5173/AutoCut/
```

If you previously used `http://localhost:5173/` or another local path/port, continue using that exact address. `localhost` versus `127.0.0.1`, different ports and different project paths do **not** share all browser project/cache storage.

## 5. Confirm the browser actually received the update

Look below the Quick/Story mode buttons for:

**Build v1.2.0-rc.1**

If it is absent or old, close every AutoCut tab/window and reopen while Termux is still serving. A service-worker update can remain waiting while another old tab is open. Do not test exports against a visibly old build. The pinned engine cache can migrate from the previous Increment A build, but if it was never cached or Android evicted it, complete one edit while connected first.

## 6. Final phone checklist

Use a short H.264 MP4 that is longer than seven seconds first. Keep Chrome in the foreground, close memory-heavy tabs, and keep the phone unlocked.

1. **Quick Edit:** import, export an untrimmed MP4, apply a short trim and a crop, process again, download and play the new file. Also try mute and MP3 if the source has audio.
2. **Story trim:** import once—this already adds a scene. Enter source Start **2** and End **7**, then tap **Apply scene timing**. Confirm **1 SCENE · 5.00s**, the applied source range 2–7, and all-scenes export total five seconds. If another full-length scene exists, remove it; do not add a duplicate accidentally.
3. Preview: verify it starts at source second 2 and stops at the scene end. Export, download and play the **new** MP4; check duration/content, not only the UI clock.
4. **Mixed story:** add another video and JPG/PNG, change image duration, reorder/remove scenes, and export. Confirm audible/silent slots and cut order.
5. **Formats:** export a short mixed story in horizontal **16:9** and vertical **9:16**. Quick Edit also supports horizontal, vertical and square crop prompts.
6. **Recovery:** Save project locally, reload, switch to that workspace, tap Restore saved project, verify source media/edits/order/format and export again. Repeat offline after warming the engine cache. Save again after further edits. Exported MP4s are not part of the saved snapshot.
7. **Cancel/retry:** cancel a running export/import and confirm accepted scenes/original files remain usable. Try the next job without refreshing.

Downloads now include duration and a UTC timestamp, for example `autocut-story-5p00s-20261112-123456-789.mp4`. Open the file identified by the new completion notice; older similarly named files can remain in Downloads.

## If an export still fails on the phone

Expand **Export diagnostics · on this device only** near the mode buttons. Report the build, workspace, error, expected/actual duration and output track details shown there, plus whether the correct new downloaded file was opened. The panel sends nothing automatically and does not include the media or source filename.

Physical-phone certification is still the purpose of this handoff. Do not upload private footage or share credentials. Saved snapshots are local browser storage—not a backup against device loss or Android storage eviction. Keep original media and important completed exports in your device files.
