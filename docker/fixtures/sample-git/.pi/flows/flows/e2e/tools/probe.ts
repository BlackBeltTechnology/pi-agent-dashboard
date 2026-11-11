// Runs git through the dashboard tool-registry facade published by the flows
// plugin bridge; throws (soft failure) when the facade is absent so the L3
// test cannot pass via a PATH fallback. Plain JS syntax (valid TS) so any
// loader runs it. See change: add-flow-code-node-tools (F1).
export default async function (_input, ctx) {
  const tools = globalThis[Symbol.for("pi-dashboard.flow-tools")];
  if (!tools) throw new Error("flow-tools facade not published");
  const r = await tools.run("git", ["--version"], { cwd: ctx.cwd, signal: ctx.signal });
  ctx.logger(r.out.trim());
  if (!r.ok) throw new Error(`git via facade failed (${r.code}): ${r.out}`);
  ctx.setSummary(r.stdout.trim());
  return { version: r.stdout.trim() };
}
