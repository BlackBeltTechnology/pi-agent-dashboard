/**
 * Non-destructive import of keys into the vault.
 *
 * The server never reads a client-supplied path (`file-read-containment`):
 *  - known locations are a fixed server-side list, offered as opaque ids; only
 *    existence is checked until the user selects one;
 *  - an upload arrives as content (<= 64 KiB).
 * The proposal lists key NAMES only (no values, no lengths); values stay in a
 * server-side, single-use, time-limited proposal. Values shorter than 8
 * characters are skipped with a notice. Source files are never modified.
 *
 * The `.env` parser mirrors `packages/nano-banana/src/env.ts#parseEnvFile`;
 * a copy, because the server must not depend on an optional skill package.
 *
 * See change: add-credential-vault (D7).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type AccountView, accountView, MIN_VALUE_LENGTH, makeKeyAccount, VaultError, type VaultStore } from "./vault-store.js";

const MAX_UPLOAD_BYTES = 64 * 1024;
const PROPOSAL_TTL_MS = 10 * 60 * 1000;
const MAX_PROPOSALS = 20;
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export interface KnownCandidate {
  id: string;
  label: string;
  path: string;
  format: "env" | "json";
}

interface CandidateView {
  id: string;
  label: string;
  exists: boolean;
}

interface Proposal {
  id: string;
  items: Array<{ name: string }>;
  skipped: Array<{ name: string; reason: string }>;
}

export interface VaultImport {
  listCandidates(): CandidateView[];
  proposeFromCandidate(candidateId: string): Promise<Proposal>;
  proposeFromUpload(content: string): Proposal;
  confirm(proposalId: string, names: string[]): Promise<AccountView[]>;
}

/** Minimal `KEY=VALUE` parser: skips blanks and comments, strips `export` and surrounding quotes. */
function parseEnvFile(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    if (line.toLowerCase().startsWith("export ")) line = line.slice("export ".length);
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (key) out[key] = value;
  }
  return out;
}

function parseJsonStrings(body: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new VaultError("invalid_request", "Source file is not valid JSON"); }
  const out: Record<string, string> = {};
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** `GEMINI_API_KEY` → `gemini`; used only as the account's provider tag. */
function providerFromName(name: string): string {
  const p = name.replace(/_(API_KEY|KEY|TOKEN|SECRET)$/i, "").toLowerCase();
  return p.length > 0 ? p : "custom";
}

/** The fixed server-side list: skill `.env` files and the system-one auth file. Existence-checked only. */
export function defaultKnownLocations(home: string = os.homedir()): KnownCandidate[] {
  const out: KnownCandidate[] = [];
  const skillsDir = path.join(home, ".pi", "agent", "skills");
  try {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        out.push({ id: `skill-env:${entry.name}`, label: `skill ${entry.name} (.env)`, path: path.join(skillsDir, entry.name, ".env"), format: "env" });
      }
    }
  } catch { /* no skills dir */ }
  out.push({ id: "system-one-auth", label: "system-one auth.json", path: path.join(home, ".pi", "agent", "system-one", "auth.json"), format: "json" });
  return out;
}

export function createVaultImport(deps: { store: VaultStore; candidates: () => KnownCandidate[] }): VaultImport {
  const proposals = new Map<string, { values: Map<string, string>; names: Set<string>; expires: number }>();

  const sweep = (): void => {
    const now = Date.now();
    for (const [id, p] of proposals) if (p.expires <= now) proposals.delete(id);
    while (proposals.size >= MAX_PROPOSALS) proposals.delete(proposals.keys().next().value as string);
  };

  const propose = (pairs: Record<string, string>): Proposal => {
    sweep();
    const items: Proposal["items"] = [];
    const skipped: Proposal["skipped"] = [];
    const values = new Map<string, string>();
    for (const [name, value] of Object.entries(pairs)) {
      if (!VALID_NAME.test(name)) { skipped.push({ name: name.slice(0, 64), reason: "not a valid variable name" }); continue; }
      if (value.length < MIN_VALUE_LENGTH) { skipped.push({ name, reason: `value shorter than ${MIN_VALUE_LENGTH} characters` }); continue; }
      items.push({ name });
      values.set(name, value);
    }
    const id = randomUUID();
    proposals.set(id, { values, names: new Set(values.keys()), expires: Date.now() + PROPOSAL_TTL_MS });
    return { id, items, skipped };
  };

  return {
    listCandidates() {
      return deps.candidates().map((c) => ({ id: c.id, label: c.label, exists: fs.existsSync(c.path) }));
    },
    async proposeFromCandidate(candidateId) {
      const c = deps.candidates().find((x) => x.id === candidateId);
      if (!c) throw new VaultError("not_found", "Unknown import candidate");
      const body = await fs.promises.readFile(c.path, "utf8");
      if (Buffer.byteLength(body, "utf8") > MAX_UPLOAD_BYTES) throw new VaultError("invalid_request", "Source file is too large to import");
      return propose(c.format === "json" ? parseJsonStrings(body) : parseEnvFile(body));
    },
    proposeFromUpload(content) {
      if (typeof content !== "string") throw new VaultError("invalid_request", "Upload content must be text");
      if (Buffer.byteLength(content, "utf8") > MAX_UPLOAD_BYTES) throw new VaultError("invalid_request", `Upload exceeds ${MAX_UPLOAD_BYTES} bytes`);
      return propose(parseEnvFile(content));
    },
    async confirm(proposalId, names) {
      const p = proposals.get(proposalId);
      if (!p || p.expires <= Date.now()) { proposals.delete(proposalId); throw new VaultError("not_found", "Unknown or expired import proposal"); }
      if (!Array.isArray(names) || names.length === 0 || names.some((n) => typeof n !== "string" || !p.names.has(n))) {
        throw new VaultError("invalid_request", "Confirm only names that were proposed");
      }
      const accounts = [...new Set(names)].map((name) => makeKeyAccount({ provider: providerFromName(name), label: name, value: p.values.get(name) as string }));
      await deps.store.update((doc) => {
        if (!Array.isArray(doc.accounts)) doc.accounts = [];
        doc.accounts.push(...accounts);
      });
      proposals.delete(proposalId);
      return accounts.map(accountView);
    },
  };
}
