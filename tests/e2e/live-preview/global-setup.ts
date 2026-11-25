import { startIsolatedServer } from "./isolated-server.js";

/**
 * Start the host-run isolated dashboard (temp HOME, free non-8000 port, live-preview tiers
 * configured) once for the whole `playwright.live-preview.config.ts` run. Run state goes to
 * `STATE_PATH`; the `isolatedServer` worker fixture reads it. No docker harness.
 */
export default async function livePreviewGlobalSetup(): Promise<void> {
  const s = await startIsolatedServer();
  console.log(`[live-preview e2e] isolated dashboard on :${s.port} (HOME=${s.home}, pool ${s.pool.from}-${s.pool.to}, node ${s.nodeBin})`);
}
