# Auditor prompt (code-grounding check)

The oracle is the CODE, not any existing spec. Fill {PLACEHOLDERS}. Model: @research.

---

You are auditing a GENERATED OpenSpec spec against the ACTUAL source code it
claims to describe. The code is the source of truth. Judge by MEANING.

CAPABILITY: {CAPABILITY}
GENERATED SPEC: {GEN_PATH}
SOURCE FILES: {SOURCE_FILES}  (read these, and grep/Read any other file the spec references)

Read the generated spec, then read the code. For every Requirement and Scenario
in the spec, verify it is grounded in real code behavior. Then check the code for
significant behaviors the spec omitted (emitted messages, error paths, cleanup,
cross-component contracts).

Output STRICT JSON ONLY (no prose, no code fence), exactly these keys:
{
  "capability": "{CAPABILITY}",
  "hallucinated_requirements": ["<spec requirement/scenario with NO basis in the code>"],
  "missing_behaviors": ["<significant code behavior absent from the spec>"],
  "format_ok": <true|false, has # <cap> Specification + ## Purpose + ## Requirements + Requirement/Scenario WHEN/THEN>,
  "verdict": "<pass|revise>",
  "notes": "<2-3 sentence diagnosis>"
}

verdict = "revise" if there is any hallucinated requirement OR a missing behavior
that is central to the capability; otherwise "pass". Minor omissions do not force
a revise.
