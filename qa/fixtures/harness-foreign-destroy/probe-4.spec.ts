import fs from "node:fs";
import { expect, test } from "../../../tests/e2e/fixtures.js";
import { HEALTH_URL } from "../../../tests/e2e/lifecycle.js";

test("probe 4: the harness answers /api/health", async ({ request }) => {
  const res = await request.get(HEALTH_URL, { timeout: 4_000 });
  expect(res.ok()).toBe(true);

});
