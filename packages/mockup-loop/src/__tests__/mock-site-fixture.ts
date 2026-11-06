import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

/** Temp project with mockups/ + node_modules symlinked to the repo (so react/vite resolve). Plugin-level tests only (no app config). */
export function makeFixture(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ms-fx-")));
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(root, "node_modules"), "dir");
  const w = (rel: string, body: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };
  w("mockups/mock-site.config.ts", "export default {};\n");
  w("mockups/mock-site.app.tsx", "export async function setup() {}\nexport const Providers = ({ children }: any) => children;\n");
  w("mockups/2026-11-03-a/mock.tsx", "export default { title: 'A', category: 'C', frames: [{ title: 'F', proposed: 'x' }] };\n");
  w("mockups/2026-11-02-b/mock.tsx", "export default { title: 'B', category: 'C', frames: [{ title: 'F', proposed: 'x' }] };\n");
  return root;
}


/** Servable fixture (serve_mock_site): an app build config the site inherits + a plain options file. */
export function makeServableFixture(): string {
  const root = makeFixture();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx", private: true, type: "module" }));
  fs.writeFileSync(path.join(root, "vite.config.mjs"), "export default { server: { port: 3999 }, define: { __FX__: '1' } };\n");
  fs.writeFileSync(path.join(root, "mockups/mock-site.config.ts"), 'export default { title: "Fixture", app: "./mock-site.app.tsx" };\n');
  return root;
}
