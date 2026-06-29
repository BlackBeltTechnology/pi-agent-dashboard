#!/usr/bin/env -S npx tsx
/**
 * Extract a structured "facts sheet" from a pi session JSONL file.
 *
 * The output is NOT the final guideline. It is the deterministic raw material
 * (prompts, tool usage, files touched, skills/memories created, steering turns,
 * errors) that the agent then synthesizes into a human-readable collaboration
 * guideline (see SKILL.md).
 *
 * Run with npx tsx:
 *     npx tsx scripts/extract_session.ts <selector> [options]
 *
 * Selector:
 *     /abs/path/to/session.jsonl   explicit file
 *     <partial-uuid>               match any session file whose name contains it
 *     latest                       most recent session for --cwd (default)
 *     .                            alias for latest in current cwd
 *
 * Options:
 *     --cwd PATH        working dir whose sessions to search (default: process.cwd())
 *     --index N         with 'latest', pick the Nth most recent (0=newest)
 *     --out-md PATH     write the markdown facts sheet here (default: stdout)
 *     --out-json PATH   also write the structured JSON here
 *     --max-text N      truncate each assistant/user text block to N chars (default 1200)
 *     --max-cmd N       truncate each shown bash command to N chars (default 200)
 *     --max-cmds N      max bash commands listed (default 60)
 *     --include-thinking  reserved (assistant reasoning omitted by default)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const SESS_ROOT = join(HOME, ".pi", "agent", "sessions");

// ---------- tiny arg parser ----------

interface Args {
  selector: string;
  cwd: string;
  index: number;
  outMd?: string;
  outJson?: string;
  maxText: number;
  maxCmd: number;
  maxCmds: number;
  includeThinking: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    selector: "latest",
    cwd: process.cwd(),
    index: 0,
    maxText: 1200,
    maxCmd: 200,
    maxCmds: 60,
    includeThinking: false,
  };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    switch (t) {
      case "--cwd": a.cwd = next(); break;
      case "--index": a.index = parseInt(next(), 10) || 0; break;
      case "--out-md": a.outMd = next(); break;
      case "--out-json": a.outJson = next(); break;
      case "--max-text": a.maxText = parseInt(next(), 10) || a.maxText; break;
      case "--max-cmd": a.maxCmd = parseInt(next(), 10) || a.maxCmd; break;
      case "--max-cmds": a.maxCmds = parseInt(next(), 10) || a.maxCmds; break;
      case "--include-thinking": a.includeThinking = true; break;
      default:
        if (t.startsWith("--")) { /* ignore unknown flag */ }
        else positionals.push(t);
    }
  }
  if (positionals.length) a.selector = positionals[0];
  return a;
}

function die(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

// ---------- locating the session file ----------

function encodeCwd(cwd: string): string {
  // mirror pi's session dir naming: "-" + abspath-with-slashes-as-dashes + "--"
  return "-" + cwd.replace(/\/+$/, "").replace(/\//g, "-") + "--";
}

function listJsonl(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(dir, f));
}

function findSession(selector: string, cwd: string, index: number): string {
  // 1) explicit existing path
  if (selector && existsSync(selector) && statSync(selector).isFile()) return selector;

  // 2) latest / . -> most recent for cwd
  if (["latest", ".", ""].includes(selector)) {
    const d = join(SESS_ROOT, encodeCwd(cwd));
    const files = listJsonl(d)
      .map((f) => ({ f, mt: statSync(f).mtimeMs }))
      .sort((a, b) => b.mt - a.mt)
      .map((x) => x.f);
    if (!files.length) die(`No sessions found for cwd ${cwd}\n  (looked in ${d})`);
    if (index >= files.length) die(`--index ${index} out of range; only ${files.length} sessions for ${cwd}`);
    return files[index];
  }

  // 3) partial id -> search every session dir
  const hits: string[] = [];
  if (existsSync(SESS_ROOT)) {
    for (const sub of readdirSync(SESS_ROOT)) {
      const d = join(SESS_ROOT, sub);
      if (!statSync(d).isDirectory()) continue;
      for (const f of listJsonl(d)) if (basename(f).includes(selector)) hits.push(f);
    }
  }
  if (!hits.length) die(`No session file matches '${selector}'`);
  return hits
    .map((f) => ({ f, mt: statSync(f).mtimeMs }))
    .sort((a, b) => b.mt - a.mt)[0].f;
}

// ---------- parsing ----------

type Entry = Record<string, any>;

function loadEntries(path: string): { header: Entry | null; entries: Entry[] } {
  const entries: Entry[] = [];
  let header: Entry | null = null;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let e: Entry;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "session") header = e;
    else entries.push(e);
  }
  return { header, entries };
}

/** Active branch (root -> leaf) via id/parentId; falls back to file order (v1). */
function activePath(entries: Entry[]): Entry[] {
  const byId = new Map<string, Entry>();
  for (const e of entries) if (e.id) byId.set(e.id, e);
  if (!byId.size) return entries;

  let leaf: Entry | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].id) { leaf = entries[i]; break; }
  }
  if (!leaf) return entries;

  const chain: Entry[] = [];
  const seen = new Set<string>();
  let cur: Entry | null = leaf;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) ?? null : null;
  }
  chain.reverse();
  return chain;
}

// ---------- helpers ----------

const shortTool = (name: string): string =>
  name && name.startsWith("mcp__") ? name.split("__").pop()! : name || "?";

function textOf(content: any): string {
  if (typeof content === "string") return content;
  const out: string[] = [];
  for (const c of content ?? []) {
    if (c && c.type === "text") out.push(c.text ?? "");
    else if (c && c.type === "image") out.push("[image]");
  }
  return out.join("\n").trim();
}

function tsToIso(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function trunc(s: string, n: number): string {
  s = (s ?? "").trim();
  return s.length <= n ? s : s.slice(0, n).trimEnd() + " …[truncated]";
}

// ---------- extraction ----------

interface FactData {
  session_id: string | null;
  cwd: string | null;
  session_name: string | null;
  started: string | null;
  ended: string | null;
  duration: string | null;
  models: string[];
  thinking_levels: string[];
  counts: { user: number; assistant: number; toolResult: number };
  tool_counts: Record<string, number>;
  tool_errors: Record<string, number>;
  turns: { n: number; time: string; text: string; is_first: boolean }[];
  assistant_notes: { time: string; text: string }[];
  files_written: string[];
  files_edited: string[];
  files_read: string[];
  bash: { cmd: string; error: boolean }[];
  searches: { tool: string; q: any }[];
  skills: any[];
  memories: any[];
  subagents: any[];
  usage: { input: number; output: number; total_tokens: number; cost: number };
  _source_file?: string;
}

function classifyTool(name: string, a: Record<string, any>, isErr: boolean, d: FactData): void {
  if (name === "write" && a.path) d.files_written.push(a.path);
  else if (name === "edit" && a.path) d.files_edited.push(a.path);
  else if (name === "read" && a.path) d.files_read.push(a.path);
  else if (name === "bash" && a.command) d.bash.push({ cmd: a.command, error: isErr });
  else if (["web_search", "code_search", "fetch_content"].includes(name) &&
    (a.query || a.queries || a.url || a.urls)) {
    d.searches.push({ tool: name, q: a.query ?? a.queries ?? a.url ?? a.urls });
  } else if (name === "skill") {
    d.skills.push({
      action: a.action, name: a.name ?? a.skill_id, scope: a.scope,
      description: a.description, section: a.section,
    });
  } else if (name === "memory") {
    d.memories.push({
      action: a.action, target: a.target, category: a.category,
      content: trunc(a.content ?? a.old_text ?? "", 200),
    });
  } else if (["Agent", "agent", "task"].includes(name)) {
    d.subagents.push({ type: a.subagent_type, desc: a.description, model: a.model });
  }
}

function extract(header: Entry | null, path: Entry[]): FactData {
  const byCallId = new Map<string, Entry>();
  for (const e of path) {
    if (e.type === "message" && e.message?.role === "toolResult") {
      byCallId.set(e.message.toolCallId, e.message);
    }
  }

  const d: FactData = {
    session_id: header?.id ?? null,
    cwd: header?.cwd ?? null,
    session_name: null,
    started: null, ended: null, duration: null,
    models: [], thinking_levels: [],
    counts: { user: 0, assistant: 0, toolResult: 0 },
    tool_counts: {}, tool_errors: {},
    turns: [], assistant_notes: [],
    files_written: [], files_edited: [], files_read: [],
    bash: [], searches: [], skills: [], memories: [], subagents: [],
    usage: { input: 0, output: 0, total_tokens: 0, cost: 0 },
  };

  let firstTs: number | null = null;
  let lastTs: number | null = null;
  let userTurnNo = 0;
  const modelsSeen: string[] = [];

  for (const e of path) {
    const et = e.type;
    if (et === "session_info" && e.name) {
      d.session_name = e.name;
    } else if (et === "model_change") {
      const m = `${e.provider ?? ""}/${e.modelId ?? ""}`.replace(/^\/|\/$/g, "");
      if (m && !modelsSeen.includes(m)) modelsSeen.push(m);
    } else if (et === "thinking_level_change") {
      const lv = e.thinkingLevel;
      if (lv && !d.thinking_levels.includes(lv)) d.thinking_levels.push(lv);
    } else if (et === "message") {
      const m = e.message;
      const role = m.role;
      const ts: number | undefined = m.timestamp;
      if (ts) {
        firstTs = firstTs === null ? ts : Math.min(firstTs, ts);
        lastTs = lastTs === null ? ts : Math.max(lastTs, ts);
      }

      if (role === "user") {
        d.counts.user++;
        const txt = textOf(m.content);
        if (txt) {
          userTurnNo++;
          d.turns.push({ n: userTurnNo, time: tsToIso(ts), text: txt, is_first: userTurnNo === 1 });
        }
      } else if (role === "assistant") {
        d.counts.assistant++;
        const mdl = `${m.provider ?? ""}/${m.model ?? ""}`.replace(/^\/|\/$/g, "");
        if (mdl && !modelsSeen.includes(mdl)) modelsSeen.push(mdl);
        const u = m.usage ?? {};
        d.usage.input += u.input ?? 0;
        d.usage.output += u.output ?? 0;
        d.usage.total_tokens += u.totalTokens ?? 0;
        d.usage.cost += u.cost?.total ?? 0;
        const note = textOf(m.content);
        if (note) d.assistant_notes.push({ time: tsToIso(ts), text: note });
        for (const c of m.content ?? []) {
          if (!(c && c.type === "toolCall")) continue;
          const name = shortTool(c.name ?? "");
          const args = c.arguments ?? {};
          d.tool_counts[name] = (d.tool_counts[name] ?? 0) + 1;
          const res = byCallId.get(c.id);
          const isErr = Boolean(res && res.isError);
          if (isErr) d.tool_errors[name] = (d.tool_errors[name] ?? 0) + 1;
          classifyTool(name, args, isErr, d);
        }
      } else if (role === "toolResult") {
        d.counts.toolResult++;
      }
    }
  }

  d.models = modelsSeen;
  d.started = firstTs ? tsToIso(firstTs) : null;
  d.ended = lastTs ? tsToIso(lastTs) : null;
  if (firstTs && lastTs) {
    const secs = Math.floor((lastTs - firstTs) / 1000);
    d.duration = secs >= 3600
      ? `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
      : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  // dedup file lists, keep order
  for (const k of ["files_written", "files_edited", "files_read"] as const) {
    d[k] = [...new Set(d[k])];
  }
  return d;
}

// ---------- markdown facts sheet ----------

function renderMd(d: FactData, args: Args): string {
  const L: string[] = [];
  const title = d.session_name ?? d.session_id ?? "session";
  L.push(`# Session facts: ${title}\n`);
  L.push("> Deterministic extract — raw material for the collaboration guideline. " +
    "Synthesize, don't paste verbatim.\n");

  L.push("## Metadata\n");
  L.push(`- **Session id:** \`${d.session_id}\``);
  if (d.session_name) L.push(`- **Name:** ${d.session_name}`);
  L.push(`- **Working dir:** \`${d.cwd}\``);
  L.push(`- **Started / ended:** ${d.started} → ${d.ended}  (${d.duration})`);
  if (d.models.length) L.push(`- **Model(s):** ${d.models.join(", ")}`);
  if (d.thinking_levels.length) L.push(`- **Thinking level(s):** ${d.thinking_levels.join(", ")}`);
  const c = d.counts;
  L.push(`- **Messages:** ${c.user} user · ${c.assistant} assistant · ${c.toolResult} tool results`);
  const u = d.usage;
  L.push(`- **Tokens:** ${u.total_tokens.toLocaleString("en-US")} total ` +
    `(${u.input.toLocaleString("en-US")} in / ${u.output.toLocaleString("en-US")} out) · ` +
    `**cost:** $${u.cost.toFixed(4)}\n`);

  if (Object.keys(d.tool_counts).length) {
    L.push("## Tool usage\n");
    L.push("| Tool | Calls | Errors |");
    L.push("|------|-------|--------|");
    for (const [name, n] of Object.entries(d.tool_counts).sort((a, b) => b[1] - a[1])) {
      L.push(`| ${name} | ${n} | ${d.tool_errors[name] ?? 0} |`);
    }
    L.push("");
  }

  L.push("## User prompts (in order)\n");
  L.push("The **first** prompt is the goal. Later prompts are *steering* — the corrections, " +
    "clarifications, and redirections that shaped the result.\n");
  for (const t of d.turns) {
    const tag = t.is_first ? "🎯 GOAL" : `↪ steering #${t.n - 1}`;
    L.push(`### Prompt ${t.n} · ${tag}  _( ${t.time} )_`);
    L.push("```");
    L.push(trunc(t.text, args.maxText));
    L.push("```");
  }
  L.push("");

  if (d.skills.length) {
    L.push("## Skills created / modified\n");
    for (const s of d.skills) {
      const extra = s.description ? ` — _${trunc(s.description, 160)}_` : "";
      const sec = s.section ? ` (section: ${s.section})` : "";
      L.push(`- **${s.action}** \`${s.name}\` [${s.scope ?? "?"}]${sec}${extra}`);
    }
    L.push("");
  }

  if (d.memories.length) {
    L.push("## Memories saved\n");
    for (const m of d.memories) {
      const cat = m.category ? ` · ${m.category}` : "";
      L.push(`- **${m.action}** → ${m.target}${cat}: ${m.content}`);
    }
    L.push("");
  }

  if (d.subagents.length) {
    L.push("## Subagents spawned\n");
    for (const s of d.subagents) {
      L.push(`- \`${s.type}\`${s.model ? ` (${s.model})` : ""}: ${s.desc}`);
    }
    L.push("");
  }

  if (d.files_written.length || d.files_edited.length) {
    L.push("## Artifacts (files created / edited)\n");
    for (const p of d.files_written) L.push(`- ✏️ created \`${p}\``);
    for (const p of d.files_edited) L.push(`- 🔧 edited  \`${p}\``);
    L.push("");
  }

  if (d.searches.length) {
    L.push("## Research (searches / fetches)\n");
    for (const s of d.searches.slice(0, 30)) {
      const q = Array.isArray(s.q) ? s.q.join(", ") : String(s.q);
      L.push(`- [${s.tool}] ${trunc(q, 160)}`);
    }
    L.push("");
  }

  if (d.bash.length) {
    L.push("## Commands run\n");
    const fails = d.bash.filter((b) => b.error);
    L.push(`_${d.bash.length} commands, ${fails.length} failed._\n`);
    for (const b of d.bash.slice(0, args.maxCmds)) {
      const flag = b.error ? "❌ " : "";
      L.push(`- ${flag}\`${trunc(b.cmd, args.maxCmd)}\``);
    }
    if (d.bash.length > args.maxCmds) L.push(`- … +${d.bash.length - args.maxCmds} more`);
    L.push("");
  }

  if (d.assistant_notes.length) {
    L.push("## Assistant explanations (condensed)\n");
    L.push("_What the model said it was doing — useful for the narrative & rationale._\n");
    for (const n of d.assistant_notes) {
      const txt = trunc(n.text, args.maxText);
      if (txt) L.push(`**[${n.time}]** ${txt}\n`);
    }
  }
  return L.join("\n");
}

// ---------- main ----------

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const path = findSession(args.selector, args.cwd, args.index);
  const { header, entries } = loadEntries(path);
  const chain = activePath(entries);
  const data = extract(header, chain);
  data._source_file = path;

  const md = renderMd(data, args);

  if (args.outJson) {
    writeFileSync(args.outJson, JSON.stringify(data, null, 2), "utf8");
    process.stderr.write(`[wrote json] ${args.outJson}\n`);
  }
  if (args.outMd) {
    writeFileSync(args.outMd, md, "utf8");
    process.stderr.write(`[wrote md]   ${args.outMd}\n`);
    process.stderr.write(`[source]     ${path}\n`);
  } else {
    process.stdout.write(md + "\n");
    process.stderr.write(`\n[source] ${path}\n`);
  }
}

main();
