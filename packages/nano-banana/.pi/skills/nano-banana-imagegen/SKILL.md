---
name: nano-banana-imagegen
description: Generate and edit images using Google Gemini image models via the nano-banana CLI. Use when the user asks to create, generate, make, or edit images with AI. Supports text-to-image, image editing, style transfer, and multi-image composition. Trigger on requests like "create an image", "generate a picture", "make me a logo", "edit this photo", "add X to this image".
---

# Nano Banana Image Generation

Generate and edit images using Google's Gemini image models. This skill ships the
`pi-nano-banana` CLI (a TypeScript wrapper — no Python) that resolves the
`GEMINI_API_KEY` for you and delegates to `@the-focus-ai/nano-banana`.

## Prerequisites

- `GEMINI_API_KEY` set via the environment or a gitignored `.env` in the project
  or package directory (the CLI resolves it automatically).
- Network access — the underlying `@the-focus-ai/nano-banana` CLI is fetched via `npx`.

## Quick Reference

Prefer the bundled `pi-nano-banana` bin (auto key resolution, output-dir creation):

```bash
# Generate a new image
pi-nano-banana "a serene mountain landscape at sunset"

# Edit an existing image
pi-nano-banana "add a hot air balloon to the sky" --file photo.jpg

# Specify output path
pi-nano-banana "a minimalist logo" --output logo.png

# Use a specific model / faster flash model
pi-nano-banana "detailed illustration" --model gemini-2.0-flash-exp
pi-nano-banana "a quick sketch" --flash
```

The raw CLI still works if you prefer it (`npx @the-focus-ai/nano-banana "…"`).
For batch generation from code, import `batchGenerate` from
`@blackbelt-technology/pi-dashboard-nano-banana/nano-banana.js`.

## Workflow

### Step 1: Understand the Request

Before generating, clarify:
- **Subject**: What should be in the image?
- **Style**: Photorealistic, illustration, cartoon, abstract?
- **Mood**: Bright, dark, moody, cheerful?
- **Composition**: Close-up, wide shot, specific aspect ratio?
- **Use case**: Hero image, icon, social media, print?

### Step 2: Craft an Effective Prompt

Read [references/prompting-guide.md](references/prompting-guide.md) for comprehensive guidance.

**Key principles:**
1. Be specific and descriptive
2. Include style references
3. Specify what you DON'T want
4. Describe composition and framing

**Example — Weak prompt:**
```
"a cat"
```

**Example — Strong prompt:**
```
"A fluffy orange tabby cat curled up on a velvet armchair, soft afternoon sunlight streaming through a window, warm cozy interior, photorealistic style, shallow depth of field"
```

### Step 3: Generate the Image

```bash
npx @the-focus-ai/nano-banana "your detailed prompt here"
```

Default output: `output/generated-<timestamp>.png`

### Step 4: Iterate

If the result isn't right:
1. **Refine the prompt** — Add more detail or constraints
2. **Edit the image** — Use `--file` to modify the generated image
3. **Try a different model** — Some models handle certain styles better

## Commands

### Text-to-Image Generation

```bash
npx @the-focus-ai/nano-banana "<prompt>"
```

### Image Editing

```bash
npx @the-focus-ai/nano-banana "<edit instruction>" --file <input-image>
```

Edit instructions should describe the change:
- "Remove the background and replace with a gradient"
- "Add sunglasses to the person"
- "Change the sky to sunset colors"
- "Make it look like a watercolor painting"

### Options

| Option | Description |
|--------|-------------|
| `--file <image>` | Input image for editing |
| `--output <path>` | Custom output path |
| `--model <name>` | Specific Gemini model |
| `--flash` | Use gemini-2.0-flash (faster, simpler images) |
| `--prompt-file <path>` | Read prompt from file |
| `--list-models` | Show available models |
| `--api-key <key>` | Explicit Gemini key |
| `--backend gemini\|pi` | Backend (default `gemini`; `pi` is opt-in, see below) |

### pi backend (opt-in, OpenRouter)

`--backend pi` (or `NANO_BANANA_BACKEND=pi`) generates through pi's own model
runtime instead of the Gemini CLI — no `GEMINI_API_KEY` needed.

- **Credential:** sign in to OpenRouter in pi (`/login openrouter`) or set `OPENROUTER_API_KEY`.
- **Requires** `@earendil-works/pi-coding-agent >= 1.0.0` resolvable next to this package.
- **Opt-in only:** a missing Gemini key never falls back to pi; library callers
  (e.g. the video-production storyboard) stay on Gemini unless they pass `backend: "pi"`.
- **Models** are OpenRouter image ids. Bare Gemini ids get `google/` in front
  (`--model gemini-3-pro-image` → `google/gemini-3-pro-image`); non-Google models
  need the full `vendor/model` id (`black-forest-labs/flux.2-pro`). Default
  `google/gemini-2.5-flash-image`; `--flash` maps to `google/gemini-3.1-flash-lite-image`.
  `gemini-2.0-flash-exp` does not exist there — an unknown id lists the known ones.
- **Cost:** the success line prints `(pi · <model>) · ~$<cost> est.` — an estimate
  computed from token usage, not the billed amount.

```bash
pi-nano-banana "a red fox in the snow, watercolor" -o fox.png --backend pi
pi-nano-banana "make it night" --file fox.png -o fox-night.png --backend pi
```

## Best Practices

### For Better Results

1. **Start with composition**: Describe the layout first, then details
2. **Use artistic references**: "in the style of Studio Ghibli", "like a National Geographic photo"
3. **Specify lighting**: "golden hour lighting", "dramatic chiaroscuro", "soft diffused light"
4. **Include negative guidance**: Describe what to avoid in the prompt itself
5. **Consider aspect ratio**: The model generates square by default; describe wide/tall if needed

### For Editing

1. **Be specific about changes**: "Add a blue butterfly to the top-left corner"
2. **Preserve what works**: "Keep the background unchanged, only modify the foreground"
3. **Iterative refinement**: Make one change at a time for better control

## Environment Setup

Ensure `GEMINI_API_KEY` is set:

```bash
export GEMINI_API_KEY="your-api-key-here"
```

Or create a `.env` file in your project:

```
GEMINI_API_KEY=your-api-key-here
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No image in response" | Prompt may have triggered safety filters — rephrase |
| Poor quality results | Add more specific style guidance, use `gemini-2.0-flash-exp` |
| `--backend pi`: "Provider is not configured" | Run `/login openrouter` in pi or set `OPENROUTER_API_KEY` |
| `--backend pi`: "needs @earendil-works/pi-coding-agent >= 1.0.0" | Install/update pi next to the package |
| Image doesn't match description | Be more explicit about composition, add negative constraints |
