/**
 * Docker pool mapping (D5/D14): the default compose publishes NO tier-3 pool range and sets no `portPool`; the opt-in is
 * documented; the test compose stays loopback-bound. File-level checks (no docker needed).
 * See change: serve-live-previews-on-capability-origin (test-plan #E192, #X31).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const uncommented = (text) => text.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

describe("docker live-preview pool mapping", () => {
  it("the default compose publishes nothing in 8100-8199 and sets no portPool; the opt-in is present but commented", () => {
    const compose = read("docker/compose.yml");
    const live = uncommented(compose);
    expect(live).not.toMatch(/\b81\d\d\b/);
    expect(live).not.toMatch(/PREVIEW_POOL|portPool/);
    expect(compose).toMatch(/#\s*- "\$\{PREVIEW_POOL:-8100-8199\}:\$\{PREVIEW_POOL:-8100-8199\}"/);
  });
  it("the README documents the opt-in, the published-range requirement, tier 5 for Docker-local users and the rollback", () => {
    const readme = read("docker/README.md");
    expect(readme).toContain("## Live previews");
    expect(readme).toContain("PREVIEW_POOL");
    expect(readme).toMatch(/publish the same\s+range/);
    expect(readme).toContain("tier 5");
    expect(readme).toContain("enabled: false");
    expect(read("docker/.env.example")).toContain("PREVIEW_POOL=8100-8199");
  });
  it("the test harness compose keeps every published port on 127.0.0.1", () => {
    const ports = [...uncommented(read("docker/compose.test.yml")).matchAll(/^\s*-\s*"([^"]*:\$\{[^}]+\}:\$\{[^}]+\})"/gm)].map((m) => m[1]);
    expect(ports.length).toBeGreaterThan(0);
    for (const p of ports) expect(p.startsWith("127.0.0.1:"), p).toBe(true);
  });
});
