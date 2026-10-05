/**
 * Projects: admin config, allowlists, folder-enabled projects, matching
 * (E30, E31, E36, E48–E51, X10, X14 server side). See change: add-team-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { API, type Harness, makeHarness, persona } from "./harness.js";
import type { TeamConfig } from "../types.js";

let h: Harness;
afterEach(async () => h?.close());

const ADMIN = { iss: "https://iss", sub: "root" };
const ALICE = { iss: "https://iss", sub: "alice" };

describe("config projects (E30, E31)", () => {
  it("E30: only valid projects are listed; invalid ones are logged with id + reason, no path", async () => {
    const config: TeamConfig = { admins: [ADMIN], projects: {} };
    h = await makeHarness({ config });
    const good = h.dir("good");
    const file = path.join(h.tmp, "afile");
    fs.writeFileSync(file, "x");
    const inPi = h.dir(".pi/sub");
    const intoTeam = path.join(h.tmp, "link-to-team");
    fs.mkdirSync(h.home, { recursive: true });
    fs.symlinkSync(h.home, intoTeam);
    config.projects = {
      rel: { name: "rel", path: "relative/path", users: "*" },
      missing: { name: "missing", path: path.join(h.tmp, "nope"), users: "*" },
      file: { name: "file", path: file, users: "*" },
      home: { name: "home", path: h.tmp, users: "*" },
      pi: { name: "pi", path: inPi, users: "*" },
      link: { name: "link", path: intoTeam, users: "*" },
      good: { name: "Good", path: good, users: "*" },
    };
    const r = await h.call("GET", `${API}/projects`, { user: "root" });
    expect(r.status).toBe(200);
    expect(r.json.projects.map((p: { id: string }) => p.id)).toEqual(["good"]);
    for (const [id, reason] of [
      ["rel", "not_absolute"],
      ["missing", "missing"],
      ["file", "not_directory"],
      ["home", "overlaps_protected_dir"],
      ["pi", "overlaps_protected_dir"],
      ["link", "overlaps_protected_dir"],
    ]) {
      const line = h.logs.find((l) => l.includes("team.project_invalid") && l.includes(`projectId=${id} `));
      expect(line, id).toContain(`reason=${reason}`);
      expect(line).not.toContain(h.tmp);
    }
  });

  it("E31: allowlist decides visibility; unknown and disallowed ids look the same; path only for admins", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    const all = h.dir("all");
    const only = h.dir("only-alice");
    config.projects = {
      all: { name: "All", path: all, users: "*" },
      only: { name: "Only", path: only, users: [ALICE] },
    };
    await h.call("POST", `${API}/personas`, { user: "root", body: { ...persona("a"), scope: "shared", projects: ["all", "only"] } });
    const ids = async (u: string) => (await h.call("GET", `${API}/projects`, { user: u })).json.projects.map((p: { id: string }) => p.id).sort();
    expect(await ids("alice")).toEqual(["all", "only"]);
    expect(await ids("bob")).toEqual(["all"]);
    const key = encodeURIComponent("shared:a");
    const bob = await h.call("POST", `${API}/agents/${key}/conversations?project=only`, { user: "bob" });
    const unknown = await h.call("POST", `${API}/agents/${key}/conversations?project=zzz`, { user: "bob" });
    expect(bob.status).toBe(404);
    expect(bob.json.error).toBe("project_not_found");
    expect(unknown.json).toEqual(bob.json);
    expect(h.host.spawns.length).toBe(0);
    const aliceView = (await h.call("GET", `${API}/projects`, { user: "alice" })).json.projects[0];
    const adminView = (await h.call("GET", `${API}/projects`, { user: "root" })).json.projects[0];
    expect(aliceView.path).toBeUndefined();
    expect(adminView.path).toBeDefined();
  });

  it("E31 (single-user): users are ignored, every valid project is usable", async () => {
    const config: TeamConfig = {};
    h = await makeHarness({ mode: "single", config });
    config.projects = { p: { name: "P", path: h.dir("p"), users: [ALICE] } };
    expect((await h.call("GET", `${API}/projects`)).json.projects.length).toBe(1);
  });
});

describe("folder-enabled projects (E48–E51)", () => {
  const setup = async (mode: "single" | "multi" = "multi") => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ mode, config });
    return config;
  };
  const user = (mode: string, who: "admin" | "bob") => (mode === "single" ? undefined : who === "admin" ? "root" : "bob");

  it("E48: nearest containing allowed project wins; worktrees never match; no leak; no spawns", async () => {
    const config = await setup();
    const repo = h.dir("repo");
    const billing = h.dir("repo/billing-api");
    h.dir("repo/billing-api/src");
    h.dir("repo/other");
    const wt = h.dir("repo/billing-api-wt");
    const crm = h.dir("repo/crm-web");
    const elsewhere = h.dir("elsewhere");
    fs.symlinkSync(billing, path.join(h.tmp, "l"));
    config.projects = {
      repo: { name: "Repo", path: repo, users: "*" },
      billing: { name: "Billing", path: billing, users: [ALICE] },
      crm: { name: "CRM", path: crm, users: [{ iss: "https://iss", sub: "nobody" }] },
    };
    const match = async (cwds: string[]) =>
      (await h.call("POST", `${API}/projects/match`, { user: "alice", body: { cwds } })).json.results.map((r: { project: { id: string } | null }) => r.project?.id ?? null);
    expect(await match([billing, path.join(billing, "src"), path.join(repo, "other"), path.join(h.tmp, "l"), crm, elsewhere, wt])).toEqual([
      "billing",
      "billing",
      "repo",
      "billing",
      "repo", // crm not allowed for alice → falls back to the containing repo project
      null,
      "repo",
    ]);
    expect(h.host.spawns.length).toBe(0);
    const bad = await h.call("POST", `${API}/projects/match`, { user: "alice", body: { cwds: [] } });
    expect(bad.status).toBe(400);
  });

  it("E49: enable gates and validation", async () => {
    for (const mode of ["single", "multi"] as const) {
      await setup(mode);
      const dir = h.dir("mkt");
      const post = (u: string | undefined, p: string) => h.call("POST", `${API}/projects`, { user: u, body: { path: p } });
      const adminU = user(mode, "admin");
      const r1 = await post(adminU, dir);
      expect(r1.status, mode).toBe(201);
      expect(r1.json.id).toBe("mkt");
      expect((await post(adminU, dir)).json.error).toBe("project_exists");
      expect((await post(adminU, h.tmp)).json.error).toBe("invalid_project"); // contains team home
      expect((await post(adminU, h.dir(".pi/x"))).status).toBe(400);
      expect((await post(adminU, path.join(h.tmp, "missing"))).status).toBe(400);
      if (mode === "multi") {
        expect((await post("bob", h.dir("other"))).status).toBe(403);
        expect(fs.existsSync(path.join(h.home, "projects.json"))).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(h.home, "projects.json"), "utf8")).projects.length).toBe(1);
      }
      await h.close();
    }
  });

  it("E49: id is the basename slug, uniquified against config ids", async () => {
    const config = await setup();
    const a = h.dir("a/billing");
    const b = h.dir("b/billing");
    config.projects = { billing: { name: "B", path: a, users: "*" } };
    const r = await h.call("POST", `${API}/projects`, { user: "root", body: { path: b } });
    expect(r.json.id).toBe("billing-2");
  });

  it("E50: config projects are read-only; disabling keeps records; re-enable restores", async () => {
    const config = await setup();
    config.projects = { billing: { name: "B", path: h.dir("billing"), users: "*" } };
    const mkt = h.dir("mkt");
    await h.call("POST", `${API}/projects`, { user: "root", body: { path: mkt, users: "*" } });
    await h.call("POST", `${API}/personas`, { user: "alice", body: persona("w", { projects: ["_ws"] }) });
    expect((await h.call("PATCH", `${API}/projects/billing`, { user: "root", body: { name: "x" } })).json.error).toBe("project_readonly");
    expect((await h.call("DELETE", `${API}/projects/billing`, { user: "root" })).json.error).toBe("project_readonly");
    // shared persona on mkt with two conversations
    await h.call("POST", `${API}/personas`, { user: "root", body: { ...persona("sh"), scope: "shared", projects: ["mkt"] } });
    const key = encodeURIComponent("shared:sh");
    const c1 = await h.call("POST", `${API}/agents/${key}/conversations?project=mkt`, { user: "alice" });
    await h.call("POST", `${API}/agents/${key}/conversations?project=mkt`, { user: "alice" });
    expect(c1.status).toBe(201);
    const del = await h.call("DELETE", `${API}/projects/mkt`, { user: "root" });
    expect(del.status).toBe(200);
    const ens = await h.call("POST", `${API}/agents/${key}/conversations/${c1.json.id}/session?project=mkt`, { user: "alice" });
    expect(ens.status).toBe(409);
    expect(ens.json.error).toBe("project_unavailable");
    await h.call("POST", `${API}/projects`, { user: "root", body: { path: mkt, name: "mkt", users: "*" } });
    const back = await h.call("POST", `${API}/agents/${key}/conversations/${c1.json.id}/session?project=mkt`, { user: "alice" });
    expect(back.status).toBe(200);
    const list = await h.call("GET", `${API}/agents/${key}/conversations?project=mkt`, { user: "alice" });
    expect(list.json.conversations.length).toBe(2);
  });

  it("E51: /me records users; /users is admin-only and absent in single-user", async () => {
    await setup();
    await h.call("GET", `${API}/me`, { user: "alice" });
    await h.call("GET", `${API}/me`, { user: "bob" });
    const adminList = await h.call("GET", `${API}/users`, { user: "root" });
    expect(adminList.status).toBe(200);
    expect(adminList.json.users.map((u: { sub: string }) => u.sub).sort()).toEqual(["alice", "bob"]);
    expect(adminList.json.users[0].lastSeenAt).toBeTruthy();
    expect((await h.call("GET", `${API}/users`, { user: "bob" })).status).toBe(403);
    await h.close();
    await setup("single");
    expect((await h.call("GET", `${API}/users`)).status).toBe(404);
  });
});

describe("unavailable project (X10)", () => {
  it("deleted directory ⇒ 409 project_unavailable, available:false, record kept", async () => {
    const config: TeamConfig = {};
    h = await makeHarness({ config });
    const dir = h.dir("proj");
    config.projects = { proj: { name: "P", path: dir, users: "*" } };
    await h.call("POST", `${API}/personas`, { user: "alice", body: { ...persona("w"), projects: ["_ws"] } });
    // private persona may use proj
    await h.call("PUT", `${API}/personas/${encodeURIComponent("private:w")}`, { user: "alice", body: { name: "w", instructions: "x", projects: ["_ws", "proj"] } });
    const key = encodeURIComponent("private:w");
    const c = await h.call("POST", `${API}/agents/${key}/conversations?project=proj`, { user: "alice" });
    expect(c.status).toBe(201);
    fs.rmSync(dir, { recursive: true, force: true });
    const spawnsBefore = h.host.spawns.length;
    const again = await h.call("POST", `${API}/agents/${key}/conversations?project=proj`, { user: "alice" });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("project_unavailable");
    const ens = await h.call("POST", `${API}/agents/${key}/conversations/${c.json.id}/session?project=proj`, { user: "alice" });
    expect(ens.json.error).toBe("project_unavailable");
    expect(h.host.spawns.length).toBe(spawnsBefore);
    expect((await h.call("GET", `${API}/projects`, { user: "alice" })).json.projects[0].available).toBe(false);
    expect((await h.call("GET", `${API}/agents/${key}/conversations?project=proj`, { user: "alice" })).json.conversations.length).toBe(1);
  });
});
