# Comprehensive Prompting Guide for Gemini Image Generation

This guide covers the principles and techniques for crafting effective prompts for image generation with Google Gemini models.

## Table of Contents

1. [Prompt Structure](#prompt-structure)
2. [Key Components](#key-components)
3. [Style and Aesthetic](#style-and-aesthetic)
4. [Technical Specifications](#technical-specifications)
5. [Common Patterns](#common-patterns)
6. [Negative Guidance](#negative-guidance)
7. [Iterative Refinement](#iterative-refinement)
8. [References](#references)

---

## Prompt Structure

### The Layered Approach

Build prompts in layers, from most important to least:

```
[Subject] + [Action/State] + [Setting/Context] + [Style] + [Technical Details] + [Negative Constraints]
```

**Example:**
```
A golden retriever (subject) playing fetch (action) on a sunny beach (setting),
watercolor illustration style (style), soft warm lighting, wide composition (technical),
no people, no text (constraints)
```

### Prompt Length

- **Short prompts (10-20 words)**: Good for simple concepts, icons, abstract art
- **Medium prompts (30-60 words)**: Ideal for most use cases
- **Long prompts (80+ words)**: Complex scenes with specific requirements

Gemini handles long, detailed prompts well. When in doubt, be more specific.

---

## Key Components

### Subject Description

Be specific about what you want to see:

| Weak | Strong |
|------|--------|
| "a dog" | "a fluffy golden retriever puppy with floppy ears" |
| "a building" | "a sleek glass skyscraper with reflective blue windows" |
| "food" | "a steaming bowl of ramen with soft-boiled egg and green onions" |

### Action and State

Describe what the subject is doing or its current state:

- **Actions**: "running", "reading a book", "looking at camera"
- **States**: "sleeping peacefully", "covered in morning dew", "glowing softly"
- **Emotions**: "joyful expression", "contemplative mood", "energetic pose"

### Setting and Context

Provide environmental details:

- **Location**: "in a cozy coffee shop", "on a mountain peak", "in a minimalist studio"
- **Time**: "at golden hour", "on a foggy morning", "under a starry night sky"
- **Atmosphere**: "warm and inviting", "mysterious and moody", "bright and airy"

---

## Style and Aesthetic

### Artistic Styles

Reference specific styles for consistent results:

| Style | Example Prompt Addition |
|-------|------------------------|
| Photorealistic | "photorealistic, DSLR quality, 85mm lens, shallow depth of field" |
| Illustration | "digital illustration, clean lines, flat design, vector art style" |
| Watercolor | "watercolor painting, soft washes, visible brushstrokes, paper texture" |
| Oil Painting | "oil painting style, rich colors, visible brushwork, classical technique" |
| Anime/Manga | "anime style, cel shaded, vibrant colors, detailed eyes" |
| Minimalist | "minimalist design, simple shapes, limited color palette, negative space" |
| Retro | "retro 1980s aesthetic, neon colors, grid patterns, synthwave style" |
| Editorial | "editorial magazine style, sophisticated, clean, professional photography" |

### Artist and Movement References

Reference well-known styles (be aware of copyright considerations):

- "in the style of Studio Ghibli animation"
- "inspired by Art Deco design"
- "reminiscent of Dutch Golden Age paintings"
- "influenced by Bauhaus design principles"

### Color Palettes

Specify colors when important:

- **Named palettes**: "earth tones", "pastel colors", "monochromatic blue"
- **Specific colors**: "teal (#0e3b46) and orange (#c3471d) accents"
- **Mood-based**: "warm sunset colors", "cool ocean blues", "muted autumn palette"

---

## Technical Specifications

### Composition

Guide the image layout:

- **Framing**: "close-up portrait", "wide establishing shot", "medium shot"
- **Angle**: "bird's eye view", "low angle looking up", "straight-on"
- **Rule of thirds**: "subject positioned on the left third"
- **Symmetry**: "perfectly symmetrical composition", "asymmetrical balance"

### Lighting

Lighting dramatically affects mood:

| Lighting Type | Effect |
|---------------|--------|
| "Golden hour lighting" | Warm, romantic, flattering |
| "Blue hour lighting" | Cool, calm, contemplative |
| "Harsh midday sun" | High contrast, dramatic shadows |
| "Soft diffused light" | Even, flattering, commercial |
| "Dramatic chiaroscuro" | Strong contrast, moody, artistic |
| "Backlit/rim lighting" | Ethereal, silhouette potential |
| "Studio lighting" | Professional, controlled, clean |

### Aspect Ratio

Describe desired proportions:

- "square format" (1:1)
- "wide 16:9 aspect ratio" (landscape/hero images)
- "vertical portrait orientation" (9:16)
- "ultra-wide cinematic ratio" (21:9)

### Quality Indicators

Add quality boosters:

- "high resolution", "4K quality", "ultra-detailed"
- "professional quality", "award-winning"
- "sharp focus", "crisp details"

---

## Common Patterns

### The Brand Guide Pattern

For consistent branded imagery:

```
Create [image type] for [brand/company].

## Brand Guidelines
- Primary color: [hex code]
- Secondary color: [hex code]
- Style: [description]
- Do NOT include: [exclusions]

## Image Requirements
- [Specific requirements]
```

### The Scene Description Pattern

For complex scenes:

```
[Main subject] in [location], [time of day].

Foreground: [describe]
Midground: [describe]
Background: [describe]

Lighting: [describe]
Mood: [describe]
Style: [describe]
```

### The Product Shot Pattern

For commercial imagery:

```
Professional product photograph of [product] on [surface].
[Lighting description], [camera angle].
[Background description].
Commercial photography style, suitable for [use case].
```

### The Character Pattern

For consistent characters:

```
[Character description]: [physical details], [clothing], [expression].
[Pose/action].
[Setting].
[Art style], [color palette].
```

---

## Negative Guidance

### What NOT to Include

Explicitly state what to avoid:

```
NO dark backgrounds, NO neon colors, NO text overlays,
NO watermarks, NO borders, NO cartoonish style
```

### Common Exclusions by Use Case

| Use Case | Common Exclusions |
|----------|-------------------|
| Professional | "no casual, no cluttered, no low quality" |
| Children's Content | "no scary, no dark, no violent" |
| Minimalist | "no busy patterns, no gradients, no excessive detail" |
| Corporate | "no playful, no neon, no informal" |

---

## Iterative Refinement

### First Pass: Broad Strokes

Start with the essential concept:
```
A mountain landscape at sunset
```

### Second Pass: Add Specifics

Include key details:
```
A dramatic mountain landscape with snow-capped peaks reflected in a still alpine
lake at sunset, golden hour lighting, wide panoramic composition
```

### Third Pass: Style and Polish

Add style and quality indicators:
```
A dramatic mountain landscape with snow-capped peaks reflected in a still alpine
lake at sunset. Golden hour lighting casting warm orange and pink hues on the
snow. Wide panoramic composition, professional landscape photography style,
National Geographic quality. Sharp focus throughout, rich saturated colors.
No people, no man-made structures.
```

### Editing Iterations

After generating, refine with editing:

```bash
# Original generation
npx @the-focus-ai/nano-banana "mountain sunset" --output v1.png

# Edit to improve
npx @the-focus-ai/nano-banana "make the sunset colors more vibrant and dramatic" --file v1.png --output v2.png

# Further refinement
npx @the-focus-ai/nano-banana "add a subtle mist in the valley" --file v2.png --output v3.png
```

---

## References

### Google AI Documentation
- [Gemini API Image Generation](https://ai.google.dev/gemini-api/docs/image-generation) - Official documentation for Gemini image capabilities
- [Responsible AI Practices](https://ai.google.dev/responsible) - Guidelines for responsible image generation

### Prompting Resources
- [Google's Prompt Engineering Guide](https://ai.google.dev/docs/prompt_best_practices) - General prompting best practices
- [Gemini Cookbook](https://github.com/google-gemini/cookbook) - Example notebooks and prompts

### Style References
- Study photography, illustration, and art history for style vocabulary
- Collect reference images to describe desired aesthetics
- Use specific artistic terms rather than vague descriptions

### Community Examples
- Check the [examples/](examples/) directory for categorized prompt templates
- Review the [prompts/](../../prompts/) directory for real-world use cases

---

## Quick Reference Card

```
STRUCTURE:
  [Subject] + [Action] + [Setting] + [Style] + [Technical] + [Exclusions]

MUST-HAVES:
  ✓ Specific subject description
  ✓ Style reference
  ✓ What to avoid (NO ...)

QUALITY BOOSTERS:
  ✓ Lighting description
  ✓ Composition guidance
  ✓ Professional quality indicators

COMMON MISTAKES:
  ✗ Too vague ("a nice picture")
  ✗ Conflicting styles
  ✗ Missing negative guidance
  ✗ Forgetting composition/framing
```
