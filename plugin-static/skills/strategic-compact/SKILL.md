---
name: strategic-compact
description: Suggests manual context compaction at logical intervals to preserve context through task phases rather than arbitrary auto-compaction. Use when a session is approaching a context limit and a task phase is a natural place to compact.
license: MIT
metadata:
  origin: ECC
  adapted_for: modtree
---

# Strategic Compact Skill

Suggests manual `/compact` at strategic points in your workflow rather than relying on arbitrary auto-compaction.

## When to Activate

- Running long sessions that approach context limits (200K+ tokens)
- Working on multi-phase tasks (research → plan → implement → test)
- Switching between unrelated tasks within the same session
- After completing a major milestone and starting new work
- When responses slow down or become less coherent (context pressure)

## Why Strategic Compaction?

Auto-compaction triggers at arbitrary points:
- Often mid-task, losing important context
- No awareness of logical task boundaries
- Can interrupt complex multi-step operations

Strategic compaction at logical boundaries:
- **After exploration, before execution** — Compact research context, keep implementation plan
- **After completing a milestone** — Fresh start for next phase
- **Before major context shifts** — Clear exploration context before different task

## How It Works in Antigravity / modtree

Instead of waiting for automatic context truncation mid-task, proactively watch for logical phase boundaries and suggest one of two clean resets:

1. **Manual `/compact`** — When continuing in the same conversation right after finishing research, planning, or debugging (e.g., `/compact Focus on implementing auth middleware next`).
2. **Fresh stage session via `modtree`** — When crossing `Plan → Code` or `Code → Review` on a bound module, first write durable state (`design`, `stop`, `next`, `linkedFiles`) via `modtree_update_progress`, then recommend opening a fresh stage session from the `modtree` sidebar so the new session starts with a clean 4-layer funnel prompt.

> Before suggesting `/compact` or switching sessions, ensure all key decisions, file paths, and next steps are written to disk or persisted via `modtree_update_progress` so nothing important is lost.

## Compaction Decision Guide

Use this table to decide when to compact:

| Phase Transition | Compact? | Why |
|-----------------|----------|-----|
| Research → Planning | Yes | Research context is bulky; plan is the distilled output |
| Planning → Implementation | Yes | Plan is written down (a file, or the task list if you have one); free up context for code |
| Implementation → Testing | Maybe | Keep if tests reference recent code; compact if switching focus |
| Debugging → Next feature | Yes | Debug traces pollute context for unrelated work |
| Mid-implementation | No | Losing variable names, file paths, and partial state is costly |
| After a failed approach | Yes | Clear the dead-end reasoning before trying a new approach |

## What Survives Compaction

Understanding what persists helps you compact with confidence:

| Persists | Lost |
|----------|------|
| CLAUDE.md instructions | Intermediate reasoning and analysis |
| Files on disk | File contents you previously read |
| Memory files (`~/.claude/memory/`) | Multi-step conversation context |
| Git state (commits, branches) | Tool call history and counts |
| The task list — **only if you have the todo tools** (see below) | Nuanced user preferences stated verbally |

> ### Don't rely on the task list surviving — it may not exist
>
> Claude Code **2.1.233 removed the todo/task tools by default** on Opus 4.8, Sonnet 5,
> Fable 5, Mythos 5 and newer models (`TodoWrite`, `TaskCreate/Get/Update/List`).
> `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` brings them back, but that is a per-machine
> environment setting — **it does not travel with this skill**, so you cannot assume the
> reader has it.
>
> This matters because "my todo list survives compaction" is a reason people compact
> *instead of* writing state down. If the tools are absent there is no list to survive,
> and the plan is simply gone. **Write the plan to a file before compacting** — a file
> persists on every version and every model. Treat the task list as a convenience that
> may be missing, never as your durable record.

## Best Practices

1. **Compact after planning** — Once the plan is finalized **and written to a file**, compact to start fresh
2. **Compact after debugging** — Clear error-resolution context before continuing
3. **Don't compact mid-implementation** — Preserve context for related changes
4. **Read the suggestion** — The hook tells you *when*, you decide *if*
5. **Write before compacting** — Save important context to files or memory before compacting
6. **Use `/compact` with a summary** — Add a custom message: `/compact Focus on implementing auth middleware next`

## Token Optimization Patterns

### Trigger-Table Lazy Loading
Instead of loading full skill content at session start, use a trigger table that maps keywords to skill paths. Skills load only when triggered, reducing baseline context by 50%+:

| Trigger | Skill | Load When |
|---------|-------|-----------|
| "test", "tdd", "coverage" | tdd-workflow | User mentions testing |
| "security", "auth", "xss" | security-review | Security-related work |
| "deploy", "ci/cd" | deployment-patterns | Deployment context |

### Context Composition Awareness
Monitor what's consuming your context window:
- **CLAUDE.md files** — Always loaded, keep lean
- **Loaded skills** — Each skill adds 1-5K tokens
- **Conversation history** — Grows with each exchange
- **Tool results** — File reads, search results add bulk

### Duplicate Instruction Detection
Common sources of duplicate context:
- Same rules in both `~/.claude/rules/` and project `.claude/rules/`
- Skills that repeat CLAUDE.md instructions
- Multiple skills covering overlapping domains

### Context Optimization Tools
- `token-optimizer` MCP — Automated 95%+ token reduction via content deduplication
- `context-mode` — Context virtualization (315KB to 5.4KB demonstrated)

## Related

- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) — Token optimization section
- Memory persistence hooks — For state that survives compaction
- `continuous-learning` skill — Extracts patterns before session ends
