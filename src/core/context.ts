import { createHash } from 'node:crypto';
import { detectCppStack, formatStageSkillsPrompt } from './skills.js';
import {
  getAncestors,
  getChildren,
  getModulePathString,
  getSiblings,
  resolveEffectiveGit,
} from './tree.js';
import {
  DriftSummary,
  ModuleNode,
  ModuleStage,
  ProjectState,
  SessionRecord,
} from './types.js';

function shortHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

export function computeReviewNotesHash(mod: ModuleNode): string {
  return shortHash(mod.reviewNotes || '');
}

/**
 * Combines ancestor design constraints + cross-subtree dependsOn summaries into one stable hash.
 */
export function computeAncestorAndDepHash(project: ProjectState, moduleId: string): string {
  const mod = project.modules[moduleId];
  if (!mod) return '';
  const ancestors = getAncestors(project, moduleId).map((a) => ({
    id: a.id,
    name: a.name,
    design: a.design || '',
    rev: a.rev,
  }));
  const deps = (mod.dependsOn || [])
    .map((id) => project.modules[id])
    .filter((m): m is ModuleNode => Boolean(m && !m.archived))
    .map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      design: d.design || '',
      rev: d.rev,
    }));
  return shortHash(JSON.stringify({ ancestors, deps }));
}

export function detectSessionDrift(
  project: ProjectState,
  moduleId: string,
  session: SessionRecord | undefined,
): DriftSummary {
  const mod = project.modules[moduleId];
  if (!mod || !session) return { outdated: false, reasons: [] };

  const reasons: string[] = [];
  if ((session.syncedRev || 0) < (mod.rev || 1)) {
    reasons.push('本模块设计/关联文件已更新');
  }
  const curAncHash = computeAncestorAndDepHash(project, moduleId);
  if (session.syncedAncestorHash && session.syncedAncestorHash !== curAncHash) {
    reasons.push('父模块约束或依赖模块设计已更新');
  }
  if (session.syncedStage && session.syncedStage !== mod.stage) {
    reasons.push(`阶段已切换为 ${mod.stage}`);
  }
  const curReviewHash = computeReviewNotesHash(mod);
  if (
    mod.reviewNotes &&
    session.syncedReviewNotesHash !== undefined &&
    session.syncedReviewNotesHash !== curReviewHash
  ) {
    reasons.push('收到新的 Review 返工问题清单');
  }

  return {
    outdated: reasons.length > 0,
    reasons,
  };
}

export interface BuildPromptOptions {
  stage?: ModuleStage;
  sessionTitle?: string;
  previousReplySnippet?: string;
  userNote?: string;
  mergeBase?: string;
}

/**
 * 4-layer funnel cold-start prompt (~300-500 chars core + concise git/handoff info).
 */
export function buildColdStartPrompt(
  project: ProjectState,
  moduleId: string,
  options: BuildPromptOptions = {},
): string {
  const mod = project.modules[moduleId];
  if (!mod) throw new Error(`模块不存在: ${moduleId}`);

  const stage = options.stage || mod.stage;
  const pathStr = getModulePathString(project, moduleId);
  const ancestors = getAncestors(project, moduleId).filter((a) => Boolean(a.design));
  const deps = (mod.dependsOn || [])
    .map((id) => project.modules[id])
    .filter((m): m is ModuleNode => Boolean(m && !m.archived));
  const siblings = getSiblings(project, moduleId);
  const children = getChildren(project, moduleId, false);
  const effGit = resolveEffectiveGit(project, moduleId);

  const lines: string[] = [];
  lines.push(
    `[modtree: bound project=${project.workspacePath} module=${mod.id} stage=${stage}]`,
  );
  lines.push(`模块路径：${pathStr}（状态：${mod.status}，当前阶段：${stage}）`);
  if (options.sessionTitle?.trim()) {
    lines.push(`本次改动主题：${options.sessionTitle.trim()}`);
  }

  if (ancestors.length > 0) {
    lines.push('上级约束（祖先设计摘要）：');
    for (const a of ancestors) {
      lines.push(`- ${a.name}：${a.design}`);
    }
  }

  lines.push(`当前模块设计：${mod.design || '（暂未填写，可在 Plan 阶段沉淀）'}`);

  if (mod.stop || mod.next) {
    lines.push(`上次进度：停在「${mod.stop || '无'}」；下一步「${mod.next || '无'}」`);
  }

  if (mod.reviewNotes) {
    lines.push(`⚠️ 待处理 Review 返工清单：\n${mod.reviewNotes}`);
  }

  if (mod.linkedFiles && mod.linkedFiles.length > 0) {
    lines.push(`关联代码文件：${mod.linkedFiles.join(', ')}`);
  }

  if (effGit.mode === 'worktree' && effGit.worktreePath) {
    lines.push(
      `Git 工作目录（Worktree${effGit.inheritedFromName ? `，继承自「${effGit.inheritedFromName}」` : ''}）：${effGit.worktreePath}（分支：${effGit.branch || '-'}，基线：${effGit.baseBranch || 'main'}）`,
    );
  } else {
    lines.push(
      `Git 工作目录（主目录）：${effGit.workingDir}${effGit.baseCommit ? `（基线 commit：${effGit.baseCommit.slice(0, 7)}）` : ''}`,
    );
  }

  if (deps.length > 0) {
    lines.push('跨子树依赖参考（仅摘要，勿越界修改）：');
    for (const d of deps) {
      lines.push(`- ${d.name} [${d.status}]：${d.design || '无设计摘要'}`);
    }
  }

  if (siblings.length > 0) {
    lines.push(
      `同级模块参考（勿越界修改）：${siblings.map((s) => `${s.name}（${s.status}）`).join('、')}`,
    );
  }
  if (children.length > 0) {
    lines.push(
      `子模块目录：${children.map((c) => `${c.name}（${c.status}）`).join('、')}`,
    );
  }

  if (options.previousReplySnippet) {
    lines.push(`上一会话末条结论接力：${options.previousReplySnippet}`);
  }

  // Stage-specific instructions
  if (stage === 'Plan') {
    lines.push(
      '阶段规则（Plan 只读）：聚焦目标、约束、接口与验收要点，沉淀进 design；不要修改源码文件。',
    );
  } else if (stage === 'Code') {
    lines.push(
      `阶段规则（Code）：代码以磁盘最新文件为准，动手前先重读相关文件；${effGit.mode === 'worktree' ? `严格只在 ${effGit.worktreePath} 内读写。` : '注意不要改动无关模块文件。'}日常迭代与小改动可直接在本会话跑测试或调用只读子代理（如 code-reviewer）自查自修，无需频繁切换 Review；里程碑收尾标 待检查 前建议按 verification-loop 跑 6 步验证闭环；本轮完成后自动调用 modtree_update_progress 回写精简停在/下一步。`,
    );
  } else if (stage === 'Review') {
    const diffHint =
      effGit.mode === 'worktree' && effGit.baseBranch
        ? `优先在 ${effGit.worktreePath} 执行 git diff ${effGit.baseBranch}...HEAD 与未提交改动审查${options.mergeBase ? `（merge-base: ${options.mergeBase.slice(0, 7)}）` : ''}`
        : `结合 ${effGit.baseCommit ? `git diff ${effGit.baseCommit.slice(0, 7)}..HEAD、` : ''}未提交 git diff 与 linkedFiles 审查`;
    lines.push(
      `阶段规则（Review 合并前独立终审 · 只读）：对照设计要点与验收条件进行终审把关（${diffHint}）。禁止直接改源码；若发现阻塞问题请调用 modtree_update_progress 将具体问题清单写入 reviewNotes 并提示用户点「回 Code 修复」；审查通过则传 clearReviewNotes=true。`,
    );
  }

  const cppStack = detectCppStack({
    workspacePath: project.workspacePath,
    workingDir: effGit.workingDir,
    linkedFiles: mod.linkedFiles,
    moduleName: mod.name,
    slug: mod.id,
  });
  lines.push(formatStageSkillsPrompt(stage, { cppStack }));

  lines.push('提示：如需其他模块详情，请按需调用 modtree_get_module / modtree_get_tree。');

  if (options.userNote?.trim()) {
    lines.push(`本次指令：${options.userNote.trim()}`);
  }

  return lines.join('\n');
}

/**
 * Incremental system message injected by PreInvocation hook on drift (zero wasted LLM turns).
 */
export function buildDriftInjectionMessage(
  project: ProjectState,
  moduleId: string,
  session: SessionRecord,
): string | null {
  const mod = project.modules[moduleId];
  if (!mod) return null;
  const drift = detectSessionDrift(project, moduleId, session);
  if (!drift.outdated) return null;

  const effGit = resolveEffectiveGit(project, moduleId);
  const pathStr = getModulePathString(project, moduleId);
  const lines: string[] = [
    `[modtree 上下文增量同步] 模块「${pathStr}」(${mod.id}) 在外部发生更新：${drift.reasons.join('；')}。`,
    `当前阶段：${mod.stage} | 状态：${mod.status} | 工作目录：${effGit.workingDir}${effGit.branch ? ` (${effGit.branch})` : ''}`,
  ];

  if ((session.syncedRev || 0) < (mod.rev || 1)) {
    lines.push(`最新设计：${mod.design || '（空）'}`);
    if (mod.linkedFiles?.length) {
      lines.push(`关联文件：${mod.linkedFiles.join(', ')}`);
    }
  }

  const curAncHash = computeAncestorAndDepHash(project, moduleId);
  if (session.syncedAncestorHash !== curAncHash) {
    const ancestors = getAncestors(project, moduleId).filter((a) => Boolean(a.design));
    if (ancestors.length) {
      lines.push('最新上级约束：');
      for (const a of ancestors) lines.push(`- ${a.name}：${a.design}`);
    }
    const deps = (mod.dependsOn || [])
      .map((id) => project.modules[id])
      .filter((m): m is ModuleNode => Boolean(m && !m.archived));
    if (deps.length) {
      lines.push('最新依赖模块摘要：');
      for (const d of deps) lines.push(`- ${d.name} [${d.status}]：${d.design || '无'}`);
    }
  }

  if (mod.reviewNotes) {
    lines.push(`⚠️ Review 返工问题清单（请优先按此修复）：\n${mod.reviewNotes}`);
  }

  if (session.syncedStage && session.syncedStage !== mod.stage) {
    if (mod.stage === 'Plan') {
      lines.push('门禁提示：已切换为 Plan 只读规划阶段，禁止修改工作区代码。');
    } else if (mod.stage === 'Code') {
      lines.push(
        `门禁提示：已切换为 Code 编码阶段，请以磁盘最新代码为准${effGit.mode === 'worktree' ? `并在 ${effGit.worktreePath} 内操作` : ''}。`,
      );
    } else if (mod.stage === 'Review') {
      lines.push(
        `门禁提示：已切换为 Review 只读审查阶段，请基于 ${effGit.mode === 'worktree' && effGit.baseBranch ? `git diff ${effGit.baseBranch}...HEAD` : 'baseCommit/未提交改动与 linkedFiles'} 审查；发现问题写入 reviewNotes。`,
      );
    }
    const cppStack = detectCppStack({
      workspacePath: project.workspacePath,
      workingDir: effGit.workingDir,
      linkedFiles: mod.linkedFiles,
      moduleName: mod.name,
      slug: mod.id,
    });
    lines.push(formatStageSkillsPrompt(mod.stage, { cppStack, compact: true }));
  }

  return lines.join('\n');
}
