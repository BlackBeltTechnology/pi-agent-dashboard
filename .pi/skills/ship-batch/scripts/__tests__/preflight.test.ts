import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupFixtures, FakeDashboard, makeFixture, seedGroup, sh } from "./fake-dashboard.ts";

afterEach(cleanupFixtures);

const noSideEffects = (fd: FakeDashboard) => {
  const wts = path.join(fd.fx.repo, ".worktrees");
  expect(fs.existsSync(path.join(wts, ".ship-batch"))).toBe(false);
  expect(fs.existsSync(wts) ? fs.readdirSync(wts).filter((f) => f.startsWith("os-")) : []).toEqual([]);
  expect(fd.spawned).toHaveLength(0);
  expect(fd.callsTo("POST", "")).toHaveLength(0);
};

const make = () => {
  const fx = makeFixture();
  const fd = new FakeDashboard(fx);
  seedGroup(fd, ["a"]);
  const errs: string[] = [];
  return { fx, fd, errs, over: { err: (l: string) => void errs.push(l) } };
};

describe("#X1 preflight", () => {
  it("(a) a non-headless spawnStrategy exits 1 with the reason", async () => {
    const { fd, errs, over } = make();
    fd.config = { spawnStrategy: "tmux" };
    expect(await fd.main(["--group", "g"], over)).toBe(1);
    expect(errs.join("\n")).toMatch(/headless/);
    noSideEffects(fd);
  });

  it("(b) a repository without origin exits 1", async () => {
    const { fx, fd, errs, over } = make();
    sh(fx.repo, "remote", "remove", "origin");
    expect(await fd.main(["--group", "g"], over)).toBe(1);
    expect(errs.join("\n")).toMatch(/origin/);
    noSideEffects(fd);
  });

  it("(c) an unreachable dashboard exits 1", async () => {
    const { fd, errs, over } = make();
    fd.unreachable = true;
    expect(await fd.main(["--group", "g"], over)).toBe(1);
    expect(errs.join("\n")).toMatch(/unreachable/);
    noSideEffects(fd);
  });

  it("a missing tool exits 1", async () => {
    const { fd, errs, over } = make();
    expect(await fd.main(["--group", "g"], { ...over, hasTool: (n) => n !== "openspec" })).toBe(1);
    expect(errs.join("\n")).toMatch(/openspec/);
    noSideEffects(fd);
  });

  it("an unknown group exits 1 listing the ids", async () => {
    const { fd, errs, over } = make();
    expect(await fd.main(["--group", "nope"], over)).toBe(1);
    expect(errs.join("\n")).toContain("g");
    noSideEffects(fd);
  });
});

describe("#X2 dependency retry bound", () => {
  const depCalls = (fd: FakeDashboard) => fd.callsTo("GET", "/api/openspec/dependencies");

  it("(a) 503 x10 aborts after 10 attempts naming the change, no side effects", async () => {
    const { fd, errs, over } = make();
    fd.rest503.set("a", 10);
    expect(await fd.main(["--group", "g"], over)).toBe(1);
    expect(depCalls(fd)).toHaveLength(10);
    expect(errs.join("\n")).toContain("a");
    noSideEffects(fd);
  });

  it("(b) 503 x9 then 200 proceeds", async () => {
    const { fd } = make();
    fd.rest503.set("a", 9);
    const runner = fd.runner();
    const { state } = await runner.plan("g");
    expect(state.items.map((i) => i.change)).toEqual(["a"]);
    expect(depCalls(fd)).toHaveLength(10);
  });

  it("(c) 404 aborts immediately", async () => {
    const { fd, errs, over } = make();
    fd.depStatus.set("a", 404);
    expect(await fd.main(["--group", "g"], over)).toBe(1);
    expect(depCalls(fd)).toHaveLength(1);
    expect(errs.join("\n")).toContain("a");
    noSideEffects(fd);
  });
});
