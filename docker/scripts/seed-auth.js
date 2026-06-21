#!/usr/bin/env node
/**
 * First-run auth seeder for the pi-dashboard container.
 *
 * Reads provider API keys from environment variables and writes them to
 * pi's auth.json (`Record<provider, { type: "api_key", key }>`) with 0600
 * permissions. Skips entirely when auth.json already exists, so a volume
 * persisted from a previous run is never overwritten and UI-managed
 * credentials always win. See openspec change docker-packaging, Decision 4.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// env var -> pi provider id
const PROVIDER_ENV = {
  ANTHROPIC_API_KEY: "anthropic",
  OPENAI_API_KEY: "openai",
  GEMINI_API_KEY: "google",
};

const authPath = process.env.PI_AUTH_PATH || join(homedir(), ".pi", "agent", "auth.json");

if (existsSync(authPath)) {
  console.log(`[seed-auth] ${authPath} already exists — leaving untouched.`);
  process.exit(0);
}

const credentials = {};
for (const [envName, provider] of Object.entries(PROVIDER_ENV)) {
  const key = process.env[envName];
  if (key && key.trim()) {
    credentials[provider] = { type: "api_key", key: key.trim() };
  }
}

if (Object.keys(credentials).length === 0) {
  console.log("[seed-auth] no *_API_KEY env vars set — skipping seed (add keys via the dashboard UI).");
  process.exit(0);
}

try {
  mkdirSync(dirname(authPath), { recursive: true });
  // `wx` makes the create atomic: if another process wrote auth.json between
  // the existsSync() check above and now, this throws EEXIST instead of
  // clobbering persisted credentials.
  writeFileSync(authPath, JSON.stringify(credentials, null, 2), { mode: 0o600, flag: "wx" });
} catch (err) {
  if (err && err.code === "EEXIST") {
    console.log(`[seed-auth] ${authPath} created concurrently \u2014 leaving untouched.`);
    process.exit(0);
  }
  console.error(`[seed-auth] failed to write ${authPath}: ${err && err.message ? err.message : err}`);
  process.exit(1);
}
console.log(`[seed-auth] wrote ${Object.keys(credentials).join(", ")} to ${authPath} (0600).`);
