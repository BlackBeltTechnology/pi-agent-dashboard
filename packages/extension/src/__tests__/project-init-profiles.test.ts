/**
 * Profile resolver: shipped ∪ user, user-wins-by-name; dox flag default + explicit.
 * See change: project-init-skill-and-profiles.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveProfiles, readProfile, shippedProfilesDir } from "../project-init/profiles.js";

function makeProfile(root: string, name: string, opts: { dox?: boolean; description?: string } = {}): string {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "prompts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md.tmpl"), "# tmpl\n");
  fs.writeFileSync(path.join(dir, "settings.json.tmpl"), "{}\n");
  const manifest: Record<string, unknown> = {};
  if (opts.dox !== undefined) manifest.dox = opts.dox;
  if (opts.description) manifest.description = opts.description;
  fs.writeFileSync(path.join(dir, "profile.json"), JSON.stringify(manifest));
  return dir;
}

describe("project-init profile resolver", () => {
  let tmp: string;
  let shipped: string;
  let user: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-profiles-"));
    shipped = path.join(tmp, "shipped");
    user = path.join(tmp, "user");
    fs.mkdirSync(shipped, { recursive: true });
    fs.mkdirSync(user, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns shipped profiles when no user profiles exist", () => {
    makeProfile(shipped, "coding");
    makeProfile(shipped, "docs");
    const profiles = resolveProfiles({ shippedDir: shipped, userDir: user });
    expect(profiles.map((p) => p.name)).toEqual(["coding", "docs"]);
    expect(profiles.every((p) => p.source === "shipped")).toBe(true);
  });

  it("user profile overrides shipped by name", () => {
    makeProfile(shipped, "coding", { description: "shipped coding" });
    makeProfile(user, "coding", { description: "user coding" });
    const profiles = resolveProfiles({ shippedDir: shipped, userDir: user });
    const coding = profiles.find((p) => p.name === "coding");
    expect(coding?.source).toBe("user");
    expect(coding?.description).toBe("user coding");
  });

  it("user profiles add to the set", () => {
    makeProfile(shipped, "coding");
    makeProfile(user, "research");
    const names = resolveProfiles({ shippedDir: shipped, userDir: user }).map((p) => p.name);
    expect(names).toEqual(["coding", "research"]);
  });

  it("dox defaults to false and honors an explicit true", () => {
    makeProfile(shipped, "plain");
    makeProfile(shipped, "doxed", { dox: true });
    const profiles = resolveProfiles({ shippedDir: shipped, userDir: user });
    expect(profiles.find((p) => p.name === "plain")?.dox).toBe(false);
    expect(profiles.find((p) => p.name === "doxed")?.dox).toBe(true);
  });

  it("rejects a directory missing required templates", () => {
    const dir = path.join(shipped, "broken");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENTS.md.tmpl"), "# only one template\n");
    expect(readProfile(dir, "shipped")).toBeNull();
  });

  it("the shipped profiles ship coding and docs", () => {
    const names = resolveProfiles({ shippedDir: shippedProfilesDir(), userDir: user }).map((p) => p.name);
    expect(names).toContain("coding");
    expect(names).toContain("docs");
  });
});
