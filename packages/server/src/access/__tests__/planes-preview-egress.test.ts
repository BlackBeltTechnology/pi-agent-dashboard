/**
 * The `preview-egress` deferred plane and its locked store.
 * E26 subject/yolo · X9 grant-time DNS · X10 concurrent writes · E29 tolerant read.
 * See change: improve-canvas-html-and-url-ux (tasks 3.1, 3.2, 3.5, 3.9, 3.10).
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessPlaneRegistry } from "../access-plane.js";
import { createPreviewEgressPlane } from "../planes.js";
import {
  addPreviewEgressGrant,
  listPreviewEgressRows,
  previewEgressStorePath,
  projectEgressGrants,
  readPreviewEgressGrants,
  resetPreviewEgressCache,
  revokePreviewEgressGrant,
} from "../preview-egress-store.js";

let dir: string;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-egress-plane-")));
  process.env.PI_PREVIEW_EGRESS_STORE = path.join(dir, "preview-egress.json");
  resetPreviewEgressCache();
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.PI_PREVIEW_EGRESS_STORE;
  resetPreviewEgressCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

const publicResolver = async () => ["93.184.216.34"];
const req = (origin: string, project = "/p") => ({ subject: origin, deniedSubject: origin, ancestors: [], origin: project });

describe("E26 — plane identity and subjects", () => {
  const plane = createPreviewEgressPlane({ resolve: publicResolver });

  it("subjectOf canonicalises; an ungrantable origin is not promptable; never YOLO-eligible", () => {
    expect(plane.subjectOf("https://CDN.example.com/x")).toBe("https://cdn.example.com");
    expect(plane.subjectOf("https://localhost")).toBeNull();
    expect(plane.subjectOf("http://cdn.example.com")).toBeNull();
    expect(plane.yoloEligible).not.toBe(true);
    expect(plane.mode).toBe("deferred");
    expect(plane.id).toBe("preview-egress");
  });

  it("the dashboard's own origins are never promptable", () => {
    const own = createPreviewEgressPlane({ ownOrigins: () => ["https://dash.example.org"], resolve: publicResolver });
    expect(own.subjectOf("https://dash.example.org")).toBeNull();
    expect(own.subjectOf("https://cdn.example.org")).toBe("https://cdn.example.org");
  });

  it("registers beside the other planes, and a yolo claim is rejected at registration", () => {
    const reg = new AccessPlaneRegistry();
    reg.register(plane);
    expect(reg.get("preview-egress")).toBe(plane);
    expect(() => new AccessPlaneRegistry().register({ ...plane, yoloEligible: true } as never)).toThrow(/yolo/);
  });
});

describe("X9 — grant-time resolution", () => {
  it("a name resolving to a private address is refused; the store is untouched", async () => {
    const plane = createPreviewEgressPlane({ resolve: async () => ["10.1.2.3"] });
    expect(await plane.grant(req("https://intranet.example.com"))).toMatchObject({ ok: false, reason: "forbidden" });
    expect(fs.existsSync(previewEgressStorePath())).toBe(false);
  });

  it("a mixed answer (one private address) is refused", async () => {
    const plane = createPreviewEgressPlane({ resolve: async () => ["93.184.216.34", "::1"] });
    expect(await plane.grant(req("https://mixed.example.com"))).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("a resolution failure is refused with the try-again message", async () => {
    const plane = createPreviewEgressPlane({
      resolve: async () => {
        throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      },
    });
    const out = await plane.grant(req("https://cdn.example.org"));
    expect(out).toEqual({ ok: false, reason: "unverifiable", error: "Could not verify this origin; try again" });
    expect(fs.existsSync(previewEgressStorePath())).toBe(false);
  });

  it("a resolution that takes longer than 3 s is refused at 3 s with the same message", async () => {
    vi.useFakeTimers();
    const plane = createPreviewEgressPlane({
      resolve: () => new Promise((resolve) => setTimeout(() => resolve(["93.184.216.34"]), 3500)),
    });
    const pending = plane.grant(req("https://slow.example.org"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toEqual({ ok: false, reason: "unverifiable", error: "Could not verify this origin; try again" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fs.existsSync(previewEgressStorePath())).toBe(false);
  });

  it("a public resolution writes the grant under the project in the audit origin", async () => {
    const plane = createPreviewEgressPlane({ resolve: publicResolver });
    expect(await plane.grant(req("https://cdn.example.org", "/p"))).toEqual({ ok: true, store: "preview-egress.json" });
    expect(projectEgressGrants("/p")).toEqual(["https://cdn.example.org"]);
    expect(projectEgressGrants("/q")).toEqual([]);
  });

  it("refuses an unnamed or ungrantable subject and a non-absolute project, writing nothing", async () => {
    const plane = createPreviewEgressPlane({ resolve: publicResolver });
    expect(await plane.grant({ ...req("https://cdn.example.org"), subject: "https://other.example.org" })).toMatchObject({ ok: false, reason: "unnamed" });
    expect(await plane.grant(req("https://localhost:8000"))).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await plane.grant(req("https://cdn.example.org", "relative/project"))).toMatchObject({ ok: false, reason: "invalid-subject" });
    expect(fs.existsSync(previewEgressStorePath())).toBe(false);
  });
});

describe("X10 — the locked store", () => {
  it("concurrent grants for two projects and an unrelated config write all survive; no repo file is written", async () => {
    const { writeConfigPartial } = await import("../../config-api.js");
    const before = fs.readdirSync(process.cwd()).sort();
    const plane = createPreviewEgressPlane({ resolve: publicResolver });
    const [a, b] = await Promise.all([
      plane.grant(req("https://cdn.example.org", "/p")),
      plane.grant(req("https://fonts.example.org", "/q")),
      Promise.resolve(writeConfigPartial({ theme: "x" })),
    ]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    expect(JSON.parse(fs.readFileSync(previewEgressStorePath(), "utf8"))).toEqual({
      "/p": ["https://cdn.example.org"],
      "/q": ["https://fonts.example.org"],
    });
    expect(fs.readdirSync(process.cwd()).sort()).toEqual(before);
  });

  it("many concurrent writers to one file lose nothing; a duplicate grant is idempotent", async () => {
    const origins = Array.from({ length: 12 }, (_, i) => `https://cdn${i}.example.org`);
    await Promise.all([...origins, origins[0]].map((o) => addPreviewEgressGrant("/p", o)));
    expect(new Set(projectEgressGrants("/p"))).toEqual(new Set(origins));
    expect(projectEgressGrants("/p")).toHaveLength(12);
  });

  it("revoke removes one origin of one project; an absent grant reports no change; an empty project disappears", async () => {
    await addPreviewEgressGrant("/p", "https://a.example.org");
    await addPreviewEgressGrant("/q", "https://a.example.org");
    expect(await revokePreviewEgressGrant("/p", "https://zzz.example.org")).toEqual({ changed: false });
    expect(await revokePreviewEgressGrant("/p", "https://a.example.org")).toEqual({ changed: true });
    expect(listPreviewEgressRows()).toEqual([{ project: "/q", origin: "https://a.example.org" }]);
  });

  it("refuses a non-canonical origin or relative project at the store", async () => {
    await expect(addPreviewEgressGrant("/p", "https://CDN.example.org/x")).rejects.toThrow();
    await expect(addPreviewEgressGrant("p", "https://cdn.example.org")).rejects.toThrow();
  });
});

describe("E29 — tolerant, side-effect-free read", () => {
  it("a missing file reads as empty and is not created", () => {
    expect(readPreviewEgressGrants()).toEqual({});
    expect(fs.existsSync(previewEgressStorePath())).toBe(false);
  });

  it("a malformed file reads as empty without being rewritten", () => {
    fs.writeFileSync(previewEgressStorePath(), "{ not json");
    expect(listPreviewEgressRows()).toEqual([]);
    expect(fs.readFileSync(previewEgressStorePath(), "utf8")).toBe("{ not json");
  });

  it("hand-edited junk is dropped on read (non-https origins, relative projects)", () => {
    fs.writeFileSync(
      previewEgressStorePath(),
      JSON.stringify({ "/p": ["https://ok.example.org", "http://bad.example.org", 5, "https://UPPER.example.org"], rel: ["https://x.example.org"] }),
    );
    expect(listPreviewEgressRows()).toEqual([{ project: "/p", origin: "https://ok.example.org" }]);
  });

  it("an out-of-process edit is seen on the next read (stat-validated cache)", async () => {
    await addPreviewEgressGrant("/p", "https://a.example.org");
    expect(projectEgressGrants("/p")).toEqual(["https://a.example.org"]);
    fs.writeFileSync(previewEgressStorePath(), JSON.stringify({ "/p": ["https://a.example.org", "https://b.example.org"] }));
    expect(projectEgressGrants("/p")).toHaveLength(2);
  });
});
