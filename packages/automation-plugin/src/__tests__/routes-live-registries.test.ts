/**
 * `/list` + `/definition` must validate against the LIVE registries, not a
 * frozen constant.
 *
 * Regression: `routes.ts` pinned `KNOWN_KINDS = new Set(["schedule"])` and both
 * call sites omitted `knownSourceIds`. The engine registers `schedule.batch`
 * and its work sources, so a perfectly valid work-source automation came back
 * `valid:false — unknown trigger kind: "schedule.batch"` (and, once the kind was
 * fixed, `unknown work source`). The scheduler fired it happily meanwhile, so
 * the operator saw a red-invalid automation that was actually running — and an
 * enable POST could not pass, which blocked the whole fan-out E2E.
 *
 * These drive the pure scanner/parser with the two argument shapes the routes
 * pass, so they fail on the frozen-constant tree and pass on the wired one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAutomationYaml } from "../server/automation-schema.js";
import { scanAutomations } from "../server/scanner.js";

const YAML = `model: anthropic/claude-opus-5
on:
  kind: schedule.batch
  cron: "*/5 * * * *"
  source: invoicebot-queued
action:
  kind: flows.run
  payload:
    flow: invoicebot:process
`;

/** What the wired routes now pass. */
const LIVE_KINDS = new Set(["schedule", "schedule.batch"]);
const LIVE_SOURCES = new Set(["invoicebot-queued"]);
/** What the frozen constant used to pass. */
const FROZEN_KINDS = new Set(["schedule"]);

let repoRoot: string;

beforeAll(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-live-reg-"));
  const dir = path.join(repoRoot, ".pi", "automation", "invoicebot-intake");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "automation.yaml"), YAML);
});

afterAll(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("/list + /definition validate against the live registries", () => {
  it("a schedule.batch automation is VALID when the live kinds + source ids are passed", () => {
    const found = scanAutomations(
      { repoRoot, homeDir: repoRoot, scanFolder: true, scanGlobal: false },
      LIVE_KINDS,
      new Set(["flows.run"]),
      LIVE_SOURCES,
    );
    const intake = found.find((a) => a.name === "invoicebot-intake");
    expect(intake, "the seeded automation should be discovered").toBeDefined();
    expect(intake!.error ?? null).toBeNull();
    expect(intake!.valid).toBe(true);
    expect(intake!.config?.on.kind).toBe("schedule.batch");
  });

  it("the frozen Phase-1 kind set mis-reports it as invalid (the bug this pins)", () => {
    const found = scanAutomations(
      { repoRoot, homeDir: repoRoot, scanFolder: true, scanGlobal: false },
      FROZEN_KINDS,
      new Set(["flows.run"]),
      LIVE_SOURCES,
    );
    const intake = found.find((a) => a.name === "invoicebot-intake");
    expect(intake!.valid).toBe(false);
    expect(String(intake!.error)).toContain("schedule.batch");
  });

  it("omitting the source ids rejects it even when the kind is known", () => {
    const { config, error } = parseAutomationYaml(YAML, LIVE_KINDS, new Set(["flows.run"]));
    expect(config ?? null).toBeNull();
    expect(String(error)).toContain("invoicebot-queued");
  });

  it("passing both live sets parses cleanly (the /definition shape)", () => {
    const { config, error } = parseAutomationYaml(
      YAML,
      LIVE_KINDS,
      new Set(["flows.run"]),
      LIVE_SOURCES,
    );
    expect(error ?? null).toBeNull();
    expect(config?.on.kind).toBe("schedule.batch");
    expect((config?.on as { source?: string }).source).toBe("invoicebot-queued");
  });
});
