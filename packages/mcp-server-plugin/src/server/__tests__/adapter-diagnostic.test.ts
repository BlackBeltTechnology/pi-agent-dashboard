/**
 * Lazy adapter-version diagnostic (change extract-mcp-client-plugin, task 6.1):
 * the consumed service's verdict passes through, an absent service reads as
 * `unknown`, and the warning fires at most once on invocation — never at
 * construction (registration).
 */
import { execFileSync } from "node:child_process";
import {
  ADAPTER_VERSION_FLOOR,
  type AdapterVerdict,
} from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";
import { describe, expect, it, vi } from "vitest";
import { adapterVerdictOf, createAdapterWarnOnce } from "../adapter-diagnostic.js";
import { headerCommandPath } from "../provisioning.js";

const svc = (verdict: AdapterVerdict) => ({ adapterVerdict: () => verdict });

describe("adapterVerdictOf", () => {
  it("passes through the consumed service's verdict", () => {
    const v: AdapterVerdict = {
      kind: "below-floor",
      installed: "2.19.0",
      floor: ADAPTER_VERSION_FLOOR,
      message: "too old",
    };
    expect(adapterVerdictOf(svc(v))).toBe(v);
  });

  it("an absent service reads as `unknown` with the floor", () => {
    expect(adapterVerdictOf(undefined)).toEqual({ kind: "unknown", floor: ADAPTER_VERSION_FLOOR });
  });
});

describe("createAdapterWarnOnce", () => {
  it("warns exactly once across many requests", () => {
    const warn = vi.fn();
    const fn = createAdapterWarnOnce({ warn }, () =>
      svc({ kind: "below-floor", installed: "2.19.0", floor: ADAPTER_VERSION_FLOOR, message: "upgrade now" }),
    );
    fn();
    fn();
    fn();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("upgrade now");
  });

  it("emits nothing at construction — the warning belongs to first use", () => {
    const warn = vi.fn();
    createAdapterWarnOnce({ warn }, () =>
      svc({ kind: "absent", floor: ADAPTER_VERSION_FLOOR, message: "no adapter" }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("an `ok` verdict never warns", () => {
    const warn = vi.fn();
    const fn = createAdapterWarnOnce({ warn }, () =>
      svc({ kind: "ok", installed: "2.20.0", floor: ADAPTER_VERSION_FLOOR }),
    );
    fn();
    expect(warn).not.toHaveBeenCalled();
  });

  it("an absent service warns once with the `unknown` diagnostic", () => {
    const warn = vi.fn();
    const fn = createAdapterWarnOnce({ warn }, () => undefined);
    fn();
    fn();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("unknown");
  });
});

describe("X2 — the header command's failure is not invisible", () => {
  it("exits non-zero with a diagnostic when the env var is unset (fail closed)", () => {
    // The adapter discards this command's stderr (`stdio[2]="ignore"`), so the
    // command's own output is structurally invisible. What MUST hold is that
    // the failure mode is a LOUD non-zero exit (→ a 401 the server records),
    // not an empty Authorization header that could never be told apart from
    // "no credential configured".
    const env = { ...process.env } as Record<string, string | undefined>;
    delete env.PI_DASHBOARD_MCP_TOKEN;
    let threw = false;
    try {
      execFileSync("node", [headerCommandPath()], {
        env: env as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
        input: "{}",
      });
    } catch (err) {
      threw = true;
      const e = err as { status?: number; stderr?: Buffer };
      expect(e.status).not.toBe(0);
      expect(String(e.stderr)).toContain("PI_DASHBOARD_MCP_TOKEN");
    }
    expect(threw).toBe(true);
  });

  it("echoes the Authorization header from its OWN environment, never argv", () => {
    const env = { ...process.env, PI_DASHBOARD_MCP_TOKEN: "mcp_test-token-value" };
    const out = execFileSync("node", [headerCommandPath()], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      input: "{}",
    }).toString();
    expect(JSON.parse(out)).toEqual({ Authorization: "Bearer mcp_test-token-value" });
  });

  it("the empty-string env var is treated as unset (no empty Bearer ever ships)", () => {
    const env = { ...process.env, PI_DASHBOARD_MCP_TOKEN: "" };
    expect(() =>
      execFileSync("node", [headerCommandPath()], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        input: "{}",
      }),
    ).toThrow();
  });
});
