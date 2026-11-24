/**
 * L1 save atomicity (scenario-gate C11 / test-plan #GC11): the temp file lives in the TARGET directory and is hard-linked
 * into place (never a cross-directory move, never an overwrite); a failed commit leaves no temp. Wraps `link` to observe
 * the temp path. See change: add-google-connect.
 */
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  return { ...real, link: vi.fn(real.link) };
});
const { commitSave, planSave } = await import("../workspace-path.js");

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "google-temp-"));
  vi.mocked(fsp.link).mockClear();
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("#GC11 temp file in the target directory", () => {
  it("writes `.pi-google-*.tmp` next to the final path (new parent dirs included), links it into place and leaves only the file", async () => {
    await commitSave(await planSave(cwd, "out/deep/r.bin"), Buffer.from("abc"));
    const [tmp, final] = vi.mocked(fsp.link).mock.calls[0] as [string, string];
    expect(path.dirname(tmp)).toBe(path.dirname(final));
    expect(path.basename(tmp)).toMatch(/^\.pi-google-[0-9a-f]+\.tmp$/);
    expect(path.dirname(final)).toBe(path.join(realpathSync(cwd), "out", "deep"));
    expect(readdirSync(path.dirname(final))).toEqual(["r.bin"]);
  });

  it("a failed commit (the final path appeared meanwhile) removes the temp and reports `exists`", async () => {
    const plan = await planSave(cwd, "r.bin");
    vi.mocked(fsp.link).mockRejectedValueOnce(Object.assign(new Error("EEXIST"), { code: "EEXIST" }));
    await expect(commitSave(plan, Buffer.from("abc"))).rejects.toMatchObject({ code: "exists" });
    expect(readdirSync(cwd)).toEqual([]);
  });
});
