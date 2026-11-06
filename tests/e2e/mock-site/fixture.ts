import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (this file lives at tests/e2e/mock-site/). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const MARKER = path.join(os.tmpdir(), "pi-mock-site-e2e.json");
export const FIXTURE_MOCK = "2026-11-04-e2e-fixture";
export const PILLS_MOCK = "2026-11-03-session-pills";
export const SCRIPTED_MOCK = "2026-11-07-e2e-scripted";
export const SOLID_MOCK = "2026-11-07-e2e-solid";

export type Marker = { root: string; port: number; pid: number; url: string };
export const readMarker = (): Marker => JSON.parse(fs.readFileSync(MARKER, "utf8")) as Marker;

const pkg = (p: string) => path.join(REPO_ROOT, "packages", p);

/**
 * Scripted / fixture scenarios (add-mock-site-exact-env test-plan E11, E12, F3-F5, F7-F10).
 * Frames: 1 late target (3000 ms, default timeout) · 2 never target · 3 target at 1500 ms with
 * timeout 1000 · 4 unless/expect · 5 stateful fixture toggle, both panes, 3-step script ·
 * 6 WebSocket fixture · 7 unfixtured GET · 8 typing (runs beside 5) · 9 counter (reduced motion).
 */
const SCRIPTED_SRC = `import { useEffect, useState } from "react";
import type { Fixtures, Mock } from "mock-site/kit";
function Late({ ms, id }: { ms: number; id: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), ms); return () => clearTimeout(t); }, [ms]);
  return <div>{on ? <button type="button" data-testid={id}>{id}</button> : "waiting"}</div>;
}
function Raw() {
  const [clicks, setClicks] = useState(0);
  return <div><input data-testid="raw-input" defaultValue="0 17 * * *" /><button type="button" data-testid="raw-toggle" onClick={() => setClicks((c) => c + 1)}>toggle</button><span data-testid="raw-clicks">clicks: {clicks}</span></div>;
}
function Flag() {
  const [on, setOn] = useState<boolean | null>(null);
  const [aim, setAim] = useState("");
  const load = () => fetch("/api/flag").then((r) => r.json()).then((d) => setOn(d.on));
  useEffect(() => { void load(); }, []);
  const click = async (e: React.MouseEvent) => {
    const c = document.querySelector<HTMLElement>(".mk-cursor");
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (c) setAim(Math.abs(Number(c.dataset.x) - (b.left + b.width / 2)) <= 2 && Math.abs(Number(c.dataset.y) - (b.top + b.height / 2)) <= 2 ? "on-target" : "off-target");
    await fetch("/api/flag", { method: "POST" });
    await load();
  };
  return <div data-flag={on === null ? "loading" : on ? "on" : "off"}>flag: {on === null ? "..." : on ? "on" : "off"} <button type="button" data-testid="toggle" onClick={click}>toggle</button> <span data-testid="aim">{aim}</span></div>;
}
function Feed() {
  const [msg, setMsg] = useState("connecting");
  useEffect(() => { const ws = new WebSocket(\`ws://\${location.host}/ws/feed\`); ws.onmessage = (e) => setMsg(String(e.data)); return () => ws.close(); }, []);
  return <div data-testid="feed">{msg}</div>;
}
function Unmocked() {
  const [s, setS] = useState("loading");
  useEffect(() => { void fetch("/api/unmocked").then((r) => setS("status " + r.status)); void fetch("/api/unmocked"); }, []);
  return <div data-testid="unmocked">{s}</div>;
}
function Counter() {
  const [n, setN] = useState(0);
  return <div><button type="button" data-testid="inc" onClick={() => setN((x) => x + 1)}>inc</button><span data-testid="count">count: {n}</span></div>;
}
const flagFixtures = (): Fixtures => { let on = false; return { http: { "GET /api/flag": () => ({ on }), "POST /api/flag": () => { on = !on; return { ok: true }; } } }; };
const mock: Mock = {
  title: "E2E scripted",
  category: "Fixture",
  frames: [
    { title: "Late target", loop: false, proposed: <Late ms={3000} id="late" />, script: [{ say: "click late", target: "late", act: "click" }] },
    { title: "Never target", loop: false, proposed: <div>none</div>, script: [{ say: "click never", target: "never", act: "click" }] },
    { title: "Short timeout", loop: false, proposed: <Late ms={1500} id="slow" />, script: [{ say: "click slow", target: "slow", act: "click", timeout: 1000 }] },
    { title: "Unless and expect", loop: false, proposed: <Raw />, script: [
      { say: "switch to raw mode", target: "raw-toggle", act: "click", unless: "raw-input" },
      { say: "expect the impossible", target: "raw-input", act: "click", expect: "nope", timeout: 500 },
    ] },
    { title: "Stateful toggle", fixtures: flagFixtures, current: <Flag />, proposed: <Flag />, script: [
      { say: "Toggle the flag", target: "toggle", act: "click", expect: "[data-flag=on]" },
      { say: "Flag is on", act: "wait", target: "[data-flag=on]" },
      { say: "Hover the toggle", target: "toggle", act: "hover" },
    ] },
    { title: "WebSocket feed", fixtures: () => ({ ws: { "/ws/feed": (s) => { setTimeout(() => s.send("hello from fixture"), 50); } } }), proposed: <Feed /> },
    { title: "Unmocked request", fixtures: () => ({}), proposed: <Unmocked /> },
    { title: "Typing", proposed: <input data-testid="name" />, script: [
      { say: "Clear", target: "name", act: "clear" },
      { say: "Type hello", target: "name", act: "type", text: "hello", expect: (d) => (d.querySelector("input") as HTMLInputElement).value === "hello" },
    ] },
    { title: "Counter steps", loop: false, proposed: <Counter />, script: [
      { say: "one", target: "inc", act: "click" },
      { say: "two", target: "inc", act: "click" },
      { say: "three", target: "inc", act: "click" },
    ] },
  ],
};
export default mock;
`;

/**
 * Temp project for the mock-site E2E: the package example mock
 * (`packages/mockup-loop/examples/`, never a mock root) + an
 * e2e-only mock exercising ring lint, Tailwind scan, containment and a phone
 * edge ring. Decisions written by tests land here, never in the repo.
 */
export function makeE2eProject(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-mock-site-e2e-")));
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
  const mockups = path.join(root, "mockups");
  fs.mkdirSync(mockups, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, "packages", "mockup-loop", "examples", PILLS_MOCK, "mock.tsx"), path.join(mockups, PILLS_MOCK, "mock.tsx"), { recursive: true });
  fs.mkdirSync(path.join(root, "openspec", "changes"), { recursive: true });
  const w = (rel: string, body: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };
  w("mockups/mock-site.css", `@import ${JSON.stringify(path.join(pkg("client"), "src/index.css"))};
@source ${JSON.stringify(path.join(pkg("client"), "src"))};
@source ".";
@source "../openspec/changes";
`);
  w("mockups/mock-site.app.tsx", fs.readFileSync(path.join(REPO_ROOT, "mockups", "mock-site.app.tsx"), "utf8"));
  // App build config (inherited by the mock site) + a plain options file (never a build config).
  w("vite.config.ts", `import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const pkg = (p: string) => path.join(${JSON.stringify(path.join(REPO_ROOT, "packages"))}, p);
export default {
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@blackbelt-technology/pi-dashboard-shared": pkg("shared/src"), "@blackbelt-technology/pi-dashboard-client-utils": pkg("client-utils/src"), "@blackbelt-technology/pi-dashboard-app-kit/react": pkg("app-kit/src/react/index.ts"), "@blackbelt-technology/pi-dashboard-app-kit": pkg("app-kit/src/index.ts") } },
  server: { port: 3999, hmr: { clientPort: 3999 }, proxy: { "/api": "http://127.0.0.1:9" } },
  build: { target: "es2022", outDir: "dist" }, esbuild: { target: "es2022" }, optimizeDeps: { esbuildOptions: { target: "es2022" } },
};
`);
  w("mockups/mock-site.config.ts", `import path from "node:path";
export default {
  title: "E2E mocks", app: "./mock-site.app.tsx",
  themes: [
    { id: "system", label: "System", system: { dark: "dark", light: "light" } },
    { id: "dark", label: "Dark", attrs: { "data-theme": null } },
    { id: "light", label: "Light", attrs: { "data-theme": "light" } },
  ],
  aliases: { "@app": ${JSON.stringify(path.join(pkg("client"), "src"))} },
};
`);
  w(`mockups/${SCRIPTED_MOCK}/mock.tsx`, SCRIPTED_SRC);
  w(`mockups/${SOLID_MOCK}/mock.tsx`, "export default { title: 'Solid mock', category: 'Fixture', framework: 'solid', frames: [{ title: 'x', proposed: 'solid' }] };\n");
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
      why: "${"w".repeat(121)}",
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
    {
      title: "Animated steps",
      play: true,
      steps: [{ label: "one", proposed: <Box t="scene one" /> }, { label: "two", proposed: <Box t="scene two" /> }],
    },
    {
      title: "Steps and panes",
      current: <Box t="ignored" />,
      steps: [{ label: "only", proposed: <Box t="step wins" /> }],
    },
    {
      title: "Phone steps",
      phone: true,
      steps: [{ label: "one", proposed: <Box t="phone one" /> }, { label: "two", proposed: <Box t="phone two" /> }],
    },
  ],
};
export default mock;
`);
  return root;
}
