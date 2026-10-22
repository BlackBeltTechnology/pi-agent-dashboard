/**
 * Trusted Types e2e glue (change: harden-client-sinks, design D9).
 *
 * - `installTtProbe` — init script: records `securitypolicyviolation` events
 *   and counts / times every `default`-policy invocation (wraps
 *   `trustedTypes.createPolicy`). Read with `readTtProbe`.
 * - `forceTtMode` — rewrites dashboard DOCUMENT responses so one browser
 *   context sees a chosen mode (`off` strips the directive, `enforce` adds an
 *   enforcing `require-trusted-types-for 'script'`) and the matching
 *   `<meta name="pi-trusted-types">`. A fulfilled document trips Chromium's
 *   Local Network Access checks, so specs using it launch with
 *   {@link TT_LAUNCH_ARGS} (spike §11).
 * - `seedFile` / `removeFile` — write / delete a fixture inside the harness
 *   repo (`/fixtures/sample-git`) for the duration of a spec.
 * - `pixelDiff` — count differing pixels of two PNG screenshots, computed in
 *   the page (no image dependency).
 */
import type { Page } from "@playwright/test";
import { inContainer } from "./folder-collapse.js";
import { FIXTURE_GIT } from "./index.js";

export type TtMode = "off" | "report" | "enforce";

const TT_DIRECTIVE = "require-trusted-types-for 'script'";

export const TT_LAUNCH_ARGS = [
  "--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights",
];

export interface TtProbe {
  violations: { directive: string; sink: string; source: string }[];
  defaultHits: number;
  defaultMs: number;
}

export async function installTtProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = { violations: [] as unknown[], defaultHits: 0, defaultMs: 0 };
    (window as unknown as { __ttProbe: typeof probe }).__ttProbe = probe;
    window.addEventListener("securitypolicyviolation", (e) => {
      if (!/trusted-types/.test(e.effectiveDirective || e.violatedDirective)) return;
      probe.violations.push({
        directive: e.effectiveDirective || e.violatedDirective,
        sink: (e.sample || "").split("|")[0],
        source: `${(e.sourceFile || "").split(/[?#]/)[0]}:${e.lineNumber}`,
      });
    });
    const tt = (window as unknown as { trustedTypes?: { createPolicy: (n: string, r: Record<string, unknown>) => unknown } })
      .trustedTypes;
    if (!tt) return;
    const orig = tt.createPolicy.bind(tt);
    tt.createPolicy = (name: string, rules: Record<string, unknown>) => {
      if (name !== "default") return orig(name, rules);
      const wrapped: Record<string, unknown> = {};
      for (const [k, fn] of Object.entries(rules)) {
        wrapped[k] =
          typeof fn === "function"
            ? (...a: unknown[]) => {
                const t0 = performance.now();
                try {
                  return (fn as (...x: unknown[]) => unknown)(...a);
                } finally {
                  probe.defaultMs += performance.now() - t0;
                  probe.defaultHits += 1;
                }
              }
            : fn;
      }
      return orig(name, wrapped);
    };
  });
}

export async function readTtProbe(page: Page): Promise<TtProbe> {
  return page.evaluate(() => (window as unknown as { __ttProbe: TtProbe }).__ttProbe);
}

const RO = "content-security-policy-report-only";
const EN = "content-security-policy";

function stripDirective(v: string | undefined): string | undefined {
  if (!v) return v;
  const out = v
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && !d.startsWith("require-trusted-types-for"))
    .join("; ");
  return out || undefined;
}

/** Serve every dashboard document in `mode` (headers + meta) for this page. */
export async function forceTtMode(page: Page, mode: TtMode): Promise<void> {
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.resourceType() !== "document" || req.frame() !== page.mainFrame()) return route.continue();
    const res = await route.fetch();
    const headers = { ...res.headers() };
    const ro = stripDirective(headers[RO]);
    const en = stripDirective(headers[EN]);
    delete headers[RO];
    delete headers[EN];
    if (ro) headers[RO] = ro;
    if (en) headers[EN] = en;
    if (mode === "enforce") headers[EN] = en ? `${en}; ${TT_DIRECTIVE}` : TT_DIRECTIVE;
    if (mode === "report") headers[RO] = ro ? `${ro}; ${TT_DIRECTIVE}` : TT_DIRECTIVE;
    let body = await res.text();
    if ((headers["content-type"] ?? "").includes("text/html")) {
      body = body.replace(/<meta name="pi-trusted-types" content="[^"]*">/, "");
      body = body.replace(/<head\b[^>]*>/i, (m) => `${m}<meta name="pi-trusted-types" content="${mode}">`);
    }
    delete headers["content-length"];
    delete headers["content-encoding"];
    await route.fulfill({ status: res.status(), headers, body });
  });
}

/** Write `content` to `rel` inside the harness fixture repo. */
export function seedFile(rel: string, content: string): void {
  const b64 = Buffer.from(content, "utf8").toString("base64");
  inContainer(`printf %s ${b64} | base64 -d > ${JSON.stringify(`${FIXTURE_GIT}/${rel}`)}`);
}

export function removeFile(rel: string): void {
  inContainer(`rm -f ${JSON.stringify(`${FIXTURE_GIT}/${rel}`)}`);
}

/** Mirror of client `encodeFolderPath` (base64url of the cwd). */
function encodeFolderPath(cwd: string): string {
  return Buffer.from(cwd, "utf8").toString("base64url");
}

/** `/folder/<cwd>/view?path=<rel>` for the fixture repo. */
export function fileViewUrl(rel: string): string {
  return `/folder/${encodeFolderPath(FIXTURE_GIT)}/view?path=${encodeURIComponent(rel)}`;
}

/** Number of differing pixels between two PNGs (size mismatch counts every pixel of the larger). */
export async function pixelDiff(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const load = async (b64: string) => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
        ctx.drawImage(bmp, 0, 0);
        return { w: bmp.width, h: bmp.height, d: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
      };
      const [p, q] = await Promise.all([load(x), load(y)]);
      if (p.w !== q.w || p.h !== q.h) return Math.max(p.w * p.h, q.w * q.h);
      let n = 0;
      for (let i = 0; i < p.d.length; i += 4) {
        if (p.d[i] !== q.d[i] || p.d[i + 1] !== q.d[i + 1] || p.d[i + 2] !== q.d[i + 2] || p.d[i + 3] !== q.d[i + 3]) n++;
      }
      return n;
    },
    [a.toString("base64"), b.toString("base64")] as const,
  );
}
