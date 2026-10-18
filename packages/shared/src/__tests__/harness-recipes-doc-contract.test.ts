/**
 * Doc contract: the forbidden operator recipes behind #451 are written down
 * where an operator will look (change: add-missing-ci-legs, test-plan E35).
 *
 * The two foreign destroyers seen in session logs are operator commands, not
 * repo code. `docker/TESTING.md` and `docs/faq.md` must therefore both carry the
 * prefix-filtered `docker rm` recipe, the daemon-wide `docker container prune`,
 * and `docker/test-down.sh` as the supported teardown. Pattern:
 * site-seo-contract.test.ts (plain file-content assertions).
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(REPO_ROOT, p), "utf8");

const DOCS = ["docker/TESTING.md", "docs/faq.md"];

describe("harness forbidden-recipe docs (E35)", () => {
  for (const file of DOCS) {
    describe(file, () => {
      const text = read(file);
      it("names the prefix-filtered `docker rm` recipe as forbidden", () => {
        expect(text).toContain("docker ps -aq --filter 'name=pi-dash-test'");
        expect(text).toMatch(/xargs -r docker rm -f/);
      });
      it("names the daemon-wide `docker container prune`", () => {
        expect(text).toContain("docker container prune");
      });
      it("points at docker/test-down.sh as the supported teardown", () => {
        expect(text).toContain("docker/test-down.sh");
      });
    });
  }
});
