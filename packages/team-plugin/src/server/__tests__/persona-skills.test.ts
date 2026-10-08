/**
 * Persona skill validation: shared targets, private owner, fork filtering
 * (test-plan E20–E22). See change: add-team-skill-access.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TeamConfig } from "../types.js";
import { API, type Harness, makeHarness, persona } from "./harness.js";

let h: Harness;
afterEach(async () => h?.close());

const ADMIN = { iss: "https://iss", sub: "root" };
const admin = (method: string, url: string, body?: unknown) => h.call(method, url, { user: "root", body });

function twoProjects(config: TeamConfig): void {
  config.projects = {
    billing: { name: "B", path: h.dir("billing"), users: "*" },
    crm: { name: "C", path: h.dir("crm"), users: "*" },
  };
}

function skillDir(name: string): string {
  const dir = h.dir(`skills/${name}`);
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\nbody\n`);
  return dir;
}

describe("persona skill validation (E20–E22)", () => {
  it("E20: shared persona skills must be allowed for every assigned target", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    twoProjects(config);
    await admin("POST", `${API}/skills`, { name: "review", path: skillDir("review"), targets: ["billing"] });
    const bad = await admin("POST", `${API}/personas`, { ...persona("p1"), scope: "shared", projects: ["billing", "crm"], skills: ["review"] });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ error: "invalid_persona", fields: { skills: "skill_not_allowed" } });
    expect((await admin("GET", `${API}/personas`)).json.personas).toHaveLength(0);
    expect((await admin("PATCH", `${API}/skills/review`, { targets: "*" })).status).toBe(200);
    expect((await admin("POST", `${API}/personas`, { ...persona("p2"), scope: "shared", projects: ["billing", "crm"], skills: ["review"] })).status).toBe(201);
    expect((await admin("PATCH", `${API}/skills/review`, { targets: ["billing", "crm"] })).status).toBe(200);
    expect((await admin("POST", `${API}/personas`, { ...persona("p3"), scope: "shared", projects: ["billing", "crm"], skills: ["review"] })).status).toBe(201);
  });

  it("E21: private persona skill must be allowed for the owner (multi refuses, single ignores users)", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    await admin("POST", `${API}/skills`, { name: "review", path: skillDir("review"), users: [{ iss: "https://iss", sub: "bob" }] });
    const bad = await h.call("POST", `${API}/personas`, { user: "alice", body: persona("mine", { skills: ["review"] }) });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ error: "invalid_persona", fields: { skills: "skill_not_allowed" } });
    await h.close();
    h = await makeHarness({ mode: "single" });
    expect((await h.call("POST", `${API}/skills`, { body: { name: "review", path: skillDir("review"), users: [{ iss: "x", sub: "bob" }] } })).status).toBe(201);
    expect((await h.call("POST", `${API}/personas`, { body: persona("mine2", { skills: ["review"] }) })).status).toBe(201);
  });

  it("E22: fork keeps only the skills allowed for the forking user", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    await admin("POST", `${API}/skills`, { name: "review", path: skillDir("review"), users: [{ iss: "https://iss", sub: "bob" }] });
    await admin("POST", `${API}/skills`, { name: "all-ok", path: skillDir("all-ok") });
    const shared = await admin("POST", `${API}/personas`, { ...persona("backend"), scope: "shared", skills: ["review", "all-ok"] });
    expect(shared.status).toBe(201);
    const fork = await h.call("POST", `${API}/personas/${encodeURIComponent("shared:backend")}/fork`, { user: "alice", body: {} });
    expect(fork.status).toBe(201);
    expect(fork.json.skills).toEqual(["all-ok"]);
  });
});
