/**
 * Single source of truth for the macOS support floor, plus the pure predicates
 * the CI floor check runs on.
 *
 * Why a module and not three literals scattered across a config, a workflow and
 * a test: the update-gate value in particular is asserted by L1 tests AND
 * injected by CI. Duplicated literals let the tests stay green while CI injects
 * something else (test-plan clarification G1).
 *
 * The two consumers are the CLI wrappers next to this file:
 *   - verify-macos-floor.mjs        (CI: otool the packaged Mach-O)
 *   - inject-update-min-system-version.mjs (CI: write latest-mac.yml)
 *
 * See change: upgrade-electron-runtime.
 */

/**
 * Marketing macOS version of the floor. This is the value that goes into
 * `Info.plist > LSMinimumSystemVersion` (forge.config.ts) and into
 * `MACOSX_DEPLOYMENT_TARGET` on the darwin make step.
 */
export const MACOS_FLOOR_MARKETING = "12.0";

/**
 * Expected `LC_BUILD_VERSION.minos` MAJOR of the packaged main Mach-O.
 *
 * Note what this actually measures: the otooled binary is the RENAMED ELECTRON
 * PREBUILT, whose LC_BUILD_VERSION is baked by the upstream Electron release
 * and copied verbatim by @electron/packager. It is NOT produced by our
 * MACOSX_DEPLOYMENT_TARGET. The check is therefore an UPSTREAM-FLOOR TRIPWIRE:
 * it fires when a future Electron raises its own macOS floor without us
 * noticing. Observed empirically against the electron@43.4.1 prebuilt.
 *
 * See design.md Decision 2.
 */
export const MACOS_FLOOR_MINOS_MAJOR = 12;

/**
 * `minimumSystemVersion` injected into the emitted `latest-mac.yml`.
 *
 * MUST be the DARWIN KERNEL version as a full three-component semver.
 * `electron-updater`'s `checkIfUpdateSupported` compares `os.release()` (the
 * Darwin version on macOS) against this using the STRICT `semver.lt` parser,
 * catches any throw, and falls through to "update supported". So both
 * intuitive spellings are silently inert:
 *
 *   "12.0" — marketing version   → semver.lt throws → gate disabled
 *   "21"   — bare Darwin major   → semver.lt throws → gate disabled
 *   "21.0.0" — Darwin triple     → correct
 *
 * macOS 12 Monterey === Darwin 21. See design.md Decision 5, Trap 1.
 */
export const UPDATE_MINIMUM_SYSTEM_VERSION = "21.0.0";

/**
 * Extract EVERY `minos` value from `otool -l` output.
 *
 * Multi-slice safety: a universal (fat) Mach-O emits one load-command set per
 * architecture, so an extractor that reads the first match and stops would
 * never check the second slice's floor. This returns all of them.
 *
 * Falls back to the older `LC_VERSION_MIN_MACOSX` load command when no
 * `LC_BUILD_VERSION` block is present.
 *
 * @param {string} otoolOutput
 * @returns {string[]} every declared minimum-OS version, in file order
 */
export function extractMinosValues(otoolOutput) {
  const collect = (commandName, fieldName) => {
    const values = [];
    let inBlock = false;
    for (const rawLine of String(otoolOutput ?? "").split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("Load command")) {
        inBlock = false;
        continue;
      }
      if (line.startsWith("cmd ") && line.includes(commandName)) {
        inBlock = true;
        continue;
      }
      if (line === commandName || line.endsWith(` ${commandName}`)) {
        inBlock = true;
        continue;
      }
      if (!inBlock) continue;
      const match = line.match(new RegExp(`^${fieldName}\\s+(\\S+)$`));
      if (match) {
        values.push(match[1]);
        inBlock = false;
      }
    }
    return values;
  };

  const buildVersion = collect("LC_BUILD_VERSION", "minos");
  if (buildVersion.length > 0) return buildVersion;
  return collect("LC_VERSION_MIN_MACOSX", "version");
}

/**
 * Apply the floor predicate to `otool -l` output.
 *
 * The comparison is EQUALITY, not the historical upward-only `-gt`. Under the
 * old 10.15 target a below-floor value was unreachable (10 was the minimum
 * expressible on x64); at a 12.0 floor it is reachable and must not pass.
 *
 * @param {{ otoolOutput: string, expectedMajor?: number }} args
 * @returns {{ status: "ok"|"mismatch"|"non-numeric"|"not-extractable",
 *             values: string[], expectedMajor: number, message: string }}
 */
export function checkMinosFloor({
  otoolOutput,
  expectedMajor = MACOS_FLOOR_MINOS_MAJOR,
}) {
  const values = extractMinosValues(otoolOutput);

  if (values.length === 0) {
    return {
      status: "not-extractable",
      values,
      expectedMajor,
      message:
        "Could not extract minos from the binary (no LC_BUILD_VERSION or LC_VERSION_MIN_MACOSX load command) — skipping the floor check.",
    };
  }

  for (const value of values) {
    const major = Number(value.split(".")[0]);
    if (!Number.isInteger(major)) {
      return {
        status: "non-numeric",
        values,
        expectedMajor,
        message: `minos major is non-numeric ('${value}') — skipping the floor check.`,
      };
    }
  }

  const sliceCount = values.length;
  for (const value of values) {
    const major = Number(value.split(".")[0]);
    if (major !== expectedMajor) {
      return {
        status: "mismatch",
        values,
        expectedMajor,
        message:
          `Mach-O minos is '${value}' (major=${major}), expected exactly major=${expectedMajor}` +
          (sliceCount > 1 ? ` (slice ${values.indexOf(value) + 1} of ${sliceCount})` : "") +
          ". This binary is the renamed UPSTREAM ELECTRON PREBUILT: its LC_BUILD_VERSION is baked by the Electron " +
          "release and copied verbatim by the packager, so this value reports an upstream Electron macOS floor change " +
          "— it is not produced by this repo's build flags. Re-derive the expected major from the installed prebuilt " +
          "(otool -l node_modules/electron/dist/Electron.app/Contents/MacOS/Electron) and move MACOS_FLOOR_MINOS_MAJOR " +
          "together with the product's documented macOS floor, deliberately. See change: upgrade-electron-runtime.",
      };
    }
  }

  return {
    status: "ok",
    values,
    expectedMajor,
    message: `Mach-O minos verified across ${sliceCount} slice(s): ${values.join(", ")} (expected major=${expectedMajor}).`,
  };
}

/**
 * Map a produced-binary `checkMinosFloor` result to its CI verdict.
 *
 * The produced binary tolerates what it cannot measure (`not-extractable`,
 * `non-numeric` → warning, exit 0) so a novel Mach-O shape does not red the
 * build. That tolerance is only safe behind a passing `checkCanary`.
 *
 * @param {{ status: string }} result
 * @returns {{ level: "ok"|"warning"|"error", exitCode: 0|1 }}
 */
export function producedBinaryVerdict(result) {
  if (result.status === "ok") return { level: "ok", exitCode: 0 };
  if (result.status === "mismatch") return { level: "error", exitCode: 1 };
  return { level: "warning", exitCode: 0 };
}

/**
 * Extractor canary: prove `extractMinosValues` is not blind on a binary we
 * KNOW carries LC_BUILD_VERSION — the installed Electron prebuilt — before
 * the produced-binary check is allowed to tolerate an unextractable minos.
 *
 * Pure by design: the `otool` exec and the file-existence probe live in
 * verify-macos-floor.mjs and arrive here as `execFailed` / `sampleMissing`,
 * so every verdict is fixture-testable on Linux (no otool there).
 *
 * Every non-`ok` status is an ERROR (exit 1) — deliberately asymmetric with
 * `producedBinaryVerdict`. A non-numeric value fails too: on the produced
 * binary it maps to a passing warning, so accepting it here would leave the
 * tripwire as dead as a blind extractor would.
 *
 * @param {{ otoolOutput?: string, execFailed?: string|false,
 *           sampleMissing?: boolean, samplePath: string,
 *           expectedMajor?: number }} args
 * @returns {{ status: "ok"|"blind-extractor"|"non-numeric"|"sample-missing"|"exec-failed"|"mismatch",
 *             values: string[], message: string,
 *             level: "ok"|"error", exitCode: 0|1 }}
 */
export function checkCanary({
  otoolOutput = "",
  execFailed = false,
  sampleMissing = false,
  samplePath,
  expectedMajor = MACOS_FLOOR_MINOS_MAJOR,
}) {
  const fail = (status, values, detail) => ({
    status,
    values,
    level: "error",
    exitCode: 1,
    message: `macOS floor canary failed on the Electron prebuilt '${samplePath}': ${detail} The produced-binary check cannot be trusted without it (extractor: extractMinosValues). See change: fix-ci-pipeline-followups.`,
  });

  if (sampleMissing) {
    return fail(
      "sample-missing",
      [],
      "the sample does not exist — run `node install.js` in the electron dir resolved by pi-dashboard-resolve-tool.cjs before the floor check.",
    );
  }
  if (execFailed) {
    return fail("exec-failed", [], `could not run 'otool -l' (${execFailed}).`);
  }

  const result = checkMinosFloor({ otoolOutput, expectedMajor });
  if (result.status === "not-extractable") {
    return fail(
      "blind-extractor",
      result.values,
      "extractMinosValues returned no minos from a binary known to carry LC_BUILD_VERSION — the extractor is blind.",
    );
  }
  if (result.status !== "ok") {
    return fail(result.status, result.values, result.message);
  }
  return {
    status: "ok",
    values: result.values,
    level: "ok",
    exitCode: 0,
    message: `Extractor canary ok on '${samplePath}': minos ${result.values.join(", ")}.`,
  };
}
