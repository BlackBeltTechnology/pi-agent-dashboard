#!/usr/bin/env node
// Parse run JSONL files → behavior rows on stdout (one JSON per line).
// Usage: node extract.mjs runs/*.jsonl > rows.jsonl
import fs from "node:fs";
import path from "node:path";

const tasks = new Map(
  fs.readFileSync(new URL("./tasks.jsonl", import.meta.url), "utf8")
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
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 };
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
  const checks = {};
  for (const c of (tasks.get(taskId)?.checks || [])) {
    checks[c.name] = evalCheck(c, { toolSeq, names, assistantText });
  }
  return { arm, taskId, run: Number(run), usage, nTools: names.length, toolSeq: names, checks, textLen: assistantText.length };
}

function evalCheck(c, ctx) {
  const { toolSeq, names, assistantText } = ctx;
  switch (c.type) {
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
