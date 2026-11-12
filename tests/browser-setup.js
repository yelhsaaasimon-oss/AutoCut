import { chromium as playwright } from "@playwright/test";
import chromium from "@sparticuz/chromium";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { brotliDecompressSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export async function launchBrowser() {
  // Use npm's bundled Linux x64 browser and NSS in minimal test sandboxes.
  const libraryDir = resolve(".arena/browser-libs");
  await mkdir(libraryDir, { recursive: true });
  const archive = resolve(".arena/browser-libs.tar");
  await writeFile(
    archive,
    brotliDecompressSync(
      await readFile(
        new URL(
          "../node_modules/@sparticuz/chromium/bin/al2023.tar.br",
          import.meta.url,
        ),
      ),
    ),
  );
  execFileSync("tar", ["-xf", archive, "-C", libraryDir]);
  const args = chromium.args.filter(
    (arg) =>
      !arg.includes("disable-web-security") &&
      !arg.includes("enable-features=SharedArrayBuffer") &&
      arg !== "--single-process",
  );
  return playwright.launch({
    executablePath: await chromium.executablePath(),
    args,
    headless: true,
    env: {
      ...process.env,
      LD_LIBRARY_PATH: `${libraryDir}/lib:${process.env.LD_LIBRARY_PATH || ""}`,
    },
  });
}

export const ANDROID = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
};
