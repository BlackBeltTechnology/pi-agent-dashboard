/**
 * `admitRouteCwd` / `listKnownFolderCwds`: the route-boundary wrapper over the shared tri-state guard.
 * See change: core-cwd-admission (tasks 1.3).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admissionAllows, releaseAdmission } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import type { GitProbeRunner } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  admitRouteCwd,
  CWD_ADMISSION_UNAVAILABLE_BODY,
  listKnownFolderCwds,
  sendAdmissionUnavailable,
} from "../route-admission.js";

const made: string[] = [];
afterAll(() => {
  for (const p of made) rmSync(p, { recursive: true, force: true });
});
function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "route-adm-")));
  made.push(dir);
  execFileSync("git", ["-c", "init.defaultBranch=main", "init"], { cwd: dir, stdio: "ignore" });
  return dir;
}

describe("listKnownFolderCwds", () => {
  it("is session cwds ∪ pinned directories, deduplicated and unfiltered", () => {
    const set = listKnownFolderCwds({
      sessionManager: { listAll: () => [{ cwd: "/a" }, { cwd: "/b" }, { cwd: "" }, {}] },
      preferencesStore: { getPinnedDirectories: () => ["/b", "/c"], getWorkspaces: () => [] },
    });
    expect(set.sort()).toEqual(["/a", "/b", "/c"]);
  });

  it("also includes every workspace folder, each once (core-file-cwd-admission D8)", () => {
    const set = listKnownFolderCwds({
      sessionManager: { listAll: () => [{ cwd: "/a" }] },
      preferencesStore: {
        getPinnedDirectories: () => ["/b"],
        getWorkspaces: () => [{ folders: ["/b", "/c"] }, { folders: ["/c", "/d"] }],
      },
    });
    expect(set.sort()).toEqual(["/a", "/b", "/c", "/d"]);
  });
});

describe("admitRouteCwd", () => {
  it("admits a known cwd and the token is bound to the exact request string", async () => {
    const repo = makeRepo();
    const adm = await admitRouteCwd(repo, { knownCwds: () => [repo] });
    expect(adm.kind).toBe("admit");
    expect(admissionAllows(adm, repo)).toBe(true);
    expect(admissionAllows(adm, `${repo}/`)).toBe(false);
    if (adm.kind === "admit") releaseAdmission(adm.token);
  });

  it("uses the known-set function it is given on every call (live, not a snapshot)", async () => {
    const repo = makeRepo();
    const known: string[] = [];
    const deps = { knownCwds: () => known };
    expect((await admitRouteCwd(repo, deps)).kind).toBe("refuse");
    known.push(repo);
    expect((await admitRouteCwd(repo, deps)).kind).toBe("admit");
  });

  it("fails closed when no known set is supplied", async () => {
    expect((await admitRouteCwd(makeRepo())).kind).toBe("refuse");
  });

  it("indeterminate: calls the supplied logger once and returns the verdict unchanged", async () => {
    const repo = makeRepo();
    const onIndeterminate = vi.fn();
    const runner: GitProbeRunner = async () => ({ ok: false, error: { kind: "spawn-failure", message: "EAGAIN" } });
    const adm = await admitRouteCwd(repo, { knownCwds: () => [], admitOptions: { runner, onIndeterminate } });
    expect(adm.kind).toBe("indeterminate");
    expect(onIndeterminate).toHaveBeenCalledTimes(1);
  });

  it("honours the admitOptions seam (injected realpath)", async () => {
    const realpath = vi.fn(async (p: string) => ({ kind: "ok" as const, path: p }));
    await admitRouteCwd("/definitely/not/here", { knownCwds: () => [], admitOptions: { realpath } });
    expect(realpath).toHaveBeenCalled();
  });
});

describe("sendAdmissionUnavailable", () => {
  it("sets 503 + Retry-After: 1 and returns the shared body", () => {
    const calls: Array<[string, unknown]> = [];
    const reply = {
      code(n: number) {
        calls.push(["code", n]);
        return reply;
      },
      header(k: string, v: string) {
        calls.push(["header", [k, v]]);
        return reply;
      },
    };
    expect(sendAdmissionUnavailable(reply)).toBe(CWD_ADMISSION_UNAVAILABLE_BODY);
    expect(calls).toEqual([["code", 503], ["header", ["Retry-After", "1"]]]);
    expect(CWD_ADMISSION_UNAVAILABLE_BODY).toEqual({
      success: false,
      code: "cwd-admission-unavailable",
      error: "cwd-admission-unavailable",
      message: "cwd admission could not be decided right now",
      retryAfterMs: 1000,
    });
  });
});
