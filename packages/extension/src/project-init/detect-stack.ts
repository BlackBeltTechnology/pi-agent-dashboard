/**
 * Technology-stack detection for the `coding` profile.
 *
 * A coding repo is not always Node/npm — it may be Cargo, Go, Python, Maven,
 * Gradle, etc. The scaffold detects a best-guess stack from the target
 * directory's marker files, the skill asks the user to confirm or override,
 * and the chosen stack fills the `coding` templates:
 *   settings.json.tmpl  → {{INIT_GATE}}, {{INIT_COMMAND}}   (worktreeInit hook)
 *   AGENTS.md.tmpl      → {{INSTALL_CMD}}, {{TEST_CMD}}, {{BUILD_CMD}}
 *
 * Detection is best-effort. A bare directory yields `null` (the skill then
 * asks the user which stack to use).
 *
 * See change: project-init-skill-and-profiles.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface Stack {
  /** Stable stack id (e.g. "npm", "cargo", "go"). */
  id: string;
  /** Human-readable label for the confirm prompt. */
  label: string;
  /** Install/restore command (AGENTS.md `{{INSTALL_CMD}}`). */
  install: string;
  /** Test command (AGENTS.md `{{TEST_CMD}}`). */
  test: string;
  /** Build command (AGENTS.md `{{BUILD_CMD}}`). */
  build: string;
  /** worktreeInit gate: exits 0 when init is needed (`{{INIT_GATE}}`). */
  initGate: string;
  /** worktreeInit run command (`{{INIT_COMMAND}}`). */
  initCommand: string;
}

/** All known stacks, keyed by id. Values are sensible defaults; users override. */
export const STACKS: Record<string, Stack> = {
  npm: {
    id: "npm", label: "Node — npm",
    install: "npm ci", test: "npm test", build: "npm run build",
    initGate: "test ! -d node_modules", initCommand: "npm ci",
  },
  pnpm: {
    id: "pnpm", label: "Node — pnpm",
    install: "pnpm install --frozen-lockfile", test: "pnpm test", build: "pnpm build",
    initGate: "test ! -d node_modules", initCommand: "pnpm install --frozen-lockfile",
  },
  yarn: {
    id: "yarn", label: "Node — yarn",
    install: "yarn install --frozen-lockfile", test: "yarn test", build: "yarn build",
    initGate: "test ! -d node_modules", initCommand: "yarn install --frozen-lockfile",
  },
  bun: {
    id: "bun", label: "Bun",
    install: "bun install", test: "bun test", build: "bun run build",
    initGate: "test ! -d node_modules", initCommand: "bun install",
  },
  cargo: {
    id: "cargo", label: "Rust — Cargo",
    install: "cargo fetch", test: "cargo test", build: "cargo build",
    initGate: "test ! -d target", initCommand: "cargo fetch",
  },
  go: {
    id: "go", label: "Go modules",
    install: "go mod download", test: "go test ./...", build: "go build ./...",
    initGate: "test ! -f go.sum", initCommand: "go mod download",
  },
  poetry: {
    id: "poetry", label: "Python — Poetry",
    install: "poetry install", test: "poetry run pytest", build: "poetry build",
    initGate: "test ! -d .venv", initCommand: "poetry install",
  },
  pip: {
    id: "pip", label: "Python — pip/venv",
    install: "python -m venv .venv && .venv/bin/pip install -r requirements.txt",
    test: ".venv/bin/pytest", build: "python -m build",
    initGate: "test ! -d .venv",
    initCommand: "python -m venv .venv && .venv/bin/pip install -r requirements.txt",
  },
  maven: {
    id: "maven", label: "Java — Maven",
    install: "mvn -q dependency:go-offline", test: "mvn test", build: "mvn -q package -DskipTests",
    initGate: "test ! -d target", initCommand: "mvn -q dependency:go-offline",
  },
  gradle: {
    id: "gradle", label: "Java — Gradle",
    install: "./gradlew dependencies", test: "./gradlew test", build: "./gradlew build -x test",
    initGate: "test ! -d .gradle", initCommand: "./gradlew dependencies",
  },
};

/**
 * Ordered marker-file → stack rules. JS package managers are checked before
 * the plain `package.json` fallback so a lockfile wins; language ecosystems
 * follow. First match wins.
 */
const RULES: Array<{ id: string; has: (files: Set<string>) => boolean }> = [
  { id: "pnpm", has: (f) => f.has("pnpm-lock.yaml") },
  { id: "yarn", has: (f) => f.has("yarn.lock") },
  { id: "bun", has: (f) => f.has("bun.lockb") || f.has("bun.lock") },
  { id: "npm", has: (f) => f.has("package-lock.json") || f.has("package.json") },
  { id: "cargo", has: (f) => f.has("Cargo.toml") },
  { id: "go", has: (f) => f.has("go.mod") },
  { id: "poetry", has: (f) => f.has("poetry.lock") },
  { id: "pip", has: (f) => f.has("requirements.txt") || f.has("pyproject.toml") },
  { id: "maven", has: (f) => f.has("pom.xml") },
  { id: "gradle", has: (f) => f.has("build.gradle") || f.has("build.gradle.kts") },
];

/**
 * Detect the best-guess stack from the marker files in `dir`, or `null` when
 * the directory is bare / has no recognized markers.
 */
export function detectStack(dir: string): Stack | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const files = new Set(entries);
  // `pyproject.toml` with a `[tool.poetry]` table means Poetry, not plain pip.
  if (files.has("pyproject.toml") && !files.has("poetry.lock")) {
    try {
      const raw = fs.readFileSync(path.join(dir, "pyproject.toml"), "utf8");
      if (/\[tool\.poetry\]/.test(raw)) return STACKS.poetry!;
    } catch {
      /* fall through to ordered rules */
    }
  }
  for (const rule of RULES) {
    if (rule.has(files)) return STACKS[rule.id]!;
  }
  return null;
}

/** Map a stack to the template-substitution values it fills. */
export function stackSubstitutions(stack: Stack): Record<string, string> {
  return {
    INSTALL_CMD: stack.install,
    TEST_CMD: stack.test,
    BUILD_CMD: stack.build,
    INIT_GATE: stack.initGate,
    INIT_COMMAND: stack.initCommand,
  };
}
