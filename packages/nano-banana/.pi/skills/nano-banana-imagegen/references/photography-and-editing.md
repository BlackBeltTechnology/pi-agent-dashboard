# Photography-Style and Editing Prompts

## Photorealistic Generation

### Product Photography
```
Professional product photograph of a sleek wireless headphone on a
clean white surface. Soft studio lighting from the left, subtle shadow,
sharp focus on the product. Commercial photography style, 4K quality,
neutral background.
```

### Food Photography
```
Appetizing food photograph of a rustic sourdough bread loaf on a wooden
cutting board. Warm natural lighting, shallow depth of field, artisanal
kitchen background slightly blurred. Food magazine quality, inviting,
makes you want to taste it.
```

### Portrait Style
```
Professional headshot style portrait. Soft, flattering lighting, neutral
background, confident and approachable expression. Business casual
attire, sharp focus on the face, slight bokeh in background.
```

### Landscape
```
Stunning landscape photograph of mountain peaks reflected in a calm
alpine lake at golden hour. Dramatic lighting, rich colors, professional
nature photography quality. Wide angle composition, sharp throughout.
```

### Architecture
```
Architectural photograph of a modern glass building facade. Clean lines,
interesting reflections, dramatic perspective looking upward. Blue hour
lighting, sharp details, professional real estate photography style.
```

## Image Editing Prompts

### Background Changes

```bash
# Remove and replace background
npx @the-focus-ai/nano-banana "Remove the background and replace with a clean gradient from light blue to white" --file portrait.jpg

# Add environmental context
npx @the-focus-ai/nano-banana "Replace the plain background with a professional office setting, keeping the person unchanged" --file headshot.jpg
```

### Style Transfer

```bash
# Convert to illustration
npx @the-focus-ai/nano-banana "Transform this photograph into a watercolor painting style, preserving the composition and subjects" --file photo.jpg

# Add vintage effect
npx @the-focus-ai/nano-banana "Apply a vintage 1970s film photography look with warm tones and slight grain" --file modern-photo.jpg
```

### Object Manipulation

```bash
# Add elements
npx @the-focus-ai/nano-banana "Add a hot air balloon floating in the sky in the upper right corner" --file landscape.jpg

# Remove elements
npx @the-focus-ai/nano-banana "Remove the person in the background, fill naturally with the surrounding environment" --file street-photo.jpg

# Modify elements
npx @the-focus-ai/nano-banana "Change the car color from red to deep blue, keep everything else the same" --file car-photo.jpg
```

### Enhancement

```bash
# Lighting adjustment
npx @the-focus-ai/nano-banana "Enhance the lighting to create a warm golden hour effect, add subtle lens flare" --file outdoor-photo.jpg

# Color grading
npx @the-focus-ai/nano-banana "Apply cinematic color grading with teal shadows and orange highlights" --file video-still.jpg
```

### Compositing

```bash
# Combine elements
npx @the-focus-ai/nano-banana "Add realistic falling snow to this winter scene, varying sizes and depths" --file winter-street.jpg

# Add text/graphics
npx @the-focus-ai/nano-banana "Add a subtle watermark with the text 'Sample' diagonally across the image" --file product.jpg
```

## Scene Generation

### Interior Design
```
Photorealistic interior design visualization of a modern living room.
Scandinavian style with natural wood, white walls, and green plants.
Large windows with natural light, cozy textiles, minimalist furniture.
Architectural photography quality.
```

### Outdoor Scenes
```
Photorealistic image of a cozy café terrace on a European cobblestone
street. Morning light, empty chairs and tables, potted plants, vintage
signage. Inviting atmosphere, travel photography style.
```
