#!/usr/bin/env node
/**
 * E2E-ONLY seed for the multi-user identity plane (openspec:
 * add-multi-user-identity-plane §11.2).
 *
 * Writes two ENDED sessions with a persisted `principalOwner` sidecar — one
 * owned by fixture user Anna, one by Béla — so the two-user isolation spec can
 * assert, over the REAL wired server, that each principal sees only its own
 * session (list/bootstrap/detail owner-gating, §8.1/§8.2/D11). Ended sessions
 * need no live pi process, so the split is deterministic and fast (no 30s spawn).
 *
 * The owner `iss` MUST equal the resolver's configured issuer and the token
 * `iss` the fake OIDC issuer stamps — passed as argv[3] by test-entrypoint.sh.
 *
 * Sourced by docker/test-entrypoint.sh under PI_E2E_IDENTITY=1. NOT production.
 *
 * Usage: seed-identity-sessions.mjs <sessionsRoot> <issuer>
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Stable ids the spec pins. */
export const ANNA_SESSION_ID = "019f1d00-0000-7000-8000-0000000000a1";
export const BELA_SESSION_ID = "019f1d00-0000-7000-8000-0000000000b1";

/** Stable subs — must match tests/e2e/helpers/identity-tokens.ts FIXTURE_USERS. */
const OWNERS = [
  { id: ANNA_SESSION_ID, sub: "user-anna", label: "Anna" },
  { id: BELA_SESSION_ID, sub: "user-bela", label: "Béla" },
];

export function seedIdentitySessions(sessionsRoot, issuer) {
  if (!issuer) throw new Error("seed-identity-sessions: issuer (argv[3]) is required");
  fs.mkdirSync(sessionsRoot, { recursive: true });
  // Recent so both land inside the default snapshot window.
  const baseTime = Date.parse("2026-09-01T12:00:00.000Z");

  for (const [i, owner] of OWNERS.entries()) {
    const cwd = `/fixtures/identity-${owner.sub}`;
    const dirEncoded = `--fixtures-identity-${owner.sub}--`;
    const dir = path.join(sessionsRoot, dirEncoded);
    fs.mkdirSync(dir, { recursive: true });

    const startedAt = baseTime + i * 1000;
    const endedAt = startedAt + 500;
    const datePrefix = new Date(startedAt).toISOString().replace(/:/g, "-");
    const jsonlName = `${datePrefix}_${owner.id}.jsonl`;
    const metaName = `${datePrefix}_${owner.id}.meta.json`;

    fs.writeFileSync(
      path.join(dir, jsonlName),
      `${JSON.stringify({ type: "session", id: owner.id, cwd })}\n`,
    );
    fs.writeFileSync(
      path.join(dir, metaName),
      `${JSON.stringify({
        cwd,
        status: "ended",
        startedAt,
        endedAt,
        name: `${owner.label} identity session`,
        // §6.2/D11 — the ownership key the owner-gate reads back at scan time.
        principalOwner: { iss: issuer, sub: owner.sub },
      })}\n`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [root, issuer] = process.argv.slice(2);
  if (!root || !issuer) {
    console.error("Usage: seed-identity-sessions.mjs <sessionsRoot> <issuer>");
    process.exit(1);
  }
  seedIdentitySessions(root, issuer);
  console.log(
    `[test-entrypoint] PI_E2E_IDENTITY: seeded Anna + Béla owned sessions (iss=${issuer}) in ${root}`,
  );
}
