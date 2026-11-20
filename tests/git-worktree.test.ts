import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupModuleWorktree,
  createModuleWorktree,
  getModuleGitRuntime,
  getRepoOverview,
  mergeBranchToBase,
  runGit,
  syncBaseIntoWorktree,
} from '../src/core/git.js';
import { createEmptyProject } from '../src/core/store.js';
import { createModule } from '../src/core/tree.js';
import { DEFAULT_GIT_CONFIG } from '../src/core/types.js';

describe('real Git worktree lifecycle integration', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'modtree-git-'));
    runGit(repoDir, ['init', '-b', 'main']);
    runGit(repoDir, ['config', 'user.email', 'test@example.com']);
    runGit(repoDir, ['config', 'user.name', 'Test User']);
    writeFileSync(join(repoDir, 'README.md'), '# demo\n', 'utf-8');
    writeFileSync(join(repoDir, '.env'), 'API_MODE=local\n', 'utf-8');
    writeFileSync(join(repoDir, '.gitignore'), '.env\n', 'utf-8');
    runGit(repoDir, ['add', 'README.md', '.gitignore']);
    runGit(repoDir, ['commit', '-m', 'init']);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('creates isolated worktree, excludes .worktrees without polluting git status, copies .env, tracks behind/ahead, squash-merges, and cleans up', () => {
    const wt = createModuleWorktree(repoDir, 'export-fields', {
      ...DEFAULT_GIT_CONFIG,
      copyEnvFiles: ['.env'],
    });

    expect(wt.branch).toBe('mod/export-fields');
    expect(existsSync(join(wt.worktreePath, '.env'))).toBe(true);
    expect(readFileSync(join(wt.worktreePath, '.env'), 'utf-8')).toContain('API_MODE=local');

    // Main repo status remains 100% clean (zero pollution)
    expect(getRepoOverview(repoDir).dirtyCount).toBe(0);

    // Commit work inside worktree
    writeFileSync(join(wt.worktreePath, 'fields.txt'), 'col1,col2\n', 'utf-8');
    runGit(wt.worktreePath, ['add', 'fields.txt']);
    runGit(wt.worktreePath, ['commit', '-m', 'add field picker']);

    // Advance main by 1 commit to test behind detection + sync
    writeFileSync(join(repoDir, 'main-update.txt'), 'main\n', 'utf-8');
    runGit(repoDir, ['add', 'main-update.txt']);
    runGit(repoDir, ['commit', '-m', 'advance main']);

    const project = createEmptyProject(repoDir);
    const mod = createModule(project, { name: '字段选择' });
    mod.git = {
      mode: 'worktree',
      inheritFromParent: false,
      branch: wt.branch,
      worktreePath: wt.worktreePath,
      baseBranch: wt.baseBranch,
      baseCommit: wt.baseCommit,
    };

    const rt = getModuleGitRuntime(project, mod.id);
    expect(rt.aheadBase).toBe(1);
    expect(rt.behindBase).toBe(1);
    expect(rt.mergeBase).toBeTruthy();

    // Sync main into worktree cleanly
    const synced = syncBaseIntoWorktree(wt.worktreePath, 'main');
    expect(synced.merged).toBe(true);
    expect(getModuleGitRuntime(project, mod.id).behindBase).toBe(0);

    // Squash merge back to main
    const merged = mergeBranchToBase(repoDir, {
      branch: wt.branch,
      worktreePath: wt.worktreePath,
      baseBranch: 'main',
      strategy: 'squash',
      commitMessage: 'feat(export-fields): field picker',
    });
    expect(merged.mergedCommit).toHaveLength(40);
    expect(existsSync(join(repoDir, 'fields.txt'))).toBe(true);

    // Cleanup worktree & branch
    const cleaned = cleanupModuleWorktree(repoDir, '.worktrees', {
      worktreePath: wt.worktreePath,
      branch: wt.branch,
      forceBranchDelete: true,
    });
    expect(cleaned.removedWorktree).toBe(true);
    expect(cleaned.deletedBranch).toBe(true);
    expect(existsSync(wt.worktreePath)).toBe(false);
  });

  it('deduplicates mod/ branch prefix when module ID already starts with mod-', () => {
    const wt = createModuleWorktree(repoDir, 'mod-crwy', DEFAULT_GIT_CONFIG);
    expect(wt.branch).toBe('mod/crwy');
    expect(wt.worktreePath.replace(/\\/g, '/')).toMatch(/\.worktrees\/crwy$/);
  });

  it('aborts cleanly on merge conflict without leaving repo in dirty conflicted state', () => {
    const wt = createModuleWorktree(repoDir, 'conflict-mod', DEFAULT_GIT_CONFIG);

    writeFileSync(join(wt.worktreePath, 'README.md'), '# branch change\n', 'utf-8');
    runGit(wt.worktreePath, ['add', 'README.md']);
    runGit(wt.worktreePath, ['commit', '-m', 'branch edit']);

    writeFileSync(join(repoDir, 'README.md'), '# main change\n', 'utf-8');
    runGit(repoDir, ['add', 'README.md']);
    runGit(repoDir, ['commit', '-m', 'main edit']);

    expect(() => syncBaseIntoWorktree(wt.worktreePath, 'main')).toThrow(/冲突/);
    // Worktree was cleanly aborted back to clean state
    expect(runGit(wt.worktreePath, ['status', '--porcelain'])).toBe('');

    expect(() =>
      mergeBranchToBase(repoDir, {
        branch: wt.branch,
        worktreePath: wt.worktreePath,
        baseBranch: 'main',
        strategy: 'no-ff',
        commitMessage: 'should conflict',
      }),
    ).toThrow(/冲突/);
    expect(getRepoOverview(repoDir).dirtyCount).toBe(0);
  });
});
