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
      1. **Write scenario.json** at `<change-dir>/screenshots/scenario.json`. URLs are `http://localhost:8000`. Capture at BOTH desktop (1512px) and mobile (375px) viewports.

         Format — flat array of step objects, each with exactly one key:
         ```json
         [
           {"open": "http://localhost:8000"},
           {"wait": 3000},
           {"set viewport": "1512 3000"},
           {"screenshot": "session-list-desktop"},
           {"set viewport": "375 3000"},
           {"wait": 1000},
           {"screenshot": "session-list-mobile"}
         ]
         ```

      2. **Capture screenshots** (starts sandbox, runs scenarios inside container, copies results out):
         ```bash
         bash sandbox/scripts/capture-screenshots.sh \
           <change-dir>/screenshots/scenario.json \
           <change-dir>/screenshots/ 2>&1
         ```
         Verify screenshots exist AND have correct dimensions:
         ```bash
         ls -la <change-dir>/screenshots/*.png
         file <change-dir>/screenshots/*.png
         ```
         Desktop MUST be ≥ 3000px tall. If not, the viewport was too short — fix scenario.json and re-capture.

         **If sandbox exits with "unhealthy"**, the previous run left stale state. Clean up and retry once:
         ```bash
         docker compose -f sandbox/docker-compose.yml down --volumes 2>&1
         bash sandbox/scripts/capture-screenshots.sh ...
         ```

      3. **Derive visual states** from specs requirements and proposal user stories.
         List every `<!-- state: <name> -->` that the mockup must include.
         Minimum: desktop + mobile variants, all statuses (streaming/idle/ended/error),
         all interactive elements mentioned in specs.

      4. **Invoke sandbox-designer subagent.**

         **CRITICAL — sandbox-designer skill requires NO `reads` parameter.** All file paths MUST go in the `task` text. Using `reads` causes the designer to fail with "screenshots failed to load".

         List all spec files with `find <change-dir>/specs -name '*.md'` and include every one:
         ```
         subagent({
           agent: "sandbox-designer",
           async: true,
           task: `Generate mockup.html for <change-name>.

         Read these screenshots first:
         - <change-dir>/screenshots/session-list-desktop.png
         - <change-dir>/screenshots/session-list-mobile.png

         Read these design documents:
         - <change-dir>/proposal.md
         - <change-dir>/design.md

         Read these specs:
         - <change-dir>/specs/<capability-1>/spec.md
         - <change-dir>/specs/<capability-2>/spec.md

         Required states: <state list from step 3>

         Requirements:
         - Show BOTH light and dark theme variants for each state.
         - Add a visible `<h2>` label above each <!-- state: --> block so states are identifiable.
         - CSS custom properties ONLY. No raw Tailwind colors.

         Save output to: <change-dir>/mockup.html`
         })
         ```
         The subagent runs async — collect output when complete:
         ```
         subagent({ action: "status", id: "<run-id>" })
         ```
         When status is "completed", save the output as `<change-dir>/mockup.html`.

         **Validate the designer's first message** — it MUST describe what it sees in the screenshots (mentioning specific colors, layouts, elements). If the description is wrong or generic, screenshots didn't load. If the designer reports "ERROR: screenshots failed to load", the invocation was wrong (likely used `reads`) — fix and re-invoke.

      5. **Validate mockup.html:**
         - Check ALL `<!-- state: -->` blocks from the task are present
         - Verify no raw Tailwind colors (`grep -cE 'bg-gray-|text-white|border-gray-|bg-slate-' mockup.html` must be 0)
         - Verify both light and dark theme variants present
         - Verify visible `<h2>` labels above each state block
         - If validation fails → resume the designer with feedback: `subagent({ action: "resume", id: "<run-id>", message: "<fixes>" })`

      6. **Capture mockup screenshot.** Open `mockup.html` in browser, take full-page screenshot, save to `<change-dir>/screenshots/mockup-final.png`.

      7. **Update design.md** with `## Visual Design` section linking to `mockup.html`.

      8. **Show visuals to user.** Use `read` to display the screenshots sent to the designer (from `<change-dir>/screenshots/`) and the mockup screenshot (`mockup-final.png`). No text — just the images.

      9. **Ask user for approval.** Show the mockup and ask: "Does the mockup look good? Any changes needed?" Use `ask_user` with method `confirm`. **Wait indefinitely — do NOT proceed until user responds.** If user wants changes, **resume the sandbox-designer subagent** with the feedback (do NOT restart from scratch): `subagent({ action: "resume", id: "<run-id>", message: "<user feedback>" })`. Loop until approved.

      10. **Final mockup review.** Before the summary, read `mockup.html` and `mockup-final.png` one last time.

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
