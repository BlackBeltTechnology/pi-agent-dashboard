/**
 * headless-pid-registry — the generic `pluginRef` promotion + keeper-respawn
 * relink primitives that back the ownership-resolution seam.
 *
 * Covers test-plan scenarios: E6 (three-tier link priority; only the token
 * path carries a ref), E7 (stale token degrades to pid/cwd with NO ref), E8
 * (already-linked entry not re-linked by any tier), X7 (keeper respawn relinks
 * by keeperPid + refreshes piPid + resolves the same ref), X8 (in-process fork
 * inherits nothing). See change: detach-automation-goal-from-core.
 */
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import type { ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { createHeadlessPidRegistry } from "../headless-pid-registry.js";

function fakeProc(): ChildProcess {
  return new EventEmitter() as ChildProcess;
}
function tmpPidFile(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "pi-hpr-")), "pids.json");
}

describe("headless-pid-registry plugin-ref + relink", () => {
  it("E6: link priority is token > pid > cwd; only the token path promotes a ref", () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: tmpPidFile() });

    // Tier 1 — token. An entry with token T, pid 111, cwd /w links by token.
    reg.register(111, "/w", fakeProc(), "T");
    expect(reg.linkByToken("T", "sess-token", 111)).toBe(true);
    // The seam promotes the ref only on a token resolution:
    reg.setPluginRef("sess-token", { kind: "automation" });
    expect(reg.getPluginRef("sess-token")).toEqual({ kind: "automation" });

    // Tier 2 — pid. A second unlinked entry links by pid (no token given).
    reg.register(222, "/w", fakeProc(), "U");
    expect(reg.linkByToken("no-match", "sess-pid", 222)).toBe(false);
    expect(reg.linkByPid("sess-pid", 222)).toBe(true);
    expect(reg.getPluginRef("sess-pid")).toBeUndefined(); // pid tier assigns no ref

    // Tier 3 — cwd-FIFO. A third unlinked entry links by cwd only.
    reg.register(333, "/w", fakeProc());
    expect(reg.linkByPid("sess-cwd", 999)).toBe(false);
    expect(reg.linkSession("sess-cwd", "/w")).toBe(true);
    expect(reg.getPluginRef("sess-cwd")).toBeUndefined(); // cwd tier assigns no ref
  });

  it("E7: a stale token degrades to pid then cwd, promoting NO ref", () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: tmpPidFile() });
    reg.register(111, "/w", fakeProc(), "REAL");
    // A register presents a token that matches no live entry.
    expect(reg.linkByToken("STALE", "sess", 111)).toBe(false);
    // Falls through to pid, which matches the unlinked entry.
    expect(reg.linkByPid("sess", 111)).toBe(true);
    // No token resolution ⇒ the seam never calls setPluginRef ⇒ no ref.
    expect(reg.getPluginRef("sess")).toBeUndefined();
  });

  it("E8: an already-linked entry is not re-linked by token, pid, or cwd", () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: tmpPidFile() });
    reg.register(111, "/w", fakeProc(), "T");
    expect(reg.linkByToken("T", "first", 111)).toBe(true);
    // A second register matching by every tier must NOT steal the entry.
    expect(reg.linkByToken("T", "second", 111)).toBe(false);
    expect(reg.linkByPid("second", 111)).toBe(false);
    expect(reg.linkSession("second", "/w")).toBe(false);
    // The original link stands.
    expect(reg.getPid("first")).toBe(111);
    expect(reg.getPid("second")).toBeUndefined();
  });

  it("X7: keeper respawn relinks by keeperPid, refreshes piPid, resolves the same ref", () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: tmpPidFile() });
    // Keeper-mediated entry: spawn-time pid == keeperPid.
    reg.register(5000, "/w", fakeProc(), "T", { keeperPid: 5000, keeperSockPath: "/tmp/k.sock" });
    reg.linkByToken("T", "sess-old", 6000); // pi pid 6000
    reg.setPluginRef("sess-old", { goalId: "g1" });

    // Tokenless respawn: keeper (stable 5000) relaunched pi as a NEW session
    // with a NEW pi pid; the register carries no token.
    expect(reg.relinkByKeeperPid(5000, "sess-new", 7000)).toBe(true);
    // Relinked to the new sessionId, piPid refreshed…
    expect(reg.getPid("sess-new")).toBe(7000);
    expect(reg.getPid("sess-old")).toBeUndefined();
    // …and the respawned session resolves the SAME ref.
    expect(reg.getPluginRef("sess-new")).toEqual({ goalId: "g1" });
  });

  it("X8: an in-process fork (no keeper entry of its own) inherits no ref", () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: tmpPidFile() });
    reg.register(5000, "/w", fakeProc(), "T", { keeperPid: 5000, keeperSockPath: "/tmp/k.sock" });
    reg.linkByToken("T", "parent", 6000);
    reg.setPluginRef("parent", { goalId: "g1" });

    // The fork mints a tokenless sessionId with NO keeper entry of its own.
    // It matches no keeperPid, so relink fails and it inherits nothing.
    expect(reg.relinkByKeeperPid(9999, "forked", 8000)).toBe(false);
    expect(reg.getPluginRef("forked")).toBeUndefined();
    // The parent keeps its ref untouched.
    expect(reg.getPluginRef("parent")).toEqual({ goalId: "g1" });
  });
});
