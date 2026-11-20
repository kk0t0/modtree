import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeAncestorAndDepHash, computeReviewNotesHash } from '../src/core/context.js';
import { mutateProject } from '../src/core/store.js';
import {
  bindSessionToModule,
  createModule,
  setModuleStage,
  updateModule,
  updateModuleProgress,
} from '../src/core/tree.js';
import { evaluatePreInvocation } from '../src/hooks/pre-invocation.js';
import { evaluatePreToolUse } from '../src/hooks/pre-tool-use.js';

describe('PreToolUse & PreInvocation hooks', () => {
  let tmpRoot: string;
  let dataDir: string;
  let repoDir: string;
  let wtDir: string;
  let artifactDir: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'modtree-hooks-'));
    dataDir = join(tmpRoot, 'plugin_data');
    repoDir = join(tmpRoot, 'repo');
    wtDir = join(repoDir, '.worktrees', 'export');
    artifactDir = join(tmpRoot, 'artifacts');
    mkdirSync(wtDir, { recursive: true });
    mkdirSync(artifactDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('keeps unbound conversations silent with zero interference', () => {
    const toolOut = evaluatePreToolUse(
      {
        conversationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        toolCall: { name: 'write_file', args: { Path: join(repoDir, 'a.ts') } },
      },
      dataDir,
    );
    expect(toolOut.decision).toBe('allow');

    const invOut = evaluatePreInvocation(
      { conversationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      dataDir,
    );
    expect(invOut).toEqual({});
  });

  it('hard-denies workspace writes in Plan/Review while allowing artifact dir and read-only commands', () => {
    const convId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    mutateProject(
      repoDir,
      (proj) => {
        const m = createModule(proj, { name: '字段选择', stage: 'Review' });
        bindSessionToModule(proj, m.id, {
          conversationId: convId,
          title: 'Review',
          stage: 'Review',
          syncedRev: m.rev,
          syncedAncestorHash: computeAncestorAndDepHash(proj, m.id),
          syncedStage: 'Review',
          syncedReviewNotesHash: computeReviewNotesHash(m),
        });
      },
      dataDir,
    );

    const denyWrite = evaluatePreToolUse(
      {
        conversationId: convId,
        artifactDirectoryPath: artifactDir,
        toolCall: { name: 'write_file', args: { Path: join(repoDir, 'src/index.ts') } },
      },
      dataDir,
    );
    expect(denyWrite.decision).toBe('deny');

    const allowArtifact = evaluatePreToolUse(
      {
        conversationId: convId,
        artifactDirectoryPath: artifactDir,
        toolCall: { name: 'write_file', args: { Path: join(artifactDir, 'plan.md') } },
      },
      dataDir,
    );
    expect(allowArtifact.decision).toBe('allow');

    const allowDiff = evaluatePreToolUse(
      {
        conversationId: convId,
        toolCall: { name: 'run_command', args: { CommandLine: 'git diff main...HEAD' } },
      },
      dataDir,
    );
    expect(allowDiff.decision).toBe('allow');

    // Exact read-only commands observed in real testui runs must be allowed cleanly
    for (const roCmd of [
      'git -C "E:\\testui" status; git -C "E:\\testui" log -n 5 2>&1',
      'cd E:\\testui\\.worktrees\\mod-crwy; node --test tests/filterList.test.mjs',
      'node -v; python --version',
      'git -C E:\\testui status --short; Write-Output "---LOG---"; git -C E:\\testui log --oneline -n 5',
    ]) {
      expect(
        evaluatePreToolUse(
          { conversationId: convId, toolCall: { name: 'run_command', args: { CommandLine: roCmd } } },
          dataDir,
        ).decision,
      ).toBe('allow');
    }

    // Chained mutation hidden after read-only command must still be caught
    expect(
      evaluatePreToolUse(
        {
          conversationId: convId,
          toolCall: { name: 'run_command', args: { CommandLine: 'git status; git -C E:\\testui commit -m "x"' } },
        },
        dataDir,
      ).decision,
    ).toBe('force_ask');

    const askMutate = evaluatePreToolUse(
      {
        conversationId: convId,
        toolCall: { name: 'run_command', args: { CommandLine: 'npm install lodash' } },
      },
      dataDir,
    );
    expect(askMutate.decision).toBe('force_ask');
  });

  it('enforces Worktree write boundary, rewrites run_command cwd, and gates dangerous git commands', () => {
    const convId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    mutateProject(
      repoDir,
      (proj) => {
        const m = createModule(proj, { name: '结果导出', stage: 'Code' });
        m.git = {
          mode: 'worktree',
          inheritFromParent: false,
          branch: 'mod/export',
          worktreePath: wtDir,
          baseBranch: 'main',
          baseCommit: 'abc1234',
        };
        bindSessionToModule(proj, m.id, {
          conversationId: convId,
          title: 'Code',
          stage: 'Code',
          syncedRev: m.rev,
          syncedAncestorHash: computeAncestorAndDepHash(proj, m.id),
          syncedStage: 'Code',
          syncedReviewNotesHash: computeReviewNotesHash(m),
        });
      },
      dataDir,
    );

    const denyMainWrite = evaluatePreToolUse(
      {
        conversationId: convId,
        toolCall: { name: 'edit_file', args: { Path: join(repoDir, 'src/main.ts') } },
      },
      dataDir,
    );
    expect(denyMainWrite.decision).toBe('deny');

    const allowWtWrite = evaluatePreToolUse(
      {
        conversationId: convId,
        toolCall: { name: 'edit_file', args: { Path: join(wtDir, 'src/export.ts') } },
      },
      dataDir,
    );
    expect(allowWtWrite.decision).toBe('allow');

    const rewriteCmd = evaluatePreToolUse(
      {
        conversationId: convId,
        toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } },
      },
      dataDir,
      'win32',
    );
    expect(rewriteCmd.decision).toBe('allow');
    expect(String(rewriteCmd.overwrite?.CommandLine)).toContain('Set-Location -LiteralPath');
    expect(String(rewriteCmd.overwrite?.CommandLine)).toContain(wtDir);

    const askDangerGit = evaluatePreToolUse(
      {
        conversationId: convId,
        toolCall: { name: 'run_command', args: { CommandLine: 'git push --force' } },
      },
      dataDir,
    );
    expect(askDangerGit.decision).toBe('force_ask');
  });

  it('injects drift via PreInvocation once and updates synced markers so next call is silent', () => {
    const convId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    let modId = '';
    mutateProject(
      repoDir,
      (proj) => {
        const m = createModule(proj, { name: '字段选择', design: '初版设计', stage: 'Code' });
        modId = m.id;
        bindSessionToModule(proj, m.id, {
          conversationId: convId,
          title: 'Code',
          stage: 'Code',
          syncedRev: m.rev,
          syncedAncestorHash: computeAncestorAndDepHash(proj, m.id),
          syncedStage: 'Code',
          syncedReviewNotesHash: computeReviewNotesHash(m),
        });
      },
      dataDir,
    );

    // No drift yet
    expect(evaluatePreInvocation({ conversationId: convId }, dataDir)).toEqual({});

    // Simulate external Review rejection + design update
    mutateProject(
      repoDir,
      (proj) => {
        updateModule(proj, modId, { design: '修订版设计：支持自定义分隔符' });
        updateModuleProgress(proj, modId, { reviewNotes: '请修复空数组导出崩溃', allowComplete: false });
        setModuleStage(proj, modId, 'Code');
      },
      dataDir,
    );

    const first = evaluatePreInvocation({ conversationId: convId }, dataDir);
    expect(first.injectSteps?.length).toBe(1);
    expect(first.injectSteps![0].systemMessage.systemMessage).toContain('请修复空数组导出崩溃');
    expect(first.injectSteps![0].systemMessage.systemMessage).toContain('支持自定义分隔符');

    // Second invocation without new changes is silent
    const second = evaluatePreInvocation({ conversationId: convId }, dataDir);
    expect(second).toEqual({});
  });

  it('keeps dedicated Code session writable and undisturbed when user switches module stage to Plan, while Plan session stays read-only', () => {
    const planConv = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const codeConv = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    let modId = '';
    mutateProject(
      repoDir,
      (proj) => {
        const m = createModule(proj, { name: '并行模块', design: '初版设计', stage: 'Code' });
        modId = m.id;
        bindSessionToModule(
          proj,
          m.id,
          {
            conversationId: planConv,
            title: '[Plan] 并行模块',
            stage: 'Plan',
            syncedRev: m.rev,
            syncedAncestorHash: computeAncestorAndDepHash(proj, m.id),
            syncedStage: 'Plan',
            syncedReviewNotesHash: computeReviewNotesHash(m),
          },
          { bindStage: 'Plan', setAsPrimary: true },
        );
        bindSessionToModule(
          proj,
          m.id,
          {
            conversationId: codeConv,
            title: '[Code] 并行模块',
            stage: 'Code',
            syncedRev: m.rev,
            syncedAncestorHash: computeAncestorAndDepHash(proj, m.id),
            syncedStage: 'Code',
            syncedReviewNotesHash: computeReviewNotesHash(m),
          },
          { bindStage: 'Code', setAsPrimary: false },
        );
      },
      dataDir,
    );

    // User clicks Plan in sidebar while Code session is active
    mutateProject(
      repoDir,
      (proj) => {
        setModuleStage(proj, modId, 'Plan');
      },
      dataDir,
    );

    // Code session MUST still be allowed to write files and NOT receive false "switched to Plan" drift
    const codeWrite = evaluatePreToolUse(
      {
        conversationId: codeConv,
        toolCall: { name: 'write_file', args: { Path: join(repoDir, 'src/feature.ts') } },
      },
      dataDir,
    );
    expect(codeWrite.decision).toBe('allow');
    expect(evaluatePreInvocation({ conversationId: codeConv }, dataDir)).toEqual({});

    // Plan session MUST stay read-only even when module stage is Code
    mutateProject(
      repoDir,
      (proj) => {
        setModuleStage(proj, modId, 'Code');
      },
      dataDir,
    );
    const planWrite = evaluatePreToolUse(
      {
        conversationId: planConv,
        toolCall: { name: 'write_file', args: { Path: join(repoDir, 'src/feature.ts') } },
      },
      dataDir,
    );
    expect(planWrite.decision).toBe('deny');
  });

  it('injects full cold-start context on first turn for a freshly bound native session (syncedRev=0)', () => {
    const nativeConv = '12345678-1234-1234-1234-1234567890ab';
    mutateProject(
      repoDir,
      (proj) => {
        const m = createModule(proj, { name: '原生绑定测试', design: '使用原生 grill-me', stage: 'Plan' });
        bindSessionToModule(
          proj,
          m.id,
          {
            conversationId: nativeConv,
            title: '[Plan] 原生绑定测试',
            stage: 'Plan',
            syncedRev: 0,
            syncedAncestorHash: '',
            syncedStage: undefined,
            syncedReviewNotesHash: '',
          },
          { bindStage: 'Plan', setAsPrimary: true },
        );
      },
      dataDir,
    );

    const first = evaluatePreInvocation({ conversationId: nativeConv }, dataDir);
    expect(first.injectSteps?.length).toBe(1);
    expect(first.injectSteps![0].systemMessage.systemMessage).toContain('[modtree: bound');
    expect(first.injectSteps![0].systemMessage.systemMessage).toContain('使用原生 grill-me');
    expect(first.injectSteps![0].systemMessage.systemMessage).toContain('search-first');

    // Second turn must be silent
    expect(evaluatePreInvocation({ conversationId: nativeConv }, dataDir)).toEqual({});
  });
});
