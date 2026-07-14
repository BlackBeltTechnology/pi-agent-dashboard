#!/usr/bin/env node
import { execSync } from "node:child_process";
// One-time codemod: migrate `auto.*` codemod keys to structured domain keys.
// - Harvests every referenced `auto.*` key + its English call-site fallback.
// - Assigns a structured key (domain-rooted, camelCase leaf) deterministically.
// - Rewrites all client call sites and the zh-CN dictionary in i18n.tsx.
// - Emits packages/client/src/lib/i18n-legacy-aliases.ts (old -> new) and
//   packages/client/src/lib/i18n-en-source.json (structured key -> English source).
// Usage: node scripts/i18n-migrate-auto-keys.mjs [--write]
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CLIENT = path.join(ROOT, "packages/client/src");
const I18N = path.join(CLIENT, "lib/i18n.tsx");
const WRITE = process.argv.includes("--write");

// ---- 1. Collect client source files ---------------------------------------
const files = execSync(
  `grep -rl '"auto\\.' ${CLIENT} --include='*.tsx' --include='*.ts'`,
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((f) => f && !f.endsWith("lib/i18n.tsx"));

// ---- 2. Harvest auto keys + English fallbacks from call sites -------------
// Matches: <fn>("auto.key", <arg2>, "english") | ("auto.key", <arg2>) | ("auto.key")
// We only need key + trailing string literal fallback when present.
const enSource = {}; // autoKey -> english
const autoKeys = new Set();
const keyRe = /"(auto\.[a-zA-Z0-9_]+)"/g;
// 3-arg form: ("auto.key", <vars>, "english") — vars has no top-level comma/paren.
const fbRe = /"(auto\.[a-zA-Z0-9_]+)"\s*,\s*[^,)]*,\s*("(?:[^"\\]|\\.)*")/g;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  let m;
  while ((m = keyRe.exec(src))) autoKeys.add(m[1]);
  let fm;
  while ((fm = fbRe.exec(src))) {
    if (!enSource[fm[1]]) {
      try {
        enSource[fm[1]] = JSON.parse(fm[2]);
      } catch {
        /* ignore unparsable fallback */
      }
    }
  }
}

// ---- 3. Pull zh-CN values for auto keys from i18n.tsx ---------------------
const i18nSrc = fs.readFileSync(I18N, "utf8");
const zhAuto = {}; // autoKey -> zh value
const zhRe = /"(auto\.[a-zA-Z0-9_]+)":\s*("(?:[^"\\]|\\.)*")/g;
let zm;
while ((zm = zhRe.exec(i18nSrc))) {
  autoKeys.add(zm[1]);
  zhAuto[zm[1]] = JSON.parse(zm[2]);
}

// ---- 4. Domain assignment heuristic --------------------------------------
const DOMAIN_RULES = [
  ["worktree", /worktree/],
  ["git", /\b(git|branch|merge|commit|stash|uncommitted|fast_forward|cascade|pull_request|remote)\b|git|branch|merge|stash|cascade/],
  ["openspec", /openspec|proposal|artifact|new_change|attach.*change|detach.*change|specs?\b|task|archive/],
  ["gateway", /gateway|api_key|api_keys|api_type|oauth|subscription|issuer|client_id|client_secret|invite|enroll/],
  ["tunnel", /tunnel|zrok|mdns|discovery|watchdog|vlan|multicast|firewall/],
  ["editor", /editor|code_server|vscode|code-server/],
  ["packages", /package|install|uninstall|npm|extension|module|plugin|chocolatey|homebrew|scoop|brew/],
  ["providers", /provider|base_url|registry|anthropic|openai_compatible/],
  ["models", /\bmodel/],
  ["folders", /folder|workspace|directory|pin_|_pin|pin_directory/],
  ["terminal", /terminal|\bbash\b|stderr|sigterm/],
  ["diff", /\bdiff\b|unified|changed_files|no_diff/],
  ["doctor", /doctor|diagnostic/],
  ["session", /session|spawn|fork|resume|steering|thinking|reasoning|turn|prompt|chat|follow_up|ask_user|message/],
  ["connection", /connect|disconnect|unreachable|switch_server/],
  ["tunnel", /qr|scan_to/],
  ["landing", /welcome|install_app|home_screen|add_to_home|pwa/],
  ["status", /idle|running|stopped|queued|failed|waiting|loading|error|rate_limited|retry|aborted|cancelled|revoked/],
  ["time", /_ago\b|just_now/],
  ["settings", /setting|enabled|_port\b|timeout|threshold|interval|max_|min_|poll|jitter|idle_seconds|memory|buffer|scope/],
];
const COMMON = new Set([
  "add", "cancel", "confirm", "save", "close", "remove", "delete", "ok",
  "yes", "no", "back", "next", "prev", "retry", "refresh", "rename", "edit",
  "copy", "download", "export", "share", "search", "select", "submit", "send",
  "reset", "update", "install", "verify", "continue", "skip", "apply", "clear",
  "dismiss", "expand", "view", "home", "actions", "name", "label", "path",
  "port", "host", "key", "loading", "error", "stop", "start", "run", "state",
]);

function camel(s) {
  return s
    .split("_")
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join("");
}

function assignDomain(autoKey) {
  const leaf = autoKey.slice("auto.".length);
  if (COMMON.has(leaf)) return `common.${camel(leaf)}`;
  for (const [domain, re] of DOMAIN_RULES) {
    if (re.test(leaf)) return `${domain}.${camel(leaf)}`;
  }
  return `common.${camel(leaf)}`;
}

// ---- 5. Build mapping with collision-safe leaves --------------------------
const mapping = {}; // autoKey -> structuredKey
const used = new Set();
// Reserve existing structured keys already in i18n.tsx so we don't collide.
for (const em of i18nSrc.matchAll(/"([a-z][a-zA-Z]+\.[a-zA-Z0-9.]+)":/g)) {
  if (!em[1].startsWith("auto.")) used.add(em[1]);
}
const sorted = [...autoKeys].sort();
for (const autoKey of sorted) {
  let key = assignDomain(autoKey);
  if (used.has(key)) {
    let n = 2;
    while (used.has(`${key}${n}`)) n++;
    key = `${key}${n}`;
  }
  used.add(key);
  mapping[autoKey] = key;
}

// ---- 6. Compose outputs ---------------------------------------------------
const aliasEntries = sorted
  .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(mapping[k])},`)
  .join("\n");
const aliasFile = `// AUTO-GENERATED by scripts/i18n-migrate-auto-keys.mjs\n// Maps deprecated \`auto.*\` keys to their structured replacement so any residual\n// call site keeps resolving. Safe to shrink as call sites are confirmed migrated.\nexport const LEGACY_ALIASES: Record<string, string> = {\n${aliasEntries}\n};\n`;

// English source map keyed by structured key (source of truth for hu authoring).
const enByStructured = {};
for (const autoKey of sorted) {
  const en = enSource[autoKey];
  if (en != null) enByStructured[mapping[autoKey]] = en;
}

// zh-CN by structured key.
const zhByStructured = {};
for (const autoKey of sorted) {
  if (zhAuto[autoKey] != null) zhByStructured[mapping[autoKey]] = zhAuto[autoKey];
}

if (!WRITE) {
  const domains = {};
  for (const v of Object.values(mapping)) {
    const d = v.split(".")[0];
    domains[d] = (domains[d] || 0) + 1;
  }
  console.log("auto keys:", sorted.length);
  console.log("english harvested:", Object.keys(enSource).length);
  console.log("zh values:", Object.keys(zhAuto).length);
  console.log("domain distribution:", JSON.stringify(domains, null, 2));
  console.log("sample:", sorted.slice(0, 8).map((k) => `${k} -> ${mapping[k]}`).join("\n"));
  process.exit(0);
}

// ---- 7. Rewrite call sites ------------------------------------------------
let rewritten = 0;
for (const f of files) {
  let src = fs.readFileSync(f, "utf8");
  let changed = false;
  for (const [autoKey, structured] of Object.entries(mapping)) {
    const needle = `"${autoKey}"`;
    if (src.includes(needle)) {
      src = src.split(needle).join(`"${structured}"`);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(f, src);
    rewritten++;
  }
}

// ---- 8. Rewrite i18n.tsx zh-CN dict: replace auto block with structured ---
let newI18n = i18nSrc;
// Remove the entire auto block (between the two marker comments).
const startMarker = "  // --- auto-generated (codemod sweep) ---";
const endMarker = "  // --- end auto-generated ---";
const s = newI18n.indexOf(startMarker);
const e = newI18n.indexOf(endMarker);
if (s === -1 || e === -1) throw new Error("auto markers not found in i18n.tsx");
const structuredBlock = Object.keys(zhByStructured)
  .sort()
  .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(zhByStructured[k])},`)
  .join("\n");
newI18n =
  newI18n.slice(0, s) +
  "  // --- migrated from auto.* (see scripts/i18n-migrate-auto-keys.mjs) ---\n" +
  structuredBlock +
  "\n" +
  newI18n.slice(e + endMarker.length);
fs.writeFileSync(I18N, newI18n);

// ---- 9. Emit generated files ---------------------------------------------
fs.writeFileSync(path.join(CLIENT, "lib/i18n-legacy-aliases.ts"), aliasFile);
fs.writeFileSync(
  path.join(CLIENT, "lib/i18n-en-source.json"),
  JSON.stringify(enByStructured, null, 2) + "\n",
);

console.log(`Rewrote ${rewritten} call-site files.`);
console.log(`Migrated ${sorted.length} auto keys -> structured.`);
console.log(`English source entries: ${Object.keys(enByStructured).length}`);
console.log(`zh-CN structured entries: ${Object.keys(zhByStructured).length}`);
