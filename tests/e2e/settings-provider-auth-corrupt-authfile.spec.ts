/**
 * L3 — corrupt `auth.json` does not kill the Settings panel, and the repair
 * flow works while corrupt (test-plan X6, F6).
 *
 * The bug this guards is the original 0.8.0 AppImage report: a zero-byte
 * `auth.json` made `GET /api/provider-auth/status` return
 * `500 {"message":"Unexpected end of JSON input"}` and the Settings panel
 * white-screen on `TypeError: t.filter is not a function` — the one surface
 * that could repair the file was the surface that died.
 *
 * The file is zeroed OUT-OF-BAND inside the harness container (docker exec),
 * the same way other specs plant harness state. The pre-existing bytes are
 * snapshotted and restored so later specs still see the seeded credential.
 *
 * Exemplar: tests/e2e/ended-session-endedat.spec.ts (container discovery +
 * bounded docker exec). Port + compose project come from .pi-test-harness.json
 * via the Playwright config — never hardcode :18000.
 *
 * See change: fix-corrupt-auth-json-500.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, gotoDashboard } from "./helpers/index.js";
import { REPO_ROOT } from "./lifecycle.js";

/**
 * The harness container id, resolved from the compose project recorded in
 * `.pi-test-harness.json`.
 */
let containerId: string | undefined;
function harnessContainer(): string {
  if (containerId) return containerId;
  const state = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, ".pi-test-harness.json"), "utf8"),
  ) as { project?: string };
  if (!state.project) throw new Error(".pi-test-harness.json carries no compose project");
  const id = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${state.project}`],
    { encoding: "utf8", timeout: 30_000 },
  ).trim().split("\n")[0];
  if (!id) throw new Error(`no running container for compose project ${state.project}`);
  containerId = id;
  return id;
}

function inContainer(script: string): string {
  // Bounded: an unbounded `docker` call would hang the single worker until the
  // Playwright timeout fires, hiding the real cause.
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", script], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

const AUTH_FILE = 'process.env.HOME + "/.pi/agent/auth.json"';

/** Current harness auth.json bytes, base64 (empty string = file absent). */
function readAuthB64(): string {
  return inContainer(
    `node -e 'const fs=require("fs");try{process.stdout.write(fs.readFileSync(${AUTH_FILE}).toString("base64"))}catch{process.stdout.write("")}'`,
  );
}

function writeAuthB64(b64: string): void {
  if (!b64) {
    inContainer(`node -e 'require("fs").rmSync(${AUTH_FILE},{force:true})'`);
    return;
  }
  inContainer(`node -e 'require("fs").writeFileSync(${AUTH_FILE},Buffer.from("${b64}","base64"))'`);
}

/** The corruption itself: a zero-byte auth.json, out-of-band. */
function zeroOutAuthFile(): void {
  inContainer(`node -e 'require("fs").writeFileSync(${AUTH_FILE},"")'`);
}

async function openProviderAuthSettings(page: Page) {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await page
    .getByTestId("settings-nav-rail")
    .getByRole("button", { name: "Providers", exact: true })
    .click();
  await expect(page.getByText("Provider Authentication").first()).toBeVisible({ timeout: 20_000 });
}

test.describe("settings provider auth with a corrupt auth.json", () => {
  test("a zero-byte auth.json renders provider rows and a 200 status (#X6)", async ({ page }) => {
    const original = readAuthB64();
    try {
      zeroOutAuthFile();

      const statusResponses: number[] = [];
      page.on("response", (res) => {
        if (res.url().includes("/api/provider-auth/status")) statusResponses.push(res.status());
      });

      await openProviderAuthSettings(page);

      // Rows render signed-out — no ErrorBoundary fallback anywhere.
      await expect(page.getByText(/Subscriptions \(OAuth\)/i)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Sign In" }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Render error:/i)).toHaveCount(0);

      // The status endpoint answered 200 while the file was corrupt.
      expect(statusResponses.length).toBeGreaterThanOrEqual(1);
      expect(statusResponses.every((s) => s === 200)).toBe(true);
    } finally {
      writeAuthB64(original);
    }
  });

  test("an API key can be saved while auth.json is corrupt (#F6)", async ({ page }) => {
    const original = readAuthB64();
    try {
      // The API-key rows render from the bridge-pushed provider catalogue, so a
      // live session must exist BEFORE the file is corrupted (its bridge pushes
      // the catalogue on connect; zeroing auth.json afterwards does not unpush
      // it). The fixtures' reap tears this session down after the test.
      await ensureGitSession(page);
      zeroOutAuthFile();
      await openProviderAuthSettings(page);

      // The repair flow: enter an API key for the first API-key provider.
      const addKey = page.getByRole("button", { name: "Add Key" }).first();
      await expect(addKey).toBeVisible({ timeout: 30_000 });
      await addKey.click();
      await page.getByPlaceholder(/Paste API key/).fill("sk-e2e-test-key-123");
      await page.getByRole("button", { name: "Save", exact: true }).first().click();

      // After the section refetches, the row shows the masked key.
      await expect(page.getByText("sk-e2...123")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Render error:/i)).toHaveCount(0);
    } finally {
      writeAuthB64(original);
    }
  });
});
