import fs from "node:fs";
import { expect, test } from "../../../tests/e2e/fixtures.js";
import { HEALTH_URL } from "../../../tests/e2e/lifecycle.js";

test("probe 1: the harness answers /api/health", async ({ request }) => {
  const res = await request.get(HEALTH_URL, { timeout: 4_000 });
  expect(res.ok()).toBe(true);
  // Tell the driver script that spec 1 is done: it destroys the container now.
  if (process.env.PROBE_SPEC1_DONE) fs.writeFileSync(process.env.PROBE_SPEC1_DONE, "done");
});
