import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "./fixtures.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { FIXTURE_GIT, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — `/api/file/raw` serves scriptable media types (SVG/HTML) with an
// enforced sandbox CSP, so a directly opened file cannot run script in the
// dashboard origin, while in-app previews keep working
// (change: harden-raw-svg-responses; test-plan F1–F4).
//
// Files are seeded into the fixture repo INSIDE the harness container with
// `docker exec` (unique token names, removed in afterEach) — no image rebuild.
// Exemplar: changed-on-disk-content-gate.spec.ts.

const TOKEN = randomBytes(4).toString("hex");
const created: string[] = [];
let container = "";

const SANDBOX =
  "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'";

const sh = (script: string): string =>
  execFileSync("docker", ["exec", container, "sh", "-c", script], { encoding: "utf8" }).trim();
// Bytes travel base64-encoded: the payloads contain single quotes, which a
// single-quoted `sh -c` string would silently consume.
const put = (rel: string, content: string): void => {
  created.push(rel);
  const b64 = Buffer.from(content).toString("base64");
  sh(`printf '%s' '${b64}' | base64 -d > '${FIXTURE_GIT}/${rel}'`);
};
const rawUrl = (rel: string): string =>
  `/api/file/raw?cwd=${encodeURIComponent(FIXTURE_GIT)}&path=${encodeURIComponent(rel)}`;

const EVIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><script>document.title='PWNED'</script><rect width="40" height="40" fill="red"/></svg>`;
const EVIL_HTML = `<html><head><title>clean</title></head><body><h1>x</h1><script>document.title='PWNED'</script></body></html>`;

test.describe("raw active-content sandbox", () => {
  test.beforeEach(() => {
    container = resolveContainer();
  });

  test.afterEach(() => {
    for (const rel of created.splice(0)) {
      try {
        sh(`rm -f '${FIXTURE_GIT}/${rel}'`);
      } catch {
        /* container gone */
      }
    }
  });

  async function openInPane(page: Page, rel: string): Promise<void> {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    await card.click();
    await page.goto(`/session/${sessionId}/editor?file=${encodeURIComponent(rel)}`);
  }

  async function expectSandboxed(page: Page, rel: string): Promise<void> {
    await spawnFreshGitSession(page); // makes FIXTURE_GIT a known session cwd
    const res = await page.goto(rawUrl(rel));
    expect(res?.status()).toBe(200);
    expect(res?.headers()["content-security-policy"]).toBe(SANDBOX);
    expect(await page.title()).not.toBe("PWNED");
    // page.evaluate runs over CDP, outside the sandbox's script switch.
    expect(await page.evaluate(() => window.origin)).toBe("null");
  }

  test("F1: a directly opened script-bearing SVG cannot run in the dashboard origin", async ({ page }) => {
    test.setTimeout(120_000);
    const rel = `raw-${TOKEN}-evil.svg`;
    put(rel, EVIL_SVG);
    await expectSandboxed(page, rel);
    const cookie = await page.evaluate(() => {
      try {
        return document.cookie;
      } catch {
        return "blocked";
      }
    });
    expect(cookie).toBe("blocked");
  });

  test("F2: a directly opened script-bearing HTML is sandboxed", async ({ page }) => {
    test.setTimeout(120_000);
    const rel = `raw-${TOKEN}-evil.html`;
    put(rel, EVIL_HTML);
    await expectSandboxed(page, rel);
  });

  test("F3: the SVG image preview keeps rendering", async ({ page }) => {
    test.setTimeout(120_000);
    const rel = `raw-${TOKEN}-logo.svg`;
    put(rel, `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><style>rect{fill:blue}</style><rect width="40" height="40"/></svg>`);
    await openInPane(page, rel);
    // The pane's SVG viewer fetches /api/file/raw into a blob: URL, so match by alt, not src.
    const img = page.getByRole("img", { name: `raw-${TOKEN}-logo.svg`, exact: true });
    await expect(img).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth > 0 && el.naturalHeight > 0))
      .toBe(true);
  });

  test("F4: the HTML preview is unaffected", async ({ page }) => {
    test.setTimeout(120_000);
    const rel = `raw-${TOKEN}-page.html`;
    put(rel, `<html><body><h1>Hello</h1></body></html>`);
    await openInPane(page, rel);
    const frame = page.locator(`iframe[title$="raw-${TOKEN}-page.html"]`);
    await expect(frame).toBeVisible({ timeout: 30_000 });
    await expect(frame).toHaveAttribute("srcdoc", /<h1>Hello<\/h1>/);
    await expect(page.frameLocator(`iframe[title$="raw-${TOKEN}-page.html"]`).getByText("Hello")).toBeVisible();
  });
});
