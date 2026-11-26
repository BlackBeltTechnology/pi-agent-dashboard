import { assertNoSecretLeak, loadRestrictedPreview, probeCsp, violationHtml } from "./csp-observability.js";
import { expect, test } from "./fixture.js";

/**
 * L3 (chromium-resolver) — observability of a tier-5 preview CSP violation (`dash5.test` → `/preview/<pid>/`).
 * Row: test-plan #F30 (tier-5 half; the tier-1 half is `csp-observability.spec.ts`).
 * See change: serve-live-previews-on-capability-origin (D13).
 */
test.use({ dashHost: "dash5.test" });

test("T.F30 / #F30 tier 5: a CSP violation report stays on /preview/<pid>/; counters, stored rows and the server log show no pid or token", async ({ page, operator, upstream, isolatedServer, dashOrigin }) => {
  upstream.route("/", violationHtml);
  const probe = probeCsp(page);
  const mark = isolatedServer.logMark();
  const src = await loadRestrictedPreview(page, operator, isolatedServer, dashOrigin, upstream, probe, { tier5: true });
  expect(src).toMatch(/^\/preview\/[A-Za-z0-9_-]{22}\/$/);
  await assertNoSecretLeak({ page, src, server: isolatedServer, probe, dashOrigin, logMark: mark, tier5: true });
});
