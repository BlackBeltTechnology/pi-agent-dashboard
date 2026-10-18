/**
 * L1 coverage for the e2e harness's `trustedNetworks` seed in
 * `docker/test-entrypoint.sh` (test-plan #E23-#E25).
 *
 * There is no unit harness for the entrypoint, so this extracts the config-seed
 * `node -e '...'` program VERBATIM from the shell source and runs it with a tmp
 * output path, then asserts the shell structure that gates it statically. It
 * pins the documented contract — `PI_E2E_TRUSTED_NETWORKS` (comma-separated)
 * overrides the default `["0.0.0.0/0"]` — which `openspec` had drifted from
 * (the spec said RFC1918-only). The default stays UI-only: nothing is seeded
 * without `PI_E2E_SEED=1`.
 *
 * See change: triage-browser-e2e-offbox-poison.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ENTRYPOINT = resolve(import.meta.dirname, "..", "..", "docker", "test-entrypoint.sh");
const source = readFileSync(ENTRYPOINT, "utf8");
const lines = source.split("\n");

/** Index of the line that opens the config-seed program: `    node -e '` after the proxy key. */
const keyLine = lines.findIndex((l) => l.includes('E2E_PROXY_KEY="'));
const openLine = lines.findIndex((l, i) => i > keyLine && /^\s*node -e '\s*$/.test(l));
const closeLine = lines.findIndex((l, i) => i > openLine && /^\s*' "\$\{E2E_PROXY_KEY\}"/.test(l));

/** The seed program, byte-for-byte as the shell passes it to node. */
const program = lines.slice(openLine + 1, closeLine).join("\n");

/** Run the program as the entrypoint does and return the written config. */
function seed(trusted) {
  const out = join(mkdtempSync(join(tmpdir(), "pi-trust-seed-")), "config.json");
  execFileSync("node", ["-e", program, "test-key", "tmux", out, trusted, "", ""], { encoding: "utf8" });
  return JSON.parse(readFileSync(out, "utf8"));
}

describe("config-seed program extraction", () => {
  it("finds the program inside the entrypoint", () => {
    expect(keyLine).toBeGreaterThan(0);
    expect(openLine).toBeGreaterThan(keyLine);
    expect(closeLine).toBeGreaterThan(openLine);
    expect(program).toContain("trustedNetworks");
  });
});

describe("PI_E2E_TRUSTED_NETWORKS override parsing (E23)", () => {
  it.each([
    ["unset", "", ["0.0.0.0/0"]],
    ["empty string", "", ["0.0.0.0/0"]],
    ["only separators and blanks", " , ", ["0.0.0.0/0"]],
    ["one entry", "127.0.0.1/32", ["127.0.0.1/32"]],
    ["padded entries with a blank between", " 10.0.0.0/8 , ,192.168.0.0/16 ", ["10.0.0.0/8", "192.168.0.0/16"]],
  ])("%s → trustedNetworks %j", (_label, input, expected) => {
    expect(seed(input).trustedNetworks).toEqual(expected);
  });
});

/**
 * Line range [start, end] of the shell `if` whose opening line satisfies `pick`.
 * The entrypoint is consistently indented, so the closing `fi` is the first later
 * line with the same indentation (robust against one-line `if ...; fi` and the
 * JS `if (` lines inside the single-quoted programs).
 */
function ifBlock(pick) {
  const start = lines.findIndex(pick);
  expect(start, "opening `if` not found in docker/test-entrypoint.sh").toBeGreaterThanOrEqual(0);
  const indent = lines[start].match(/^\s*/)[0];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === `${indent}fi`) return [start, i];
  }
  throw new Error("unterminated if");
}

describe("seed gating (E24, E25)", () => {
  it("E24: the config seed sits inside the PI_E2E_SEED=1 block — the default harness stays UI-only", () => {
    const [start, end] = ifBlock((l) => /^if \[ "\$\{PI_E2E_SEED:-\}" = "1" \]; then/.test(l));
    expect(openLine).toBeGreaterThan(start);
    expect(closeLine).toBeLessThan(end);
  });

  it("E25: the config seed only runs when config.json does not already exist", () => {
    const [start, end] = ifBlock((l) => /^\s*if \[ ! -f "\$\{PI_DIR\}\/dashboard\/config\.json" \]; then/.test(l));
    expect(openLine).toBeGreaterThan(start);
    expect(closeLine).toBeLessThan(end);
  });
});
