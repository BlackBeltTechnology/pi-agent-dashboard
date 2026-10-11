import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../cli.js";
import { DEFAULT_PROMPT } from "../commands/judge.js";
import { buildBatchPayload, judgeArgs, validityItem } from "../judge.js";
import { SCRUB_RULES } from "../scrub.js";
import { mkCase, writeCaseSet } from "./helpers/run-fixture.js";
import { itemsIn, judgeEnv, verdictLines } from "./helpers/judge-env.js";

const EXPECTED_ARGV = (ref: string) => ["-p", "--no-session", "--no-extensions", "--no-skills", "--no-context-files", "--no-tools", "--model", ref];
const allItems = (env: ReturnType<typeof judgeEnv>) => env.calls().flatMap((c) => itemsIn(c.stdin));

describe("judge", () => {
  it("E27: an unchanged run is served from the cache", async () => {
    const env = judgeEnv();
    await env.run();
    expect(await env.judge()).toBe(0);
    const before = env.calls().length;
    expect(before).toBeGreaterThan(0);
    expect(await env.judge()).toBe(0);
    expect(env.calls()).toHaveLength(before);
    expect(env.stdout.join("")).toContain("every item is cached");
  });

  it("E28: a changed output re-judges only that item", async () => {
    const env = judgeEnv();
    await env.run();
    await env.judge();
    const before = env.calls().length;
    const p = env.runPath("retrieved.json");
    const r = JSON.parse(readFileSync(p, "utf8"));
    r.results["stub.r1"].c2.top5[0].text = "a different snippet";
    writeFileSync(p, JSON.stringify(r));
    expect(await env.judge()).toBe(0);
    expect(env.calls().slice(before).flatMap((c) => itemsIn(c.stdin))).toEqual(["h:c2:stub.r1"]);
  });

  it("E29: a changed case query re-judges its validity and helpfulness", async () => {
    const env = judgeEnv();
    await env.run();
    await env.judge();
    const before = env.calls().length;
    writeCaseSet(env, [mkCase({ id: "c1", query: "query 1", context: "context 1" }), mkCase({ id: "c2", query: "a NEW query", context: "context 2" }), mkCase({ id: "c3", query: "query 3", context: "context 3" })]);
    await env.run();
    expect(await env.judge()).toBe(0);
    expect(env.calls().slice(before).flatMap((c) => itemsIn(c.stdin)).sort()).toEqual(["h:c2:stub.r1", "v:c2"]);
  });

  it("E30: an edited prompt or scrub rule re-judges everything", async () => {
    const prompt = join(judgeEnv().home, "judge.v1.md");
    // (a) prompt text edited, version unchanged
    {
      const env = judgeEnv({ ctx: { promptPath: prompt } });
      writeFileSync(prompt, readFileSync(DEFAULT_PROMPT, "utf8"));
      await env.run();
      await env.judge();
      const first = allItems(env).length;
      writeFileSync(prompt, `${readFileSync(DEFAULT_PROMPT, "utf8")}\nExtra line.\n`);
      await env.judge();
      expect(allItems(env)).toHaveLength(first * 2);
    }
    // (b) a scrub rule added
    {
      const rules = [...SCRUB_RULES];
      const env = judgeEnv({ ctx: { scrubRules: rules } });
      await env.run();
      await env.judge();
      const first = allItems(env).length;
      rules.push({ kind: "extra", re: /zzz-secret/g, replace: "[REDACTED:extra]" });
      await env.judge();
      expect(allItems(env)).toHaveLength(first * 2);
    }
  });

  it("E31: secrets are scrubbed from the payload; commit hashes stay", () => {
    const hash = "3f786850e387550fdab836ed7e6dc881de23001b";
    const secrets = [
      "abc.def.ghi",
      "sk-abcdefghijklmnop123456",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "u:p@host",
      "xyzTOKENvalue",
      "xyzAPIvalue",
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmU",
    ];
    const context = [
      "Authorization: Bearer abc.def.ghi",
      "key sk-abcdefghijklmnop123456",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "url https://u:p@host/x",
      "run --token xyzTOKENvalue",
      "API_TOKEN=xyzAPIvalue",
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU\n-----END OPENSSH PRIVATE KEY-----",
      `commit ${hash}`,
    ].join("\n");
    const payload = buildBatchPayload("PROMPT", [validityItem(mkCase({ id: "c1", context }))], SCRUB_RULES);
    expect(payload.match(/\[REDACTED:/g)!.length).toBeGreaterThanOrEqual(7);
    for (const s of secrets) expect(payload, s).not.toContain(s);
    expect(payload).toContain(hash);
  });

  it("E32: the judge argv is exact and never carries an @role", async () => {
    for (const [spec, ref] of [["@review", "openai/gpt-6.1-sol:medium"], ["provider/x", "provider/x"]] as const) {
      const env = judgeEnv();
      await env.run();
      expect(await env.judge(["--judge", spec])).toBe(0);
      const c = env.calls()[0];
      expect(c.argv).toEqual(EXPECTED_ARGV(ref));
      expect(c.argv.join(" ")).not.toContain("@");
      expect(realpathSync(c.cwd)).toBe(realpathSync(env.paths.root));
      expect(c.stdin).toContain("<items>");
    }
    expect(judgeArgs("a/b")).toEqual(EXPECTED_ARGV("a/b"));
  });

  it("E33: an unknown role fails before any call", async () => {
    const env = judgeEnv();
    await env.run();
    expect(await env.judge(["--judge", "@missing"])).not.toBe(0);
    const err = env.stderr.join("");
    expect(err).toContain("@missing");
    expect(err).toContain(env.paths.providersFile);
    expect(env.calls()).toHaveLength(0);
  });

  it("E34: TTY consent shows provider, model, counts and data classes", async () => {
    const answers = ["n", "y"];
    const asked: string[] = [];
    const env = judgeEnv({ ctx: { isTTY: true, confirm: async (q) => (asked.push(q), answers.shift() === "y") } });
    await env.run();
    expect(await main(["judge"], env.ctx)).not.toBe(0);
    expect(env.calls()).toHaveLength(0);
    const out = env.stdout.join("");
    expect(out).toContain("openai");
    expect(out).toContain("openai/gpt-6.1-sol:medium");
    expect(out).toMatch(/\d+ items in \d+ batches/);
    expect(out).toContain("session prompts, commands, paths, error text, retrieved snippets");
    expect(await main(["judge"], env.ctx)).toBe(0);
    expect(env.calls().length).toBeGreaterThan(0);
    expect(asked).toHaveLength(2);
  });

  it("E35: without a TTY, consent needs --yes", async () => {
    const env = judgeEnv();
    await env.run();
    expect(await main(["judge"], env.ctx)).not.toBe(0);
    expect(env.calls()).toHaveLength(0);
    expect(await main(["judge", "--yes"], env.ctx)).toBe(0);
    expect(env.calls().length).toBeGreaterThan(0);
  });

  it("E36: --dry-run prints the plan and one scrubbed sample, with no call", async () => {
    const env = judgeEnv({ cases: [mkCase({ id: "c1", context: "Authorization: Bearer abc.def.ghi and more" })] });
    await env.run();
    expect(await main(["judge", "--dry-run"], env.ctx)).toBe(0);
    expect(env.calls()).toHaveLength(0);
    const out = env.stdout.join("");
    expect(out).toContain("dry run");
    expect(out).toContain("[REDACTED:");
    expect(out).not.toContain("abc.def.ghi");
  });

  it("X1: provider failure leaves items unjudged and uncached; a healthy re-run retries them", async () => {
    const env = judgeEnv();
    await env.run();
    env.stub({ default: { exit: 1, stderr: "402 Insufficient Balance" } });
    expect(await env.judge()).toBe(0);
    const unjudged = readFileSync(env.runPath("unjudged.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(unjudged).toHaveLength(3);
    expect(unjudged.every((u) => u.error.includes("402 Insufficient Balance"))).toBe(true);
    expect(verdictLines(env)).toHaveLength(0);
    expect(env.calls()).toHaveLength(2); // one batch, retried once
    env.stub();
    expect(await env.judge()).toBe(0);
    expect(verdictLines(env).length).toBeGreaterThan(0);
    expect(existsSync(env.runPath("unjudged.jsonl")) ? readFileSync(env.runPath("unjudged.jsonl"), "utf8") : "").toBe("");
  });

  it("X2: a malformed answer keeps the present ids and retries only the missing one", async () => {
    const env = judgeEnv();
    await env.run();
    env.stub({ omit: ["v:c3"] });
    expect(await env.judge()).toBe(0);
    const calls = env.calls();
    expect(itemsIn(calls[0].stdin).sort()).toEqual(["v:c1", "v:c2", "v:c3"]);
    expect(itemsIn(calls[1].stdin)).toEqual(["v:c3"]);
    const ids = verdictLines(env).filter((v) => v.kind === "validity").map((v) => v.caseId).sort();
    expect(ids).toEqual(["c1", "c2"]);
    const unjudged = readFileSync(env.runPath("unjudged.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(unjudged.map((u) => u.caseId)).toEqual(["c3"]);
  });

  it("X3: a timed-out judge call kills the child", async () => {
    const env = judgeEnv({ ctx: { judgeTimeoutMs: 200 } });
    await env.run();
    env.stub({ default: { delayMs: 10_000 } });
    expect(await env.judge()).toBe(0);
    const unjudged = readFileSync(env.runPath("unjudged.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(unjudged.length).toBe(3);
    expect(unjudged[0].error).toMatch(/timed out/);
    const pid = Number(readFileSync(env.pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("X4: a retry recovers and both attempts are logged", async () => {
    const env = judgeEnv();
    await env.run();
    env.stub({ calls: [{ exit: 1, stderr: "transient" }], verdicts: { validity: "invalid" } });
    expect(await env.judge()).toBe(0);
    const lines = readFileSync(env.runPath("judge-calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.outcome)).toEqual(["failed", "ok"]);
    for (const l of lines) {
      expect(typeof l.durationMs).toBe("number");
      expect(l).toHaveProperty("exitCode");
      expect(l.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(lines[0].exitCode).toBe(1);
    expect(verdictLines(env)).toHaveLength(3);
  });
});
