// @ts-check
// Chromium resolution for `score_mockup` and `mock-video`: launch Playwright's
// pinned build; when it is not installed, try the builds already in Playwright's
// browser cache, newest first, via `executablePath`. See change:
// add-mock-site-exact-env (design D7).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const INSTALL_HINT = "npx playwright install chromium";
const EXE_CANDIDATES = [
  "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
  "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  "chrome-linux64/chrome",
  "chrome-linux/chrome",
  "chrome-win64/chrome.exe",
  "chrome-win/chrome.exe",
];

/** Playwright's browser cache dir. @param {NodeJS.ProcessEnv} [env] @param {string} [platform] @param {string} [home] */
function playwrightCacheDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== "0") return env.PLAYWRIGHT_BROWSERS_PATH;
  if (platform === "darwin") return path.join(home, "Library", "Caches", "ms-playwright");
  if (platform === "win32") return path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "ms-playwright");
  return path.join(env.XDG_CACHE_HOME ?? path.join(home, ".cache"), "ms-playwright");
}

/**
 * Cached `chromium-<build>` dirs holding a browser executable, newest first.
 * @param {string} dir
 * @returns {{ name: string, exe: string }[]}
 */
export function cachedChromiumBuilds(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    .flatMap((name) => {
      const exe = EXE_CANDIDATES.map((c) => path.join(dir, name, c)).find((p) => fs.existsSync(p));
      return exe ? [{ name, exe }] : [];
    });
}

/** @param {unknown} e */
const isMissingBrowser = (e) => /Executable doesn't exist|playwright install|browserType\.launch: .*not found/i.test(String(/** @type {Error} */ (e)?.message ?? e));

/**
 * @param {{ launch: (o: object) => Promise<any> }} chromium Playwright's `chromium`
 * @param {object} [launchOpts]
 * @param {{ builds?: { name: string, exe: string }[] }} [deps]
 * @returns {Promise<{ browser: any, build: string }>} `build` = "pinned" or the cached dir used
 */
export async function launchChromium(chromium, launchOpts = {}, deps = {}) {
  try {
    return { browser: await chromium.launch(launchOpts), build: "pinned" };
  } catch (e) {
    if (!isMissingBrowser(e)) throw e;
  }
  const builds = deps.builds ?? cachedChromiumBuilds(playwrightCacheDir());
  /** @type {string[]} */
  const tried = [];
  for (const b of builds) {
    try {
      return { browser: await chromium.launch({ ...launchOpts, executablePath: b.exe }), build: b.name };
    } catch {
      tried.push(b.name);
    }
  }
  throw new Error(`Playwright's pinned Chromium is not installed and no cached build launched (tried: ${tried.join(", ") || "none found"}). Install it: ${INSTALL_HINT}`);
}
