import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

/** Temp project with mockups/ + node_modules symlinked to the repo (so react/vite resolve). */
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


/** Fixture whose mock-site.config.ts really runs the plugin (for serve_mock_site). */
export function makeServableFixture(): string {
  const root = makeFixture();
  const plugin = path.resolve(here, "../mock-site/plugin.mjs");
  fs.writeFileSync(path.join(root, "mockups/mock-site.config.ts"), `import path from "node:path";
import { mockSite } from ${JSON.stringify(plugin)};
export default { plugins: [mockSite({ projectRoot: path.resolve(__dirname, ".."), app: "./mock-site.app.tsx" })] };
`);
  return root;
}
