import { describe, expect, it } from "vitest";
import {
  MediaBudget,
  projectDirOf,
  type MediaProjectLimits,
  planMedia,
  parseProject,
  resolveMediaPath,
  restoreProject,
  rewriteProject,
} from "../media-project.js";

const MiB = 1024 * 1024;
const LIMITS: MediaProjectLimits = { projectMaxBytes: 16 * MiB, mediaMaxBytes: 64 * MiB, mediaMaxTotalBytes: 256 * MiB, mediaMaxFiles: 64 };
const enc = (s: string) => new TextEncoder().encode(s);

/** FilmCraft-shaped project: `project.items.<id>.kind.Media.media.File.path`. */
function project(paths: string[], extra: Record<string, unknown> = {}): string {
  const items: Record<string, unknown> = {};
  paths.forEach((p, i) => {
    items[String(i + 1)] = { name: `m${i}`, kind: { Media: { media: { File: { path: p } }, info: { name: `m${i}` } } } };
  });
  return JSON.stringify({ format: "filmcraft.project", schema_version: 15, project: { name: "p", items, ...extra } });
}

describe("parseProject (#E2 #E7)", () => {
  it("accepts exactly the cap and rejects cap + 1 before JSON.parse", () => {
    const base = project(["a.mp4"]);
    const pad = (n: number) => new Uint8Array(n).fill(0x20);
    const at = new Uint8Array(16 * MiB);
    at.set(enc(base));
    at.fill(0x20, enc(base).length);
    expect(parseProject(at, 16 * MiB)).not.toBeNull();
    const over = new Uint8Array(16 * MiB + 1);
    over.set(enc(base));
    over.fill(0x20, enc(base).length);
    expect(parseProject(over, 16 * MiB)).toBeNull();
    expect(pad(1).length).toBe(1);
  });
  it("is null for non-JSON and for JSON that is not a FilmCraft project", () => {
    expect(parseProject(enc("hello"), 16 * MiB)).toBeNull();
    expect(parseProject(enc('{"format":"x","project":{}}'), 16 * MiB)).toBeNull();
    expect(parseProject(enc('{"format":"filmcraft.project"}'), 16 * MiB)).toBeNull();
  });
  it("hostile keys are inert (no prototype pollution, no throw)", () => {
    const hostile =
      '{"format":"filmcraft.project","project":{"items":{"__proto__":{"polluted":1},"constructor":{"kind":{"Media":{"media":{"File":{"path":"__proto__"}}}}},"1":{"kind":{"Media":{"media":{"File":{"path":"clips/a.mp4"}}}}}}}}';
    const parsed = parseProject(enc(hostile), 16 * MiB);
    expect(parsed).not.toBeNull();
    const plan = planMedia(parsed!, "", "/w", LIMITS);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(plan.refs.map((r) => r.raw)).toContain("clips/a.mp4");
  });
});

describe("resolveMediaPath (#E5)", () => {
  const cwd = "/w";
  const dir = "edit";
  it("resolves in-folder relative and absolute paths to cwd-relative", () => {
    expect(resolveMediaPath(dir, "clips/a.mp4", cwd)).toBe("edit/clips/a.mp4");
    expect(resolveMediaPath(dir, "/w/edit/b.mp4", cwd)).toBe("edit/b.mp4");
    expect(resolveMediaPath("", "a.mp4", cwd)).toBe("a.mp4");
    expect(resolveMediaPath(dir, "./x/../a.mp4", cwd)).toBe("edit/a.mp4");
  });
  it("refuses everything that leaves the project folder or is not a plain posix path", () => {
    for (const p of ["../footage/c.mp4", "/etc/passwd", "clips/../../d.mp4", "C:\\x\\e.mp4", "a\\b.mp4", "", "/w/other/f.mp4", "/files/x.mp4", "a\0b.mp4"]) {
      expect(resolveMediaPath(dir, p, cwd), p).toBeNull();
    }
  });
});

describe("planMedia (#E1 #E4 #E6)", () => {
  const parse = (paths: string[]) => parseProject(enc(project(paths)), 16 * MiB)!;
  it("plans up to the file-count bound and counts the rest missing", () => {
    for (const [n, planned, missing] of [[63, 63, 0], [64, 64, 0], [65, 64, 1]] as const) {
      const plan = planMedia(parse(Array.from({ length: n }, (_, i) => `m${i}.mp4`)), "", "/w", LIMITS);
      expect(plan.refs.length).toBe(planned);
      expect(plan.missing).toBe(missing);
    }
  });
  it("keeps the order the project references them in", () => {
    const plan = planMedia(parse(["b.mp4", "a.mp4"]), "", "/w", { ...LIMITS, mediaMaxFiles: 1 });
    expect(plan.refs.map((r) => r.raw)).toEqual(["b.mp4"]);
    expect(plan.missing).toBe(1);
  });
  it("counts unresolvable paths missing and never plans them", () => {
    const plan = planMedia(parse(["clips/a.mp4", "../x.mp4", "/etc/passwd"]), "edit", "/w", LIMITS);
    expect(plan.refs.map((r) => r.readPath)).toEqual(["edit/clips/a.mp4"]);
    expect(plan.missing).toBe(2);
  });
  it("gives same-named files in different folders distinct VFS names and one name per distinct path", () => {
    const plan = planMedia(parse(["a/clip.mp4", "b/clip.mp4", "a/clip.mp4"]), "", "/w", LIMITS);
    expect(plan.refs.map((r) => r.vfsName)).toEqual(["clip.mp4", "2-clip.mp4"]);
  });
});

describe("MediaBudget (#E3)", () => {
  it("admits 64 MiB and refuses 64 MiB + 1", () => {
    expect(new MediaBudget(LIMITS).admit(64 * MiB)).toBe(true);
    expect(new MediaBudget(LIMITS).admit(64 * MiB + 1)).toBe(false);
  });
  it("admits 4 of 5 x 64 MiB (256 MiB total) and refuses the 5th", () => {
    const b = new MediaBudget(LIMITS);
    expect([1, 2, 3, 4, 5].map(() => b.admit(64 * MiB))).toEqual([true, true, true, true, false]);
  });
  it("a refused file does not consume the budget", () => {
    const b = new MediaBudget({ ...LIMITS, mediaMaxTotalBytes: 100 });
    expect(b.admit(150 * 1)).toBe(false);
    expect(b.admit(100)).toBe(true);
  });
});

describe("rewrite + restore (#E6 #E8)", () => {
  it("rewrites delivered paths to /files/<vfsName> and restores the exact original strings", () => {
    const src = project(["a/clip.mp4", "b/clip.mp4", "gone/x.mp4"]);
    const parsed = parseProject(enc(src), 16 * MiB)!;
    const plan = planMedia(parsed, "", "/w", LIMITS);
    const delivered = new Set(["a/clip.mp4", "b/clip.mp4"]);
    const { bytes, map } = rewriteProject(parsed, plan.refs.filter((r) => delivered.has(r.raw)));
    const out = JSON.parse(new TextDecoder().decode(bytes));
    const paths = Object.values(out.project.items).map((i) => (i as { kind: { Media: { media: { File: { path: string } } } } }).kind.Media.media.File.path);
    expect(paths).toEqual(["/files/clip.mp4", "/files/2-clip.mp4", "gone/x.mp4"]);
    const back = JSON.parse(new TextDecoder().decode(restoreProject(bytes, map)));
    expect(back).toEqual(JSON.parse(src));
  });
  it("leaves unmapped /files paths and undelivered paths byte-for-byte and stays valid JSON", () => {
    const saved = enc(project(["/files/clip.mp4", "/files/other.mp4", "clips/gone.mp4"]));
    const out = restoreProject(saved, new Map([["/files/clip.mp4", "clips/a.mp4"]]));
    const paths = Object.values(JSON.parse(new TextDecoder().decode(out)).project.items).map(
      (i) => (i as { kind: { Media: { media: { File: { path: string } } } } }).kind.Media.media.File.path,
    );
    expect(paths).toEqual(["clips/a.mp4", "/files/other.mp4", "clips/gone.mp4"]);
  });
  it("returns the input untouched when it is not JSON (the validator rejects it later)", () => {
    const junk = enc("not json");
    expect(restoreProject(junk, new Map([["/files/a", "b"]]))).toBe(junk);
  });
});

describe("projectDirOf + MediaBudget.limit", () => {
  it("returns the cwd-relative folder, or null outside the cwd", () => {
    expect(projectDirOf("/w", "edit/story.fcproj")).toBe("edit");
    expect(projectDirOf("/w", "/w/a/b/story.fcproj")).toBe("a/b");
    expect(projectDirOf("/w/", "story.fcproj")).toBe("");
    expect(projectDirOf("/w", "/elsewhere/story.fcproj")).toBeNull();
  });
  it("limit is the smaller of the per-file bound and what is left of the total", () => {
    const b = new MediaBudget({ ...LIMITS, mediaMaxBytes: 60, mediaMaxTotalBytes: 100 });
    expect(b.limit()).toBe(60);
    b.admit(60);
    expect(b.limit()).toBe(40);
  });
});
