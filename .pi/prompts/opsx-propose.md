---
description: Propose a new change - create it and generate all artifacts in one step
---

Propose a new change - create the change and generate all artifacts in one step.

I'll create a change with artifacts:
- proposal.md (what & why)
- design.md (how)
- tasks.md (implementation steps)

When ready to implement, run /opsx-apply

---

**Input**: The argument after `/opsx-propose` is the change name (kebab-case), OR a description of what the user wants to build.
**Provided arguments**: $@

**Steps**

1. **If no input provided, ask what they want to build**

   Use the **AskUserQuestion tool** (open-ended, no preset options) to ask:
   > "What change do you want to work on? Describe what you want to build or fix."

   From their description, derive a kebab-case name (e.g., "add user authentication" → `add-user-auth`).

   **IMPORTANT**: Do NOT proceed without understanding what the user wants to build.

2. **Create the change directory**
   ```bash
   openspec new change "<name>"
   ```
   This creates a scaffolded change at `openspec/changes/<name>/` with `.openspec.yaml`.

3. **Get the artifact build order**
   ```bash
   openspec status --change "<name>" --json
   ```
   Parse the JSON to get:
   - `applyRequires`: array of artifact IDs needed before implementation (e.g., `["tasks"]`)
   - `artifacts`: list of all artifacts with their status and dependencies

4. **Create artifacts in sequence until apply-ready**

   Use the **TodoWrite tool** to track progress through the artifacts.

   Loop through artifacts in dependency order (artifacts with no pending dependencies first):

   a. **For each artifact that is `ready` (dependencies satisfied)**:
      - Get instructions:
        ```bash
        openspec instructions <artifact-id> --change "<name>" --json
        ```
      - The instructions JSON includes:
        - `context`: Project background (constraints for you - do NOT include in output)
        - `rules`: Artifact-specific rules (constraints for you - do NOT include in output)
        - `template`: The structure to use for your output file
        - `instruction`: Schema-specific guidance for this artifact type
        - `outputPath`: Where to write the artifact
        - `dependencies`: Completed artifacts to read for context
      - Read any completed dependency files for context
      - Create the artifact file using `template` as the structure
      - Apply `context` and `rules` as constraints - but do NOT copy them into the file
      - **For proposal artifact**: If this is a UI/UX change, ADD a `## User Stories` section after `## What Changes`. Each story MUST follow the format: `- **As a <role>**, I want <goal>, so that <reason>.` Stories MUST cover: desktop users, mobile users, and each visual state (active, idle, ended, error, empty). Minimum 3 stories for UI changes.
      - Show brief progress: "Created <artifact-id>"

   b. **Continue until all `applyRequires` artifacts are complete**
      - After creating each artifact, re-run `openspec status --change "<name>" --json`
      - Check if every artifact ID in `applyRequires` has `status: "done"` in the artifacts array
      - Stop when all `applyRequires` artifacts are done

   c. **If an artifact requires user input** (unclear context):
      - Use **AskUserQuestion tool** to clarify
      - Then continue with creation

5. **Design Phase (after specs, before tasks) — Docker-gated**

   After specs are `done` and before creating `tasks`, check if this is a UI change. If YES, check Docker availability:

   ```bash
   docker info > /dev/null 2>&1 && echo "DOCKER_AVAILABLE" || echo "NO_DOCKER"
   ```

   a. **If Docker is NOT available:**
      - Emit: "Design sandbox unavailable (Docker not found). Proceeding with text-only proposal."
      - Skip to step 6 (tasks).

   b. **If Docker IS available:**
      1. **Start sandbox with rich data:**
         ```bash
         docker compose -f sandbox/docker-compose.yml up -d --wait 2>&1
         ```
         Wait for bootstrap, then seed sessions:
         ```bash
         node sandbox/seed-bridge.mjs &
         sleep 15
         ```
         If sandbox fails, emit warning, `docker compose down`, skip to step 6.

      2. **Capture screenshots** via scenario runner:
         ```bash
         bash sandbox/scripts/run-scenarios.sh <change-dir>/screenshots/scenario.json <change-dir>/screenshots/
         ```
         This executes all browser steps (open, click, scroll, screenshot)
         and saves PNGs to the screenshots directory.

      3. **Derive visual states** from specs requirements and proposal user stories.
         List every `<!-- state: <name> -->` that the mockup must include.
         Minimum: desktop + mobile variants, all statuses (streaming/idle/ended/error),
         all interactive elements mentioned in specs.

      4. **Write scenario.json** — browser steps to capture each state:
         Write `<change-dir>/screenshots/scenario.json` as a JSON array:
         ```json
         [
           {"open": "http://localhost:8000"},
           {"wait": 2000},
           {"screenshot": "desktop-overview"},
           {"click": ".session-card:first-child", "screenshot": "selected-card"},
           {"press": "Escape"},
           {"set viewport": "375 3000", "screenshot": "mobile-overview"}
         ]
         ```
         Execute each step in order via browser tool. Save screenshots to
         `<change-dir>/screenshots/<name>.png`.

      5. **Invoke sandbox-designer subagent:**
         ```
         subagent({
           agent: "sandbox-designer",
           reads: [
             "<change-dir>/screenshots/",
             "<change-dir>/proposal.md",
             "<change-dir>/specs/"
           ],
           task: "Generate mockup.html with these states: <state list from step 3>.\nScreenshots show current UI. Proposal + specs define requirements."
         })
         ```
         **Validate the designer's first message** — it MUST describe what it sees in the screenshots. If the description is wrong or generic, screenshots didn't load. Retry or fix paths.

      6. **Validate mockup.html:**
         - Check ALL `<!-- state: -->` blocks from the task are present
         - Verify no raw Tailwind colors (grep for `bg-gray-`, `text-white`, etc.)
         - If validation fails → intercom to designer asking for fixes, wait, re-check

      7. **Update design.md** with `## Visual Design` section linking to `mockup.html`.

      8. **Teardown sandbox:**
         ```bash
         docker compose -f sandbox/docker-compose.yml down
         ```
         Teardown failure emits a warning but does NOT block.

      9. **Read back visual artifacts** so user can review:
         ```
         read <change-dir>/screenshots/before-desktop.png
         read <change-dir>/screenshots/before-mobile.png
         read <change-dir>/mockup.html
         ```

6. **Create tasks artifact**

7. **Show final status**
   ```bash
   openspec status --change "<name>"
   ```

**Output**

After completing all artifacts, summarize:
- Change name and location
- List of artifacts created with brief descriptions
- What's ready: "All artifacts created! Ready for implementation."
- Prompt: "Run `/opsx-apply` to start implementing."

**Artifact Creation Guidelines**

- Follow the `instruction` field from `openspec instructions` for each artifact type
- The schema defines what each artifact should contain - follow it
- Read dependency artifacts for context before creating new ones
- Use `template` as the structure for your output file - fill in its sections
- **IMPORTANT**: `context` and `rules` are constraints for YOU, not content for the file
  - Do NOT copy `<context>`, `<rules>`, `<project_context>` blocks into the artifact
  - These guide what you write, but should never appear in the output

**Guardrails**
- Create ALL artifacts needed for implementation (as defined by schema's `apply.requires`)
- Always read dependency artifacts before creating a new one
- If context is critically unclear, ask the user - but prefer making reasonable decisions to keep momentum
- If a change with that name already exists, ask if user wants to continue it or create a new one
- Verify each artifact file exists after writing before proceeding to next
