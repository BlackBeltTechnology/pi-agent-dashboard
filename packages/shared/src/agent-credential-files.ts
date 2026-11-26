/**
 * Files and directories of the pi agent dir (`~/.pi/agent` and `PI_CODING_AGENT_DIR`)
 * the agent-side guards treat specially. Import-free leaf (no node built-ins, safe for
 * client bundles), like `credential-encryption.ts`.
 *
 * Two classes:
 *  - `PI_AGENT_SECRET_FILES` — provider secrets (API keys, OAuth refresh tokens). The
 *    extension credential guard HARD-BLOCKS every agent tool on them (no override).
 *  - `PI_AGENT_ASK_READ_FILES` / `PI_AGENT_ASK_READ_DIRS` — pi state an agent may
 *    legitimately read but only with an explicit human `Allow once` (the path gate asks on
 *    read, marked sensitive, never `Always allow`). `sessions/` holds every other
 *    project's transcripts.
 *
 * Overlap: the server-side `AGENT_CREDENTIAL_NAMES` of `close-security-map-high-findings`
 * (`server/src/lib/dashboard-state-guard.ts`) names these files too, plus
 * `plugin-credentials.json`; the two sets overlap by design (HTTP routes vs agent tools).
 * See change: harden-agent-tool-guards (D1, D2).
 */

/** Hard-blocked provider secrets, relative to an agent dir (`/`-joined; nested entries allowed). */
export const PI_AGENT_SECRET_FILES: readonly string[] = [
  "auth.json",
  "mcp-auth.json",
  "providers.json",
  "system-one/auth.json",
];

/** Agent-dir files an agent `read` must ask about (with their `<name>.*` siblings). */
export const PI_AGENT_ASK_READ_FILES: readonly string[] = ["models.json", "mcp.json"];

/** Agent-dir directories an agent `read` must ask about (the session's own session dir is exempt). */
export const PI_AGENT_ASK_READ_DIRS: readonly string[] = ["sessions"];
