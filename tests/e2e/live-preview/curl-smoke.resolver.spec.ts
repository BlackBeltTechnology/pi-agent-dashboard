import { expect, test } from "./fixture.js";

/**
 * L2 — end-to-end curl-style smoke on the isolated server (raw HTTP over node:http, the same bytes `curl` would send).
 * Node-level: no browser. It is named `.resolver.spec.ts` ONLY so the suite runs it once (the `chromium-resolver` project)
 * instead of once per browser project.
 * Row: test-plan #X44. See change: serve-live-previews-on-capability-origin.
 */
test("T.X44 / #X44 curl smoke: duplicate cookie → 400 + expiry; label host 403 vs localhost 200; frame-src names *.localhost:<port>; boot log has [live-preview] tiers:", async ({ isolatedServer }) => {
  const port = isolatedServer.port;

  // curl -H 'Cookie: pi_dash_s=a; pi_dash_s=b' …/api/sessions
  const dup = await isolatedServer.rawRequest({ host: `localhost:${port}`, path: "/api/sessions", headers: { cookie: "pi_dash_s=a; pi_dash_s=b" } });
  expect(dup.status, "duplicate pi_dash_* cookie is refused").toBe(400);
  const setCookie = ([] as string[]).concat(dup.headers["set-cookie"] ?? []);
  expect(setCookie.some((l) => /^pi_dash_s=; Max-Age=0/.test(l)), `Set-Cookie expires the name (got ${JSON.stringify(setCookie.slice(0, 3))})`).toBe(true);
  expect(JSON.parse(dup.body).error).toBe("duplicate_dashboard_cookie");

  // curl -H 'Host: <26×a>.localhost:<port>' …/api/health  → 403 ; curl http://localhost:<port>/api/health → 200
  const label = await isolatedServer.rawRequest({ host: `${"a".repeat(26)}.localhost:${port}`, path: "/api/health" });
  expect(label.status, "an unminted label host is refused").toBe(403);
  expect(JSON.parse(label.body), "the identical refusal body").toEqual({ error: "host_not_allowed" });
  const local = await isolatedServer.rawRequest({ host: `localhost:${port}`, path: "/api/health" });
  expect(local.status, "localhost is served").toBe(200);

  // curl -sI /  → frame-src carries the label source for THIS port
  const head = await isolatedServer.rawRequest({ host: `localhost:${port}`, path: "/", method: "HEAD", headers: { accept: "text/html" } });
  expect(head.status).toBe(200);
  const csp = [head.headers["content-security-policy"], head.headers["content-security-policy-report-only"]].flat().filter(Boolean).join(" | ");
  const frameSrc = csp.split(/[|;]/).map((d) => d.trim()).filter((d) => d.startsWith("frame-src "));
  expect(frameSrc.length, "a frame-src directive is sent").toBeGreaterThan(0);
  for (const d of frameSrc) expect(d).toContain(`http://*.localhost:${port}`);

  // boot log has `[live-preview] tiers:`
  expect(isolatedServer.livePreviewLog().join("\n")).toMatch(/\[live-preview\] tiers: /);
});
