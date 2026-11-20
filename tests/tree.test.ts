import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../src/core/store.js';
import {
  computeChildProgress,
  createModule,
  resolveEffectiveGit,
  setModuleStage,
  updateModule,
  updateModuleProgress,
} from '../src/core/tree.js';

describe('module tree core invariants', () => {
  it('supports 3-level hierarchy, prevents duplicate sibling names, and computes child progress', () => {
    const project = createEmptyProject('/tmp/demo-proj');
    const root = createModule(project, { name: '结果分析' });
    const exp = createModule(project, { name: '结果导出', parentId: root.id });
    const fields = createModule(project, { name: '字段选择', parentId: exp.id });
    const fileGen = createModule(project, { name: '文件生成', parentId: exp.id });

    expect(() => createModule(project, { name: '字段选择', parentId: exp.id })).toThrow(/同名模块/);

    expect(computeChildProgress(project, root.id)).toEqual({ done: 0, total: 3 });
    updateModuleProgress(project, fields.id, { status: '已完成', allowComplete: true });
    expect(computeChildProgress(project, exp.id)).toEqual({ done: 1, total: 2 });
    expect(computeChildProgress(project, root.id)).toEqual({ done: 1, total: 3 });
    expect(fileGen.design).toBeUndefined(); // sparse field omitted
  });

  it('prevents moving a parent module into its own descendant (anti-cycle)', () => {
    const project = createEmptyProject('/tmp/demo-proj');
    const a = createModule(project, { name: 'A' });
    const b = createModule(project, { name: 'B', parentId: a.id });
    const c = createModule(project, { name: 'C', parentId: b.id });

    expect(() => updateModule(project, a.id, { parentId: c.id })).toThrow(/循环嵌套/);
    expect(() => updateModule(project, a.id, { parentId: a.id })).toThrow(/循环嵌套/);

    // Valid reparenting bumps rev
    const prevRev = c.rev;
    updateModule(project, c.id, { parentId: a.id });
    expect(c.parentId).toBe(a.id);
    expect(c.rev).toBe(prevRev + 1);
  });

  it('enforces progress length caps, blocks Agent auto-complete, and auto-clears reviewNotes on complete', () => {
    const project = createEmptyProject('/tmp/demo-proj');
    const m = createModule(project, { name: '字段选择' });

    expect(() =>
      updateModuleProgress(project, m.id, { stop: 'x'.repeat(101), allowComplete: false }),
    ).toThrow(/100 字/);

    expect(() =>
      updateModuleProgress(project, m.id, { status: '已完成', allowComplete: false }),
    ).toThrow(/不能自动将模块标为/);

    updateModuleProgress(project, m.id, {
      status: '待检查',
      reviewNotes: '1. 空数组未拦截\n2. CSV 缺少 BOM',
      allowComplete: false,
    });
    expect(m.reviewNotes).toContain('空数组');

    // Human marking complete clears ephemeral reviewNotes
    updateModuleProgress(project, m.id, { status: '已完成', allowComplete: true });
    expect(m.status).toBe('已完成');
    expect(m.reviewNotes).toBeUndefined();
  });

  it('inherits parent worktree by default unless child opts out', () => {
    const project = createEmptyProject('/tmp/demo-proj');
    const parent = createModule(project, { name: '结果导出' });
    const child = createModule(project, { name: '字段选择', parentId: parent.id });

    parent.git = {
      mode: 'worktree',
      inheritFromParent: false,
      branch: 'mod/export',
      worktreePath: '/tmp/demo-proj/.worktrees/export',
      baseBranch: 'main',
      baseCommit: 'abc1234',
    };

    const eff = resolveEffectiveGit(project, child.id);
    expect(eff.mode).toBe('worktree');
    expect(eff.inheritedFromId).toBe(parent.id);
    expect(eff.worktreePath).toBe('/tmp/demo-proj/.worktrees/export');

    // Moving to Code updates 待设计 -> 开发中
    setModuleStage(project, child.id, 'Code');
    expect(child.stage).toBe('Code');
    expect(child.status).toBe('开发中');

    // Reopening a completed module into Code flips status back to 开发中 while keeping mergedCommit
    child.git = {
      mode: 'main',
      inheritFromParent: true,
      mergedCommit: 'deadbeef1234567',
    };
    updateModuleProgress(project, child.id, { status: '已完成', allowComplete: true });
    expect(child.status).toBe('已完成');
    setModuleStage(project, child.id, 'Code');
    expect(child.status).toBe('开发中');
    expect(child.git?.mergedCommit).toBe('deadbeef1234567');
  });
});
