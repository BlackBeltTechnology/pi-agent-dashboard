/**
 * The `pi-dashboard` CLI argv prefix for the plugin server (design D4): the
 * server's own `process.execPath` + its `--import` loader flags + its CLI entry
 * (`process.argv[1]`, the server runs `cli.ts`). Other execArgv (heap size,
 * `--inspect`) are dropped so the child never fights for an inspector port.
 * `PI_DASHBOARD_BIN` overrides (absolute launcher path). The CLI carries the
 * local credential itself, so it works under strict local proof where a
 * plugin's `fastify.inject` would be refused. See change: add-obs-studio-plugin.
 */
function loaderArgs(execArgv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < execArgv.length; i++) {
    const a = execArgv[i];
    if (a === "--import" && execArgv[i + 1] !== undefined) out.push(a, execArgv[++i]);
    else if (a.startsWith("--import=")) out.push(a);
  }
  return out;
}

export function dashboardCliArgv(
  proc: { execPath: string; execArgv: readonly string[]; argv: readonly string[]; env: Record<string, string | undefined> } = process,
): string[] {
  const override = proc.env.PI_DASHBOARD_BIN;
  if (override) return override.endsWith(".mjs") || override.endsWith(".js") ? [proc.execPath, override] : [override];
  const entry = proc.argv[1];
  if (!entry) throw new Error("cannot resolve the pi-dashboard CLI entry (process.argv[1] is empty)");
  return [proc.execPath, ...loaderArgs(proc.execArgv), entry];
}
