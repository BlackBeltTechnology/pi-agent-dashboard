# file-extension-icon-lookup Specification

## Purpose

Map a file path or filename to an icon descriptor (an `@mdi/js` glyph path plus an accent color class) so file-tree rows, tabs, and diff rows render each file kind distinctly. The lookup is keyed by lowercased file extension, finer-grained than a coarse file-kind classification, and falls back to a generic file glyph for unknown or extension-less names.

## Requirements

### Requirement: Extension extraction from a path or filename

The system SHALL derive a lowercased extension token (including its leading dot) from a file path or bare filename, ignoring any directory portion, and SHALL treat names with no usable extension as having an empty extension.

#### Scenario: Path with directory segments

- WHEN the input is `src/lib/file-icon.ts`
- THEN the directory portion is stripped
- AND the extracted extension is `.ts`

#### Scenario: Backslash directory separators

- WHEN the input path uses backslashes such as `src\lib\util.js`
- THEN the segment after the last backslash is used as the base name
- AND the extracted extension is `.js`

#### Scenario: Uppercase extension normalized to lowercase

- WHEN the input is `README.MD`
- THEN the extracted extension is lowercased
- AND the result is `.md`

#### Scenario: Filename with no dot

- WHEN the input is `Dockerfile`
- THEN no extension can be extracted
- AND the extracted extension is the empty string

#### Scenario: Dotfile with a leading dot only

- WHEN the input is `.gitignore`
- THEN the leading dot at position zero is not treated as an extension separator
- AND the extracted extension is the empty string

### Requirement: Extension-to-icon mapping across file families

The system SHALL map known extensions to a language- or media-appropriate glyph and accent color, grouping related extensions to a shared descriptor across code, data/config, image, video, audio, document, and diagram families.

#### Scenario: TypeScript family

- WHEN the extension is `.ts`, `.tsx`, `.mts`, or `.cts`
- THEN the icon is the TypeScript glyph
- AND the color class is `text-[var(--accent-blue)]`

#### Scenario: JavaScript family

- WHEN the extension is `.js`, `.jsx`, `.mjs`, or `.cjs`
- THEN the icon is the JavaScript glyph
- AND the color class is `text-[var(--accent-yellow)]`

#### Scenario: JSON data files

- WHEN the extension is `.json` or `.jsonc`
- THEN the icon is the JSON code glyph
- AND the color class is `text-[var(--accent-orange)]`

#### Scenario: Other language sources

- WHEN the extension is `.py`, `.go`, `.rs`, `.css`/`.scss`/`.less`, `.html`/`.htm`, or `.md`/`.mdx`/`.markdown`
- THEN the icon is the matching language glyph (Python, Go, Rust, CSS3, HTML5, or Markdown respectively)
- AND the color class is the accent assigned to that language

#### Scenario: Image files

- WHEN the extension is `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`, `.bmp`, or `.avif`
- THEN the icon is the image-file glyph
- AND the color class is `text-[var(--accent-green)]`

#### Scenario: Video files

- WHEN the extension is `.mp4`, `.webm`, or `.mov`
- THEN the icon is the video-file glyph
- AND the color class is `text-[var(--accent-purple)]`

#### Scenario: Audio files

- WHEN the extension is `.mp3`, `.wav`, `.ogg`, `.m4a`, or `.flac`
- THEN the icon is the music-file glyph
- AND the color class is `text-[var(--accent-purple)]`

#### Scenario: Diagram files

- WHEN the extension is `.mmd` or `.mermaid`
- THEN the icon is the graph glyph
- AND the color class is `text-[var(--accent-green)]`

#### Scenario: Shell scripts

- WHEN the extension is `.sh`, `.bash`, or `.zsh`
- THEN the icon is the code-file glyph
- AND the color class is `text-[var(--accent-green)]`

#### Scenario: PDF documents

- WHEN the extension is `.pdf`
- THEN the icon is the PDF glyph
- AND the color class is `text-[var(--accent-red)]`

### Requirement: Neutral-tone config and plain-text mappings

The system SHALL map configuration and plain-text extensions to a suitable glyph while assigning the default (empty) color tone rather than an accent color.

#### Scenario: Config formats

- WHEN the extension is `.yaml`, `.yml`, `.toml`, `.ini`
- THEN the icon is the cog glyph
- AND the color class is the empty string (default tone)

#### Scenario: Plain-text and tabular files

- WHEN the extension is `.txt`, `.csv`, or `.log`
- THEN the icon is the document glyph
- AND the color class is the empty string (default tone)

### Requirement: Unknown-extension fallback

The system SHALL return a generic file descriptor for any extension not present in the mapping and for names that yield an empty extension.

#### Scenario: Unmapped extension

- WHEN the extension is not one of the known keys, such as `.xyz`
- THEN the icon is the generic file-outline glyph
- AND the color class is the empty string (default tone)

#### Scenario: Extension-less name falls back

- WHEN the input yields an empty extension, such as `Dockerfile` or `.gitignore`
- THEN the lookup does not match any mapped extension
- AND the generic file-outline descriptor with the empty color class is returned
