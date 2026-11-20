# Third-Party Notices

This repository (`modtree`) bundles 19 curated engineering skills originally authored by **Everything Claude Code (ECC)** under the **MIT License**.

## Everything Claude Code (ECC)

- **Upstream Project**: Everything Claude Code (ECC)
- **Copyright**: Copyright (c) 2026 Affaan Mustafa
- **License**: MIT License
- **Location in `modtree`**: `plugin-static/skills/<skill-id>/` (installed into `<plugin>/skills/<skill-id>/`)

### Included Skills (19 total)

| Skill ID | `modtree` Stage / Group | Status | Notes |
| --- | --- | --- | --- |
| `search-first` | Plan | Unmodified (frontmatter `license: MIT` added) | Upstream ECC skill |
| `hexagonal-architecture` | Plan | Unmodified (frontmatter `license: MIT` added) | Upstream ECC skill |
| `api-design` | Plan / Review | Unmodified (frontmatter `license: MIT` added) | Upstream ECC skill |
| `database-migrations` | Plan | Unmodified (frontmatter `license: MIT` added; includes `examples/`) | Upstream ECC skill |
| `error-handling` | Plan / Review | Unmodified (frontmatter `license: MIT` added) | Upstream ECC skill |
| `tdd-workflow` | Code | Adapted for Antigravity / `modtree` | Replaced `$ECC_ROOT/scripts/setup-package-manager.js` call in Step 0 with direct lockfile / `package.json` detection |
| `coding-standards` | Code / Review | Unmodified (frontmatter `license: MIT` added) | Upstream ECC skill |
| `orch-refine-code` | Code | Adapted for Antigravity / `modtree` | Inlined behavior-preserving refactor loop from ECC `orch-pipeline` so the skill is self-contained without a broken `../orch-pipeline/SKILL.md` relative link |
| `backend-patterns` | Code | Unmodified (frontmatter `license: MIT` added) | Upstream ECC skill |
| `frontend-patterns` | Code | Unmodified (frontmatter `license: MIT` added) | Upstream ECC skill |
| `e2e-testing` | Code | Unmodified (frontmatter `license: MIT` added) | Upstream ECC skill |
| `git-workflow` | Code | Unmodified (frontmatter `license: MIT` added) | Upstream ECC skill |
| `verification-loop` | Code / Review | Adapted for Antigravity / `modtree` | Replaced Claude-only `/verify` wording with `modtree` `待检查` pre-handoff guidance and PowerShell note |
| `security-review` | Review | Unmodified (frontmatter `license: MIT` added; includes `cloud-infrastructure-security.md`) | Upstream ECC skill |
| `deployment-patterns` | Cross-stage / Master | Unmodified (frontmatter `license: MIT` added) | Upstream ECC skill |
| `agent-introspection-debugging` | Cross-stage / Master | Unmodified (frontmatter `license: MIT` added) | Upstream ECC skill |
| `strategic-compact` | Cross-stage / Master | Adapted for Antigravity / `modtree` | Replaced Claude Code `~/.claude/scripts/hooks/suggest-compact.js` setup instructions with Antigravity `/compact` and `modtree` stage-session handoff guidance |
| `cpp-coding-standards` | C++ / ESP32 (On-demand) | Unmodified (frontmatter `license: MIT` added) | Upstream ECC skill |
| `cpp-testing` | C++ / ESP32 (On-demand) | Unmodified (frontmatter `license: MIT` added) | Upstream ECC skill |

### Upstream License Text

```text
MIT License

Copyright (c) 2026 Affaan Mustafa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
