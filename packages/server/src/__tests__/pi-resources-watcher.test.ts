/**
 * pi-resources watcher: recreated / removed directories (CodeRabbit review).
 * See change: optimize-polling-hot-paths.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPiResourcesWatcher } from "../pi/pi-resources-watcher.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-res-w-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function setup() {
  const closed: string[] = [];
  const attached: string[] = [];
  const inodes = new Map<string, number>();
  const watcher = createPiResourcesWatcher({
    onInvalidate: vi.fn(),
    homeDir: path.join(tmp, "home"),
    inodeOf: (p) => inodes.get(p) ?? 1,
    watch: (dir) => {
      attached.push(dir);
      return { close: () => void closed.push(dir), on: () => ({}) as any } as any;
    },
  });
  return { watcher, closed, attached, inodes };
}

describe("pi-resources watcher reconcile", () => {
  it("re-attaches a resource dir that was removed and recreated (new inode)", () => {
    const { watcher, closed, attached, inodes } = setup();
    const cwd = path.join(tmp, "p");
    const skills = path.join(cwd, ".pi", "skills");
    fs.mkdirSync(skills, { recursive: true });
    watcher.attach(cwd);
    expect(attached).toContain(skills);
    // recreated at the same path: a different inode, the old watch is dead
    inodes.set(skills, 2);
    watcher.reconcile(cwd);
    expect(closed).toContain(skills);
    expect(attached.filter((d) => d === skills)).toHaveLength(2);
  });

  it("drops the watch of a directory that vanished, and re-attaches it when it returns", () => {
    const { watcher, closed, attached } = setup();
    const cwd = path.join(tmp, "q");
    const skills = path.join(cwd, ".pi", "skills");
    fs.mkdirSync(skills, { recursive: true });
    watcher.attach(cwd);
    fs.rmSync(skills, { recursive: true });
    watcher.reconcile(cwd);
    expect(closed).toContain(skills);
    fs.mkdirSync(skills);
    watcher.reconcile(cwd);
    expect(attached.filter((d) => d === skills)).toHaveLength(2);
  });

  it("an unchanged directory is not re-attached", () => {
    const { watcher, attached } = setup();
    const cwd = path.join(tmp, "r");
    fs.mkdirSync(path.join(cwd, ".pi", "skills"), { recursive: true });
    watcher.attach(cwd);
    const n = attached.length;
    watcher.reconcile(cwd);
    watcher.reconcile(cwd);
    expect(attached).toHaveLength(n);
  });
});
