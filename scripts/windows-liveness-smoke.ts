/**
 * Windows boot-parent-liveness smoke (CI: _smoke.yml standalone-install-smoke-windows).
 *
 * Proves the Tier-2 koffi path in `packages/server/src/boot-parent-liveness.ts`
 * loads and runs on a REAL Windows host — the one thing unit tests cannot cover
 * (koffi/kernel32 `OpenProcess`/`WaitForSingleObject` cannot be faithfully
 * mocked cross-platform). Guards task 1b.4: a future koffi bump or a jiti/
 * native-load regression would silently degrade every Windows user to Tier 1;
 * this fails the build instead.
 *
 * Asserts (in-process, importing the real module so koffi actually loads):
 *   - `computeBootParentAlive()` returns a boolean and never throws (idempotent
 *     across repeated calls — the retained handle is reused).
 *   - `bootParentPid` is a number; `readLivePpid()` is a number.
 *   - Active tier: on win32 MUST be "tier2" (koffi loaded + OpenProcess
 *     succeeded); on non-win32 MUST be "tier1" (koffi unused — POSIX uses the
 *     live-ppid signal). This makes the script cross-platform: green on the
 *     Linux legs and locally, load-bearing on the Windows leg.
 *
 * Exit 0 = pass. See change: electron-attach-ownership-fixes.
 */
import {
  bootParentLivenessTier,
  bootParentPid,
  computeBootParentAlive,
  readLivePpid,
} from "../packages/server/src/lifecycle/boot-parent-liveness.js";

function fail(msg: string): never {
  console.error(`[win-liveness-smoke] FAIL: ${msg}`);
  process.exit(1);
}

const alive1 = computeBootParentAlive();
const alive2 = computeBootParentAlive(); // idempotent: reuses the retained handle
if (typeof alive1 !== "boolean" || typeof alive2 !== "boolean") {
  fail(`computeBootParentAlive() must return boolean, got ${typeof alive1}/${typeof alive2}`);
}
if (typeof bootParentPid !== "number") fail(`bootParentPid must be number, got ${typeof bootParentPid}`);
if (typeof readLivePpid() !== "number") fail(`readLivePpid() must be number, got ${typeof readLivePpid()}`);

const tier = bootParentLivenessTier();
if (process.platform === "win32") {
  if (tier !== "tier2") {
    fail(
      "expected Tier 2 (koffi) on win32 but got Tier 1 — koffi failed to load or OpenProcess was denied. " +
        "Check koffi optionalDependency install + the bundle GO/NO-GO (bundle-server.mjs).",
    );
  }
} else if (tier !== "tier1") {
  fail(`expected Tier 1 on ${process.platform} (koffi is win32-only) but got ${tier}`);
}

console.log(
  `[win-liveness-smoke] OK — platform=${process.platform} tier=${tier} ` +
    `bootParentPid=${bootParentPid} alive=${alive1} (idempotent)`,
);
