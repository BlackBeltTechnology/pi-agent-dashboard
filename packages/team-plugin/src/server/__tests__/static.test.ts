/**
 * Same-origin app delivery (E37, E38). See change: add-team-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { API, type Harness, makeHarness } from "./harness.js";

let h: Harness;
afterEach(async () => h?.close());

const build = (root: string) => {
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>team</title>");
  fs.writeFileSync(path.join(root, "assets", "app-abc123.js"), "console.log(1)");
  fs.writeFileSync(path.join(path.dirname(root), "package.json"), '{"secret":true}');
};

describe("E37: /apps/team delivery", () => {
  it("redirect, index, hashed asset cache, deep link, traversal confinement, missing build", async () => {
    h = await makeHarness();
    // missing build ⇒ 503 text page
    const missing = await h.app.inject({ method: "GET", url: "/apps/team/" });
    expect(missing.statusCode).toBe(503);
    build(path.join(h.tmp, "dist-app"));

    const redirect = await h.app.inject({ method: "GET", url: "/apps/team" });
    expect(redirect.statusCode).toBe(308);
    expect(redirect.headers.location).toBe("/apps/team/");

    const index = await h.app.inject({ method: "GET", url: "/apps/team/" });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain("<title>team</title>");
    expect(index.headers["cache-control"]).toBe("no-store");

    const asset = await h.app.inject({ method: "GET", url: "/apps/team/assets/app-abc123.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect(asset.headers["content-type"]).toContain("javascript");

    const deep = await h.app.inject({ method: "GET", url: "/apps/team/agent/shared:backend" });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain("<title>team</title>");

    for (const url of ["/apps/team/../../package.json", "/apps/team/%2e%2e/%2e%2e/package.json", "/apps/team/..%2fpackage.json"]) {
      const res = await h.app.inject({ method: "GET", url });
      expect(res.body, url).not.toContain("secret");
    }
  });
});

describe("E38: admission", () => {
  it("the page carries no data; the data route refuses without a principal", async () => {
    h = await makeHarness({ mode: "multi" });
    build(path.join(h.tmp, "dist-app"));
    const page = await h.app.inject({ method: "GET", url: "/apps/team/" });
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toMatch(/persona|alice|sub/i);
    const data = await h.app.inject({ method: "GET", url: `${API}/agents?project=_ws` });
    expect(data.statusCode).toBe(401);
  });
});
