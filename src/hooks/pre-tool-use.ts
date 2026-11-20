import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { isPathInside } from '../core/git.js';
import { lookupSessionBinding, resolvePluginDataDir } from '../core/store.js';
import { resolveEffectiveGit, resolveSessionEffectiveStage } from '../core/tree.js';

export interface PreToolUseInput {
  conversationId?: string;
  workspacePaths?: string[];
  artifactDirectoryPath?: string;
  cwd?: string;
  hookEventName?: string;
  toolCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  };
}

export interface PreToolUseOutput {
  decision: 'allow' | 'deny' | 'ask' | 'force_ask';
  reason?: string;
  overwrite?: Record<string, unknown>;
}

function safeRealpath(targetPath: string): string {
  const abs = resolve(targetPath);
  if (existsSync(abs)) {
    try {
      return realpathSync(abs);
    } catch {
      return abs;
    }
  }
  const parent = dirname(abs);
  if (parent !== abs && existsSync(parent)) {
    try {
      const realParent = realpathSync(parent);
      const base = abs.slice(parent.length).replace(/^[/\\]+/, '');
      return resolve(realParent, base);
    } catch {
      return abs;
    }
  }
  return abs;
}

const DANGEROUS_GIT_RE =
  /\bgit\s+(?:merge|rebase|push|worktree\s+remove|reset\s+--hard|clean\s+-[a-z]*f|branch\s+-[dD]|checkout\s+(?:-b\s+)?(?:main|master)\b|switch\s+(?:main|master)\b)/i;

const WRITE_REDIRECT_OR_MUTATION_RE =
  /(?:^|[^0-9])>>?\s*[^&]|(?:Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item)\b|\b(?:rm|mv|cp|mkdir|rmdir|touch|sed\s+-i|tee)\b|\bgit\s+(?:(?:-C\s+(?:"[^"]+"|'[^']+'|\S+)\s+)*)(?:add|commit|stash|checkout|switch|apply|cherry-pick|reset|clean)\b/i;

const READONLY_SEGMENT_RE =
  /^(?:Set-Location\b.*|cd\b.*|Write-Output\b.*|echo\b.*|git\s+(?:(?:-C\s+(?:"[^"]+"|'[^']+'|\S+)\s+)*)(?:status|diff|log|show|rev-parse|merge-base|branch(?:\s+(?:--list|-a|-v|-vv))?|ls-files|describe|worktree\s+list)\b.*|node\s+(?:--test|-v|--version)\b.*|python(?:3)?\s+(?:--version|-V|-m\s+(?:unittest|pytest))\b.*|(?:npm|pnpm|yarn)\s+(?:test|run\s+(?:test|typecheck|lint|check))\b.*|(?:npx\s+)?(?:vitest|jest|tsc\s+--noEmit|eslint)\b.*|pytest\b.*|go\s+test\b.*|cargo\s+(?:test|check)\b.*|rg\b.*|Select-String\b.*|Get-ChildItem\b.*|Get-Content\b.*|ls\b.*|dir\b.*|cat\b.*|head\b.*|tail\b.*|pwd\b.*)$/i;

function splitCommandSegments(cmd: string): string[] {
  const segments: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      cur += ch;
      if (ch === quote && cmd[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ';') {
      if (cur.trim()) segments.push(cur.trim());
      cur = '';
      continue;
    }
    if (ch === '&' && cmd[i + 1] === '&') {
      if (cur.trim()) segments.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) segments.push(cur.trim());
  return segments;
}

export function isReadonlyCommand(cmd: string): boolean {
  if (!cmd.trim()) return true;
  if (DANGEROUS_GIT_RE.test(cmd) || WRITE_REDIRECT_OR_MUTATION_RE.test(cmd)) {
    return false;
  }
  // Reject subshells / backticks / command substitution in strict read-only check
  if (/`|\$\(/.test(cmd)) return false;
  const segments = splitCommandSegments(cmd);
  if (segments.length === 0) return false;
  return segments.every((seg) => READONLY_SEGMENT_RE.test(seg));
}

function extractTargetFilePath(args: Record<string, unknown> | undefined, baseDir: string): string {
  if (!args) return '';
  const raw =
    (typeof args.Path === 'string' && args.Path) ||
    (typeof args.path === 'string' && args.path) ||
    (typeof args.TargetFile === 'string' && args.TargetFile) ||
    (typeof args.file_path === 'string' && args.file_path) ||
    '';
  if (!raw.trim()) return '';
  return isAbsolute(raw) ? raw : resolve(baseDir, raw);
}

function prefixCommandWithWorktree(cmd: string, worktreePath: string, platform = process.platform): string {
  const normWt = resolve(worktreePath);
  // Skip if command already switches to this exact worktree
  if (cmd.toLowerCase().includes(normWt.toLowerCase())) {
    return cmd;
  }
  if (platform === 'win32') {
    const escaped = normWt.replace(/'/g, "''");
    return `Set-Location -LiteralPath '${escaped}'; ${cmd}`;
  }
  const escaped = normWt.replace(/'/g, "'\\''");
  return `cd '${escaped}' && ${cmd}`;
}

export function evaluatePreToolUse(
  input: PreToolUseInput,
  dataDir = resolvePluginDataDir(),
  platform = process.platform,
): PreToolUseOutput {
  const convId = input.conversationId || '';
  if (!convId) return { decision: 'allow' };

  const binding = lookupSessionBinding(convId, dataDir);
  if (!binding) {
    // Unbound conversation: zero interference
    return { decision: 'allow' };
  }

  const { project, moduleId } = binding;
  const mod = project.modules[moduleId];
  if (!mod || mod.archived) return { decision: 'allow' };

  const toolName = (input.toolCall?.name || '').toLowerCase();
  const args = input.toolCall?.args || {};
  const session = (mod.sessions || []).find((s) => s.conversationId === convId);
  const effectiveStage = resolveSessionEffectiveStage(mod, session);
  const effGit = resolveEffectiveGit(project, moduleId);
  const artifactDir = input.artifactDirectoryPath ? safeRealpath(input.artifactDirectoryPath) : '';

  // 1. File write / edit tools
  if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'replace_file_content' || toolName === 'multi_replace_file_content') {
    const targetRaw = extractTargetFilePath(args, input.cwd || project.workspacePath);
    if (!targetRaw) return { decision: 'allow' };
    const targetReal = safeRealpath(targetRaw);

    // Always allow Antigravity's own artifact directory (e.g. /plan artifacts)
    if (artifactDir && isPathInside(artifactDir, targetReal)) {
      return { decision: 'allow' };
    }

    if (effectiveStage === 'Plan' || effectiveStage === 'Review') {
      return {
        decision: 'deny',
        reason: `[modtree 门禁] 模块「${mod.name}」当前会话处于 ${effectiveStage} 只读阶段，禁止修改工作区代码（${targetRaw}）。如需修改代码，请在 Code 阶段会话中操作或切回 Code 阶段。`,
      };
    }

    if (effGit.mode === 'worktree' && effGit.worktreePath) {
      const wtReal = safeRealpath(effGit.worktreePath);
      if (!isPathInside(wtReal, targetReal)) {
        return {
          decision: 'deny',
          reason: `[modtree Worktree 门禁] 模块「${mod.name}」绑定于独立 Worktree（${effGit.worktreePath}），禁止写入该目录之外的路径（${targetRaw}）。`,
        };
      }
    }

    return { decision: 'allow' };
  }

  // 2. Shell command tool
  if (toolName === 'run_command') {
    const cmd =
      (typeof args.CommandLine === 'string' && args.CommandLine) ||
      (typeof args.command === 'string' && args.command) ||
      '';
    if (!cmd.trim()) return { decision: 'allow' };

    if (DANGEROUS_GIT_RE.test(cmd)) {
      return {
        decision: 'force_ask',
        reason: `[modtree Git 门禁] 检测到高危 Git 命令（merge / rebase / push / reset --hard / worktree remove / 切主干），必须由用户明确确认后执行。`,
      };
    }

    if (effectiveStage === 'Plan' || effectiveStage === 'Review') {
      const isReadonly = isReadonlyCommand(cmd);
      if (isReadonly) {
        if (effGit.mode === 'worktree' && effGit.worktreePath) {
          const rewritten = prefixCommandWithWorktree(cmd, effGit.worktreePath, platform);
          if (rewritten !== cmd) {
            return {
              decision: 'allow',
              overwrite: { CommandLine: rewritten },
            };
          }
        }
        return { decision: 'allow' };
      }
      return {
        decision: 'force_ask',
        reason: `[modtree 门禁] 模块「${mod.name}」当前会话处于 ${effectiveStage} 只读阶段，非只读终端命令需要用户明确确认。`,
      };
    }

    // Code stage in Worktree: automatically scope cwd into the bound worktree
    if (effGit.mode === 'worktree' && effGit.worktreePath) {
      const rewritten = prefixCommandWithWorktree(cmd, effGit.worktreePath, platform);
      if (rewritten !== cmd) {
        return {
          decision: 'allow',
          overwrite: { CommandLine: rewritten },
        };
      }
    }

    return { decision: 'allow' };
  }

  return { decision: 'allow' };
}

function runCli(): void {
  try {
    const raw = readFileSync(0, 'utf-8').trim();
    const input = raw ? (JSON.parse(raw) as PreToolUseInput) : {};
    const out = evaluatePreToolUse(input);
    process.stdout.write(JSON.stringify(out) + '\n');
  } catch (err: unknown) {
    // Fail open on unexpected stdin/parse errors so we never brick the user's editor
    process.stderr.write(`[modtree pre-tool-use] error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
  }
}

const isDirectExec =
  process.argv[1] &&
  (process.argv[1].endsWith('pre-tool-use.mjs') || process.argv[1].endsWith('pre-tool-use.ts'));
if (isDirectExec) {
  runCli();
}
