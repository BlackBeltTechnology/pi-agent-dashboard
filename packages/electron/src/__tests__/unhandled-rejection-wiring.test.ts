import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Main-process unhandled-rejection wiring (test-plan #X2, static half).
 *
 * X2 asked for a RUNTIME assertion that the handler fires. The only electron
 * job in CI (`ci-electron.yml`) is a dispatch-only installer BUILD matrix — it
 * never launches the app, so it cannot observe main-process log output. Per the
 * task's own fallback, the runtime row is recorded manual-only in
 * `test-plan.md`, and this static guard keeps the wiring from silently
 * disappearing in the meantime.
 *
 * Source-level assertion (not an import): `main.ts` pulls in `electron`, which
 * cannot be loaded in a vitest process. Same posture as
 * `build-config-parity.test.ts`, which reads config files rather than running
 * the toolchain.
 *
 * See change: cleanup-client-plugin-promises (design D2).
 */
const electronSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainSrc = readFileSync(path.join(electronSrc, "main.ts"), "utf8");

describe("X2 (static): electron main installs an unhandled-rejection reporter", () => {
  it("registers a process-level unhandledRejection handler", () => {
    expect(mainSrc).toMatch(/process\.on\(\s*["']unhandledRejection["']/);
  });

  it("routes the reason itself into log(), not just any log call", () => {
    const match = mainSrc.match(
      /process\.on\(\s*["']unhandledRejection["'][\s\S]{0,400}?\n\}\);/,
    );
    expect(match, "unhandledRejection handler block not found").toBeTruthy();
    const body = match?.[0] ?? "";

    // The handler's parameter must be what reaches log() — a handler that logs
    // a fixed string would satisfy a bare `log(` check while discarding the
    // reason, which is precisely the swallow this change exists to remove.
    const param = body.match(/\(\s*(\w+)\s*\)\s*=>/)?.[1];
    expect(param, "handler takes a reason parameter").toBeTruthy();
    const derived = body.match(/const\s+(\w+)\s*=[\s\S]*?\b\w+\b/)?.[1];
    const logCall = body.match(/log\(([\s\S]*?)\);/)?.[1] ?? "";
    expect(
      logCall.includes(param ?? "\u0000") || (derived ? logCall.includes(derived) : false),
      `log() must carry the reason (param "${param}"), got: ${logCall.trim()}`,
    ).toBe(true);
    // And the reason must be preserved, not flattened to a placeholder.
    expect(body).toMatch(new RegExp(`\\b${param}\\b[\\s\\S]*stack|\\b${param}\\b[\\s\\S]*message`));
    // A swallowing handler is the defect this change exists to remove.
    expect(body).not.toMatch(/\{\s*\}\s*\)/);
  });

  it("is installed before the app's startup work begins", () => {
    const handlerAt = mainSrc.search(/process\.on\(\s*["']unhandledRejection["']/);
    const startupAt = mainSrc.indexOf('log("=== Electron starting ===")');
    expect(handlerAt).toBeGreaterThan(-1);
    expect(startupAt).toBeGreaterThan(-1);
    expect(handlerAt).toBeLessThan(startupAt);
  });
});
