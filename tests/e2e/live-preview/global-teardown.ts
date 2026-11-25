import { stopIsolatedServer } from "./isolated-server.js";

/** Kill the isolated dashboard and remove its temp HOME. */
export default async function livePreviewGlobalTeardown(): Promise<void> {
  stopIsolatedServer();
}
