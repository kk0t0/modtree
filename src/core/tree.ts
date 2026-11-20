import {
  ChildProgressSummary,
  EffectiveGitInfo,
  MODULE_STAGES,
  MODULE_STATUSES,
  ModuleNode,
  ModuleStage,
  ModuleStatus,
  ProjectState,
  SessionRecord,
} from './types.js';

export const MAX_PROGRESS_LEN = 100;
export const MAX_MCP_DESIGN_LEN = 800;

export function slugifyModuleId(
  name: string,
  existing: Record<string, ModuleNode>,
  preferredSlug?: string,
): string {
  const fromPreferred = (preferredSlug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base =
    fromPreferred ||
    (ascii && /^[a-z0-9-]+$/.test(ascii)
      ? ascii.slice(0, 28)
      : `mod-${Date.now().toString(36).slice(-4)}`);
  let candidate = base || 'mod';
  let i = 2;
  while (existing[candidate]) {
    candidate = `${base}-${i++}`;
  }
  return candidate;
}

/**
 * Remove empty optional fields to keep module JSON sparse and lean.
 */
export function pruneSparseFields(node: ModuleNode): ModuleNode {
  if (!node.design?.trim()) delete node.design;
  if (!node.stop?.trim()) delete node.stop;
  if (!node.next?.trim()) delete node.next;
  if (!node.reviewNotes?.trim()) delete node.reviewNotes;
  if (!node.linkedFiles?.length) delete node.linkedFiles;
  if (!node.dependsOn?.length) delete node.dependsOn;
  if (!node.activeSessionId) delete node.activeSessionId;
  if (node.stageSessions && Object.keys(node.stageSessions).length === 0) {
    delete node.stageSessions;
  }
  if (!node.sessions?.length) delete node.sessions;
  if (!node.archived) delete node.archived;
  return node;
}

export function getAncestors(project: ProjectState, moduleId: string): ModuleNode[] {
  const chain: ModuleNode[] = [];
  const seen = new Set<string>();
  let cur = project.modules[moduleId];
  while (cur?.parentId) {
    if (seen.has(cur.parentId)) break;
    seen.add(cur.parentId);
    const parent = project.modules[cur.parentId];
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  return chain;
}

export function getModulePathString(project: ProjectState, moduleId: string): string {
  const mod = project.modules[moduleId];
  if (!mod) return '';
  const ancestors = getAncestors(project, moduleId);
  return [...ancestors.map((a) => a.name), mod.name].join(' / ');
}

export function getChildren(project: ProjectState, parentId: string | null, includeArchived = false): ModuleNode[] {
  return Object.values(project.modules)
    .filter((m) => m.parentId === parentId && (includeArchived || !m.archived))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function getSiblings(project: ProjectState, moduleId: string): ModuleNode[] {
  const mod = project.modules[moduleId];
  if (!mod) return [];
  return getChildren(project, mod.parentId, false).filter((m) => m.id !== moduleId);
}

export function getDescendants(project: ProjectState, moduleId: string, includeArchived = false): ModuleNode[] {
  const out: ModuleNode[] = [];
  const queue = getChildren(project, moduleId, includeArchived);
  const seen = new Set<string>();
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur.id)) continue;
    seen.add(cur.id);
    out.push(cur);
    queue.push(...getChildren(project, cur.id, includeArchived));
  }
  return out;
}

export function computeChildProgress(project: ProjectState, moduleId: string): ChildProgressSummary {
  const kids = getDescendants(project, moduleId, false);
  const done = kids.filter((k) => k.status === '已完成').length;
  return { done, total: kids.length };
}

export function isDescendantOf(project: ProjectState, candidateId: string, ancestorId: string): boolean {
  if (candidateId === ancestorId) return true;
  const ancestors = getAncestors(project, candidateId);
  return ancestors.some((a) => a.id === ancestorId);
}

export function resolveEffectiveGit(project: ProjectState, moduleId: string): EffectiveGitInfo {
  const mod = project.modules[moduleId];
  const fallback: EffectiveGitInfo = {
    mode: 'main',
    workingDir: project.workspacePath,
  };
  if (!mod) return fallback;

  if (mod.git?.mode === 'worktree' && mod.git.worktreePath) {
    return {
      mode: 'worktree',
      branch: mod.git.branch,
      worktreePath: mod.git.worktreePath,
      workingDir: mod.git.worktreePath,
      baseBranch: mod.git.baseBranch,
      baseCommit: mod.git.baseCommit,
      mergedCommit: mod.git.mergedCommit,
    };
  }

  // Child inherits nearest worktree-enabled ancestor unless explicitly opted out
  const shouldInherit = mod.git ? mod.git.inheritFromParent !== false : true;
  if (shouldInherit && mod.parentId) {
    const ancestors = getAncestors(project, moduleId).reverse();
    for (const anc of ancestors) {
      if (anc.git?.mode === 'worktree' && anc.git.worktreePath) {
        return {
          mode: 'worktree',
          inheritedFromId: anc.id,
          inheritedFromName: anc.name,
          branch: anc.git.branch,
          worktreePath: anc.git.worktreePath,
          workingDir: anc.git.worktreePath,
          baseBranch: anc.git.baseBranch,
          baseCommit: anc.git.baseCommit,
          mergedCommit: anc.git.mergedCommit,
        };
      }
    }
  }

  return {
    mode: 'main',
    workingDir: project.workspacePath,
    branch: mod.git?.branch,
    baseBranch: mod.git?.baseBranch,
    baseCommit: mod.git?.baseCommit,
    mergedCommit: mod.git?.mergedCommit,
  };
}

export function resolveStageSessionId(mod: ModuleNode, stage: ModuleStage = mod.stage): string {
  const pinned = mod.stageSessions?.[stage];
  if (pinned) return pinned;
  const stageRec = (mod.sessions || []).find((s) => !s.archived && s.stage === stage);
  if (stageRec) return stageRec.conversationId;
  return mod.activeSessionId || '';
}

export function buildStageSessionMap(
  mod: ModuleNode,
): Record<ModuleStage, { conversationId: string; dedicated: boolean }> {
  const primary = mod.activeSessionId || '';
  const activeSessions = (mod.sessions || []).filter((s) => !s.archived);
  const map = {} as Record<ModuleStage, { conversationId: string; dedicated: boolean }>;
  for (const st of MODULE_STAGES) {
    const pinned = mod.stageSessions?.[st];
    const stageRec = activeSessions.find((s) => s.stage === st)?.conversationId;
    const explicit = pinned || stageRec || '';
    const cid = explicit || primary;
    map[st] = {
      conversationId: cid,
      dedicated: Boolean(pinned || (explicit && primary && explicit !== primary)),
    };
  }
  return map;
}

/**
 * Resolves the effective gating stage for a specific bound session.
 * - Multi-stage modules (active sessions across >=2 stages): each session obeys its own stage
 *   so inspecting/working in Plan/Review never interrupts a running Code session,
 *   and Plan/Review chats never accidentally gain write permission.
 * - Dedicated Code/Review sessions pinned in stageSessions always keep their own stage.
 * - Single-session modules (e.g. one session upgraded Plan -> Code -> Review) continue to
 *   follow mod.stage seamlessly.
 */
export function resolveSessionEffectiveStage(
  mod: ModuleNode,
  session: SessionRecord | undefined,
): ModuleStage {
  if (!session) return mod.stage;
  const activeSessions = (mod.sessions || []).filter((s) => !s.archived);
  const distinctStages = new Set(activeSessions.map((s) => s.stage));

  if (mod.stageSessions?.Code === session.conversationId) {
    return 'Code';
  }
  if (mod.stageSessions?.Review === session.conversationId) {
    return 'Review';
  }
  if (mod.stageSessions?.Plan === session.conversationId && distinctStages.size > 1) {
    return 'Plan';
  }
  if (distinctStages.size > 1) {
    return session.stage;
  }
  return mod.stage;
}

export interface CreateModuleInput {
  name: string;
  slug?: string;
  parentId?: string | null;
  design?: string;
  dependsOn?: string[];
  stage?: ModuleStage;
  status?: ModuleStatus;
  updatedBy?: string;
}

export function createModule(project: ProjectState, input: CreateModuleInput): ModuleNode {
  const name = input.name.trim();
  if (!name) throw new Error('模块名称不能为空');

  const parentId = input.parentId ?? null;
  if (parentId !== null && !project.modules[parentId]) {
    throw new Error(`父模块不存在: ${parentId}`);
  }

  const siblings = getChildren(project, parentId, false);
  const dup = siblings.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (dup) {
    throw new Error(`同级已存在同名模块「${dup.name}」(${dup.id})，请直接复用或换名`);
  }

  const id = slugifyModuleId(name, project.modules, input.slug);
  const maxOrder = siblings.reduce((acc, s) => Math.max(acc, s.order), -1);

  const dependsOn = (input.dependsOn || []).filter((depId) => depId !== id && Boolean(project.modules[depId]));

  const node: ModuleNode = {
    id,
    parentId,
    order: maxOrder + 1,
    name,
    status: input.status && MODULE_STATUSES.includes(input.status) ? input.status : '待设计',
    stage: input.stage && MODULE_STAGES.includes(input.stage) ? input.stage : 'Plan',
    rev: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy || 'user',
  };

  if (input.design?.trim()) node.design = input.design.trim();
  if (dependsOn.length > 0) node.dependsOn = Array.from(new Set(dependsOn));

  pruneSparseFields(node);
  project.modules[id] = node;
  if (parentId) {
    project.expandedIds = project.expandedIds || {};
    project.expandedIds[parentId] = true;
  }
  if (!project.selectedModuleId) {
    project.selectedModuleId = id;
  }
  return node;
}

export interface UpdateModuleInput {
  name?: string;
  parentId?: string | null;
  design?: string;
  linkedFiles?: string[];
  dependsOn?: string[];
  updatedBy?: string;
}

export function updateModule(project: ProjectState, moduleId: string, input: UpdateModuleInput): ModuleNode {
  const mod = project.modules[moduleId];
  if (!mod) throw new Error(`模块不存在: ${moduleId}`);

  let bumpRev = false;

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error('模块名称不能为空');
    if (trimmed !== mod.name) {
      mod.name = trimmed;
    }
  }

  if (input.parentId !== undefined && input.parentId !== mod.parentId) {
    const nextParent = input.parentId;
    if (nextParent !== null) {
      if (!project.modules[nextParent]) throw new Error(`目标父模块不存在: ${nextParent}`);
      if (isDescendantOf(project, nextParent, moduleId)) {
        throw new Error(`不能将模块「${mod.name}」移动到自身或其子模块下（循环嵌套）`);
      }
    }
    mod.parentId = nextParent;
    const siblings = getChildren(project, nextParent, false).filter((s) => s.id !== moduleId);
    mod.order = siblings.reduce((acc, s) => Math.max(acc, s.order), -1) + 1;
    bumpRev = true;
  }

  if (input.design !== undefined) {
    const nextDesign = input.design.trim();
    if (nextDesign !== (mod.design || '')) {
      mod.design = nextDesign || undefined;
      bumpRev = true;
    }
  }

  if (input.linkedFiles !== undefined) {
    const cleaned = Array.from(
      new Set(input.linkedFiles.map((f) => f.trim().replace(/\\/g, '/')).filter(Boolean)),
    );
    const prev = mod.linkedFiles || [];
    if (JSON.stringify(cleaned) !== JSON.stringify(prev)) {
      mod.linkedFiles = cleaned.length ? cleaned : undefined;
      bumpRev = true;
    }
  }

  if (input.dependsOn !== undefined) {
    const cleaned = Array.from(
      new Set(
        input.dependsOn
          .map((d) => d.trim())
          .filter((d) => d && d !== moduleId && Boolean(project.modules[d])),
      ),
    );
    const prev = mod.dependsOn || [];
    if (JSON.stringify(cleaned) !== JSON.stringify(prev)) {
      mod.dependsOn = cleaned.length ? cleaned : undefined;
      bumpRev = true;
    }
  }

  if (bumpRev) {
    mod.rev = (mod.rev || 1) + 1;
  }
  mod.updatedAt = new Date().toISOString();
  mod.updatedBy = input.updatedBy || 'user';
  return pruneSparseFields(mod);
}

export interface UpdateProgressInput {
  stop?: string;
  next?: string;
  status?: ModuleStatus;
  linkedFiles?: string[];
  reviewNotes?: string;
  clearReviewNotes?: boolean;
  allowComplete?: boolean; // false for Agent MCP calls unless explicitly confirmed
  updatedBy?: string;
}

export function updateModuleProgress(
  project: ProjectState,
  moduleId: string,
  input: UpdateProgressInput,
): ModuleNode {
  const mod = project.modules[moduleId];
  if (!mod) throw new Error(`模块不存在: ${moduleId}`);

  if (input.stop !== undefined) {
    const s = input.stop.trim();
    if (s.length > MAX_PROGRESS_LEN) {
      throw new Error(`stop 超过 ${MAX_PROGRESS_LEN} 字上限（当前 ${s.length} 字），请精简后重试`);
    }
    mod.stop = s || undefined;
  }

  if (input.next !== undefined) {
    const n = input.next.trim();
    if (n.length > MAX_PROGRESS_LEN) {
      throw new Error(`next 超过 ${MAX_PROGRESS_LEN} 字上限（当前 ${n.length} 字），请精简后重试`);
    }
    mod.next = n || undefined;
  }

  if (input.status !== undefined) {
    if (!MODULE_STATUSES.includes(input.status)) {
      throw new Error(`非法状态: ${input.status}`);
    }
    if (input.status === '已完成' && !input.allowComplete) {
      throw new Error('Agent 不能自动将模块标为「已完成」，最高可设为「待检查」，由用户在侧栏确认完成');
    }
    mod.status = input.status;
    if (input.status === '已完成') {
      // Auto-clear ephemeral reviewNotes when module finishes
      delete mod.reviewNotes;
    }
  }

  if (input.linkedFiles !== undefined) {
    const merged = Array.from(
      new Set([
        ...(mod.linkedFiles || []),
        ...input.linkedFiles.map((f) => f.trim().replace(/\\/g, '/')).filter(Boolean),
      ]),
    );
    if (JSON.stringify(merged) !== JSON.stringify(mod.linkedFiles || [])) {
      mod.linkedFiles = merged.length ? merged : undefined;
      mod.rev = (mod.rev || 1) + 1;
    }
  }

  if (input.clearReviewNotes) {
    delete mod.reviewNotes;
  } else if (input.reviewNotes !== undefined) {
    const rn = input.reviewNotes.trim();
    mod.reviewNotes = rn || undefined;
  }

  mod.updatedAt = new Date().toISOString();
  mod.updatedBy = input.updatedBy || 'user';
  return pruneSparseFields(mod);
}

export function setModuleStage(
  project: ProjectState,
  moduleId: string,
  stage: ModuleStage,
  updatedBy = 'user',
): ModuleNode {
  const mod = project.modules[moduleId];
  if (!mod) throw new Error(`模块不存在: ${moduleId}`);
  if (!MODULE_STAGES.includes(stage)) {
    throw new Error(`非法阶段: ${stage}`);
  }
  mod.stage = stage;
  if (stage === 'Code' && (mod.status === '待设计' || mod.status === '已完成')) {
    mod.status = '开发中';
  }
  mod.updatedAt = new Date().toISOString();
  mod.updatedBy = updatedBy;
  return pruneSparseFields(mod);
}

export function archiveModule(project: ProjectState, moduleId: string, updatedBy = 'user'): {
  node: ModuleNode;
  warning?: string;
} {
  const mod = project.modules[moduleId];
  if (!mod) throw new Error(`模块不存在: ${moduleId}`);
  mod.archived = true;
  mod.updatedAt = new Date().toISOString();
  mod.updatedBy = updatedBy;

  const warning =
    mod.git?.mode === 'worktree' && mod.git.worktreePath && !mod.git.mergedCommit
      ? `注意：模块「${mod.name}」仍关联未合并的 Worktree (${mod.git.worktreePath})，请确认后清理。`
      : undefined;

  if (project.selectedModuleId === moduleId) {
    const next = Object.values(project.modules).find((m) => !m.archived);
    project.selectedModuleId = next?.id;
  }
  return { node: mod, warning };
}

export function bindSessionToModule(
  project: ProjectState,
  moduleId: string,
  record: Omit<SessionRecord, 'createdAt'> & { createdAt?: string },
  options: { setAsPrimary?: boolean; bindStage?: ModuleStage } = {},
): ModuleNode {
  const mod = project.modules[moduleId];
  if (!mod) throw new Error(`模块不存在: ${moduleId}`);

  const convId = record.conversationId.trim();
  if (!convId) throw new Error('conversationId 不能为空');

  mod.sessions = mod.sessions || [];
  const existing = mod.sessions.find((s) => s.conversationId === convId);
  if (existing) {
    existing.title = record.title || existing.title;
    existing.stage = record.stage || existing.stage;
    existing.syncedRev = record.syncedRev;
    existing.syncedAncestorHash = record.syncedAncestorHash;
    existing.syncedStage = record.syncedStage ?? record.stage;
    existing.syncedReviewNotesHash = record.syncedReviewNotesHash;
    existing.archived = false;
  } else {
    mod.sessions.unshift({
      conversationId: convId,
      title: record.title || mod.name,
      stage: record.stage,
      createdAt: record.createdAt || new Date().toISOString(),
      syncedRev: record.syncedRev,
      syncedAncestorHash: record.syncedAncestorHash,
      syncedStage: record.syncedStage ?? record.stage,
      syncedReviewNotesHash: record.syncedReviewNotesHash,
    });
  }

  if (options.setAsPrimary !== false || !mod.activeSessionId) {
    mod.activeSessionId = convId;
  }
  if (options.bindStage) {
    mod.stageSessions = mod.stageSessions || {};
    mod.stageSessions[options.bindStage] = convId;
  }

  mod.updatedAt = new Date().toISOString();
  mod.updatedBy = 'bind-session';
  return pruneSparseFields(mod);
}

export function unbindSessionFromModule(
  project: ProjectState,
  moduleId: string,
  conversationId?: string,
): ModuleNode {
  const mod = project.modules[moduleId];
  if (!mod) throw new Error(`模块不存在: ${moduleId}`);

  if (!conversationId) {
    delete mod.activeSessionId;
    delete mod.stageSessions;
    if (mod.sessions) {
      for (const s of mod.sessions) s.archived = true;
    }
  } else {
    if (mod.activeSessionId === conversationId) {
      const fallback = (mod.sessions || []).find((s) => s.conversationId !== conversationId && !s.archived);
      mod.activeSessionId = fallback?.conversationId;
    }
    if (mod.stageSessions) {
      for (const st of MODULE_STAGES) {
        if (mod.stageSessions[st] === conversationId) {
          delete mod.stageSessions[st];
        }
      }
    }
    if (mod.sessions) {
      const target = mod.sessions.find((s) => s.conversationId === conversationId);
      if (target) target.archived = true;
    }
  }

  mod.updatedAt = new Date().toISOString();
  mod.updatedBy = 'unbind-session';
  return pruneSparseFields(mod);
}
