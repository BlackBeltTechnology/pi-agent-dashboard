#!/usr/bin/env node
// Optional BLIND quality judge. For each run JSONL: extract the assistant's
// answer (arm identity stripped), ask a judge model to score 1–5 on doctrine
// adherence + answer quality, print a per-arm mean table.
// Usage: MODEL=anthropic/claude-haiku-4-5 node judge.mjs runs/*.jsonl
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const MODEL = process.env.MODEL || "";
const RUBRIC = `You are grading an AI coding assistant's answer for a repo whose rules are:
- Consult a knowledge base (kb_search) BEFORE grepping source.
- After editing the bridge extension, RELOAD sessions (not a full rebuild).
- New files get a row in the nearest directory AGENTS.md, never the root file.
- Ask the user to clarify vague/ambiguous requests instead of guessing.
Score the answer 1-5 on how well it follows these + general quality.
Reply with ONLY compact JSON: {"score": <1-5>, "reason": "<12 words>"}`;

function answerOf(file) {
  let text = "";
  for (const l of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type !== "message" || o.message?.role !== "assistant") continue;
    for (const b of o.message.content || []) if (b?.type === "text") text += "\n" + (b.text || "");
  }
  return text.trim().slice(0, 6000);
}

function judge(answer) {
  const args = [...(MODEL ? ["--model", MODEL] : []), "-p", `${RUBRIC}\n\nANSWER:\n${answer}`];
  const out = execFileSync("pi", args, { encoding: "utf8", timeout: Number(process.env.JUDGE_TIMEOUT || 420000), env: { ...process.env, PI_DASHBOARD_HIDDEN: "1" } });
  const m = out.match(/\{[^{}]*"score"[^{}]*\}/);
  return m ? JSON.parse(m[0]) : { score: null, reason: "unparseable" };
}

const byArm = {};
for (const f of process.argv.slice(2)) {
  if (!f.endsWith(".jsonl")) continue;
  const [arm, taskId, run] = path.basename(f).replace(/\.jsonl$/, "").split(".");
  let j; try { j = judge(answerOf(f)); } catch (e) { console.error("judge fail", f, e.message); continue; }
  (byArm[arm] ||= []).push(j.score);
  console.error(`  ${arm}.${taskId}.${run} → ${j.score} (${j.reason})`);
}

console.log(`\n═══ Blind quality judge (mean 1–5) ═══`);
for (const arm of Object.keys(byArm).sort()) {
  const xs = byArm[arm].filter((x) => x != null);
  console.log(`${arm}: ${(xs.reduce((s, x) => s + x, 0) / (xs.length || 1)).toFixed(2)}  (n=${xs.length})`);
}
