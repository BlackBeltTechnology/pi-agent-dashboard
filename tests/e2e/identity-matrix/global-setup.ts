import { bootMatrix } from "./matrix-lifecycle.js";

/** Boot every D21 setup-matrix dashboard + the fake issuer; the returned function is Playwright's teardown. */
export default async function identityMatrixGlobalSetup(): Promise<() => Promise<void>> {
  const { stop } = await bootMatrix();
  return stop;
}
