import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ModuleStage,
  ModuleStatus,
  ProjectGitConfig,
  SidecarSnapshot,
} from '../core/types.js';
import {
  apiPost,
  fetchSnapshot,
  getHostConversationId,
  openNativeConversation,
} from './api.js';
import { MergeDialog } from './components/MergeDialog';
import { ModuleTree } from './components/ModuleTree';
import { NodeDetail } from './components/NodeDetail';
import { SettingsDrawer } from './components/SettingsDrawer';

export function App() {
  const [workspace, setWorkspace] = useState<string>(
    () => new URLSearchParams(window.location.search).get('workspace') || '',
  );
  const [snapshot, setSnapshot] = useState<SidecarSnapshot | null>(null);
  const [connected, setConnected] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [manualTheme, setManualTheme] = useState<'light' | 'dark' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [dialogMode, setDialogMode] = useState<'merge' | 'cleanup' | null>(null);
  const [toast, setToast] = useState<{ text: string; isErr?: boolean } | null>(null);

  const toastTimer = useRef<number | null>(null);
  const hostConvId = getHostConversationId();

  const notify = useCallback((text: string, isErr = false) => {
    setToast({ text, isErr });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  // Theme luminance sync from host --background (immune to host --muted override)
  useEffect(() => {
    function syncFromHost() {
      if (manualTheme) {
        document.documentElement.dataset.theme = manualTheme;
        setTheme(manualTheme);
        return;
      }
      const rawBg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
      if (!rawBg) {
        document.documentElement.dataset.theme = 'light';
        setTheme('light');
        return;
      }
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background)';
      document.documentElement.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      const nums = (c.match(/[\d.]+/g) || []).map(Number);
      if (nums.length >= 3) {
        const scale = c.startsWith('color(') ? 1 : 255;
        const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const next: 'light' | 'dark' = lum < 0.45 ? 'dark' : 'light';
        document.documentElement.dataset.theme = next;
        setTheme(next);
      }
    }

    syncFromHost();
    const observer = new MutationObserver(syncFromHost);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, [manualTheme]);

  // Workspace resolution via sidecar_sdk
  useEffect(() => {
    let active = true;
    const urlWs = new URLSearchParams(window.location.search).get('workspace');
    if (urlWs) {
      setWorkspace(urlWs);
    } else if (window.sidecar?.getWorkspaceUris) {
      window.sidecar.getWorkspaceUris().then((uris) => {
        if (active && uris.length > 0) setWorkspace(uris[0]);
      });
    }
    const unsub = window.sidecar?.onWorkspaceChange?.((uris) => {
      if (uris.length > 0) setWorkspace(uris[0]);
    });
    return () => {
      active = false;
      unsub?.();
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!workspace && !hostConvId) return;
    try {
      const next = await fetchSnapshot(workspace);
      setSnapshot(next);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, [workspace, hostConvId]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(id);
  }, [refresh]);

  const wsParam = snapshot?.project.workspacePath || workspace;
  const selectedId = snapshot?.project.selectedModuleId;
  const selectedView =
    (selectedId && snapshot?.enriched[selectedId]) ||
    (snapshot ? Object.values(snapshot.enriched)[0] : undefined);

  // 4a: Clicking a node ONLY inspects details in the sidebar (never hijacks active chat).
  async function handleSelectModule(moduleId: string) {
    if (!snapshot) return;
    try {
      const next = await apiPost<SidecarSnapshot>('/api/ui-prefs', {
        workspacePath: wsParam,
        selectedModuleId: moduleId,
      });
      setSnapshot(next);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  // Explicit jump button (↗) selects node AND switches the native conversation.
  async function handleOpenModuleSession(moduleId: string) {
    if (!snapshot) return;
    try {
      const next = await apiPost<SidecarSnapshot>('/api/ui-prefs', {
        workspacePath: wsParam,
        selectedModuleId: moduleId,
      });
      setSnapshot(next);
      const view = next.enriched[moduleId];
      const targetConv = view?.stageSessionMap[view.node.stage]?.conversationId;
      if (targetConv && targetConv !== hostConvId) {
        openNativeConversation(targetConv);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleToggleExpand(moduleId: string, nextExpanded: boolean) {
    try {
      const next = await apiPost<SidecarSnapshot>('/api/ui-prefs', {
        workspacePath: wsParam,
        expandedIds: { [moduleId]: nextExpanded },
      });
      setSnapshot(next);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleCreateModule(
    parentId: string | null,
    name: string,
    design: string,
    openSession: boolean,
  ) {
    try {
      const res = await apiPost<{
        createdModuleId: string;
        createdConversationId?: string;
        snapshot: SidecarSnapshot;
      }>('/api/modules/create', {
        workspacePath: wsParam,
        parentId,
        name,
        design,
        openSession,
      });
      setSnapshot(res.snapshot);
      if (res.createdConversationId) {
        openNativeConversation(res.createdConversationId);
        notify(`已创建「${name}」并开启新会话`);
      } else {
        notify(`已记入模块「${name}」`);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleSetStage(stage: ModuleStage) {
    if (!selectedView) return;
    try {
      const next = await apiPost<SidecarSnapshot>('/api/modules/stage', {
        workspacePath: wsParam,
        moduleId: selectedView.node.id,
        stage,
      });
      setSnapshot(next);
      const updatedView = next.enriched[selectedView.node.id];
      const targetConv = updatedView?.stageSessionMap[stage]?.conversationId;
      if (updatedView?.stageSessionMap[stage]?.dedicated && targetConv && targetConv !== hostConvId) {
        openNativeConversation(targetConv);
      }
      notify(`已切换至 ${stage} 阶段`);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleBackToCodeFix() {
    if (!selectedView) return;
    try {
      const next = await apiPost<SidecarSnapshot>('/api/modules/stage', {
        workspacePath: wsParam,
        moduleId: selectedView.node.id,
        stage: 'Code',
      });
      setSnapshot(next);
      const updatedView = next.enriched[selectedView.node.id];
      const codeConv = updatedView?.stageSessionMap.Code?.conversationId;
      if (codeConv && codeConv !== hostConvId) {
        openNativeConversation(codeConv);
      }
      notify('已切回 Code 阶段并定位会话，下一轮发消息将自动带入返工清单');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleSetStatus(status: ModuleStatus) {
    if (!selectedView) return;
    try {
      const next = await apiPost<SidecarSnapshot>('/api/modules/progress', {
        workspacePath: wsParam,
        moduleId: selectedView.node.id,
        status,
      });
      setSnapshot(next);
      notify(`状态已更新为「${status}」`);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleUpdateModule(patch: { name?: string; design?: string }) {
    if (!selectedView) return;
    try {
      const next = await apiPost<SidecarSnapshot>('/api/modules/update', {
        workspacePath: wsParam,
        moduleId: selectedView.node.id,
        ...patch,
      });
      setSnapshot(next);
      notify('模块资料已更新');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleSaveProgress(patch: {
    stop?: string;
    next?: string;
    clearReviewNotes?: boolean;
  }) {
    if (!selectedView) return;
    try {
      const next = await apiPost<SidecarSnapshot>('/api/modules/progress', {
        workspacePath: wsParam,
        moduleId: selectedView.node.id,
        ...patch,
      });
      setSnapshot(next);
      notify(patch.clearReviewNotes ? '已清空 Review 返工清单' : '进度已保存');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleArchive() {
    if (!selectedView) return;
    try {
      const res = await apiPost<{ warning?: string; snapshot: SidecarSnapshot }>(
        '/api/modules/archive',
        { workspacePath: wsParam, moduleId: selectedView.node.id },
      );
      setSnapshot(res.snapshot);
      notify(res.warning || `已归档「${selectedView.node.name}」`, Boolean(res.warning));
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleBindCurrent(dedicatedForStage: boolean) {
    if (!selectedView || !hostConvId) return;
    try {
      const next = await apiPost<SidecarSnapshot>('/api/sessions/bind', {
        workspacePath: wsParam,
        moduleId: selectedView.node.id,
        conversationId: hostConvId,
        stage: selectedView.node.stage,
        dedicatedForStage,
      });
      setSnapshot(next);
      notify('已绑定当前会话');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleCreateSession(
    stage: ModuleStage,
    dedicatedForStage: boolean,
    sessionTitle?: string,
  ) {
    if (!selectedView) return;
    try {
      const res = await apiPost<{ createdConversationId: string; snapshot: SidecarSnapshot }>(
        '/api/sessions/create',
        {
          workspacePath: wsParam,
          moduleId: selectedView.node.id,
          stage,
          dedicatedForStage,
          sessionTitle,
        },
      );
      setSnapshot(res.snapshot);
      if (res.createdConversationId) {
        openNativeConversation(res.createdConversationId);
      }
      notify(
        sessionTitle
          ? `已开启「${sessionTitle}」(${stage}) 会话并定位`
          : `已为 ${stage} 开启新会话并定位`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleUnbindSession(conversationId?: string) {
    if (!selectedView) return;
    try {
      const next = await apiPost<SidecarSnapshot>('/api/sessions/unbind', {
        workspacePath: wsParam,
        moduleId: selectedView.node.id,
        conversationId,
      });
      setSnapshot(next);
      notify('已解绑会话');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handlePushContext() {
    if (!selectedView) return;
    try {
      const res = await apiPost<{ sentTo: string; snapshot: SidecarSnapshot }>(
        '/api/sessions/push-context',
        {
          workspacePath: wsParam,
          moduleId: selectedView.node.id,
        },
      );
      setSnapshot(res.snapshot);
      notify('已推送最新上下文到绑定会话');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleSaveGitConfig(cfg: ProjectGitConfig) {
    try {
      const next = await apiPost<SidecarSnapshot>('/api/git/config', {
        workspacePath: wsParam,
        ...cfg,
      });
      setSnapshot(next);
      notify('项目 Git / Worktree 设置已保存');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleCreateWorktree() {
    if (!selectedView) return;
    try {
      const res = await apiPost<{
        created: { branch: string; copiedEnvFiles: string[] };
        snapshot: SidecarSnapshot;
      }>('/api/git/worktree/create', {
        workspacePath: wsParam,
        moduleId: selectedView.node.id,
      });
      setSnapshot(res.snapshot);
      notify(
        `已创建 Worktree (${res.created.branch})${res.created.copiedEnvFiles.length ? `，拷贝 ${res.created.copiedEnvFiles.length} 个 env` : ''}`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleSyncWorktree() {
    if (!selectedView) return;
    try {
      const res = await apiPost<{ message: string; snapshot: SidecarSnapshot }>(
        '/api/git/worktree/sync',
        { workspacePath: wsParam, moduleId: selectedView.node.id },
      );
      setSnapshot(res.snapshot);
      notify('已同步主干到当前 Worktree');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleConfirmMerge(strategy: 'squash' | 'no-ff', commitMessage: string) {
    if (!selectedView) return;
    try {
      const res = await apiPost<{ mergedCommit: string; snapshot: SidecarSnapshot }>(
        '/api/git/worktree/merge',
        {
          workspacePath: wsParam,
          moduleId: selectedView.node.id,
          strategy,
          commitMessage,
        },
      );
      setSnapshot(res.snapshot);
      setDialogMode(null);
      notify(`合并成功 (${res.mergedCommit.slice(0, 7)})，可按需清理 Worktree`);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function handleConfirmCleanup() {
    if (!selectedView) return;
    try {
      const res = await apiPost<{ snapshot: SidecarSnapshot }>('/api/git/worktree/cleanup', {
        workspacePath: wsParam,
        moduleId: selectedView.node.id,
      });
      setSnapshot(res.snapshot);
      setDialogMode(null);
      notify('已清理 Worktree 与本地分支，模块节点保留');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    }
  }

  return (
    <div className="mt-shell">
      <header className="mt-header">
        <div className="mt-header-left">
          <h1>模块树</h1>
          <span className={`mt-pill ${connected ? 'ok' : 'warn'}`}>
            {connected ? '已连' : '断开'}
          </span>
          {snapshot?.project.projectName && (
            <span className="mt-project-tag" title={snapshot.project.workspacePath}>
              · {snapshot.project.projectName}
            </span>
          )}
        </div>
        <div className="mt-header-actions">
          <button
            type="button"
            className="mt-ghost"
            onClick={() => setShowSettings((v) => !v)}
          >
            Git设置
          </button>
          <button
            type="button"
            className="mt-ghost"
            onClick={() => setManualTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '浅色' : '深色'}
          </button>
        </div>
      </header>

      {showSettings && snapshot && (
        <SettingsDrawer
          config={snapshot.project.gitConfig}
          workspacePath={snapshot.project.workspacePath}
          onSave={handleSaveGitConfig}
          onClose={() => setShowSettings(false)}
        />
      )}

      {!snapshot ? (
        <div className="mt-card mt-empty">
          {connected ? '正在加载当前工作区模块树…' : '无法连接到 modtree 侧栏后端'}
        </div>
      ) : (
        <>
          <ModuleTree
            modules={snapshot.project.modules}
            enriched={snapshot.enriched}
            selectedId={selectedView?.node.id}
            expandedIds={snapshot.project.expandedIds || {}}
            hostConvId={hostConvId}
            onSelect={handleSelectModule}
            onOpenSession={handleOpenModuleSession}
            onToggleExpand={handleToggleExpand}
            onCreate={handleCreateModule}
          />

          {selectedView && (
            <NodeDetail
              view={selectedView}
              allModules={snapshot.project.modules}
              workspacePath={snapshot.project.workspacePath}
              repoGit={snapshot.repoGit}
              activeCodeModulesOnMain={snapshot.activeCodeModulesOnMain}
              hostConvId={hostConvId}
              onSelectNode={handleSelectModule}
              onSetStage={handleSetStage}
              onBackToCodeFix={handleBackToCodeFix}
              onSetStatus={handleSetStatus}
              onUpdateModule={handleUpdateModule}
              onSaveProgress={handleSaveProgress}
              onArchive={handleArchive}
              onBindCurrent={handleBindCurrent}
              onCreateSession={handleCreateSession}
              onUnbindSession={handleUnbindSession}
              onPushContext={handlePushContext}
              onCreateWorktree={handleCreateWorktree}
              onSyncWorktree={handleSyncWorktree}
              onOpenMerge={() => setDialogMode('merge')}
              onOpenCleanup={() => setDialogMode('cleanup')}
            />
          )}
        </>
      )}

      {dialogMode && selectedView && (
        <MergeDialog
          mode={dialogMode}
          node={selectedView.node}
          hasReviewed={Boolean(
            selectedView.stageSessionMap.Review?.dedicated ||
              selectedView.node.stage === 'Review',
          )}
          onCancel={() => setDialogMode(null)}
          onConfirmMerge={handleConfirmMerge}
          onConfirmCleanup={handleConfirmCleanup}
          onStartIndependentReview={async () => {
            await handleSetStage('Review');
            await handleCreateSession('Review', true, '合并前独立终审');
            setDialogMode(null);
          }}
        />
      )}

      {toast && <div className={`mt-toast${toast.isErr ? ' err' : ''}`}>{toast.text}</div>}
    </div>
  );
}
