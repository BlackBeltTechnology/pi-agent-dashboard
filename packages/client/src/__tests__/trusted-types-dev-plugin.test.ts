import { resolveTrustedTypesMode } from "@blackbelt-technology/pi-dashboard-shared/trusted-types-mode.js";
import { describe, expect, it } from "vitest";
import { trustedTypesDevPlugin } from "../../trusted-types-dev-plugin.js";

/**
 * Dev-server half of the Trusted Types mode states the SAME mode as the server for the same
 * environment and config (test-plan #E7). See change: enforce-trusted-types-default.
 */
describe("trustedTypesDevPlugin states the resolved mode (#E7)", () => {
  type Mode = "off" | "report" | "enforce";
  const stub = '<!doctype html><html><head></head><body></body></html>';

  function stated(env: Record<string, string | undefined>, config: unknown): string | undefined {
    const plugin = trustedTypesDevPlugin("/ws", { env, readConfig: () => config });
    const hook = plugin.transformIndexHtml as { handler: (html: string, ctx: { server?: unknown }) => string };
    return /name="pi-trusted-types" content="(\w+)"/.exec(hook.handler(stub, { server: {} }))?.[1];
  }

  it.each([
    { label: "all unset", env: {}, config: undefined, want: "report" },
    { label: "CSP off", env: { PI_DASHBOARD_CSP: "off" }, config: undefined, want: "off" },
    { label: "config enforce", env: {}, config: "enforce", want: "enforce" },
    { label: "env beats config", env: { PI_DASHBOARD_TRUSTED_TYPES: "off" }, config: "enforce", want: "off" },
    { label: "typo → report", env: { PI_DASHBOARD_TRUSTED_TYPES: "reprot" }, config: undefined, want: "report" },
  ])("$label → $want, equal to the shared resolver", ({ env, config, want }) => {
    expect(stated(env, config)).toBe(want);
    const cspMode: Mode = env.PI_DASHBOARD_CSP === "off" ? "off" : "report";
    const resolved = resolveTrustedTypesMode({
      env: (env as Record<string, string | undefined>).PI_DASHBOARD_TRUSTED_TYPES,
      config,
      cspMode,
    });
    expect(resolved.mode).toBe(want);
  });

  it("does not touch a production build (no dev server)", () => {
    const plugin = trustedTypesDevPlugin("/ws", { env: {}, readConfig: () => undefined });
    const hook = plugin.transformIndexHtml as { handler: (html: string, ctx: { server?: unknown }) => string };
    expect(hook.handler(stub, {})).toBe(stub);
  });
});
