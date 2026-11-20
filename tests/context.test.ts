import { describe, expect, it } from 'vitest';
import {
  buildBootstrapPrompt,
  buildColdStartPrompt,
  buildDriftInjectionMessage,
  computeAncestorAndDepHash,
  computeReviewNotesHash,
  detectSessionDrift,
} from '../src/core/context.js';
import { createEmptyProject } from '../src/core/store.js';
import {
  bindSessionToModule,
  createModule,
  setModuleStage,
  updateModule,
  updateModuleProgress,
} from '../src/core/tree.js';

describe('4-layer context & drift detection', () => {
  it('builds funnel cold-start prompt with ancestors, dependsOn summaries, siblings, and Review diff hint', () => {
    const project = createEmptyProject('/tmp/demo-proj');
    const parent = createModule(project, {
      name: '结果导出',
      design: '统一 CSV UTF-8 BOM 编码',
    });
    const dep = createModule(project, {
      name: '实验数据模型',
      design: '字段 schema 定义在 src/model.ts',
    });
    const sibling = createModule(project, { name: '文件生成', parentId: parent.id });
    const child = createModule(project, {
      name: '字段选择',
      parentId: parent.id,
      design: '至少保留一个字段，保持勾选顺序',
      dependsOn: [dep.id],
    });
    parent.git = {
      mode: 'worktree',
      inheritFromParent: false,
      branch: 'mod/export',
      worktreePath: '/tmp/demo-proj/.worktrees/export',
      baseBranch: 'main',
      baseCommit: '1111111',
    };

    const prompt = buildColdStartPrompt(project, child.id, {
      stage: 'Review',
      sessionTitle: '合并前独立终审',
      previousReplySnippet: '已完成字段勾选 UI 与顺序绑定。',
      mergeBase: '2222222deadbeef',
    });

    expect(prompt).toContain(`[modtree: bound project=${project.workspacePath} module=${child.id} stage=Review]`);
    expect(prompt).toContain('本次改动主题：合并前独立终审');
    expect(prompt).toContain('统一 CSV UTF-8 BOM 编码');
    expect(prompt).toContain('实验数据模型');
    expect(prompt).toContain(sibling.name);
    expect(prompt).toContain('git diff main...HEAD');
    expect(prompt).toContain('2222222');
    expect(prompt).toContain('已完成字段勾选 UI');

    const codePrompt = buildColdStartPrompt(project, child.id, {
      stage: 'Code',
      sessionTitle: '修中文乱码',
    });
    expect(codePrompt).toContain('本次改动主题：修中文乱码');
    expect(codePrompt).toContain('只读子代理');
    expect(codePrompt).toContain('tdd-workflow');
    expect(codePrompt).toContain('verification-loop');
    expect(codePrompt).not.toContain('cpp-coding-standards');

    // Review cold-start prompt gets Review skills
    expect(prompt).toContain('security-review');
    expect(prompt).toContain('api-design');
    expect(prompt).not.toContain('tdd-workflow');

    // Plan cold-start prompt gets Plan skills
    const planPrompt = buildColdStartPrompt(project, child.id, { stage: 'Plan' });
    expect(planPrompt).toContain('search-first');
    expect(planPrompt).toContain('hexagonal-architecture');
    expect(planPrompt).not.toContain('tdd-workflow');
  });

  it('injects compact stage skills when PreInvocation detects a stage switch', () => {
    const project = createEmptyProject('/tmp/demo-proj');
    const mod = createModule(project, {
      name: 'ESP32 蓝牙固件',
      slug: 'esp32-ble',
      stage: 'Plan',
    });
    bindSessionToModule(project, mod.id, {
      conversationId: '22222222-2222-2222-2222-222222222222',
      title: 'Plan',
      stage: 'Plan',
      syncedRev: mod.rev,
      syncedAncestorHash: computeAncestorAndDepHash(project, mod.id),
      syncedStage: 'Plan',
      syncedReviewNotesHash: computeReviewNotesHash(mod),
    });
    const rec = mod.sessions![0];
    setModuleStage(project, mod.id, 'Code');
    const injected = buildDriftInjectionMessage(project, mod.id, rec);
    expect(injected).toContain('已切换为 Code 编码阶段');
    expect(injected).toContain('tdd-workflow');
    expect(injected).toContain('cpp-coding-standards');
    expect(injected).toContain('cpp-testing');
  });

  it('detects drift when ancestor design, dependsOn design, stage, or reviewNotes changes', () => {
    const project = createEmptyProject('/tmp/demo-proj');
    const parent = createModule(project, { name: '结果导出', design: '仅支持 CSV' });
    const child = createModule(project, {
      name: '字段选择',
      parentId: parent.id,
      design: '保留顺序',
      stage: 'Code',
    });

    bindSessionToModule(project, child.id, {
      conversationId: '11111111-1111-1111-1111-111111111111',
      title: 'Code',
      stage: 'Code',
      syncedRev: child.rev,
      syncedAncestorHash: computeAncestorAndDepHash(project, child.id),
      syncedStage: 'Code',
      syncedReviewNotesHash: computeReviewNotesHash(child),
    });

    const rec = child.sessions![0];
    expect(detectSessionDrift(project, child.id, rec).outdated).toBe(false);

    // Update parent constraint + add reviewNotes + switch stage
    updateModule(project, parent.id, { design: '同时支持 CSV 与 JSON' });
    updateModuleProgress(project, child.id, { reviewNotes: '缺少空数组校验', allowComplete: false });
    setModuleStage(project, child.id, 'Code');

    const drift = detectSessionDrift(project, child.id, rec);
    expect(drift.outdated).toBe(true);
    expect(drift.reasons.length).toBeGreaterThanOrEqual(2);

    const injected = buildDriftInjectionMessage(project, child.id, rec);
    expect(injected).toContain('同时支持 CSV 与 JSON');
    expect(injected).toContain('缺少空数组校验');
  });

  it('builds native bootstrap prompt with readable title line and optional Plan Grill-me interview', () => {
    const project = createEmptyProject('/tmp/demo-proj');
    const mod = createModule(project, { name: '列表筛选', slug: 'filter-list', stage: 'Plan' });
    const prompt = buildBootstrapPrompt(project, mod.id, {
      stage: 'Plan',
      sessionTitle: '首版交互设计',
      grillMe: true,
    });
    const lines = prompt.split('\n');
    expect(lines[0]).toBe('[Plan] 列表筛选 · 首版交互设计');
    expect(prompt).toContain('modtree_bind_session');
    expect(prompt).toContain('"filter-list"');
    expect(prompt).toContain('ask_question');
  });

  it('injects full cold-start context on first turn when syncedRev is 0 and includes stop/next on subsequent rev bumps', () => {
    const project = createEmptyProject('/tmp/demo-proj');
    const mod = createModule(project, { name: '导出模块', design: '初版 CSV 导出', stage: 'Code' });
    bindSessionToModule(project, mod.id, {
      conversationId: '33333333-3333-3333-3333-333333333333',
      title: '[Code] 导出模块',
      stage: 'Code',
      syncedRev: 0,
      syncedAncestorHash: '',
      syncedStage: undefined,
      syncedReviewNotesHash: '',
    });
    const rec = mod.sessions![0];
    const firstMsg = buildDriftInjectionMessage(project, mod.id, rec);
    expect(firstMsg).toContain(`[modtree: bound project=${project.workspacePath} module=${mod.id} stage=Code]`);
    expect(firstMsg).toContain('tdd-workflow');

    // Simulate synced then Plan updates design + stop/next
    rec.syncedRev = mod.rev;
    rec.syncedAncestorHash = computeAncestorAndDepHash(project, mod.id);
    rec.syncedStage = 'Code';
    rec.syncedReviewNotesHash = computeReviewNotesHash(mod);

    updateModule(project, mod.id, { design: '新版：增加 JSON 导出' });
    updateModuleProgress(project, mod.id, { stop: 'Plan 已定稿', next: '实现 JSON 序列化', allowComplete: false });
    const deltaMsg = buildDriftInjectionMessage(project, mod.id, rec);
    expect(deltaMsg).toContain('新版：增加 JSON 导出');
    expect(deltaMsg).toContain('实现 JSON 序列化');
  });
});
