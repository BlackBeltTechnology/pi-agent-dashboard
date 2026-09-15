// The `requestHeadersCommand` the provisioned `pi-dashboard` mcp.json entry
// points at (wire-mcp-session-token, design D2).
//
// The pi-mcp-adapter spawns this once per HTTP request to /mcp and reads ONE
// JSON object of headers from stdout. The bearer is read from THIS process's
// own environment — never from argv, which `ps -ww -o args=` exposes to every
// local user (spike Q1b). The adapter passes the credential via the entry's
// `env` slot as `${PI_DASHBOARD_MCP_TOKEN}`, interpolated from the parent pi
// process's live environment at spawn time, so a value the bridge extension
// wrote AFTER session start is picked up on the next request (spike Q2).
//
// Fail-closed: with the env var unset there is no credential to present. Exit
// non-zero so the failure is at least an observable 401 rather than a silent
// empty header — the adapter discards this command's stderr
// (`stdio: ["pipe","pipe","ignore"]`), which is why the unset case is also
// recorded server-side (test-plan X2).
//
// Stdin: the adapter writes a `{version, method, url, bodyBase64}` envelope we
// have no use for; drain it so the writer never EPIPEs, then answer.

const TOKEN_ENV_VAR = "PI_DASHBOARD_MCP_TOKEN";

let envelope = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  envelope += chunk;
  if (envelope.length > 1024 * 1024) {
    process.exit(1); // absurd envelope — refuse rather than buffer forever
  }
});
process.stdin.on("end", () => {
  const token = process.env[TOKEN_ENV_VAR];
  if (typeof token !== "string" || token.length === 0) {
    process.stderr.write(`${TOKEN_ENV_VAR} is not set in this process environment\n`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ Authorization: `Bearer ${token}` }));
});
