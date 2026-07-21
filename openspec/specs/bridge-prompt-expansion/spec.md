# bridge-prompt-expansion Specification

## Purpose

Dashboard slash commands are delivered to a pi session via `pi.sendUserMessage()`, which calls `session.prompt()` with `expandPromptTemplates: false`. That flag skips pi's built-in prompt-template and skill expansion, so a raw `/command` string would reach the LLM unexpanded. This capability restores expansion in the bridge by resolving a slash command to its prompt-template or skill file on disk, reading and classifying that file, and either producing LLM-bound text or an executable (bash) payload — while passing through any input that does not resolve to a template.

## Requirements

### Requirement: Slash-Command Detection and Argument Split

The bridge SHALL only attempt template expansion on inputs beginning with `/`, and SHALL split the command name from its arguments on the first whitespace (space OR newline).

#### Scenario: Non-slash input is not a template

- **WHEN** the input does not start with `/`
- **THEN** the bridge SHALL return no template match (null), leaving the input untouched

#### Scenario: Command name split from arguments

- **WHEN** a slash command carries trailing text after the command name
- **THEN** the bridge SHALL take the first whitespace-delimited token (after the leading `/`) as the template name
- **AND** SHALL take the remainder as the argument string

#### Scenario: Multi-line argument payload

- **WHEN** a slash command is followed by a newline and multi-line argument text (e.g. `/skill:foo\nargs`)
- **THEN** the bridge SHALL split on the first whitespace including the newline, so the template name excludes the argument text

### Requirement: Template and Skill File Resolution

The bridge SHALL resolve a slash-command name to a file on disk by consulting local `.pi/prompts` and `.pi/skills` directories under the session cwd, skill-bundled `commands/*.md` files, and the `pi.getCommands()` registry, honoring `:` ↔ `-` alias variants with the typed form taking precedence.

#### Scenario: Flat prompt template resolves by basename

- **WHEN** a file `<cwd>/.pi/prompts/<name>.md` exists
- **THEN** the bridge SHALL resolve the command to that file as a `prompt` source keyed by its basename

#### Scenario: Skill SKILL.md resolves by skill key

- **WHEN** a directory `<cwd>/.pi/skills/<skill>/SKILL.md` exists
- **THEN** the bridge SHALL resolve `/<skill>` (or `/skill:<skill>`) to that `SKILL.md` as a `skill` source

#### Scenario: Skill-bundled command resolves by basename

- **WHEN** a file `<cwd>/.pi/skills/<skill>/commands/<name>.md` exists
- **THEN** the bridge SHALL scan that `commands/` directory one level deep and resolve `/<name>` to the file, because `pi.getCommands()` does not reliably surface nested skill command files across pi versions
- **AND** SHALL NOT overwrite a top-level prompt/skill template of the same name

#### Scenario: Registry fallback when cwd scan misses

- **WHEN** the local cwd scan does not contain the command but `pi.getCommands()` lists a skill or prompt template whose path exists on disk
- **THEN** the bridge SHALL resolve the command using that registry entry's `sourceInfo.path` (or legacy top-level `path`)
- **AND** SHALL additionally harvest each registry skill's sibling `commands/*.md` so bundled commands resolve when the session cwd is not the extension install directory

#### Scenario: Colon/hyphen alias resolution with typed-form precedence

- **WHEN** a command name contains `:` or `-` and does not match directly
- **THEN** the bridge SHALL try the alternate-punctuation variant (`:`↔`-`)
- **AND** SHALL consult every store on the originally typed form before consulting any remapped variant on any store

### Requirement: Template Reading and Frontmatter Parsing

The bridge SHALL read a resolved file, split optional YAML-lite frontmatter from the body, and interpret only the recognized keys, degrading gracefully on malformed or missing frontmatter.

#### Scenario: Frontmatter separated from body

- **WHEN** a file begins with a `---\n...\n---\n` frontmatter block
- **THEN** the bridge SHALL parse the block into typed frontmatter and return the remaining trimmed content as the body

#### Scenario: Missing frontmatter falls back to whole body

- **WHEN** a file has no closing/opening frontmatter delimiter
- **THEN** the bridge SHALL treat the entire trimmed content as the body with empty frontmatter

#### Scenario: Unknown frontmatter keys ignored

- **WHEN** frontmatter contains keys other than `executable`, `excludeFromContext`, or `description`
- **THEN** the bridge SHALL ignore the unknown keys and SHALL skip malformed lines without a colon rather than failing

### Requirement: Classification into LLM vs Executable Mode

The bridge SHALL classify a resolved template into a discriminated union via `loadPromptTemplate`: templates whose frontmatter declares `executable: bash` resolve to `kind: "exec"`; every other template (including unsupported `executable:` values) resolves to `kind: "llm"`. `loadPromptTemplate` returns `null` when no template matches.

#### Scenario: Executable bash template classified as exec, skipping the LLM

- **WHEN** a resolved template carries frontmatter `executable: bash`
- **THEN** `loadPromptTemplate` SHALL return `{ kind: "exec", body, excludeFromContext, argsString }` carrying the raw template body, and the body SHALL be run as bash while the LLM is skipped

#### Scenario: Unsupported executable value degrades to LLM mode

- **WHEN** a resolved template declares an `executable:` value other than `bash` (e.g. `node`, `python`)
- **THEN** the frontmatter parser SHALL drop the value, so the template is NOT classified as exec
- **AND** `loadPromptTemplate` SHALL return `kind: "llm"` and route the expanded text through the LLM

#### Scenario: Exec mode excludeFromContext defaults to true

- **WHEN** a template is classified as exec and its frontmatter omits `excludeFromContext`
- **THEN** the bridge SHALL default `excludeFromContext` to `true` (mirroring `!!`-style context exclusion)
- **AND** an author MAY opt back in with `excludeFromContext: false` to capture the output for follow-up reasoning

### Requirement: Expansion Into LLM-Bound Text

For LLM-classified templates the bridge SHALL assemble the expanded text differently for skill versus prompt sources, wrapping skills in a skill block and appending arguments to plain prompts.

#### Scenario: Skill template wrapped in skill block

- **WHEN** a resolved LLM source is a skill
- **THEN** the bridge SHALL build a skill block from the bare skill name, file path, base directory, body, and any user arguments

#### Scenario: Plain prompt appends arguments

- **WHEN** a resolved LLM source is a plain prompt template and arguments are present
- **THEN** the bridge SHALL append the argument string after a blank line following the body

#### Scenario: Plain prompt without arguments returns body

- **WHEN** a resolved LLM source is a plain prompt template with no arguments
- **THEN** the bridge SHALL return the body unchanged

### Requirement: String Wrapper and Exec-Body Security Passthrough

The bridge SHALL expose a string-returning wrapper `expandPromptTemplateFromDisk` around `loadPromptTemplate` for the backward-compatible passthrough path. The wrapper SHALL return LLM text for `kind: "llm"`, and SHALL return the ORIGINAL input text — never the raw bash body — when an exec template reaches it, so exec bodies never hit the LLM.

#### Scenario: Two-function surface distinguished

- **WHEN** a caller needs to classify and route a slash command
- **THEN** the caller SHALL use `loadPromptTemplate`, the classifier returning the `{ kind: "llm" } | { kind: "exec" }` discriminated union (or `null`)
- **AND** the string wrapper `expandPromptTemplateFromDisk` SHALL be used only for the passthrough path that always yields a string

#### Scenario: LLM template through the wrapper returns expanded text

- **WHEN** a slash command resolves to an LLM-classified template
- **THEN** `expandPromptTemplateFromDisk` SHALL return the expanded LLM-bound text

#### Scenario: Exec template through the wrapper returns original text, not the bash body

- **WHEN** an `executable: bash` template slips through to `expandPromptTemplateFromDisk` (e.g. the multi-line / image-bearing passthrough path)
- **THEN** the wrapper SHALL return the ORIGINAL input text unchanged and SHALL NOT return the raw bash body, so the executable body never reaches the LLM

### Requirement: Passthrough for Unresolved Input

The bridge SHALL return the original input unchanged when a slash command does not resolve to any template, so unknown commands and non-template text reach the caller intact.

#### Scenario: Unknown slash command passes through

- **WHEN** a slash command does not match any local, bundled, or registry template
- **THEN** the disk-expansion wrapper SHALL return the original input text unchanged

#### Scenario: Read failure passes through

- **WHEN** a template resolves but reading/expanding it throws
- **THEN** `loadPromptTemplate` SHALL return no expansion (null), and the wrapper SHALL yield the original input text

#### Scenario: Non-template text passes through

- **WHEN** the input is not a slash command
- **THEN** the wrapper SHALL return the input text unchanged
