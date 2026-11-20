import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';
import {
  buildColdStartPrompt,
  buildDriftInjectionMessage,
  computeAncestorAndDepHash,
  computeReviewNotesHash,
  detectSessionDrift,
} from '../core/context.js';
import {
  cleanupModuleWorktree,
  createModuleWorktree,
  getModuleGitRuntime,
  getRepoOverview,
  mergeBranchToBase,
  syncBaseIntoWorktree,
} from '../core/git.js';
import {
  hashWorkspacePath,
  loadProject,
  mutateProject,
  normalizeWorkspacePath,
  resolveAppDataDir,
  resolvePluginDataDir,
} from '../core/store.js';
import { observeTranscript } from '../core/transcript.js';
import {
  archiveModule,
  bindSessionToModule,
  buildStageSessionMap,
  computeChildProgress,
  createModule,
  getModulePathString,
  resolveEffectiveGit,
  resolveStageSessionId,
  setModuleStage,
  unbindSessionFromModule,
  updateModule,
  updateModuleProgress,
} from '../core/tree.js';
import {
  EnrichedModuleView,
  MODULE_STAGES,
  MODULE_STATUSES,
  ModuleStage,
  ModuleStatus,
  SidecarSnapshot,
} from '../core/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_VERSION = '0.1.4';
const ID_RE = /^[0-9a-f-]{8,}$/i;

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

function execAgentApi(args: string[], { projectId }: { projectId?: string } = {}): Record<string, unknown> {
  const env = { ...process.env };
  if (projectId) env.ANTIGRAVITY_PROJECT_ID = projectId;
  const exe = process.env.ANTIGRAVITY_AGENTAPI_EXE;
  const file = exe || 'agentapi';
  const execArgs = exe ? ['agentapi', ...args] : args;
  const out = execFileSync(file, execArgs, { encoding: 'utf-8', env });
  return out.trim() ? (JSON.parse(out) as Record<string, unknown>) : {};
}

function resolveProjectId(conversationId?: string): string {
  if (conversationId && ID_RE.test(conversationId)) {
    try {
      const data = execAgentApi(['get-conversation-metadata', conversationId]) as {
        response?: {
          conversationMetadata?: { metadata?: { projectId?: string; project_id?: string } };
          conversation_metadata?: { metadata?: { projectId?: string; project_id?: string } };
        };
      };
      const meta =
        data?.response?.conversationMetadata?.metadata ||
        data?.response?.conversation_metadata?.metadata;
      const pid = meta?.projectId || meta?.project_id || '';
      if (pid) return pid;
    } catch {
      // fall through
    }
  }
  return process.env.ANTIGRAVITY_PROJECT_ID || '';
}

function resolveWorkspaceFromMetadata(conversationId?: string): string {
  if (!conversationId || !ID_RE.test(conversationId)) return '';
  try {
    const data = execAgentApi(['get-conversation-metadata', conversationId]) as {
      response?: {
        conversationMetadata?: {
          metadata?: {
            workspaceUris?: string[];
            workspaces?: Array<{ workspaceFolderAbsoluteUri?: string }>;
          };
        };
      };
    };
    const meta = data?.response?.conversationMetadata?.metadata;
    const uri =
      meta?.workspaceUris?.[0] ||
      meta?.workspaces?.[0]?.workspaceFolderAbsoluteUri ||
      '';
    return uri ? normalizeWorkspacePath(uri) : '';
  } catch {
    return '';
  }
}

function requireWorkspace(data: Record<string, unknown>): string {
  const raw =
    (typeof data.workspace === 'string' && data.workspace) ||
    (typeof data.workspacePath === 'string' && data.workspacePath) ||
    '';
  if (raw.trim()) return normalizeWorkspacePath(raw);
  const convId =
    (typeof data.currentConversationId === 'string' && data.currentConversationId) ||
    (typeof data.conversationId === 'string' && data.conversationId) ||
    '';
  const fromMeta = resolveWorkspaceFromMetadata(convId);
  if (fromMeta) return fromMeta;
  throw new Error('未检测到当前工作区路径（workspacePath）');
}

function buildSnapshot(workspacePath: string): SidecarSnapshot {
  const dataDir = resolvePluginDataDir();
  const appDataDir = resolveAppDataDir();
  const project = loadProject(workspacePath, dataDir);
  const repoGit = getRepoOverview(project.workspacePath);
  const enriched: Record<string, EnrichedModuleView> = {};
  const activeCodeModulesOnMain: string[] = [];

  for (const mod of Object.values(project.modules)) {
    if (mod.archived) continue;
    const effectiveGit = resolveEffectiveGit(project, mod.id);
    const gitRuntime =
      effectiveGit.mode === 'worktree' ? getModuleGitRuntime(project, mod.id) : undefined;
    const activeConvId = resolveStageSessionId(mod, mod.stage);
    const observation = observeTranscript(activeConvId, appDataDir);
    const sessionRec = (mod.sessions || []).find((s) => s.conversationId === activeConvId);
    const drift = detectSessionDrift(project, mod.id, sessionRec);
    const childProgress = computeChildProgress(project, mod.id);
    const stageSessionMap = buildStageSessionMap(mod);

    if (effectiveGit.mode === 'main' && mod.stage === 'Code' && observation.state === 'running') {
      activeCodeModulesOnMain.push(mod.id);
    }

    enriched[mod.id] = {
      node: mod,
      effectiveGit,
      gitRuntime,
      observation,
      drift,
      childProgress,
      stageSessionMap,
    };
  }

  return {
    uiVersion: UI_VERSION,
    projectHash: hashWorkspacePath(project.workspacePath),
    project,
    repoGit,
    enriched,
    activeCodeModulesOnMain,
  };
}

function extractNewConversationId(rawResult: Record<string, unknown>): string {
  const resp = rawResult.response as Record<string, unknown> | undefined;
  const nc = (resp?.newConversation || resp?.new_conversation) as Record<string, unknown> | undefined;
  return String(
    nc?.conversationId ||
      nc?.conversation_id ||
      rawResult.conversationId ||
      rawResult.conversation_id ||
      resp?.conversationId ||
      resp?.conversation_id ||
      '',
  );
}

function createAndBindConversation(
  workspacePath: string,
  moduleId: string,
  opts: {
    stage?: ModuleStage;
    dedicatedForStage?: boolean;
    sessionTitle?: string;
    currentConversationId?: string;
    model?: string;
    userNote?: string;
  },
): { createdConversationId: string; snapshot: SidecarSnapshot } {
  const dataDir = resolvePluginDataDir();
  const appDataDir = resolveAppDataDir();
  const projBefore = loadProject(workspacePath, dataDir);
  const mod = projBefore.modules[moduleId];
  if (!mod) throw new Error(`模块不存在: ${moduleId}`);

  const stage = opts.stage || mod.stage;
  const customTitle = opts.sessionTitle?.trim() || '';
  const prevConvId = resolveStageSessionId(mod, mod.stage);
  const prevObs = prevConvId ? observeTranscript(prevConvId, appDataDir) : undefined;
  const gitRt = getModuleGitRuntime(projBefore, moduleId);

  const prompt = buildColdStartPrompt(projBefore, moduleId, {
    stage,
    sessionTitle: customTitle || undefined,
    previousReplySnippet: prevObs?.latestReply || undefined,
    userNote: opts.userNote,
    mergeBase: gitRt.mergeBase,
  });

  const pathStr = getModulePathString(projBefore, moduleId);
  const title = customTitle ? `[${stage}] ${mod.name} · ${customTitle}` : `[${stage}] ${pathStr}`;
  const model = opts.model || 'flash';
  const projectId = resolveProjectId(opts.currentConversationId);

  const rawResult = execAgentApi(
    ['new-conversation', `--model=${model}`, `--title=${title}`, prompt],
    { projectId },
  );
  const newConvId = extractNewConversationId(rawResult);
  if (!newConvId) {
    throw new Error(`agentapi 未返回有效 conversationId: ${JSON.stringify(rawResult)}`);
  }

  mutateProject(
    workspacePath,
    (proj) => {
      const m = proj.modules[moduleId];
      if (!m) return;
      if (stage === 'Code' && (m.status === '待设计' || m.status === '已完成')) {
        m.status = '开发中';
      }
      if (stage === 'Code' && !m.git?.baseCommit) {
        const repo = getRepoOverview(proj.workspacePath);
        if (repo.isGitRepo && repo.headCommit) {
          m.git = {
            mode: m.git?.mode || 'main',
            inheritFromParent: m.git ? m.git.inheritFromParent : true,
            ...m.git,
            baseBranch: m.git?.baseBranch || repo.currentBranch,
            baseCommit: repo.headCommit,
          };
        }
      }
      bindSessionToModule(
        proj,
        moduleId,
        {
          conversationId: newConvId,
          title: customTitle || title,
          stage,
          syncedRev: m.rev,
          syncedAncestorHash: computeAncestorAndDepHash(proj, moduleId),
          syncedStage: stage,
          syncedReviewNotesHash: computeReviewNotesHash(m),
        },
        {
          setAsPrimary: !opts.dedicatedForStage || !m.activeSessionId,
          bindStage: opts.dedicatedForStage ? stage : undefined,
        },
      );
      proj.selectedModuleId = moduleId;
    },
    dataDir,
  );

  return {
    createdConversationId: newConvId,
    snapshot: buildSnapshot(workspacePath),
  };
}

function registerStaticPublicFiles(app: SidecarApp, publicDir: string): void {
  if (!existsSync(publicDir)) return;

  function walk(dir: string, urlPrefix: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full, `${urlPrefix}/${entry}`);
      } else {
        const route = `${urlPrefix}/${entry}`;
        const ext = extname(entry).toLowerCase();
        const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
        const isHtml = ext === '.html';
        const serve = () =>
          new Response(readFileSync(full), {
            contentType,
            headers: isHtml
              ? { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
              : { 'Cache-Control': 'public, max-age=31536000, immutable' },
          });
        app.page(route, serve);
        if (route === '/index.html') {
          app.page('/', serve);
        }
      }
    }
  }

  walk(publicDir, '');
}

const app = new SidecarApp();
registerStaticPublicFiles(app, join(__dirname, 'public'));

app.api('/api/state', (data) => {
  const ws = requireWorkspace(data);
  return buildSnapshot(ws);
}, 'GET');

app.api('/api/ui-prefs', (data) => {
  const ws = requireWorkspace(data);
  mutateProject(ws, (proj) => {
    if (typeof data.selectedModuleId === 'string' && proj.modules[data.selectedModuleId]) {
      proj.selectedModuleId = data.selectedModuleId;
    }
    if (data.expandedIds && typeof data.expandedIds === 'object') {
      proj.expandedIds = { ...(proj.expandedIds || {}), ...(data.expandedIds as Record<string, boolean>) };
    }
  });
  return buildSnapshot(ws);
}, 'POST');

app.api('/api/modules/create', (data) => {
  const ws = requireWorkspace(data);
  const { result: created } = mutateProject(ws, (proj) => {
    const node = createModule(proj, {
      name: String(data.name || ''),
      parentId: data.parentId === null || typeof data.parentId === 'string' ? data.parentId : null,
      design: typeof data.design === 'string' ? data.design : undefined,
      dependsOn: Array.isArray(data.dependsOn)
        ? data.dependsOn.filter((x): x is string => typeof x === 'string')
        : undefined,
      stage:
        typeof data.stage === 'string' && MODULE_STAGES.includes(data.stage as ModuleStage)
          ? (data.stage as ModuleStage)
          : 'Plan',
      updatedBy: 'sidebar-ui',
    });
    proj.selectedModuleId = node.id;
    return node;
  });

  if (data.openSession) {
    const res = createAndBindConversation(ws, created.id, {
      stage: created.stage,
      currentConversationId:
        typeof data.currentConversationId === 'string' ? data.currentConversationId : undefined,
      model: typeof data.model === 'string' ? data.model : 'flash',
    });
    return { createdModuleId: created.id, ...res };
  }

  return { createdModuleId: created.id, snapshot: buildSnapshot(ws) };
}, 'POST');

app.api('/api/modules/update', (data) => {
  const ws = requireWorkspace(data);
  const moduleId = String(data.moduleId || '').trim();
  mutateProject(ws, (proj) => {
    updateModule(proj, moduleId, {
      name: typeof data.name === 'string' ? data.name : undefined,
      parentId:
        data.parentId === null || typeof data.parentId === 'string' ? data.parentId : undefined,
      design: typeof data.design === 'string' ? data.design : undefined,
      linkedFiles: Array.isArray(data.linkedFiles)
        ? data.linkedFiles.filter((x): x is string => typeof x === 'string')
        : undefined,
      dependsOn: Array.isArray(data.dependsOn)
        ? data.dependsOn.filter((x): x is string => typeof x === 'string')
        : undefined,
      updatedBy: 'sidebar-ui',
    });
  });
  return buildSnapshot(ws);
}, 'POST');

app.api('/api/modules/progress', (data) => {
  const ws = requireWorkspace(data);
  const moduleId = String(data.moduleId || '').trim();
  mutateProject(ws, (proj) => {
    updateModuleProgress(proj, moduleId, {
      stop: typeof data.stop === 'string' ? data.stop : undefined,
      next: typeof data.next === 'string' ? data.next : undefined,
      status:
        typeof data.status === 'string' && MODULE_STATUSES.includes(data.status as ModuleStatus)
          ? (data.status as ModuleStatus)
          : undefined,
      reviewNotes: typeof data.reviewNotes === 'string' ? data.reviewNotes : undefined,
      clearReviewNotes: Boolean(data.clearReviewNotes),
      allowComplete: true, // Human UI action
      updatedBy: 'sidebar-ui',
    });
  });
  return buildSnapshot(ws);
}, 'POST');

app.api('/api/modules/stage', (data) => {
  const ws = requireWorkspace(data);
  const moduleId = String(data.moduleId || '').trim();
  const stage = String(data.stage || '') as ModuleStage;
  mutateProject(ws, (proj) => {
    const updated = setModuleStage(proj, moduleId, stage, 'sidebar-ui');
    if (stage === 'Code' && !updated.git?.baseCommit) {
      const repo = getRepoOverview(proj.workspacePath);
      if (repo.isGitRepo && repo.headCommit) {
        updated.git = {
          mode: updated.git?.mode || 'main',
          inheritFromParent: updated.git ? updated.git.inheritFromParent : true,
          ...updated.git,
          baseBranch: updated.git?.baseBranch || repo.currentBranch,
          baseCommit: repo.headCommit,
        };
      }
    }
  });
  return buildSnapshot(ws);
}, 'POST');

app.api('/api/modules/archive', (data) => {
  const ws = requireWorkspace(data);
  const moduleId = String(data.moduleId || '').trim();
  const { result } = mutateProject(ws, (proj) => archiveModule(proj, moduleId, 'sidebar-ui'));
  return { warning: result.warning, snapshot: buildSnapshot(ws) };
}, 'POST');

app.api('/api/sessions/bind', (data) => {
  const ws = requireWorkspace(data);
  const moduleId = String(data.moduleId || '').trim();
  const conversationId = String(data.conversationId || '').trim();
  const stage =
    typeof data.stage === 'string' && MODULE_STAGES.includes(data.stage as ModuleStage)
      ? (data.stage as ModuleStage)
      : undefined;
  const dedicated = Boolean(data.dedicatedForStage);

  mutateProject(ws, (proj) => {
    const mod = proj.modules[moduleId];
    if (!mod) throw new Error(`模块不存在: ${moduleId}`);
    const useStage = stage || mod.stage;
    bindSessionToModule(
      proj,
      moduleId,
      {
        conversationId,
        title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : `[${useStage}] ${mod.name}`,
        stage: useStage,
        syncedRev: mod.rev,
        syncedAncestorHash: computeAncestorAndDepHash(proj, moduleId),
        syncedStage: useStage,
        syncedReviewNotesHash: computeReviewNotesHash(mod),
      },
      {
        setAsPrimary: !dedicated || !mod.activeSessionId,
        bindStage: dedicated ? useStage : undefined,
      },
    );
  });
  return buildSnapshot(ws);
}, 'POST');

app.api('/api/sessions/unbind', (data) => {
  const ws = requireWorkspace(data);
  const moduleId = String(data.moduleId || '').trim();
  const conversationId = typeof data.conversationId === 'string' ? data.conversationId.trim() : undefined;
  mutateProject(ws, (proj) => unbindSessionFromModule(proj, moduleId, conversationId));
  return buildSnapshot(ws);
}, 'POST');

app.api('/api/sessions/create', (data) => {
  const ws = requireWorkspace(data);
  const moduleId = String(data.moduleId || '').trim();
  const stage =
    typeof data.stage === 'string' && MODULE_STAGES.includes(data.stage as ModuleStage)
      ? (data.stage as ModuleStage)
      : undefined;
  return createAndBindConversation(ws, moduleId, {
    stage,
    dedicatedForStage: Boolean(data.dedicatedForStage),
    sessionTitle: typeof data.sessionTitle === 'string' ? data.sessionTitle : undefined,
    currentConversationId:
      typeof data.currentConversationId === 'string' ? data.currentConversationId : undefined,
    model: typeof data.model === 'string' ? data.model : 'flash',
    userNote: typeof data.userNote === 'string' ? data.userNote : undefined,
  });
}, 'POST');

app.api('/api/sessions/push-context', (data) => {
  const ws = requireWorkspace(data);
  const moduleId = String(data.moduleId || '').trim();
  const project = loadProject(ws);
  const mod = project.modules[moduleId];
  if (!mod) throw new Error(`模块不存在: ${moduleId}`);
  const targetConvId =
    (typeof data.conversationId === 'string' && data.conversationId.trim()) ||
    resolveStageSessionId(mod, mod.stage);
  if (!targetConvId || !ID_RE.test(targetConvId)) {
    throw new Error('该模块尚未绑定有效会话 ID');
  }
  const rec = (mod.sessions || []).find((s) => s.conversationId === targetConvId);
  const driftMsg = rec ? buildDriftInjectionMessage(project, moduleId, rec) : null;
  const gitRt = getModuleGitRuntime(project, moduleId);
  const msg =
    driftMsg ||
    buildColdStartPrompt(project, moduleId, {
      stage: mod.stage,
      mergeBase: gitRt.mergeBase,
      userNote: '请仅简短确认已同步上述最新模块上下文，不要修改文件。',
    });

  const projectId = resolveProjectId(targetConvId);
  execAgentApi(['send-message', `--title=模块上下文同步 · ${mod.name}`, targetConvId, msg], {
    projectId,
  });

  const ancHash = computeAncestorAndDepHash(project, moduleId);
  const rnHash = computeReviewNotesHash(mod);
  mutateProject(ws, (proj) => {
    const m = proj.modules[moduleId];
    const s = m?.sessions?.find((x) => x.conversationId === targetConvId);
    if (m && s) {
      s.syncedRev = m.rev;
      s.syncedAncestorHash = ancHash;
      s.syncedStage = m.stage;
      s.syncedReviewNotesHash = rnHash;
    }
  });

  return { sentTo: targetConvId, snapshot: buildSnapshot(ws) };
}, 'POST');

app.api('/api/git/config', (data) => {
  const ws = requireWorkspace(data);
  mutateProject(ws, (proj) => {
    if (typeof data.branchPrefix === 'string' && data.branchPrefix.trim()) {
      proj.gitConfig.branchPrefix = data.branchPrefix.trim();
    }
    if (typeof data.worktreeDir === 'string' && data.worktreeDir.trim()) {
      proj.gitConfig.worktreeDir = data.worktreeDir.trim();
    }
    if (Array.isArray(data.copyEnvFiles)) {
      proj.gitConfig.copyEnvFiles = data.copyEnvFiles
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean);
    }
    if (typeof data.initCommand === 'string') {
      proj.gitConfig.initCommand = data.initCommand.trim();
    }
  });
  return buildSnapshot(ws);
}, 'POST');

app.api('/api/git/worktree/create', (data) => {
  const ws = requireWorkspace(data);
  const moduleId = String(data.moduleId || '').trim();
  const project = loadProject(ws);
  const mod = project.modules[moduleId];
  if (!mod) throw new Error(`模块不存在: ${moduleId}`);

  const created = createModuleWorktree(project.workspacePath, mod.id, project.gitConfig);
  mutateProject(ws, (proj) => {
    const m = proj.modules[moduleId];
    if (!m) return;
    m.git = {
      mode: 'worktree',
      inheritFromParent: false,
      branch: created.branch,
      worktreePath: created.worktreePath,
      baseBranch: created.baseBranch,
      baseCommit: created.baseCommit,
    };
    m.rev = (m.rev || 1) + 1;
    m.updatedAt = new Date().toISOString();
    m.updatedBy = 'git-worktree-create';
  });

  return { created, snapshot: buildSnapshot(ws) };
}, 'POST');

app.api('/api/git/worktree/sync', (data) => {
  const ws = requireWorkspace(data);
  const moduleId = String(data.moduleId || '').trim();
  const project = loadProject(ws);
  const eff = resolveEffectiveGit(project, moduleId);
  if (eff.mode !== 'worktree' || !eff.worktreePath || !eff.baseBranch) {
    throw new Error('该模块未关联有效 Worktree');
  }
  const res = syncBaseIntoWorktree(eff.worktreePath, eff.baseBranch);
  return { ...res, snapshot: buildSnapshot(ws) };
}, 'POST');

app.api('/api/git/worktree/merge', (data) => {
  const ws = requireWorkspace(data);
  const moduleId = String(data.moduleId || '').trim();
  const strategy = data.strategy === 'no-ff' ? 'no-ff' : 'squash';
  const project = loadProject(ws);
  const mod = project.modules[moduleId];
  if (!mod) throw new Error(`模块不存在: ${moduleId}`);
  if (mod.git?.mode !== 'worktree' || !mod.git.branch || !mod.git.baseBranch) {
    throw new Error('仅持有独立 Worktree 的模块可执行合并回主干（若为继承子模块，请在父模块统一集成合并）');
  }

  const commitMessage =
    (typeof data.commitMessage === 'string' && data.commitMessage.trim()) ||
    `feat(${mod.id}): ${mod.name}`;

  const { mergedCommit } = mergeBranchToBase(project.workspacePath, {
    branch: mod.git.branch,
    worktreePath: mod.git.worktreePath,
    baseBranch: mod.git.baseBranch,
    strategy,
    commitMessage,
  });

  mutateProject(ws, (proj) => {
    const m = proj.modules[moduleId];
    if (!m || !m.git) return;
    m.git.mergedCommit = mergedCommit;
    m.git.mergedAt = new Date().toISOString();
    m.status = '已完成';
    delete m.reviewNotes;
    m.updatedAt = new Date().toISOString();
    m.updatedBy = 'git-merge';
  });

  return { mergedCommit, snapshot: buildSnapshot(ws) };
}, 'POST');

app.api('/api/git/worktree/cleanup', (data) => {
  const ws = requireWorkspace(data);
  const moduleId = String(data.moduleId || '').trim();
  const project = loadProject(ws);
  const mod = project.modules[moduleId];
  if (!mod) throw new Error(`模块不存在: ${moduleId}`);
  if (mod.git?.mode !== 'worktree') {
    throw new Error('该模块没有独立 Worktree 需要清理');
  }

  const res = cleanupModuleWorktree(project.workspacePath, project.gitConfig.worktreeDir, {
    worktreePath: mod.git.worktreePath,
    branch: mod.git.branch,
    forceBranchDelete: Boolean(mod.git.mergedCommit) || Boolean(data.force),
  });

  mutateProject(ws, (proj) => {
    const m = proj.modules[moduleId];
    if (!m || !m.git) return;
    m.git = {
      mode: 'main',
      inheritFromParent: true,
      baseBranch: m.git.baseBranch,
      baseCommit: m.git.baseCommit,
      mergedCommit: m.git.mergedCommit,
      mergedAt: m.git.mergedAt,
    };
    m.updatedAt = new Date().toISOString();
    m.updatedBy = 'git-cleanup';
  });

  return { ...res, snapshot: buildSnapshot(ws) };
}, 'POST');

app.run();
