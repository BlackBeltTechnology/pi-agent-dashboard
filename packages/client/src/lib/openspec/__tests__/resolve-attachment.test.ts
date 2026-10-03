import type { ArchiveEntry } from "@blackbelt-technology/pi-dashboard-shared/archive-types.js";
import type { OpenSpecChange, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import { type ArchiveState, resolveAttachment } from "../resolve-attachment.js";

const change = (name: string): OpenSpecChange => ({ name, status: "in-progress", artifacts: [], completedTasks: 0, totalTasks: 0 }) as unknown as OpenSpecChange;
const known = (...names: string[]): OpenSpecData => ({ initialized: true, changes: names.map(change) });
const placeholder = (readiness: string, pending = false): OpenSpecData =>
  ({ initialized: false, pending, changes: [], readiness: { state: readiness } }) as unknown as OpenSpecData;
const entry = (name: string): ArchiveEntry => ({ name, date: name.slice(0, 10), artifacts: [{ id: "proposal", status: "done" }] });
const ok = (...names: string[]): ArchiveState => ({ status: "ok", entries: names.map(entry) });
const local = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

function run(opts: {
  name?: string;
  cwd?: string;
  mainPath?: string;
  startedAt?: number;
  active?: Record<string, OpenSpecData>;
  archives?: Record<string, ArchiveState>;
}) {
  const cwd = opts.cwd ?? "/repo";
  const getArchive = vi.fn((c: string): ArchiveState => opts.archives?.[c] ?? { status: "idle", entries: [] });
  const result = resolveAttachment(
    {
      attachedProposal: opts.name ?? "add-auth",
      cwd,
      startedAt: opts.startedAt ?? local(2026, 9, 20),
      gitWorktree: opts.mainPath ? ({ mainPath: opts.mainPath } as never) : undefined,
    },
    new Map(Object.entries(opts.active ?? {})),
    getArchive,
  );
  return { result, getArchive };
}

describe("resolveAttachment", () => {
  it("E1 active wins, no archive read", () => {
    const { result, getArchive } = run({ active: { "/repo": known("add-auth") } });
    expect(result).toMatchObject({ kind: "active", cwd: "/repo" });
    expect(getArchive).not.toHaveBeenCalled();
  });
  it("E2 archived in place", () => {
    const { result } = run({ active: { "/repo": known("b") }, archives: { "/repo": ok("2026-09-30-add-auth") } });
    expect(result).toMatchObject({ kind: "archived", cwd: "/repo" });
    expect((result as { entry: ArchiveEntry }).entry.name).toBe("2026-09-30-add-auth");
  });
  it("E3 removed worktree -> mainPath archive", () => {
    const { result } = run({
      cwd: "/repo/.worktrees/os-add-auth", mainPath: "/repo",
      active: { "/repo/.worktrees/os-add-auth": placeholder("ABSENT"), "/repo": known("b") },
      archives: { "/repo": ok("2026-09-30-add-auth") },
    });
    expect(result).toMatchObject({ kind: "archived", cwd: "/repo" });
  });
  it("E4 active in mainPath", () => {
    const { result } = run({
      cwd: "/repo/.worktrees/os-add-auth", mainPath: "/repo",
      active: { "/repo/.worktrees/os-add-auth": placeholder("ABSENT"), "/repo": known("add-auth") },
    });
    expect(result).toMatchObject({ kind: "active", cwd: "/repo" });
  });
  it("E5 nothing found", () => {
    const { result } = run({
      cwd: "/repo/.worktrees/w", mainPath: "/repo",
      active: { "/repo/.worktrees/w": known("b"), "/repo": known("b") },
      archives: { "/repo/.worktrees/w": ok(), "/repo": ok() },
    });
    expect(result).toEqual({ kind: "missing" });
  });
  it("E6 exact-name match + escaping", () => {
    expect(run({ active: { "/repo": known() }, archives: { "/repo": ok("2026-09-30-add-auth-v2") } }).result).toEqual({ kind: "missing" });
    expect(run({ name: "a.b", active: { "/repo": known() }, archives: { "/repo": ok("2026-09-30-a-b") } }).result).toEqual({ kind: "missing" });
  });
  const pick = (names: string[], startedAt: number, name = "add-auth") =>
    ((run({ name, startedAt, active: { "/repo": known() }, archives: { "/repo": ok(...names) } }).result) as { entry: ArchiveEntry }).entry.name;
  it("E7 on/after start", () => {
    expect(pick(["2026-09-30-add-auth", "2026-05-01-add-auth"], local(2026, 9, 20))).toBe("2026-09-30-add-auth");
  });
  it("E8 tz tolerance", () => {
    expect(pick(["2026-09-29-add-auth", "2026-05-01-add-auth"], local(2026, 9, 30, 0, 30))).toBe("2026-09-29-add-auth");
  });
  it("E9 fallback newest", () => {
    expect(pick(["2026-06-01-x", "2026-05-01-x"], local(2026, 9, 20), "x")).toBe("2026-06-01-x");
  });
  it("E10 unsettled = unresolved loading", () => {
    for (const active of [{} as Record<string, OpenSpecData>, { "/repo": placeholder("PENDING", true) }]) {
      const { result, getArchive } = run({ active });
      expect(result).toEqual({ kind: "unresolved", reason: "loading" });
      expect(getArchive).not.toHaveBeenCalled();
    }
  });
  it("initialized data with a stale pending flag is still known (no flip back to loading)", () => {
    const { result } = run({ active: { "/repo": { ...known("add-auth"), pending: true } } });
    expect(result).toMatchObject({ kind: "active", cwd: "/repo" });
  });
  it("E11 disabled folder", () => {
    for (const r of ["OPTED_OUT", "GLOBAL_OFF"]) {
      expect(run({ active: { "/repo": placeholder(r) } }).result).toEqual({ kind: "unresolved", reason: "disabled" });
    }
  });
  it("E12 mainPath gated = unavailable", () => {
    const { result } = run({
      cwd: "/repo/.worktrees/w", mainPath: "/repo",
      active: { "/repo/.worktrees/w": placeholder("ABSENT"), "/repo": placeholder("OPTED_OUT") },
      archives: { "/repo": ok("2026-09-30-add-auth") },
    });
    expect(result).toMatchObject({ kind: "archived", cwd: "/repo" });
  });
  it("E13 active beats archived", () => {
    const { result } = run({ active: { "/repo": known("add-auth") }, archives: { "/repo": ok("2026-05-01-add-auth") } });
    expect(result.kind).toBe("active");
  });
  it("E14 mainPath === cwd skips steps 2/4", () => {
    const { result, getArchive } = run({ mainPath: "/repo", active: { "/repo": known("b") }, archives: { "/repo": ok() } });
    expect(result).toEqual({ kind: "missing" });
    expect(getArchive.mock.calls.map((c) => c[0])).toEqual(["/repo"]);
  });
  it("archive loading -> unresolved loading; error -> unresolved error", () => {
    expect(run({ active: { "/repo": known() }, archives: { "/repo": { status: "loading", entries: [] } } }).result).toEqual({ kind: "unresolved", reason: "loading" });
    expect(run({ active: { "/repo": known() }, archives: { "/repo": { status: "error", entries: [] } } }).result).toEqual({ kind: "unresolved", reason: "error" });
  });
  it("error in cwd archive but match in mainPath archive resolves archived", () => {
    const { result } = run({
      cwd: "/repo/.worktrees/w", mainPath: "/repo",
      active: { "/repo/.worktrees/w": known(), "/repo": known() },
      archives: { "/repo/.worktrees/w": { status: "error", entries: [] }, "/repo": ok("2026-09-30-add-auth") },
    });
    expect(result).toMatchObject({ kind: "archived", cwd: "/repo" });
  });
});
