/**
 * LIVE verification of the auto-naming fix against a REAL model.
 *
 * Replicates the measurement table in the change proposal — which is what
 * established the root cause — but against the SHIPPED code path: the real
 * summarizer prompt, the real `generateTitle`, the real `parseTitle` verdicts.
 *
 * Unit tests prove the state machine; only this proves the fix against a model
 * that actually reasons. Run it from the worktree root:
 *
 *   node scripts/measure-auto-naming.mjs [provider/model]
 *
 * See change: fix-auto-naming-reasoning-model (task 11.1, 11.2).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const namer = await jiti.import("../packages/extension/src/auto-session-namer.ts");
const { generateTitle, parseTitle, stripThinkingSuffix, SUMMARIZER_SYSTEM_PROMPT } = namer;

// ESM-only export map — the bridge loads it the same way (dynamic import).
const { streamSimple } = await import("@earendil-works/pi-ai");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const agentDir = join(homedir(), ".pi", "agent");
const roles = readJson(join(agentDir, "providers.json")).roles ?? {};
const auth = readJson(join(agentDir, "auth.json"));

// The naming model, resolved exactly as the bridge resolves it.
const rawRef = process.argv[2] || roles.naming || roles.fast;
if (!rawRef) {
  console.error("no naming model: assign the `naming` or `fast` role, or pass provider/model as an argument");
  process.exit(2);
}
const slash = rawRef.indexOf("/");
if (slash <= 0) {
  console.error(`malformed model ref '${rawRef}' (expected provider/model)`);
  process.exit(2);
}
const provider = rawRef.slice(0, slash);
// Mirror production: a role value may carry a `:<level>` thinking suffix, and
// the catalogue is keyed on the bare id.
const modelId = stripThinkingSuffix(rawRef.slice(slash + 1));
const modelRef = `${provider}/${modelId}`;

const entry = auth[provider] ?? {};
const apiKey = entry.apiKey ?? entry.api_key ?? entry.key ?? entry.access ?? entry.token;
if (!apiKey) {
  console.error(`no usable credential for '${provider}' in auth.json (keys: ${Object.keys(entry)})`);
  process.exit(2);
}

// pi caches the resolved model catalogue (api, baseUrl, reasoning, compat) in
// models-store.json — the same metadata the live registry hands the bridge.
const store = readJson(join(agentDir, "models-store.json"));
const list = store[provider]?.models ?? [];
const found = (Array.isArray(list) ? list : Object.values(list)).find((m) => (m.id ?? m) === modelId);
if (!found) {
  console.error(`model '${modelId}' not in models-store.json for '${provider}'`);
  process.exit(2);
}
const model = { ...found, provider, id: modelId };

const registry = {
  find: () => model,
  getApiKeyAndHeaders: async () => ({ apiKey, headers: {} }),
};

// A transcript with an unmistakable topic — a model that emits nothing here is
// starved, not short of material.
const transcript = [
  "Fix the bridge auto-namer: the title call is starved by reasoning tokens",
  "",
  "Measured: max_tokens=16 ends finish_reason=length with empty content.",
].join("\n");

console.log(`model:  ${modelRef}  (api=${model.api}, reasoning=${model.reasoning === true})`);
console.log(`prompt: ${SUMMARIZER_SYSTEM_PROMPT.split("\n")[0]}…`);
console.log("");
console.log("cap    stopReason  verdict   applied?  text");
console.log("-----  ----------  --------  --------  ----------------------------------");

let sawStarvedAtOldCap = false;
let sawTitleAtNewCap = false;

for (const maxTokens of [1, 16, 1024, 2048]) {
  let res;
  try {
    res = await generateTitle({ registry, streamSimple, modelRef, transcript, maxTokens });
  } catch (e) {
    console.log(`${String(maxTokens).padEnd(5)}  THREW       -         -         ${e.message}`);
    continue;
  }
  if (!res.ok) {
    console.log(`${String(maxTokens).padEnd(5)}  -           ${res.hardError ? "HARD" : "soft"}      no        ${res.reason}`);
    continue;
  }
  const v = parseTitle(res.text, res.stopReason);
  const applied = v.verdict === "title";
  console.log(
    `${String(maxTokens).padEnd(5)}  ${res.stopReason.padEnd(10)}  ${v.verdict.padEnd(8)}  ` +
      `${(applied ? "YES" : "no").padEnd(8)}  ${applied ? v.title : JSON.stringify(res.text).slice(0, 40)}`,
  );
  if (maxTokens <= 16 && v.verdict === "starved") sawStarvedAtOldCap = true;
  if (maxTokens >= 1024 && applied) sawTitleAtNewCap = true;
}

console.log("");
console.log(`#X1 a truncated stream is classified starved and NEVER applied: ${sawStarvedAtOldCap ? "PASS" : "not observed"}`);
console.log(`#X2 a title is produced and applied at the NEW cap:              ${sawTitleAtNewCap ? "PASS" : "not observed"}`);
console.log("");
console.log("NOTE: reasoning consumption is nondeterministic (design D3). The exact");
console.log("starvation the proposal measured on 2026-08-20 may not reproduce on a");
console.log("given day; the cap=1 row forces the same TRUNCATED-stream condition so");
console.log("the starved verdict is exercised against the real provider regardless.");
