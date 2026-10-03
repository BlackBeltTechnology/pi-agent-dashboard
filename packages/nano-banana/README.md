# @blackbelt-technology/pi-dashboard-nano-banana

TypeScript port of the standalone `nano-banana-imagegen` pi skill — no Python.
Generate and edit images with Google's Gemini image models via the
[`@the-focus-ai/nano-banana`](https://www.npmjs.com/package/@the-focus-ai/nano-banana)
CLI, wrapped with automatic `GEMINI_API_KEY` resolution, output-path handling and
bounded-concurrency batch generation.

Exposed two ways:

- **pi skill** — `.pi/skills/nano-banana-imagegen` (auto-loads on image-gen requests).
- **CLI bin** — `pi-nano-banana`.

## Usage

```bash
pi-nano-banana "a serene mountain landscape at sunset"
pi-nano-banana "add a hot air balloon to the sky" --file photo.jpg
pi-nano-banana "a minimalist logo" --output logo.png --model gemini-2.0-flash-exp
```

`GEMINI_API_KEY` (or `GOOGLE_API_KEY`) resolves from, in order: `--api-key`, the
environment, a project-local `.env` (cwd + up to two parents), then a package-local
`.env`. Nothing is committed — `.env` is gitignored.

### pi backend (opt-in)

`--backend pi` (or `NANO_BANANA_BACKEND=pi`; programmatic `backend: "pi"`) generates
through pi's model runtime with the OpenRouter credential pi already holds —
`/login openrouter` in pi, or `OPENROUTER_API_KEY`. No `GEMINI_API_KEY` needed.

- Opt-in only: the default stays `gemini`, a missing Gemini key never falls back
  to pi, and the library never reads `NANO_BANANA_BACKEND` (only the CLI does).
- Model ids are OpenRouter image ids: bare Gemini ids get `google/` in front;
  non-Google models need the full `vendor/model` id. Default
  `google/gemini-2.5-flash-image`; `--flash` → `google/gemini-3.1-flash-lite-image`.
- The CLI prints `(pi · <model>) · ~$<cost> est.` — cost is an **estimate** from
  token usage.
- Needs `@earendil-works/pi-coding-agent >= 1.0.0` resolvable next to the package
  (optional peer).

```bash
pi-nano-banana "a red fox in the snow, watercolor" -o fox.png --backend pi
```

## Programmatic API

```ts
import { generateImage, batchGenerate } from "@blackbelt-technology/pi-dashboard-nano-banana/nano-banana.js";

await generateImage({ prompt: "a fox", output: "fox.png" });
await generateImage({ prompt: "a fox", output: "fox.png", backend: "pi" }); // → { ok, output, outputs, model, usage, backend }

await batchGenerate({
  jobs: [
    { name: "hero", prompt: "wide cinematic hero", output: "out/hero.png" },
    { name: "icon", prompt: "flat minimal icon", output: "out/icon.png" },
  ],
  concurrency: 3,
});
```

`batchGenerate` powers the storyboard step of
`@blackbelt-technology/pi-dashboard-video-production`.

## Prerequisites

- Node (runs as TypeScript via pi's jiti loader — no build step).
- Network access for `npx` to fetch the underlying nano-banana CLI.
- A Gemini API key from <https://aistudio.google.com/apikey> — or, for `--backend pi`,
  an OpenRouter credential in pi and `@earendil-works/pi-coding-agent >= 1.0.0`.
