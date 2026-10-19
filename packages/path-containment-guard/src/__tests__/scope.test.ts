import { describe, expect, it } from "vitest";
import { withPathContainmentGuard } from "../scope.js";

const guardEntry = (scope: { extensions?: string[] }) => scope.extensions?.at(-1) ?? "";

describe("withPathContainmentGuard (E19)", () => {
  it("builds the fragment with no base", () => {
    const s = withPathContainmentGuard({ allowedRoots: ["/w/repo"], deniedTools: ["bash"] });
    expect(s.extensions).toHaveLength(1);
    expect(guardEntry(s)).toMatch(/path-containment-guard[\\/]src[\\/]extension\.ts$/);
    expect(s.extensionConfig).toEqual({
      "path-containment-guard": { allowedRoots: ["/w/repo"], deniedTools: ["bash"] },
    });
  });

  it("merges into an existing scope, keeping both, without mutating the base", () => {
    const base = { extensions: ["/p/own.ts"], extensionConfig: { team: { root: "/w" } }, noMcp: true };
    const snapshot = structuredClone(base);
    const s = withPathContainmentGuard({ allowedRoots: ["/w/repo"] }, base);
    expect(s.extensions?.[0]).toBe("/p/own.ts");
    expect(s.extensions).toHaveLength(2);
    expect(s.extensionConfig).toMatchObject({ team: { root: "/w" }, "path-containment-guard": { allowedRoots: ["/w/repo"] } });
    expect(s.noMcp).toBe(true);
    expect(base).toEqual(snapshot);
  });

  it("throws when the base already holds a guard entry", () => {
    expect(() =>
      withPathContainmentGuard(
        { allowedRoots: ["/w/repo"] },
        { extensionConfig: { "path-containment-guard": { allowedRoots: ["/x"] } } },
      ),
    ).toThrow();
  });

  it("omitted deniedTools → no deniedTools key", () => {
    const s = withPathContainmentGuard({ allowedRoots: ["/w/repo"] });
    expect(Object.keys(s.extensionConfig["path-containment-guard"])).toEqual(["allowedRoots"]);
  });

  it.each([[[]], [["rel"]], [[""]]])("throws on unusable roots %j", (roots) => {
    expect(() => withPathContainmentGuard({ allowedRoots: roots as string[] })).toThrow();
  });

  it("throws on a malformed denied-tools entry", () => {
    expect(() => withPathContainmentGuard({ allowedRoots: ["/w/repo"], deniedTools: ["bash", ""] })).toThrow();
    expect(() => withPathContainmentGuard({ allowedRoots: ["/w/repo"], deniedTools: [7 as never] })).toThrow();
  });
});
