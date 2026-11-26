import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adopt } from "../scheduler.ts";
import type { SessionObs } from "../types.ts";
import { T0 } from "./helpers.ts";

const WT = "/repo/.worktrees/os-x";
const ident = (p: string) => p;
const s = (id: string, over: Partial<SessionObs> = {}): SessionObs => ({ id, cwd: WT, status: "idle", startedAt: T0 + 10, ...over });
const run = (sessions: SessionObs[], realpath = ident) => adopt({ worktree: WT, spawnRequestedAt: T0, sessions, realpath });

describe("#E20 session adoption", () => {
  it("(a) one non-ended session started at/after spawnRequestedAt is adopted", () => {
    expect(run([s("a")])).toEqual({ kind: "adopted", sessionId: "a" });
    expect(run([s("a", { startedAt: T0 })])).toEqual({ kind: "adopted", sessionId: "a" });
  });
  it("(b) a session that started before is not adopted", () => expect(run([s("a", { startedAt: T0 - 1 })])).toEqual({ kind: "none" }));
  it("(c) an ended session is not adopted", () => expect(run([s("a", { status: "ended" })])).toEqual({ kind: "none" }));
  it("(d) two matching sessions are ambiguous, none adopted", () => {
    expect(run([s("a"), s("b")])).toEqual({ kind: "ambiguous", sessionIds: ["a", "b"] });
  });
  it("(e) a symlinked cwd is matched by realpath", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adopt-"));
    const real = path.join(dir, "real");
    const link = path.join(dir, "link");
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);
    const r = adopt({
      worktree: real,
      spawnRequestedAt: T0,
      sessions: [s("a", { cwd: link })],
      realpath: (p) => fs.realpathSync(p),
    });
    expect(r).toEqual({ kind: "adopted", sessionId: "a" });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
