---
name: openspec-propose
description: Propose a new change with all artifacts generated in one step. Use when the user wants to quickly describe what they want to build and get a complete proposal with design, specs, and tasks ready for implementation.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.3.1"
---

Propose a new change - create the change and generate all artifacts in one step.

I'll create a change with artifacts:
- proposal.md (what & why)
- design.md (how)
- tasks.md (implementation steps)

When ready to implement, run /opsx-apply

---

**Input**: The user's request should include a change name (kebab-case) OR a description of what they want to build.

**Steps**

1. **If no clear input provided, ask what they want to build**

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
      - Emit: "Design sandbox unavailable (Docker not found) then stop and report.

   b. **If Docker IS available:**
      1. **Start sandbox** (all internal, no host ports exposed):
         ```bash
         docker compose -f sandbox/docker-compose.yml up -d --wait 2>&1
         ```

      2. **Seed sessions inside the container** (NOT on host — uses internal Docker network):
         ```bash
         docker compose -f sandbox/docker-compose.yml exec -T dashboard node sandbox/seed-bridge.mjs 2>&1
         ```

      3. **Write scenario.json** at `<change-dir>/screenshots/scenario.json` with browser steps. **Every screenshot MUST be captured at BOTH desktop (1512px) and mobile (375px) viewports.** Specific states to capture depend on the change.

         Execute:
         ```bash
         bash sandbox/scripts/run-scenarios.sh <change-dir>/screenshots/scenario.json <change-dir>/screenshots/
         ```

      4. **Derive visual states** from specs requirements and proposal user stories.
         List every `<!-- state: <name> -->` that the mockup must include.
         Minimum: desktop + mobile variants, all statuses (streaming/idle/ended/error),
         all interactive elements mentioned in specs.

      5. **Invoke sandbox-designer subagent:**
         ```
         subagent({
           agent: "sandbox-designer",
           reads: [
             "<change-dir>/screenshots/",
             "<change-dir>/proposal.md",
             "<change-dir>/specs/"
           ],
           task: "Generate mockup.html with these states: <state list from step 4>.\nScreenshots show current UI. Proposal + specs define requirements."
         })
         ```
         Save output as `<change-dir>/mockup.html`. **Validate the designer's first message** — it MUST describe what it sees in the screenshots. If the description is wrong or generic, screenshots didn't load. Retry or fix paths.

      6. **Validate mockup.html:**
         - Check ALL `<!-- state: -->` blocks from the task are present
         - Verify no raw Tailwind colors (grep for `bg-gray-`, `text-white`, etc.)
         - If validation fails → intercom to designer asking for fixes, wait, re-check

      7. **Capture mockup screenshot.** Open `mockup.html` in browser, take full-page screenshot, save to `<change-dir>/screenshots/mockup-final.png`.

      8. **Update design.md** with `## Visual Design` section linking to `mockup.html`.

      9. **Show visuals to user.** Use `read` to display the screenshots sent to the designer (from `<change-dir>/screenshots/`) and the mockup screenshot (`mockup-final.png`). No text — just the images.

      10. **Ask user for approval.** Show the mockup and ask: "Does the mockup look good? Any changes needed?" Use `ask_user` with method `confirm`. **Wait indefinitely — do NOT proceed until user responds.** If user wants changes, **resume the sandbox-designer subagent** with the feedback (do NOT restart from scratch): `subagent({ action: "resume", id: "<run-id>", message: "<user feedback>" })`. Loop until approved.

      11. **Teardown sandbox:**
         ```bash
         docker compose -f sandbox/docker-compose.yml down
         ```
         Teardown failure emits a warning but does NOT block.

      12. **Final mockup review.** Before the summary, read `mockup.html` and `mockup-final.png` one last time.

6. **Create tasks artifact**

7. **Show final status**
   ```bash
   openspec status --change "<name>"
   ```

**Final Summary**

Before the summary, SHOW the mockup one last time:
- `read <change-dir>/mockup.html`
- `read <change-dir>/screenshots/mockup-final.png`

After completing all artifacts, summarize:
- Change name and location
- List of artifacts created with brief descriptions
- What's ready: "All artifacts created! Ready for implementation."
- Prompt: "Run `/opsx-apply` or ask me to implement to start working on the tasks."

**Artifact Creation Guidelines**

- Follow the `instruction` field from `openspec instructions` for each artifact type
- The schema defines what each artifact should contain - follow it
- Read dependency artifacts for context before creating new ones
- Use `template` as the structure for your output file - fill in its sections
- **IMPORTANT**: `context` and `rules` are constraints for YOU, not content for the file

**Guardrails**
- Create ALL artifacts needed for implementation (as defined by schema's `apply.requires`)
- Always read dependency artifacts before creating a new one
- If context is critically unclear, ask the user - but prefer making reasonable decisions to keep momentum
- If a change with that name already exists, ask if user wants to continue it or create a new one
- Verify each artifact file exists after writing before proceeding to next
