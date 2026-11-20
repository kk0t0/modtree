import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { resolveEffectiveGit } from './tree.js';
import {
  ModuleGitRuntime,
  ProjectGitConfig,
  ProjectState,
  RepoGitOverview,
} from './types.js';

export function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export function tryGit(cwd: string, args: string[]): string | null {
  try {
    return runGit(cwd, args);
  } catch {
    return null;
  }
}

export function isPathInside(parentDir: string, targetPath: string): boolean {
  const normParent = resolve(parentDir);
  const normTarget = resolve(targetPath);
  const rel = relative(
    process.platform === 'win32' ? normParent.toLowerCase() : normParent,
    process.platform === 'win32' ? normTarget.toLowerCase() : normTarget,
  );
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function getRepoOverview(workspacePath: string): RepoGitOverview {
  if (!workspacePath || !existsSync(workspacePath)) {
    return {
      isGitRepo: false,
      currentBranch: '',
      headCommit: '',
      dirtyCount: 0,
      dirtyFiles: [],
    };
  }
  const top = tryGit(workspacePath, ['rev-parse', '--is-inside-work-tree']);
  if (top !== 'true') {
    return {
      isGitRepo: false,
      currentBranch: '',
      headCommit: '',
      dirtyCount: 0,
      dirtyFiles: [],
    };
  }

  const currentBranch =
    tryGit(workspacePath, ['symbolic-ref', '--short', 'HEAD']) ||
    tryGit(workspacePath, ['rev-parse', '--short', 'HEAD']) ||
    '';
  const headCommit = tryGit(workspacePath, ['rev-parse', 'HEAD']) || '';
  const statusOut = tryGit(workspacePath, ['status', '--porcelain']) || '';
  const dirtyFiles = statusOut
    ? statusOut.split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).trim())
    : [];

  return {
    isGitRepo: true,
    currentBranch,
    headCommit,
    dirtyCount: dirtyFiles.length,
    dirtyFiles: dirtyFiles.slice(0, 20),
  };
}

export function ensureWorktreeExcluded(workspacePath: string, worktreeDir = '.worktrees'): void {
  const commonDirRaw = runGit(workspacePath, ['rev-parse', '--git-common-dir']);
  const commonDir = isAbsolute(commonDirRaw)
    ? commonDirRaw
    : resolve(workspacePath, commonDirRaw);
  const excludeFile = join(commonDir, 'info', 'exclude');
  mkdirSync(dirname(excludeFile), { recursive: true });

  const pattern = `${worktreeDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}/`;
  if (!existsSync(excludeFile)) {
    writeFileSync(excludeFile, `# modtree worktrees\n${pattern}\n`, 'utf-8');
    return;
  }
  const content = readFileSync(excludeFile, 'utf-8');
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  if (!lines.includes(pattern) && !lines.includes(pattern.slice(0, -1))) {
    const prefix = content.endsWith('\n') || content.length === 0 ? '' : '\n';
    appendFileSync(excludeFile, `${prefix}# modtree worktrees\n${pattern}\n`, 'utf-8');
  }
}

export interface CreateWorktreeResult {
  branch: string;
  worktreePath: string;
  baseBranch: string;
  baseCommit: string;
  copiedEnvFiles: string[];
  initRan: boolean;
}

export function createModuleWorktree(
  workspacePath: string,
  moduleSlug: string,
  gitConfig: ProjectGitConfig,
): CreateWorktreeResult {
  const overview = getRepoOverview(workspacePath);
  if (!overview.isGitRepo) {
    throw new Error('当前工作区不是 Git 仓库，无法创建 Worktree');
  }
  if (!overview.headCommit) {
    throw new Error('当前 Git 仓库尚无任何提交（HEAD 为空），请先做一次初始 commit');
  }

  const worktreeDirName = (gitConfig.worktreeDir || '.worktrees').replace(/^[/\\]+|[/\\]+$/g, '');
  ensureWorktreeExcluded(workspacePath, worktreeDirName);

  const safeSlug = moduleSlug.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'mod';
  const prefix = gitConfig.branchPrefix || 'mod/';
  // Avoid redundant prefix like "mod/mod-crwy" when fallback ID already starts with "mod-"
  const prefixWord = prefix.replace(/[/\\-]+$/, '').toLowerCase();
  const branchSlug =
    prefixWord && safeSlug.toLowerCase().startsWith(`${prefixWord}-`)
      ? safeSlug.slice(prefixWord.length + 1) || safeSlug
      : safeSlug;
  let branch = `${prefix}${branchSlug}`;
  let suffix = 2;
  while (tryGit(workspacePath, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]) !== null) {
    branch = `${prefix}${branchSlug}-${suffix++}`;
  }

  const worktreeRoot = resolve(workspacePath, worktreeDirName);
  mkdirSync(worktreeRoot, { recursive: true });
  let worktreePath = join(worktreeRoot, branchSlug);
  let dirSuffix = 2;
  while (existsSync(worktreePath)) {
    worktreePath = join(worktreeRoot, `${branchSlug}-${dirSuffix++}`);
  }

  runGit(workspacePath, ['worktree', 'add', '-b', branch, worktreePath, overview.headCommit]);

  // Copy optional .env files
  const copiedEnvFiles: string[] = [];
  for (const relEnv of gitConfig.copyEnvFiles || []) {
    const cleanRel = relEnv.trim();
    if (!cleanRel) continue;
    const src = resolve(workspacePath, cleanRel);
    const dst = resolve(worktreePath, cleanRel);
    if (isPathInside(workspacePath, src) && isPathInside(worktreePath, dst) && existsSync(src)) {
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      copiedEnvFiles.push(cleanRel);
    }
  }

  // Optional init command (user-configured in project settings)
  let initRan = false;
  if (gitConfig.initCommand && gitConfig.initCommand.trim()) {
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const shellArgs =
      process.platform === 'win32'
        ? ['-NoProfile', '-Command', gitConfig.initCommand.trim()]
        : ['-c', gitConfig.initCommand.trim()];
    execFileSync(shell, shellArgs, {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    initRan = true;
  }

  return {
    branch,
    worktreePath: normalize(worktreePath),
    baseBranch: overview.currentBranch || 'main',
    baseCommit: overview.headCommit,
    copiedEnvFiles,
    initRan,
  };
}

export function getModuleGitRuntime(project: ProjectState, moduleId: string): ModuleGitRuntime {
  const eff = resolveEffectiveGit(project, moduleId);
  if (eff.mode !== 'worktree' || !eff.worktreePath) {
    return {
      effective: eff,
      behindBase: 0,
      aheadBase: 0,
      worktreeDirtyCount: 0,
      worktreeExists: false,
    };
  }

  const worktreeExists = existsSync(eff.worktreePath);
  if (!worktreeExists) {
    return {
      effective: eff,
      behindBase: 0,
      aheadBase: 0,
      worktreeDirtyCount: 0,
      worktreeExists: false,
    };
  }

  const wtStatus = tryGit(eff.worktreePath, ['status', '--porcelain']) || '';
  const worktreeDirtyCount = wtStatus ? wtStatus.split(/\r?\n/).filter(Boolean).length : 0;

  let behindBase = 0;
  let aheadBase = 0;
  let mergeBase: string | undefined;

  if (eff.baseBranch) {
    const counts = tryGit(eff.worktreePath, [
      'rev-list',
      '--left-right',
      '--count',
      `${eff.baseBranch}...HEAD`,
    ]);
    if (counts) {
      const parts = counts.split(/\s+/).map(Number);
      if (parts.length === 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
        behindBase = parts[0];
        aheadBase = parts[1];
      }
    }
    mergeBase = tryGit(eff.worktreePath, ['merge-base', eff.baseBranch, 'HEAD']) || undefined;
  }

  return {
    effective: eff,
    behindBase,
    aheadBase,
    worktreeDirtyCount,
    worktreeExists,
    mergeBase,
  };
}

export function syncBaseIntoWorktree(
  worktreePath: string,
  baseBranch: string,
): { merged: boolean; message: string } {
  if (!existsSync(worktreePath)) {
    throw new Error(`Worktree 目录不存在: ${worktreePath}`);
  }
  const status = tryGit(worktreePath, ['status', '--porcelain']) || '';
  if (status.trim()) {
    throw new Error('当前 Worktree 有未提交改动，请先提交或暂存后再同步主干');
  }
  try {
    const out = runGit(worktreePath, ['merge', '--no-edit', baseBranch]);
    return { merged: true, message: out || `已将 ${baseBranch} 合并到当前 Worktree` };
  } catch (err: unknown) {
    tryGit(worktreePath, ['merge', '--abort']);
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`同步主干出现冲突，已自动中止（merge --abort），请手动或交由该会话处理：${msg}`);
  }
}

export interface MergeToBaseInput {
  branch: string;
  worktreePath?: string;
  baseBranch: string;
  strategy: 'squash' | 'no-ff';
  commitMessage: string;
}

export function mergeBranchToBase(
  workspacePath: string,
  input: MergeToBaseInput,
): { mergedCommit: string } {
  const overview = getRepoOverview(workspacePath);
  if (!overview.isGitRepo) throw new Error('主工作区不是 Git 仓库');
  if (overview.dirtyCount > 0) {
    throw new Error(`主目录有 ${overview.dirtyCount} 个未提交改动，请先清理或提交后再合并`);
  }
  if (overview.currentBranch !== input.baseBranch) {
    throw new Error(
      `主目录当前位于分支「${overview.currentBranch}」，与目标主干「${input.baseBranch}」不一致；请先手动切回主干后再合并`,
    );
  }
  if (input.worktreePath && existsSync(input.worktreePath)) {
    const wtDirty = tryGit(input.worktreePath, ['status', '--porcelain']) || '';
    if (wtDirty.trim()) {
      throw new Error('目标 Worktree 仍有未提交改动，请先在 Worktree 内提交后再合并回主干');
    }
  }

  const msg = input.commitMessage.trim() || `feat: merge ${input.branch}`;

  if (input.strategy === 'squash') {
    try {
      runGit(workspacePath, ['merge', '--squash', input.branch]);
      const staged = tryGit(workspacePath, ['diff', '--cached', '--name-only']) || '';
      if (!staged.trim()) {
        throw new Error('该分支相对主干没有可合并的新改动');
      }
      runGit(workspacePath, ['commit', '-m', msg]);
    } catch (err: unknown) {
      // Cleanly roll back conflicted/partial squash merge
      tryGit(workspacePath, ['merge', '--abort']);
      tryGit(workspacePath, ['reset', '--hard', 'HEAD']);
      const errText = err instanceof Error ? err.message : String(err);
      throw new Error(`Squash 合并失败并已自动回滚：${errText}`);
    }
  } else {
    try {
      runGit(workspacePath, ['merge', '--no-ff', '-m', msg, input.branch]);
    } catch (err: unknown) {
      tryGit(workspacePath, ['merge', '--abort']);
      const errText = err instanceof Error ? err.message : String(err);
      throw new Error(`普通 Merge (--no-ff) 出现冲突并已中止：${errText}`);
    }
  }

  const mergedCommit = runGit(workspacePath, ['rev-parse', 'HEAD']);
  return { mergedCommit };
}

export function cleanupModuleWorktree(
  workspacePath: string,
  worktreeDirName: string,
  options: { worktreePath?: string; branch?: string; forceBranchDelete?: boolean },
): { removedWorktree: boolean; deletedBranch: boolean } {
  let removedWorktree = false;
  let deletedBranch = false;

  if (options.worktreePath) {
    const allowedRoot = resolve(workspacePath, worktreeDirName || '.worktrees');
    if (!isPathInside(allowedRoot, options.worktreePath)) {
      throw new Error(`安全拒绝：目标路径 ${options.worktreePath} 不在允许的 Worktree 目录 ${allowedRoot} 下`);
    }
    if (existsSync(options.worktreePath)) {
      runGit(workspacePath, ['worktree', 'remove', options.worktreePath]);
      removedWorktree = true;
    } else {
      tryGit(workspacePath, ['worktree', 'prune']);
    }
  }

  if (options.branch) {
    const exists = tryGit(workspacePath, ['show-ref', '--verify', '--quiet', `refs/heads/${options.branch}`]);
    if (exists !== null) {
      // Squash-merged branches require -D since git cannot see commit ancestry
      runGit(workspacePath, ['branch', options.forceBranchDelete ? '-D' : '-d', options.branch]);
      deletedBranch = true;
    }
  }

  return { removedWorktree, deletedBranch };
}
