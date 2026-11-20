---
name: orch-refine-code
description: Orchestrate a behavior-preserving refactor — confirm tests are green, restructure without changing behavior, keep tests green, review, and gated commit. Use when the structure should improve but behavior must not change.
license: MIT
metadata:
  origin: ECC
  adapted_for: modtree
---

# orch-refine-code

> Adapted from Everything Claude Code (`orch-refine-code` + `orch-pipeline`, MIT License) as a self-contained skill for Antigravity / `modtree`.

## When to Use

- Same behavior, **better structure**: extract modules, split monolithic files, remove duplication, kill dead code, reduce nesting, or rename for clarity.
- If externally observable behavior is meant to change, use normal feature/fix workflows (e.g. `tdd-workflow`) instead of this skill.

## Workflow (Behavior-Preserving Refactor Loop)

### Step 0 — Classify Blast Radius
State the scope in one line before editing:
- **Small** (1 file / 1 function, obvious cleanup): Step 1 → Step 3 → Step 4 → Step 5.
- **Standard / Large** (multiple files, module extraction, shared helper refactor): full Step 1 → Step 2 (**Gate 1**) → Step 3 → Step 4 → Step 5 (**Gate 2**).

### Step 1 — Establish a Green Safety Net (First Move)
- Confirm existing tests covering the target area exist and are **green before** touching production code.
- If coverage is thin or missing, add characterization tests first to lock down current behavior (no new behavior changes).

### Step 2 — Plan the Restructure (Gate 1)
- Present a concise extraction/restructure plan: target files, boundaries/interfaces to preserve, and step order.
- For Standard/Large refactors, wait for user confirmation before moving code across files.

### Step 3 — Restructure in Small, Green Steps
- Move or simplify code in small, incremental steps.
- Re-run the relevant test suite after each step — tests must stay green throughout.
- Do not mix feature additions, bug fixes, or unrelated formatting sweeps into the refactor diff.
- For dead-code or duplication sweeps, check unused exports/files (e.g., via static analysis or `refactor-cleaner` subagent when available) and remove safely.

### Step 4 — Self-Review & Verification
- Review the full `git diff` to confirm the change is strictly behavior-neutral (same public contracts, same edge-case semantics).
- Run typecheck, lint, and full test suite (or `verification-loop` before marking a `modtree` module `待检查`).

### Step 5 — Gated Commit (Gate 2)
- Summarize the diff and propose a Conventional Commit message with `refactor:` prefix (e.g., `refactor(parser): extract tokenizer into separate module`).
- Confirm with the user before committing if committing is part of the request.

## Example

```text
orch-refine-code: split monolithic git helper into focused modules
→ confirm tests green → present extraction plan [GATE 1: approve]
→ extract in small steps, re-running tests after each → diff self-review
→ commit refactor: [GATE 2: confirm]
```
