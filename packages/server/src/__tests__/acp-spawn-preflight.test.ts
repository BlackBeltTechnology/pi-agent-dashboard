/**
 * ACP preflight replaces the pi/tmux preflight. See change: add-acp-session-driver
 * (test-plan #X6).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { preflightAcpSpawn } from "../spawn-process/acp-spawn.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-pf-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const agent = (command: string, durable = false) => ({ id: "qmt", name: "q", command, args: [], env: {}, durable });

describe("preflightAcpSpawn", () => {
  it("X6: missing cwd and an agent command not on PATH are reported together", () => {
    const r = preflightAcpSpawn("/definitely/not/here", agent("definitely-not-a-command-xyz"));
    expect(r.ok).toBe(false);
    expect(r.reasons.map((x) => x.code).sort()).toEqual(["acp_command_missing", "cwd_missing"]);
  });

  it("ok for an existing cwd and an absolute executable path", () => {
    const bin = path.join(dir, "agent");
    fs.writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
    expect(preflightAcpSpawn(dir, agent(bin))).toEqual({ ok: true, reasons: [] });
  });

  it("a bare command is resolved on PATH", () => {
    expect(preflightAcpSpawn(dir, agent("node")).ok).toBe(true);
  });

  it("a file instead of a directory is rejected", () => {
    const f = path.join(dir, "f");
    fs.writeFileSync(f, "x");
    expect(preflightAcpSpawn(f, agent("node")).reasons.map((r) => r.code)).toContain("cwd_not_directory");
  });
});
