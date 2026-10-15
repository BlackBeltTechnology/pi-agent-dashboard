/**
 * `questions` config block: autoBrief + minBriefChars (test-plan #E3, #E4).
 * See change: add-pending-question-stack (D12).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_QUESTIONS, ensureConfig, loadConfig, parseQuestionsConfig } from "../config.js";

describe("parseQuestionsConfig — minBriefChars clamp (test-plan #E3)", () => {
  it.each([
    [-1, 0],
    [0, 0],
    [4000, 4000],
    [4001, 4000],
    [100000, 4000],
    ["abc", 240],
    [undefined, 240],
    [NaN, 240],
    [240.9, 240],
  ])("minBriefChars %s → %s", (raw, expected) => {
    const parsed = parseQuestionsConfig(raw === undefined ? {} : { minBriefChars: raw });
    expect(parsed.minBriefChars).toBe(expected);
  });
});

describe("parseQuestionsConfig — autoBrief (test-plan #E4)", () => {
  it.each([
    [false, false],
    [true, true],
    ["yes", true],
    [0, true],
    [undefined, true],
  ])("autoBrief %j → %s", (raw, expected) => {
    const parsed = parseQuestionsConfig(raw === undefined ? {} : { autoBrief: raw });
    expect(parsed.autoBrief).toBe(expected);
  });

  it("non-object block → defaults", () => {
    expect(parseQuestionsConfig(undefined)).toEqual(DEFAULT_QUESTIONS);
    expect(parseQuestionsConfig("x")).toEqual(DEFAULT_QUESTIONS);
    expect(DEFAULT_QUESTIONS).toEqual({ autoBrief: true, minBriefChars: 240 });
  });
});

describe("loadConfig / ensureConfig — questions block", () => {
  let testDir: string;
  let origHome: string;
  const cfgPath = () => path.join(testDir, ".pi", "dashboard", "config.json");

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-config-questions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("no `questions` key → autoBrief true, minBriefChars 240", () => {
    fs.writeFileSync(cfgPath(), JSON.stringify({ port: 8000 }));
    expect(loadConfig().questions).toEqual({ autoBrief: true, minBriefChars: 240 });
  });

  it("out-of-range minimum clamps to 4000; invalid autoBrief type → true", () => {
    fs.writeFileSync(cfgPath(), JSON.stringify({ questions: { minBriefChars: 100000, autoBrief: "yes" } }));
    expect(loadConfig().questions).toEqual({ autoBrief: true, minBriefChars: 4000 });
  });

  it("autoBrief false is honored", () => {
    fs.writeFileSync(cfgPath(), JSON.stringify({ questions: { autoBrief: false } }));
    expect(loadConfig().questions.autoBrief).toBe(false);
  });

  it("ensureConfig does not write the questions defaults", () => {
    fs.rmSync(cfgPath(), { force: true });
    ensureConfig();
    const written = JSON.parse(fs.readFileSync(cfgPath(), "utf8"));
    expect(written).not.toHaveProperty("questions");
  });
});
