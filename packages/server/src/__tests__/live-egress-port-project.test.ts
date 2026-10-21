/**
 * B2 — a project egress grant also applies to a PORT (dev-server) preview opened from a session of
 * that project; a port target with no resolvable session keeps allow-once only.
 * See change: improve-canvas-html-and-url-ux (design Risks: "operator can allow once or per project").
 */
import { describe, expect, it } from "vitest";
import { createPreviewEgress } from "../live-server/live-egress.js";

const CDN = "https://cdn.tailwindcss.com";
const port = (id: string) =>
  ({ targetId: id, tokenId: `t-${id}`, kind: "port", policy: { egress: "restricted", scripts: true }, minterKey: "local", principal: { kind: "local" } }) as never;

const make = (presetCwd: (id: string) => string | undefined) =>
  createPreviewEgress({
    getStatic: () => undefined,
    presetCwdOf: presetCwd,
    projectKeyOf: (c) => c,
    projectGrants: (p) => (p === "/p" ? [CDN] : []),
    allowOnce: () => ["https://unpkg.com"],
  });

describe("B2 project grants on port previews", () => {
  it("a preset opened from a /p session loads the /p grant (plus its allow-once set)", () => {
    const egress = make((id) => (id === "dev1" ? "/p" : undefined));
    expect(egress.grantedFor(port("dev1"))).toEqual([CDN, "https://unpkg.com"]);
  });
  it("a port target of another project, or with no session, gets allow-once only", () => {
    const egress = make((id) => (id === "dev1" ? "/p" : id === "dev2" ? "/q" : undefined));
    expect(egress.grantedFor(port("dev2"))).toEqual(["https://unpkg.com"]);
    expect(egress.grantedFor(port("user1"))).toEqual(["https://unpkg.com"]);
  });
});
