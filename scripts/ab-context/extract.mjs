#!/usr/bin/env node
// Parse run JSONL files → behavior rows on stdout (one JSON per line).
// Usage: node extract.mjs runs/*.jsonl > rows.jsonl
import fs from "node:fs";
import path from "node:path";

const TASKS_FILE = process.env.TASKS_FILE || "./tasks.jsonl";
const tasks = new Map(
  fs.readFileSync(new URL(TASKS_FILE, import.meta.url), "utf8")
    .split("\n").filter(Boolean).map((l) => { const t = JSON.parse(l); return [t.id, t]; }),
);

const SEARCH_BASH = /\b(grep|rg|ripgrep|find)\b/;
const isKbTool = (n) => /^kb(_|$)/.test(n) || n === "kb";

function parseRun(file) {
  const base = path.basename(file).replace(/\.jsonl$/, "");
  const [arm, taskId, run] = base.split(".");     // A.kb-before-grep.1
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const toolSeq = [];        // { name, cmd }
  let assistantText = "";
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, reasoning: 0, ctxPeak: 0 };
  for (const l of lines) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type !== "message") continue;
    const m = o.message || {};
    if (m.usage) {
      usage.input += m.usage.input || 0;
      usage.output += m.usage.output || 0;
      usage.cacheRead += m.usage.cacheRead || 0;
      usage.cacheWrite += m.usage.cacheWrite || 0;
      usage.total += m.usage.totalTokens || 0;
      usage.cost += m.usage.cost?.total || 0;
      usage.reasoning += m.usage.reasoning || 0;
      // per-turn context = everything the provider had to read this turn
      const ctx = (m.usage.input || 0) + (m.usage.cacheRead || 0) + (m.usage.cacheWrite || 0);
      if (ctx > usage.ctxPeak) usage.ctxPeak = ctx;
    }
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (!b || !b.type) continue;
      if (b.type === "toolCall" || b.type === "tool_use" || b.type === "tool_call") {
        const name = b.name || b.toolName || "?";
        const inp = b.input || b.arguments || {};
        toolSeq.push({ name, cmd: inp.command || inp.cmd || "" });
      } else if (b.type === "text" && m.role === "assistant") {
        assistantText += "\n" + (b.text || "");
      }
    }
  }
  const names = toolSeq.map((t) => t.name);
  // sidecars written by run-impl.sh: "0" = tests passed / tests untouched
  const sidecar = (ext) => {
    try { return fs.readFileSync(file.replace(/\.jsonl$/, ext), "utf8").trim(); }
    catch { return null; }
  };
  const checks = {};
  for (const c of (tasks.get(taskId)?.checks || [])) {
    checks[c.name] = evalCheck(c, { toolSeq, names, assistantText, sidecar });
  }
  return { arm, taskId, run: Number(run), usage, nTools: names.length, toolSeq: names, checks, textLen: assistantText.length };
}

function evalCheck(c, ctx) {
  const { toolSeq, names, assistantText, sidecar } = ctx;
  switch (c.type) {
    case "verify_exit_zero": {
      const v = sidecar?.(".verify");
      if (v === null || v === undefined) return "na";   // run crashed before verify
      return v === "0" ? "pass" : "fail";
    }
    case "test_file_unmodified": {
      const v = sidecar?.(".testdiff");
      if (v === null || v === undefined) return "na";
      return v === "0" ? "pass" : "fail";
    }
    case "first_search_is_kb": {
      const first = toolSeq.find((t) => isKbTool(t.name) || (t.name === "bash" && SEARCH_BASH.test(t.cmd)));
      if (!first) return "na";
      return isKbTool(first.name) ? "pass" : "fail";
    }
    case "tool_called":     return names.includes(c.tool) ? "pass" : "fail";
    case "tool_not_called": return names.includes(c.tool) ? "fail" : "pass";
    case "text_matches":    return new RegExp(c.re, c.flags || "").test(assistantText) ? "pass" : "fail";
    case "text_not_matches":return new RegExp(c.re, c.flags || "").test(assistantText) ? "fail" : "pass";
    case "bash_matches":    return toolSeq.some((t) => t.name === "bash" && new RegExp(c.re, c.flags || "").test(t.cmd)) ? "pass" : "fail";
    default: return "na";
  }
}

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: node extract.mjs runs/*.jsonl > rows.jsonl"); process.exit(1); }
for (const f of files) {
  if (!f.endsWith(".jsonl")) continue;
  try { console.log(JSON.stringify(parseRun(f))); }
  catch (e) { console.error("skip", f, e.message); }
}
