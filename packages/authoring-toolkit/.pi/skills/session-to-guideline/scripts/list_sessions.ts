#!/usr/bin/env -S npx tsx
/**
 * List recent pi sessions so a session can be chosen for documentation.
 *
 * Run with npx tsx:
 *     npx tsx scripts/list_sessions.ts [--cwd PATH] [--limit N] [--all]
 *
 * Without --all, lists sessions for --cwd (default: current working directory),
 * newest first, with id, time, name, message count, and the first user prompt.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const SESS_ROOT = join(HOME, ".pi", "agent", "sessions");

interface Args { cwd: string; limit: number; all: boolean; }

function parseArgs(argv: string[]): Args {
  const a: Args = { cwd: process.cwd(), limit: 20, all: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--cwd") a.cwd = argv[++i];
    else if (t === "--limit") a.limit = parseInt(argv[++i], 10) || a.limit;
    else if (t === "--all") a.all = true;
  }
  return a;
}

const encodeCwd = (cwd: string): string =>
  "-" + cwd.replace(/\/+$/, "").replace(/\//g, "-") + "--";

function listJsonl(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));
}

function firstPromptAndName(path: string): { name: string | null; prompt: string; msgs: number } {
  let name: string | null = null;
  let prompt: string | null = null;
  let msgs = 0;
  try {
    const text = readFileSync(path, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      let e: Record<string, any>;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "session_info" && e.name) {
        name = e.name;
      } else if (e.type === "message") {
        const m = e.message;
        if (m.role === "user" || m.role === "assistant") msgs++;
        if (m.role === "user" && prompt === null) {
          if (typeof m.content === "string") prompt = m.content;
          else if (Array.isArray(m.content)) {
            for (const b of m.content) {
              if (b && b.type === "text") { prompt = b.text; break; }
            }
          }
        }
      }
    }
  } catch { /* ignore unreadable files */ }
  return { name, prompt: (prompt ?? "").trim().replace(/\n/g, " "), msgs };
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  let files: string[] = [];
  if (args.all) {
    if (existsSync(SESS_ROOT)) {
      for (const sub of readdirSync(SESS_ROOT)) {
        const d = join(SESS_ROOT, sub);
        if (statSync(d).isDirectory()) files.push(...listJsonl(d));
      }
    }
  } else {
    files = listJsonl(join(SESS_ROOT, encodeCwd(args.cwd)));
  }

  files = files
    .map((f) => ({ f, mt: statSync(f).mtimeMs }))
    .sort((a, b) => b.mt - a.mt)
    .slice(0, args.limit)
    .map((x) => x.f);

  if (!files.length) {
    console.log(`No sessions found (${args.all ? "all projects" : args.cwd}).`);
    return;
  }

  console.log(`${"#".padStart(2)}  ${"when".padEnd(19)}  ${"msgs".padStart(4)}  id / name / first prompt`);
  console.log("-".repeat(100));
  files.forEach((f, i) => {
    const when = fmtTime(statSync(f).mtimeMs);
    const sid = basename(f).split("_").slice(1).join("_").replace(".jsonl", "");
    const { name, prompt, msgs } = firstPromptAndName(f);
    const label = name ?? (prompt.slice(0, 70) + (prompt.length > 70 ? "…" : ""));
    console.log(`${String(i).padStart(2)}  ${when.padEnd(19)}  ${String(msgs).padStart(4)}  ${sid.slice(0, 8)}  ${label}`);
  });
  console.log("\nPick with:  npx tsx scripts/extract_session.ts <id-or-'latest'> --cwd <dir>");
  console.log("  (use 'latest --index N' to pick the Nth-most-recent by the # column)");
}

main();
