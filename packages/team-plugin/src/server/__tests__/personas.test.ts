/**
 * Personas: schema, scopes, admin gate, fork, projects, store integrity
 * (E6–E19, E26, E27, E41, E42). See change: add-team-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realFs } from "../paths.js";
import { API, type Harness, makeHarness, persona } from "./harness.js";

let h: Harness;
afterEach(async () => h?.close());

const ADMIN = { iss: "https://iss", sub: "root" };
const multi = () => makeHarness({ config: { admins: [ADMIN] } });
const post = (user: string, body: unknown) => h.call("POST", `${API}/personas`, { user, body });
const allFiles = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String) : [];

describe("schema validation (E6–E10)", () => {
  it("E6: name length boundaries in code points", async () => {
    h = await multi();
    const cases: Array<[string, number]> = [
      ["", 400],
      ["a", 201],
      ["é".repeat(60), 201],
      ["😀".repeat(60), 201],
      ["x".repeat(61), 400],
      ["😀".repeat(61), 400],
    ];
    let i = 0;
    for (const [name, status] of cases) {
      const r = await post("alice", persona(`n${i++}`, { name }));
      expect(r.status, JSON.stringify(name.length)).toBe(status);
      if (status === 400) expect(r.json.error).toBe("invalid_persona");
    }
    expect(allFiles(h.home).filter((f) => f.endsWith(".json")).length).toBe(3);
  });

  it("E7: description 280 / 281 code points", async () => {
    h = await multi();
    expect((await post("alice", persona("d1", { description: "x".repeat(280) }))).status).toBe(201);
    expect((await post("alice", persona("d2", { description: "x".repeat(281) }))).status).toBe(400);
  });

  it("E8: instructions 32768 / 32769 UTF-8 bytes", async () => {
    h = await multi();
    const ok = "é".repeat(16384); // 32768 bytes
    expect((await post("alice", persona("i1", { instructions: ok }))).status).toBe(201);
    expect((await post("alice", persona("i2", { instructions: `${ok}a` }))).status).toBe(400);
  });

  it("E9: slug rules, unknown fields, nothing written on 400", async () => {
    h = await multi();
    for (const slug of ["../etc", "Backend", "-x", "a".repeat(41)]) {
      const r = await post("alice", persona(slug));
      expect(r.status, slug).toBe(400);
    }
    expect((await post("alice", persona("a"))).status).toBe(201);
    expect((await post("alice", persona("a".repeat(40)))).status).toBe(201);
    expect((await post("alice", { ...persona("zz"), foo: 1 })).status).toBe(400);
    const files = allFiles(h.home).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(2);
    expect(files.every((f) => !f.includes(".."))).toBe(true);
  });

  it("E10: unknown schemaVersion is skipped with a warning", async () => {
    h = await multi();
    await post("root", { ...persona("good"), scope: "shared" });
    fs.writeFileSync(path.join(h.home, "personas", "x.json"), JSON.stringify({ schemaVersion: 2, key: "shared:x" }));
    const r = await h.call("GET", `${API}/personas`, { user: "alice" });
    expect(r.status).toBe(200);
    expect(r.json.personas.map((p: { key: string }) => p.key)).toEqual(["shared:good"]);
    expect(h.logs.some((l) => l.includes("team.persona_skipped") && l.includes("x.json"))).toBe(true);
  });
});

describe("caps (E11)", () => {
  it("private 50 and shared 200 ⇒ 409 persona_limit, counts unchanged", async () => {
    h = await multi();
    const dir = path.join(h.home, "personas");
    fs.mkdirSync(dir, { recursive: true });
    const seed = (d: string, n: number, scope: string) => {
      fs.mkdirSync(d, { recursive: true });
      for (let i = 0; i < n; i++) {
        fs.writeFileSync(
          path.join(d, `p${i}.json`),
          JSON.stringify({ schemaVersion: 1, key: `${scope}:p${i}`, scope, name: `p${i}`, description: "", avatar: { kind: "initials" }, role: "member", instructions: "", tools: "chat", projects: ["_ws"], createdAt: "", updatedAt: "", updatedBy: "" }),
        );
      }
    };
    const me = await h.call("GET", `${API}/me`, { user: "alice" });
    seed(path.join(h.home, "users", me.json.uk, "personas"), 49, "private");
    expect((await post("alice", persona("last"))).status).toBe(201);
    expect((await post("alice", persona("over"))).status).toBe(409);
    expect((await post("alice", persona("over"))).json.error).toBe("persona_limit");
    seed(dir, 199, "shared");
    expect((await post("root", { ...persona("s200"), scope: "shared" })).status).toBe(201);
    expect((await post("root", { ...persona("s201"), scope: "shared" })).status).toBe(409);
    expect(fs.readdirSync(dir).length).toBe(200);
  });
});

describe("scopes and gates (E12–E14, E26)", () => {
  it("E12: private personas are owner-only; foreign access is a plain 404", async () => {
    h = await multi();
    expect((await post("alice", persona("copywriter"))).status).toBe(201);
    const list = (u: string) => h.call("GET", `${API}/personas`, { user: u });
    expect((await list("alice")).json.personas.length).toBe(1);
    expect((await list("bob")).json.personas.length).toBe(0);
    const key = encodeURIComponent("private:copywriter");
    const upd = { name: "n", instructions: "x" };
    expect((await h.call("PUT", `${API}/personas/${key}`, { user: "alice", body: upd })).status).toBe(200);
    expect((await h.call("PUT", `${API}/personas/${key}`, { user: "bob", body: upd })).status).toBe(404);
    expect((await h.call("DELETE", `${API}/personas/${key}`, { user: "bob" })).json.error).toBe("persona_not_found");
    expect((await h.call("POST", `${API}/personas/${key}/fork`, { user: "bob", body: {} })).status).toBe(404);
    expect((await h.call("POST", `${API}/personas/${key}/fork`, { user: "alice", body: {} })).status).toBe(201);
    expect((await h.call("DELETE", `${API}/personas/${key}`, { user: "alice" })).status).toBe(200);
  });

  it("E13: `full` is only for shared personas in single-user mode", async () => {
    for (const mode of ["single", "multi"] as const) {
      h = await makeHarness({ mode, config: { admins: [ADMIN] } });
      const admin = mode === "multi" ? "root" : undefined;
      const shared = await h.call("POST", `${API}/personas`, { user: admin, body: { ...persona("s"), scope: "shared", tools: "full" } });
      const priv = await h.call("POST", `${API}/personas`, { user: admin, body: { ...persona("p"), tools: "full" } });
      expect(shared.status, `${mode}/shared`).toBe(mode === "single" ? 201 : 400);
      expect(priv.status, `${mode}/private`).toBe(400);
      await h.close();
    }
  });

  it("E14: admin gate (listed admin / unlisted / local operator)", async () => {
    h = await multi();
    const sharedBody = { ...persona("team"), scope: "shared" };
    expect((await post("root", sharedBody)).status).toBe(201);
    expect((await post("bob", { ...sharedBody, slug: "other" })).json.error).toBe("admin_required");
    const key = encodeURIComponent("shared:team");
    expect((await h.call("PUT", `${API}/personas/${key}`, { user: "bob", body: { name: "x", instructions: "" } })).status).toBe(403);
    expect((await h.call("DELETE", `${API}/personas/${key}`, { user: "bob" })).status).toBe(403);
    expect((await h.call("GET", `${API}/me`, { user: "root" })).json.admin).toBe(true);
    expect((await h.call("GET", `${API}/me`, { user: "bob" })).json.admin).toBe(false);
    await h.close();
    h = await makeHarness({ mode: "single" });
    expect((await h.call("POST", `${API}/personas`, { body: { ...sharedBody } })).status).toBe(201);
    expect((await h.call("GET", `${API}/me`)).json).toMatchObject({ admin: true, mode: "single" });
  });

  it("E26: 401 without a principal in multi-user; served as local operator when identity is off", async () => {
    h = await multi();
    expect((await h.call("GET", `${API}/personas`)).status).toBe(401);
    expect((await h.call("GET", `${API}/personas`, { user: "alice" })).status).toBe(200);
    await h.close();
    h = await makeHarness({ mode: "single" });
    expect((await h.call("GET", `${API}/personas`)).status).toBe(200);
  });
});

describe("fork (E15, E16, E42)", () => {
  it("E15: default slug, -2 suffix, explicit slug, taken slug, 40-char base", async () => {
    h = await multi();
    await post("root", { ...persona("backend"), scope: "shared" });
    const src = encodeURIComponent("shared:backend");
    const fork = (body: unknown) => h.call("POST", `${API}/personas/${src}/fork`, { user: "alice", body });
    expect((await fork({})).json.key).toBe("private:backend");
    expect((await fork({})).json.key).toBe("private:backend-2");
    expect((await fork({ slug: "mine" })).json.key).toBe("private:mine");
    const taken = await fork({ slug: "mine" });
    expect(taken.status).toBe(409);
    expect(taken.json.error).toBe("slug_taken");
    const long = "a".repeat(40);
    await post("root", { ...persona(long), scope: "shared" });
    const lk = encodeURIComponent(`shared:${long}`);
    await h.call("POST", `${API}/personas/${lk}/fork`, { user: "alice", body: {} });
    const f2 = await h.call("POST", `${API}/personas/${lk}/fork`, { user: "alice", body: {} });
    expect(f2.json.key.length).toBeLessThanOrEqual("private:".length + 40);
    expect(f2.json.key.slice(8)).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/);
    expect(f2.json.forkedFrom).toBe(`shared:${long}`);
  });

  it("E16: full → files on fork (single-user)", async () => {
    h = await makeHarness({ mode: "single" });
    await h.call("POST", `${API}/personas`, { body: { ...persona("b"), scope: "shared", tools: "full" } });
    const r = await h.call("POST", `${API}/personas/${encodeURIComponent("shared:b")}/fork`, { body: {} });
    expect(r.json.tools).toBe("files");
  });

  it("E42: fork keeps only the projects the forker may use, else _ws", async () => {
    const dirs: Record<string, string> = {};
    h = await makeHarness({ config: { admins: [ADMIN] } });
    dirs.billing = h.dir("billing");
    dirs.crm = h.dir("crm");
    await h.close();
    // reopen with config pointing at the dirs (registry reads config lazily; build a fresh harness reusing paths)
    const config = {
      admins: [ADMIN],
      projects: {
        billing: { name: "Billing", path: dirs.billing, users: "*" as const },
        crm: { name: "CRM", path: dirs.crm, users: [{ iss: "https://iss", sub: "nobody" }] },
      },
    };
    h = await makeHarness({ config });
    // dirs vanished with the old harness; recreate under the new tmp
    const b = h.dir("billing");
    const c = h.dir("crm");
    config.projects.billing.path = b;
    config.projects.crm.path = c;
    // registry activation happened at start with missing dirs: re-activate by config change
    await post("root", { ...persona("a"), scope: "shared", projects: ["billing", "crm"] });
    await post("root", { ...persona("b2"), scope: "shared", projects: ["crm"] });
    const f1 = await h.call("POST", `${API}/personas/${encodeURIComponent("shared:a")}/fork`, { user: "alice", body: {} });
    const f2 = await h.call("POST", `${API}/personas/${encodeURIComponent("shared:b2")}/fork`, { user: "alice", body: {} });
    expect(f1.json.projects).toEqual(["billing"]);
    expect(f2.json.projects).toEqual(["_ws"]);
  });
});

describe("skills catalog (E17)", () => {
  it("only catalog names are accepted; spawn scope carries the resolved path", async () => {
    h = await makeHarness({ config: { skillCatalog: { review: "/s/review" } } });
    expect((await post("alice", persona("s1", { skills: ["review"] }))).status).toBe(201);
    expect((await post("alice", persona("s2", { skills: ["/tmp/evil"] }))).status).toBe(400);
    expect((await post("alice", persona("s3", { skills: ["nope"] }))).status).toBe(400);
    const c = await h.call("POST", `${API}/agents/${encodeURIComponent("private:s1")}/conversations?project=_ws`, { user: "alice" });
    expect(c.status).toBe(201);
    expect(h.host.spawns[0].scope?.skills).toEqual(["/s/review"]);
  });
});

describe("store integrity (E18, E19)", () => {
  it("E18: a failed rename leaves the previous file intact and no tmp files", async () => {
    let failRename = false;
    h = await makeHarness({
      ops: {
        ...realFs,
        rename: (a, b) => {
          if (failRename) throw new Error("boom");
          realFs.rename(a, b);
        },
      },
    });
    expect((await post("alice", persona("keep", { instructions: "v1" }))).status).toBe(201);
    const me = (await h.call("GET", `${API}/me`, { user: "alice" })).json.uk;
    const file = path.join(h.home, "users", me, "personas", "keep.json");
    const before = fs.readFileSync(file, "utf8");
    failRename = true;
    const r = await h.call("PUT", `${API}/personas/${encodeURIComponent("private:keep")}`, { user: "alice", body: { name: "keep", instructions: "v2" } });
    expect(r.status).toBe(500);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("E19: a symlinked agent path is refused and nothing spawns", async () => {
    h = await makeHarness();
    expect((await post("alice", persona("x"))).status).toBe(201);
    const uk = (await h.call("GET", `${API}/me`, { user: "alice" })).json.uk;
    fs.mkdirSync(path.join(h.home, "users", uk), { recursive: true });
    fs.symlinkSync("/etc", path.join(h.home, "users", uk, "runtime"));
    const r = await h.call("POST", `${API}/agents/${encodeURIComponent("private:x")}/conversations?project=_ws`, { user: "alice" });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(h.host.spawns.length).toBe(0);
  });
});

describe("project assignment (E41)", () => {
  it("defaults, validation and per-author allowed projects", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    const billing = h.dir("billing");
    const crm = h.dir("crm");
    h.team.projects.enable({ uk: "local", iss: "x", sub: "y", admin: true }, { path: billing, name: "billing", users: [{ iss: "https://iss", sub: "alice" }] });
    h.team.projects.enable({ uk: "local", iss: "x", sub: "y", admin: true }, { path: crm, name: "crm", users: [{ iss: "https://iss", sub: "nobody" }] });
    const r0 = await post("alice", persona("p0"));
    expect(r0.json.projects).toEqual(["_ws"]);
    expect((await post("alice", persona("p1", { projects: [] }))).status).toBe(400);
    expect((await post("alice", persona("p2", { projects: ["nope"] }))).status).toBe(400);
    expect((await post("alice", persona("p3", { projects: Array.from({ length: 51 }, (_, i) => `x${i}`) }))).status).toBe(400);
    expect((await post("alice", persona("p4", { projects: ["_ws", "_ws"] }))).status).toBe(400);
    expect((await post("alice", persona("p5", { projects: ["billing"] }))).status).toBe(201);
    const bad = await post("alice", persona("p6", { projects: ["crm"] }));
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("invalid_persona");
    expect((await post("root", { ...persona("sh"), scope: "shared", projects: ["crm"] })).status).toBe(201);
  });
});

describe("route registration (E27)", () => {
  it("rate limiter is registered with the shared values", async () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../routes.ts"), "utf8");
    expect(src).toMatch(/max:\s*100_000/);
    expect(src).toMatch(/timeWindow:\s*"1 minute"/);
    expect(src).toMatch(/allowList:\s*\["127\.0\.0\.1",\s*"::1"\]/);
  });
});
