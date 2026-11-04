import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (this file lives at tests/e2e/mock-site/). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const MARKER = path.join(os.tmpdir(), "pi-mock-site-e2e.json");
export const FIXTURE_MOCK = "2026-11-04-e2e-fixture";
export const PILLS_MOCK = "2026-11-03-session-pills";

export type Marker = { root: string; port: number; pid: number; url: string };
export const readMarker = (): Marker => JSON.parse(fs.readFileSync(MARKER, "utf8")) as Marker;

const pkg = (p: string) => path.join(REPO_ROOT, "packages", p);

/**
 * Temp project for the mock-site E2E: the dashboard's real example mock + an
 * e2e-only mock exercising ring lint, Tailwind scan, containment and a phone
 * edge ring. Decisions written by tests land here, never in the repo.
 */
export function makeE2eProject(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-mock-site-e2e-")));
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
  const mockups = path.join(root, "mockups");
  fs.mkdirSync(mockups, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, "mockups", PILLS_MOCK, "mock.tsx"), path.join(mockups, PILLS_MOCK, "mock.tsx"), { recursive: true });
  fs.mkdirSync(path.join(root, "openspec", "changes"), { recursive: true });
  const w = (rel: string, body: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };
  w("mockups/mock-site.css", `@import ${JSON.stringify(path.join(pkg("client"), "src/index.css"))};
@source ${JSON.stringify(path.join(pkg("client"), "src"))};
@source ".";
@source "../openspec/changes";
`);
  w("mockups/mock-site.app.tsx", fs.readFileSync(path.join(REPO_ROOT, "mockups", "mock-site.app.tsx"), "utf8"));
  w("mockups/mock-site.config.ts", `import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mockSite } from ${JSON.stringify(pkg("mockup-loop/src/mock-site/plugin.mjs"))};
const pkg = (p: string) => path.join(${JSON.stringify(path.join(REPO_ROOT, "packages"))}, p);
export default {
  plugins: [react(), tailwindcss(), mockSite({
    projectRoot: path.resolve(__dirname, ".."), appRoot: pkg("client"), title: "E2E mocks", app: "./mock-site.app.tsx",
    themes: [
      { id: "system", label: "System", system: { dark: "dark", light: "light" } },
      { id: "dark", label: "Dark", attrs: { "data-theme": null } },
      { id: "light", label: "Light", attrs: { "data-theme": "light" } },
    ],
    aliases: { "@app": pkg("client/src"), "@blackbelt-technology/pi-dashboard-shared": pkg("shared/src"), "@blackbelt-technology/pi-dashboard-client-utils": pkg("client-utils/src"), "@blackbelt-technology/pi-dashboard-app-kit/react": pkg("app-kit/src/react/index.ts"), "@blackbelt-technology/pi-dashboard-app-kit": pkg("app-kit/src/index.ts") },
  })],
  build: { target: "es2022" }, esbuild: { target: "es2022" }, optimizeDeps: { esbuildOptions: { target: "es2022" } },
};
`);
  w(`mockups/${FIXTURE_MOCK}/mock.tsx`, `import { InlineMessage } from "@app/components/primitives/InlineMessage.tsx";
import { Fix, Issue, type Mock } from "mock-site/kit";
const Box = ({ t }: { t: string }) => <div style={{ padding: 8 }}>{t}</div>;
const mock: Mock = {
  title: "E2E fixture",
  category: "Fixture",
  frames: [
    {
      title: "Lint, Tailwind, containment",
      width: 700,
      current: (
        <div style={{ display: "grid", gap: 24, padding: 20 }}>
          <Issue n={1} tip="exactly forty characters long tip text!!"><Box t="forty" /></Issue>
          <Issue n="x-2" tip="this tip is forty-one characters long...."><Box t="forty-one" /></Issue>
          <div className="mt-[13px]" data-testid="tw-mock">tw</div>
          <InlineMessage severity="warning" title="App component">app css</InlineMessage>
        </div>
      ),
      proposed: (
        <div style={{ display: "grid", gap: 24, padding: 20 }}>
          <Fix n={1} tip="ok"><Box t="one" /></Fix>
          <Fix n="a/b" tip="bad n"><Box t="bad" /></Fix>
          <div className="fixed top-0 left-0 z-50 w-full h-10 bg-red-500" data-testid="fixed-child">fixed</div>
        </div>
      ),
    },
    {
      title: "Phone edge ring",
      phone: true,
      current: <Issue n={1} tip="edge"><div style={{ height: 40 }}>edge</div></Issue>,
      proposed: <Fix n={1} tip="edge"><div style={{ height: 40 }}>edge</div></Fix>,
    },
  ],
};
export default mock;
`);
  return root;
}
