/**
 * site-design-tokens-contract.test.ts — the marketing site's design tokens
 * (spec `marketing-site` › "Site declares \"Pi blue\" design tokens as CSS
 * variables"; change: fix-ci-pipeline-followups, test-plan E11).
 *
 * Since c52745af0 the site is a hand-written static page. Its tokens are the
 * product's own names, lifted verbatim from packages/client/src/index.css,
 * declared as literal values in `:root` (dark default) and re-declared under
 * `[data-theme="light"]`. The pre-rewrite Tailwind contract — `pi-*` colours
 * through `rgb(var(--pi-xxx) / <alpha-value>)` with a `:root.dark` selector —
 * must not creep back into either page.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const TOKENS = [
  "--bg-primary",
  "--bg-secondary",
  "--bg-tertiary",
  "--text-primary",
  "--text-secondary",
  "--text-tertiary",
  "--accent",
  "--accent-solid",
  "--accent-text",
  "--status-idle",
  "--status-working",
  "--status-needs-you",
  "--border",
] as const;

/** Body of the first rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(^|[\\s}])${esc}\\s*\\{([^}]*)\\}`, "m"));
  return m ? m[2] : "";
}

function declared(body: string): Set<string> {
  return new Set([...body.matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)].map((m) => m[1]));
}

for (const page of ["site/index.html", "site/404.html"]) {
  describe(`${page} declares the product token set in both themes`, () => {
    const html = fs.readFileSync(path.join(REPO_ROOT, page), "utf8");

    it(":root declares all 13 tokens", () => {
      const got = declared(ruleBody(html, ":root"));
      for (const t of TOKENS) expect(got, `${page} :root missing ${t}`).toContain(t);
    });

    it('[data-theme="light"] re-declares the same set', () => {
      const got = declared(ruleBody(html, '[data-theme="light"]'));
      for (const t of TOKENS) {
        expect(got, `${page} [data-theme="light"] missing ${t}`).toContain(t);
      }
    });

    it("carries no pre-rewrite Tailwind token machinery", () => {
      expect(html.split("--pi-").length - 1, `${page}: --pi-*`).toBe(0);
      expect(html.split("rgb(var(").length - 1, `${page}: rgb(var(`).toBe(0);
      expect(html.split("root.dark").length - 1, `${page}: :root.dark`).toBe(0);
    });
  });
}
