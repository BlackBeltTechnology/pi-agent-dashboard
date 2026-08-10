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

## Programmatic API

```ts
import { generateImage, batchGenerate } from "@blackbelt-technology/pi-dashboard-nano-banana/nano-banana.js";

await generateImage({ prompt: "a fox", output: "fox.png" });

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
- A Gemini API key from <https://aistudio.google.com/apikey>.
