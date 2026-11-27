/**
 * Repository inputs are untrusted (task 7.36 #S3): names re-validated, change directories must be real
 * directories under `<repo>/openspec/changes/`, files are read only as regular files of at most 1 MiB
 * (`lstat`, never through a symlink, never blocking on a FIFO), `dependencies.yaml` has no alias expansion.
 * See change: add-agent-teams-openspec.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isChangeName, MAX_INPUT_BYTES, readBoundedFile, readChangeDependencies, readChangeTasks, readGroupsFile, resolveChangeDir } from "../inputs.js";
import { tmp } from "./env.js";

function repo(): string {
  const r = tmp("at-os-repo-");
  fs.mkdirSync(path.join(r, "openspec", "changes"), { recursive: true });
  return r;
}
const change = (r: string, name: string): string => {
  const d = path.join(r, "openspec", "changes", name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

describe("names are re-validated wherever they come from", () => {
  it.each(["../x", "a/b", "/abs", ".", "..", "", "A", "a--b", "-a", "a-", "x y", "x\u0000", "archive/..", "a".repeat(65)])("rejects %j", (v) => {
    expect(isChangeName(v)).toBe(false);
    expect(resolveChangeDir("/nonexistent", v)).toMatchObject({ ok: false, code: "invalid_name" });
  });

  it("accepts kebab names up to 64 characters", () => {
    for (const v of ["x", "a-b", "a1", "a-2", "1x", "a".repeat(64)]) expect(isChangeName(v)).toBe(true);
  });

  it("`archive` is not a change", () => {
    expect(resolveChangeDir("/x", "archive")).toMatchObject({ ok: false, code: "invalid_name" });
  });

  it("a huge key is a plain refusal, not a crash", () => {
    expect(isChangeName("a".repeat(1_000_000))).toBe(false);
  });
});

describe("change directories", () => {
  it("a real directory resolves", () => {
    const r = repo();
    change(r, "x");
    expect(resolveChangeDir(r, "x")).toEqual({ ok: true, dir: path.join(r, "openspec", "changes", "x") });
  });

  it("an absent directory is `absent`; a file is `not_directory`", () => {
    const r = repo();
    fs.writeFileSync(path.join(r, "openspec", "changes", "f"), "x");
    expect(resolveChangeDir(r, "nope")).toMatchObject({ ok: false, code: "absent" });
    expect(resolveChangeDir(r, "f")).toMatchObject({ ok: false, code: "not_directory" });
  });

  it("a change directory that is a symlink to /etc or to another repo is refused, and no file under it is read", async () => {
    const r = repo();
    const other = repo();
    fs.mkdirSync(path.join(other, "openspec", "changes", "x"), { recursive: true });
    fs.writeFileSync(path.join(other, "openspec", "changes", "x", "tasks.md"), "- [ ] other repo\n");
    fs.symlinkSync("/etc", path.join(r, "openspec", "changes", "etc"));
    fs.symlinkSync(path.join(other, "openspec", "changes", "x"), path.join(r, "openspec", "changes", "x"));
    for (const name of ["etc", "x"]) {
      expect(resolveChangeDir(r, name)).toMatchObject({ ok: false, code: "not_directory" });
      expect(readChangeTasks(r, name)).toMatchObject({ ok: false });
      await expect(readChangeDependencies(r, name)).resolves.toMatchObject({ kind: "invalid" });
    }
  });

  it("a symlinked `openspec/changes` (the whole tree redirected) is refused by the realpath check", () => {
    const r = tmp("at-os-repo-");
    const elsewhere = tmp("at-os-else-");
    fs.mkdirSync(path.join(elsewhere, "x"), { recursive: true });
    fs.mkdirSync(path.join(r, "openspec"), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(r, "openspec", "changes"));
    expect(resolveChangeDir(r, "x")).toMatchObject({ ok: false, code: "not_directory" });
  });
});

describe("regular files only, at most 1 MiB", () => {
  it("reads a regular file; exactly 1 MiB passes, 1 MiB + 1 does not", () => {
    const r = repo();
    const d = change(r, "x");
    fs.writeFileSync(path.join(d, "tasks.md"), "a".repeat(MAX_INPUT_BYTES));
    expect(readChangeTasks(r, "x")).toMatchObject({ ok: true });
    fs.writeFileSync(path.join(d, "tasks.md"), "a".repeat(MAX_INPUT_BYTES + 1));
    expect(readChangeTasks(r, "x")).toEqual({ ok: false, code: "too_large" });
  });

  it("a sparse 100 MB file is refused from its size, without reading it", () => {
    const r = repo();
    const d = change(r, "x");
    fs.closeSync(fs.openSync(path.join(d, "tasks.md"), "w"));
    fs.truncateSync(path.join(d, "tasks.md"), 100 * 1024 * 1024);
    const t0 = Date.now();
    expect(readChangeTasks(r, "x")).toEqual({ ok: false, code: "too_large" });
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("a FIFO is refused immediately (never blocks on a writer)", () => {
    const r = repo();
    const d = change(r, "x");
    execFileSync("mkfifo", [path.join(d, "tasks.md")]);
    const t0 = Date.now();
    expect(readChangeTasks(r, "x")).toEqual({ ok: false, code: "not_regular" });
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("a symlinked tasks.md / groups.json is not followed", () => {
    const r = repo();
    const d = change(r, "x");
    fs.symlinkSync("/etc/hosts", path.join(d, "tasks.md"));
    expect(readChangeTasks(r, "x")).toEqual({ ok: false, code: "not_regular" });
    fs.mkdirSync(path.join(r, "openspec", "groups"), { recursive: true });
    fs.symlinkSync("/etc/hosts", path.join(r, "openspec", "groups", "groups.json"));
    expect(readGroupsFile(r)).toEqual({ ok: false, code: "not_regular" });
  });

  it("a missing file is `absent`, an unreadable name is `unreadable`/`absent`, never a throw", () => {
    const r = repo();
    change(r, "x");
    expect(readChangeTasks(r, "x")).toEqual({ ok: false, code: "absent" });
    expect(readGroupsFile(r)).toEqual({ ok: false, code: "absent" });
    expect(readBoundedFile(path.join(r, "openspec", "nope", "deeper", "f"))).toEqual({ ok: false, code: "absent" });
  });

  it("the cap is a parameter and never exceeds what was asked", () => {
    const r = repo();
    const f = path.join(r, "f.txt");
    fs.writeFileSync(f, "12345");
    expect(readBoundedFile(f, 5)).toEqual({ ok: true, text: "12345" });
    expect(readBoundedFile(f, 4)).toEqual({ ok: false, code: "too_large" });
  });
});

describe("dependencies.yaml", () => {
  const write = (r: string, text: string): void => fs.writeFileSync(path.join(change(r, "x"), "dependencies.yaml"), text);

  it("a valid file parses; an absent one is `absent`", async () => {
    const r = repo();
    change(r, "x");
    expect(await readChangeDependencies(r, "x")).toEqual({ kind: "absent" });
    write(r, "blocked_by:\n  - change: a\n");
    expect(await readChangeDependencies(r, "x")).toMatchObject({ kind: "ok", value: { blockedBy: [{ change: "a" }] } });
  });

  it("a YAML bomb (anchors/aliases) is refused without expansion", async () => {
    const r = repo();
    const levels = ["a: &a [x, x, x, x, x, x, x, x, x]"];
    for (let i = 0; i < 9; i++) levels.push(`${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [${Array(9).fill(`*${String.fromCharCode(97 + i)}`).join(", ")}]`);
    write(r, `${levels.join("\n")}\n`);
    const t0 = Date.now();
    expect(await readChangeDependencies(r, "x")).toMatchObject({ kind: "invalid" });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("a symlink, a FIFO and a 100 MB file are `invalid` (that change is skipped, the read never blocks)", async () => {
    const r = repo();
    const d = change(r, "x");
    fs.symlinkSync("/etc/hosts", path.join(d, "dependencies.yaml"));
    expect(await readChangeDependencies(r, "x")).toMatchObject({ kind: "invalid" });
    fs.rmSync(path.join(d, "dependencies.yaml"));
    execFileSync("mkfifo", [path.join(d, "dependencies.yaml")]);
    expect(await readChangeDependencies(r, "x")).toMatchObject({ kind: "invalid" });
    fs.rmSync(path.join(d, "dependencies.yaml"));
    fs.closeSync(fs.openSync(path.join(d, "dependencies.yaml"), "w"));
    fs.truncateSync(path.join(d, "dependencies.yaml"), 100 * 1024 * 1024);
    expect(await readChangeDependencies(r, "x")).toMatchObject({ kind: "invalid" });
  });

  it("an unparseable file or a bad change name inside is `invalid`", async () => {
    const r = repo();
    write(r, "blocked_by: [\n");
    expect(await readChangeDependencies(r, "x")).toMatchObject({ kind: "invalid" });
    write(r, "blocked_by:\n  - ../evil\n");
    expect(await readChangeDependencies(r, "x")).toMatchObject({ kind: "invalid" });
  });
});
