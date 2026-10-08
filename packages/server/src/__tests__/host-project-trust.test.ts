/**
 * `host.isProjectTrusted(cwd)` mirrors a pi session's trust rule
 * (migrate-mcp-to-pi-builtin test-plan E32): the recorded decision wins; with
 * none, `defaultProjectTrust: always` trusts and `ask` does not. The second
 * block runs the REAL installed pi through `getPiCore()` (the
 * pi-core-trust-exports pattern), so a pi API drift fails here.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHostProjectTrust, type DefaultProjectTrust, loadHostProjectTrust } from "../pi/host-project-trust.js";
import { getPiCore } from "../pi/pi-resource-activation.js";

describe("E32 — decision table", () => {
  const cases: Array<[string, boolean | null, DefaultProjectTrust, boolean]> = [
    ["recorded yes × always", true, "always", true],
    ["recorded yes × ask", true, "ask", true],
    ["recorded no × always", false, "always", false],
    ["recorded no × ask", false, "ask", false],
    ["none × always", null, "always", true],
    ["none × ask", null, "ask", false],
    ["none × never", null, "never", false],
  ];
  it.each(cases)("%s", (_label, recorded, dflt, expected) => {
    const trust = createHostProjectTrust({ recordedDecision: () => recorded, defaultProjectTrust: () => dflt });
    expect(trust("/p")).toBe(expected);
  });

  it("an unreadable store fails closed even when the default is always", () => {
    const trust = createHostProjectTrust({
      recordedDecision: () => {
        throw new Error("lock held");
      },
      defaultProjectTrust: () => "always",
    });
    expect(trust("/p")).toBe(false);
  });

  it("a throwing store or settings read is untrusted, never a throw", () => {
    const trust = createHostProjectTrust({
      recordedDecision: () => {
        throw new Error("corrupt");
      },
      defaultProjectTrust: () => {
        throw new Error("corrupt");
      },
    });
    expect(trust("/p")).toBe(false);
  });
});

describe("E32 — against the real installed pi", () => {
  it("recorded decision wins; none + ask (pi default) is untrusted; none + always is trusted", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-host-trust-"));
    const yes = fs.mkdtempSync(path.join(os.tmpdir(), "pi-host-trust-yes-"));
    const no = fs.mkdtempSync(path.join(os.tmpdir(), "pi-host-trust-no-"));
    const none = fs.mkdtempSync(path.join(os.tmpdir(), "pi-host-trust-none-"));
    try {
      const { ProjectTrustStore } = await getPiCore();
      const store = new ProjectTrustStore(agentDir);
      store.set(yes, true);
      store.set(no, false);
      fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "ask" }));
      let trust = await loadHostProjectTrust(agentDir);
      expect(trust(yes)).toBe(true);
      expect(trust(no)).toBe(false);
      expect(trust(none)).toBe(false);

      fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));
      trust = await loadHostProjectTrust(agentDir);
      expect(trust(none)).toBe(true);
      expect(trust(no)).toBe(false);
    } finally {
      for (const d of [agentDir, yes, no, none]) fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
