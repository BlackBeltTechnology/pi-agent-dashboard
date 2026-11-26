import { assertNoSecretLeak, loadRestrictedPreview, probeCsp, violationHtml } from "./csp-observability.js";
import { expect, test } from "./fixture.js";

/**
 * L3 — observability of a tier-1 preview CSP violation: no secret in browser-visible places other than where the browser needs it.
 * Row: test-plan #F30 (tier-1 half; the tier-5 half is `csp-observability.resolver.spec.ts`; tier-3 `?k=` redaction is covered at L1 by 12.1).
 * See change: serve-live-previews-on-capability-origin (D13).
 */
test("T.F30 / #F30 tier 1: a CSP violation report stays on the preview origin; counters, stored rows and the server log show no label or token", async ({ page, operator, upstream, isolatedServer, dashOrigin }) => {
  upstream.route("/", violationHtml);
  const probe = probeCsp(page);
  const mark = isolatedServer.logMark();
  const src = await loadRestrictedPreview(page, operator, isolatedServer, dashOrigin, upstream, probe);
  expect(src).toMatch(/^http:\/\/[a-z2-7]{26}\.localhost:\d+\/$/);
  await assertNoSecretLeak({ page, src, server: isolatedServer, probe, dashOrigin, logMark: mark });
});
