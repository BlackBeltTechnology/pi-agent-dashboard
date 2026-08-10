import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The client's unhandled-rejection reporter must be installed before any
 * application work (test-plan #F6, ordering half).
 *
 * The E2E half proves the reporter REPORTS; it cannot prove the install happens
 * before `ReactDOM.createRoot(...).render(...)`, because a rejection fired
 * before the bundle executes can never reach a listener the bundle installs.
 * That ordering is a source property, so it is asserted here \u2014 same posture as
 * `packages/electron/src/__tests__/unhandled-rejection-wiring.test.ts`.
 *
 * `main.tsx` cannot be imported in vitest (it renders the whole app on import),
 * hence the source-level read.
 *
 * See change: cleanup-client-plugin-promises (design D2).
 */
const clientSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mainSrc = readFileSync(path.join(clientSrc, "main.tsx"), "utf8");

describe("F6 (ordering): the reporter is installed before the app renders", () => {
  it("calls installUnhandledRejectionReporter() at the entrypoint", () => {
    expect(mainSrc).toMatch(/^installUnhandledRejectionReporter\(\);$/m);
  });

  it("installs it before ReactDOM.createRoot(...).render(...)", () => {
    const installAt = mainSrc.search(/^installUnhandledRejectionReporter\(\);$/m);
    const renderAt = mainSrc.indexOf("ReactDOM.createRoot(");
    expect(installAt).toBeGreaterThan(-1);
    expect(renderAt).toBeGreaterThan(-1);
    expect(installAt).toBeLessThan(renderAt);
  });

  it("installs it before the other startup side effects it must observe", () => {
    const installAt = mainSrc.search(/^installUnhandledRejectionReporter\(\);$/m);
    // Service-worker registration and the device-auth fetch shim both run
    // promise work at startup; the reporter has to be in place first.
    for (const marker of ["installDeviceAuthFetch()", "navigator.serviceWorker.register"]) {
      const at = mainSrc.indexOf(marker);
      expect(at, `${marker} not found in main.tsx`).toBeGreaterThan(-1);
      expect(installAt, `reporter must precede ${marker}`).toBeLessThan(at);
    }
  });
});
