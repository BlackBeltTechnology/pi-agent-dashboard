/**
 * `pi.services` discovery + strict offer parsing + template hash/diff.
 * See change: add-service-registry-core (test-plan E4, E5, E6).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as exec from "../../platform/exec.js";
import { discoverSkillManifests } from "../../tool-registry/pi-tools.js";
import { diffTemplates, discoverServiceOffers, parseServiceOffers, templateHash } from "../offers.js";

const DIGEST = `ghcr.io/x/docling@sha256:${"a".repeat(64)}`;

function offer(overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as string | undefined) ?? "docling";
  return {
    schemaVersion: 1,
    id,
    mode: "managed",
    drivers: ["oci:docker", "oci:podman"],
    oci: { image: DIGEST, ports: { http: { container: 5001, protocol: "http" } }, volumes: { [`${id}-cache`]: "/cache" } },
    health: { kind: "http", endpoint: "http", path: "/health" },
    ...overrides,
  };
}

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "svc-offers-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writePkg(dir: string, name: string, pi: Record<string, unknown>) {
  const pkgDir = path.join(root, "packages", dir);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name, version: "1.2.3", pi }));
}

describe("E4 — services-only packages are discovered; pi.tools unchanged", () => {
  it("offers = B,C; skill manifests = A,C", () => {
    writePkg("a", "@x/a", { tools: [{ id: "ffmpeg" }] });
    writePkg("b", "@x/b", { services: [offer({ id: "svc-b" })] });
    writePkg("c", "@x/c", { tools: [{ id: "git" }], services: [offer({ id: "svc-c" })] });

    const offers = discoverServiceOffers(root);
    expect(offers.errors).toEqual([]);
    expect(offers.offers.map((o) => `${o.package}#${o.template.id}`).sort()).toEqual(["@x/b#svc-b", "@x/c#svc-c"]);

    const skills = discoverSkillManifests(root);
    expect(skills.map((m) => path.basename(m.pkgDir)).sort()).toEqual(["a", "c"]);
    // Exact pre-change record shape: { pkgDir, pi } only.
    for (const m of skills) expect(Object.keys(m).sort()).toEqual(["pi", "pkgDir"]);
  });
});

describe("E5 — dangerous offers are rejected, naming package and key", () => {
  const pkg = { name: "@x/evil", version: "9.9.9" };
  it.each([
    ["lifecycle", offer({ mode: "attached", drivers: undefined, oci: undefined, endpoints: { ws: "ws://127.0.0.1:1" }, health: { kind: "tcp", endpoint: "ws" }, lifecycle: { start: { darwin: ["sh", "-c", "x"] } } }), "lifecycle"],
    ["bind mount", offer({ oci: { image: DIGEST, ports: { http: { container: 1 } }, binds: { "/": "/host" } } }), "oci.binds"],
    ["bind via volumes", offer({ oci: { image: DIGEST, ports: { http: { container: 1 } }, volumes: { "/etc": "/x" } } }), "oci.volumes"],
    ["privileged", offer({ oci: { image: DIGEST, ports: { http: { container: 1 } }, privileged: true } }), "oci.privileged"],
    ["host network", offer({ oci: { image: DIGEST, ports: { http: { container: 1 } }, network: "host" } }), "oci.network"],
    ["0.0.0.0 port", offer({ oci: { image: DIGEST, ports: { http: "0.0.0.0:5001:5001" } } }), "oci.ports.http"],
    [":latest image", offer({ oci: { image: "ghcr.io/x/y:latest", ports: { http: { container: 1 } } } }), "oci.image"],
    ["uvx without version", offer({ drivers: ["native"], oci: undefined, native: { runner: "uvx", package: "docling-serve", args: [], ports: { http: {} } } }), "native.package"],
    ["unknown key", offer({ surprise: true }), "offer.surprise"],
  ])("%s", (_label, entry, key) => {
    const clean = JSON.parse(JSON.stringify(entry));
    const r = parseServiceOffers({ services: [clean] }, pkg);
    expect(r.offers).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.some((e) => e.includes("@x/evil") && e.includes(key as string))).toBe(true);
  });

  it("one bad entry does not hide a good sibling", () => {
    const r = parseServiceOffers({ services: [offer({ id: "bad", surprise: 1 }), offer({ id: "good" })] }, pkg);
    expect(r.offers.map((o) => o.template.id)).toEqual(["good"]);
  });

  it("requires schemaVersion", () => {
    const { schemaVersion: _s, ...noVersion } = offer();
    expect(parseServiceOffers({ services: [noVersion] }, pkg).errors.join()).toMatch(/schemaVersion/);
  });
});

describe("audit hardening — offers stay inside their own namespace", () => {
  const pkg = { name: "@x/evil", version: "1.0.0" };
  const errs = (entry: unknown) => parseServiceOffers({ services: [entry] }, pkg).errors.join("\n");
  it("may not reference another service's stored secret, env: or keychain:", () => {
    expect(errs(offer({ secrets: { pw: { ref: "store:postgres/PASSWORD" } } }))).toMatch(/secrets\.pw\.ref/);
    expect(errs(offer({ secrets: { pw: { ref: "env:AWS_SECRET_ACCESS_KEY" } } }))).toMatch(/secrets\.pw\.ref/);
    expect(errs(offer({ secrets: { pw: { ref: "keychain:login/me" } } }))).toMatch(/secrets\.pw\.ref/);
    expect(parseServiceOffers({ services: [offer({ secrets: { pw: { ref: "store:docling/pw" } } })] }, pkg).offers).toHaveLength(1);
  });
  it("volume names must be prefixed with the service id (no stranger's volume)", () => {
    expect(errs(offer({ oci: { image: DIGEST, ports: { http: { container: 1 } }, volumes: { myapp_pgdata: "/x" } } }))).toMatch(/oci\.volumes\.myapp_pgdata/);
  });
  it("an image starting with '-' is rejected (would be read as a runtime flag)", () => {
    expect(errs(offer({ oci: { image: `--volume=/:/h@sha256:${"a".repeat(64)}`, ports: { http: { container: 1 } } } }))).toMatch(/oci\.image/);
  });
  it("secret names differing only by case are rejected", () => {
    expect(errs(offer({ secrets: { Token: {}, TOKEN: {} } }))).toMatch(/only by case/);
  });
});

describe("E6 — discovery is inert", () => {
  it("lists a valid digest-pinned offer without executing anything", () => {
    const spawn = vi.spyOn(exec, "spawn");
    const execFile = vi.spyOn(exec, "execFile");
    const execSync = vi.spyOn(exec, "execSync");
    writePkg("d", "@x/docling", { services: [offer()] });
    const r = discoverServiceOffers(root);
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0].templateHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(spawn).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(execSync).not.toHaveBeenCalled();
  });
});

describe("templateHash / diffTemplates", () => {
  it("hash ignores key order and changes with content", () => {
    const a = offer();
    const reordered = Object.fromEntries(Object.entries(a).reverse());
    expect(templateHash(reordered as never)).toBe(templateHash(a as never));
    expect(templateHash(offer({ description: "x" }) as never)).not.toBe(templateHash(a as never));
  });
  it("diff names the changed path", () => {
    const next = `ghcr.io/x/docling@sha256:${"b".repeat(64)}`;
    const to = offer({ oci: { ...offer().oci, image: next } });
    expect(diffTemplates(offer(), to)).toEqual([{ path: "oci.image", from: DIGEST, to: next }]);
  });
});

describe("dashboard-plugin-scaffold manifest reference (task 6.3)", () => {
  it("its `pi.services` example validates with parseServiceOffers", () => {
    const md = fs.readFileSync(
      path.resolve(__dirname, "../../../../dashboard-plugin-skill/.pi/skills/dashboard-plugin-scaffold/references/manifest-schema.md"),
      "utf8",
    );
    const section = md.slice(md.indexOf("## `pi.services`"));
    const block = /```json\n([\s\S]*?)```/.exec(section)?.[1];
    expect(block).toBeDefined();
    const pkg = JSON.parse(block as string) as { name: string; version: string; pi: unknown };
    const r = parseServiceOffers(pkg.pi, pkg);
    expect(r.errors).toEqual([]);
    expect(r.offers.map((o) => o.template.id)).toEqual(["docling"]);
  });
});
