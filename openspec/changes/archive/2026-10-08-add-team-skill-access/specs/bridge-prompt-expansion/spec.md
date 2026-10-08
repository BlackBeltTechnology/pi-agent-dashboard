## MODIFIED Requirements

### Requirement: Template and Skill File Resolution

The bridge SHALL resolve a slash-command name to a file on disk by consulting local `.pi/prompts` and `.pi/skills` directories under the session cwd, skill-bundled `commands/*.md` files, and the `pi.getCommands()` registry, honoring `:` ↔ `-` alias variants with the typed form taking precedence. In a team-confined session the bridge SHALL NOT perform this resolution: it SHALL expand only `/skill:<name>` for a name in the session's effective skill set, from `<root>/SKILL.md`, and SHALL pass every other slash text through unexpanded or refuse it as the team rules require.

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

#### Scenario: Team session never resolves from disk or registry
- **WHEN** a team-confined session receives `/deploy\nnow` and `<cwd>/.pi/prompts/deploy.md` exists
- **THEN** the bridge SHALL NOT read that file and SHALL send the text unexpanded

#### Scenario: Team session expands an effective skill with the standard envelope
- **WHEN** a team-confined session whose effective skills include `review` receives `/skill:review check it`
- **THEN** the bridge SHALL send `buildSkillBlock({name:"review", filePath:<root>/SKILL.md, baseDir:<root>, body, userArgs:"check it"})`, which is byte-identical to the non-team expansion of the same file

