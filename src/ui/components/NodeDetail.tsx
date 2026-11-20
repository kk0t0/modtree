import { useEffect, useState } from 'react';
import {
  MODULE_STAGES,
  MODULE_STATUSES,
  type EnrichedModuleView,
  type ModuleNode,
  type ModuleStage,
  type ModuleStatus,
  type RepoGitOverview,
} from '../../core/types.js';
import { openNativeConversation, openWorkspaceFile, shortId } from '../api.js';

interface NodeDetailProps {
  view: EnrichedModuleView;
  allModules: Record<string, ModuleNode>;
  workspacePath: string;
  repoGit: RepoGitOverview;
  activeCodeModulesOnMain: string[];
  hostConvId: string;
  onSelectNode: (moduleId: string) => void;
  onSetStage: (stage: ModuleStage) => Promise<void>;
  onBackToCodeFix: () => Promise<void>;
  onSetStatus: (status: ModuleStatus) => Promise<void>;
  onUpdateModule: (patch: { name?: string; design?: string }) => Promise<void>;
  onSaveProgress: (patch: { stop?: string; next?: string; clearReviewNotes?: boolean }) => Promise<void>;
  onArchive: () => Promise<void>;
  onBindCurrent: (dedicatedForStage: boolean, title?: string) => Promise<void>;
  onCopyBootstrapPrompt: (
    stage: ModuleStage,
    sessionTitle?: string,
    grillMe?: boolean,
  ) => Promise<{ prompt: string; copied: boolean }>;
  onCreateSession: (stage: ModuleStage, dedicatedForStage: boolean, sessionTitle?: string) => Promise<void>;
  onUnbindSession: (conversationId?: string) => Promise<void>;
  onPushContext: () => Promise<void>;
  onCreateWorktree: () => Promise<void>;
  onSyncWorktree: () => Promise<void>;
  onOpenMerge: () => void;
  onOpenCleanup: () => void;
}

export function NodeDetail({
  view,
  allModules,
  workspacePath,
  repoGit,
  activeCodeModulesOnMain,
  hostConvId,
  onSelectNode,
  onSetStage,
  onBackToCodeFix,
  onSetStatus,
  onUpdateModule,
  onSaveProgress,
  onArchive,
  onBindCurrent,
  onCopyBootstrapPrompt,
  onCreateSession,
  onUnbindSession,
  onPushContext,
  onCreateWorktree,
  onSyncWorktree,
  onOpenMerge,
  onOpenCleanup,
}: NodeDetailProps) {
  const {
    node,
    effectiveGit,
    gitRuntime,
    observation,
    stageObservations,
    codeSessionRunning,
    drift,
    stageSessionMap,
  } = view;
  const [designExpanded, setDesignExpanded] = useState(false);
  const [editingDesign, setEditingDesign] = useState(false);
  const [designDraft, setDesignDraft] = useState(node.design || '');
  const [editingProgress, setEditingProgress] = useState(false);
  const [stopDraft, setStopDraft] = useState(node.stop || '');
  const [nextDraft, setNextDraft] = useState(node.next || '');
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(node.name);
  const [sessionPanel, setSessionPanel] = useState<
    | { mode: 'bootstrap'; stage: ModuleStage }
    | { mode: 'bind'; stage: ModuleStage }
    | { mode: 'bg-create'; stage: ModuleStage; dedicated: boolean }
    | null
  >(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState('');
  const [grillMeChecked, setGrillMeChecked] = useState(true);
  const [copiedPreview, setCopiedPreview] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    setDesignExpanded(false);
    setEditingDesign(false);
    setEditingProgress(false);
    setRenaming(false);
    setSessionPanel(null);
    setSessionTitleDraft('');
    setGrillMeChecked(true);
    setCopiedPreview('');
    setDesignDraft(node.design || '');
    setStopDraft(node.stop || '');
    setNextDraft(node.next || '');
    setNameDraft(node.name);
  }, [node.id]);

  useEffect(() => {
    if (!editingDesign) setDesignDraft(node.design || '');
  }, [node.design, editingDesign]);

  useEffect(() => {
    if (!editingProgress) {
      setStopDraft(node.stop || '');
      setNextDraft(node.next || '');
    }
  }, [node.stop, node.next, editingProgress]);

  async function runBusy(key: string, fn: () => Promise<void>) {
    setBusyAction(key);
    try {
      await fn();
    } finally {
      setBusyAction(null);
    }
  }

  // Compute full breadcrumb path
  const pathParts: string[] = [node.name];
  let curParent = node.parentId;
  const seen = new Set<string>([node.id]);
  while (curParent && !seen.has(curParent) && allModules[curParent]) {
    seen.add(curParent);
    pathParts.unshift(allModules[curParent].name);
    curParent = allModules[curParent].parentId;
  }
  const fullPath = pathParts.join(' / ');

  const currentStageSession = stageSessionMap[node.stage]?.conversationId || '';
  const hasReviewDedicated = stageSessionMap.Review?.dedicated;
  const otherMainCodeRunning = activeCodeModulesOnMain.filter((id) => id !== node.id);
  const showMainCollisionWarn =
    effectiveGit.mode === 'main' &&
    node.stage === 'Code' &&
    (otherMainCodeRunning.length > 0 || repoGit.dirtyCount > 0);

  const isOwnWorktree = node.git?.mode === 'worktree' && Boolean(node.git.worktreePath);
  const isInheritedWorktree = effectiveGit.mode === 'worktree' && !isOwnWorktree;

  const gateHint =
    node.stage === 'Plan'
      ? '🔒 只读规划：禁改源码，产出沉淀至设计要点'
      : node.stage === 'Code'
        ? `✏️ 编码模式（可开只读子代理自测）：写入范围 ${effectiveGit.mode === 'worktree' ? effectiveGit.branch || 'Worktree' : '主目录'}`
        : `🔍 合并前独立终审（只读）：基线 ${gitRuntime?.mergeBase?.slice(0, 7) || effectiveGit.baseCommit?.slice(0, 7) || '未记录'}`;

  return (
    <section className="mt-card" aria-label="当前模块详情">
      {/* Header + status + rename/archive */}
      <div className="mt-card-head" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {renaming ? (
            <div className="mt-row">
              <input
                className="mt-input"
                style={{ flex: 1 }}
                value={nameDraft}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void runBusy('rename', async () => {
                      await onUpdateModule({ name: nameDraft });
                      setRenaming(false);
                    });
                  } else if (e.key === 'Escape') {
                    setRenaming(false);
                  }
                }}
              />
              <button
                type="button"
                className="mt-primary"
                onClick={() =>
                  void runBusy('rename', async () => {
                    await onUpdateModule({ name: nameDraft });
                    setRenaming(false);
                  })
                }
              >
                保存
              </button>
            </div>
          ) : (
            <div className="mt-card-title" style={{ wordBreak: 'break-word' }}>
              {fullPath}
            </div>
          )}
        </div>

        <div className="mt-row" style={{ flexShrink: 0, gap: 4 }}>
          <select
            className="mt-select"
            style={{ width: 'auto', padding: '2px 6px', fontSize: 11 }}
            value={node.status}
            aria-label="模块状态"
            onChange={(e) => void runBusy('status', () => onSetStatus(e.target.value as ModuleStatus))}
          >
            {MODULE_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <button type="button" className="mt-ghost" title="重命名" onClick={() => setRenaming((v) => !v)}>
            改名
          </button>
          <button
            type="button"
            className="mt-ghost"
            title="归档模块（保留历史）"
            onClick={() => void runBusy('archive', onArchive)}
          >
            归档
          </button>
        </div>
      </div>

      {/* Plan / Code / Review stage switcher (explicitly decoupled from jumping chats) */}
      <div className="mt-label-row" style={{ marginBottom: 4 }}>
        <span className="mt-muted" style={{ fontSize: 11 }}>
          当前工作阶段（不跳转聊天；看各阶段会话请点下方直达条）
        </span>
        {codeSessionRunning && (
          <span className="mt-pill ok" title="当前模块有 Code 会话正在运行中">
            Code 运行中
          </span>
        )}
      </div>
      <div className="mt-stages" role="group" aria-label="工作阶段">
        {MODULE_STAGES.map((st) => (
          <button
            key={st}
            type="button"
            aria-pressed={node.stage === st}
            disabled={busyAction !== null}
            onClick={() => void runBusy(`stage-${st}`, () => onSetStage(st))}
            title={`将模块默认工作阶段切换为 ${st}`}
          >
            <span>{st}</span>
          </button>
        ))}
      </div>

      {/* Stage gate bar + Review bootstrap shortcut */}
      <div className="mt-gate-bar">
        <span>{gateHint}</span>
        {node.stage === 'Review' && !hasReviewDedicated && (
          <button
            type="button"
            className="mt-ghost"
            disabled={busyAction !== null}
            onClick={() => {
              setSessionPanel({ mode: 'bootstrap', stage: 'Review' });
              setSessionTitleDraft('合并前独立终审');
              setCopiedPreview('');
            }}
            title="复制 Review 开场指令，到左上角原生新建干净审查会话"
          >
            复制独立审查指令
          </button>
        )}
      </div>

      {/* Prominent completion shortcut for main-dir modules in 待检查 */}
      {node.status === '待检查' && (!isOwnWorktree || Boolean(node.git?.mergedCommit)) && (
        <div
          className="mt-gate-bar"
          style={{
            background: 'var(--mt-ok-bg)',
            color: 'var(--mt-ok-fg)',
            borderColor: 'var(--mt-ok-fg)',
          }}
        >
          <span>当前模块待检查，验收无误后可一键收口</span>
          <button
            type="button"
            className="mt-primary"
            style={{ padding: '3px 9px', fontSize: 11.5 }}
            disabled={busyAction !== null}
            onClick={() => void runBusy('mark-done', () => onSetStatus('已完成'))}
          >
            {busyAction === 'mark-done' ? '更新中…' : '标为已完成 ✓'}
          </button>
        </div>
      )}

      {/* Main workspace dirty/collision warning */}
      {showMainCollisionWarn && (
        <div className="mt-banner warn">
          <div>
            {otherMainCodeRunning.length > 0
              ? `主目录已有其他模块（${otherMainCodeRunning.map((id) => allModules[id]?.name || id).join('、')}）正在运行 Code；`
              : ''}
            {repoGit.dirtyCount > 0 ? `主目录当前有 ${repoGit.dirtyCount} 个未提交改动。` : ''}
            建议为并行模块创建独立 Worktree 隔离写入。
          </div>
          {repoGit.isGitRepo && (
            <div className="mt-row">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void runBusy('wt-create', onCreateWorktree)}
              >
                {busyAction === 'wt-create' ? '创建中…' : '为此模块创建 Worktree'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sparse Review Notes (only shown when non-empty) */}
      {node.reviewNotes && (
        <div className="mt-banner warn">
          <div className="mt-label-row" style={{ marginBottom: 0 }}>
            <strong>⚠️ Review 返工问题清单</strong>
            <div className="mt-row" style={{ gap: 4 }}>
              <button
                type="button"
                className="mt-primary"
                style={{ padding: '2px 7px', fontSize: 11 }}
                disabled={busyAction !== null}
                onClick={() => void runBusy('back-code', onBackToCodeFix)}
                title="一步切回 Code 阶段并定位 Code 会话（下一轮自动注入返工清单）"
              >
                {busyAction === 'back-code' ? '切换中…' : '回 Code 修复'}
              </button>
              <button
                type="button"
                className="mt-ghost"
                disabled={busyAction !== null}
                onClick={() => void runBusy('clear-rn', () => onSaveProgress({ clearReviewNotes: true }))}
              >
                清空
              </button>
            </div>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{node.reviewNotes}</div>
        </div>
      )}

      {/* Git / Worktree panel */}
      {repoGit.isGitRepo && (
        <div className="mt-banner wt">
          <div className="mt-label-row" style={{ marginBottom: 0 }}>
            <span>
              <strong>Git：</strong>
              {isOwnWorktree ? (
                <>
                  <code>{node.git?.branch}</code>（独立 Worktree）
                </>
              ) : isInheritedWorktree ? (
                <>
                  <code>{effectiveGit.branch}</code>（继承自「{effectiveGit.inheritedFromName}」）
                </>
              ) : (
                <>
                  主目录 <code>{repoGit.currentBranch || 'HEAD'}</code>
                </>
              )}
            </span>
            {node.git?.mergedCommit && (
              <span className="mt-pill ok" title={node.git.mergedCommit}>
                已合并 {node.git.mergedCommit.slice(0, 7)}
              </span>
            )}
          </div>

          {effectiveGit.mode === 'worktree' && (
            node.git?.mergedCommit || effectiveGit.mergedCommit ? (
              <div className="mt-muted" style={{ color: 'inherit', opacity: 0.95 }}>
                ✅ 已合并至 {effectiveGit.baseBranch || 'main'}（
                <code>{(node.git?.mergedCommit || effectiveGit.mergedCommit || '').slice(0, 7)}</code>
                ），可安全清理临时 Worktree
              </div>
            ) : gitRuntime ? (
              <div className="mt-muted" style={{ color: 'inherit', opacity: 0.9 }}>
                {gitRuntime.worktreeExists ? (
                  <>
                    领先 {gitRuntime.aheadBase} · 落后主干 {gitRuntime.behindBase} · 未提交{' '}
                    {gitRuntime.worktreeDirtyCount}
                  </>
                ) : (
                  'Worktree 目录不存在（可能已被手动删除）'
                )}
              </div>
            ) : null
          )}

          <div className="mt-row">
            {!isOwnWorktree && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void runBusy('wt-create', onCreateWorktree)}
              >
                {busyAction === 'wt-create'
                  ? '创建中…'
                  : isInheritedWorktree
                    ? '拆分独立 Worktree'
                    : '创建 Worktree'}
              </button>
            )}
            {effectiveGit.mode === 'worktree' &&
              !(node.git?.mergedCommit || effectiveGit.mergedCommit) &&
              (gitRuntime?.behindBase || 0) > 0 && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void runBusy('wt-sync', onSyncWorktree)}
                >
                  {busyAction === 'wt-sync' ? '同步中…' : `同步主干 (+${gitRuntime?.behindBase})`}
                </button>
              )}
            {isOwnWorktree && !node.git?.mergedCommit && (
              <button
                type="button"
                className="mt-primary"
                disabled={busyAction !== null}
                onClick={onOpenMerge}
              >
                合并回主干
              </button>
            )}
            {isOwnWorktree && (
              <button
                type="button"
                className={node.git?.mergedCommit ? 'mt-primary' : 'mt-danger'}
                disabled={busyAction !== null}
                onClick={onOpenCleanup}
              >
                清理 Worktree
              </button>
            )}
          </div>
        </div>
      )}

      {/* Design (2-line clamped by default, expandable) */}
      <div className="mt-field">
        <div className="mt-label-row">
          <span className="mt-label">设计要点</span>
          <div className="mt-row" style={{ gap: 4 }}>
            {!editingDesign && node.design && (
              <button
                type="button"
                className="mt-ghost"
                onClick={() => setDesignExpanded((v) => !v)}
              >
                {designExpanded ? '收起' : '展开'}
              </button>
            )}
            <button
              type="button"
              className="mt-ghost"
              onClick={() => {
                setEditingDesign((v) => !v);
                setDesignExpanded(true);
              }}
            >
              {editingDesign ? '取消' : '编辑'}
            </button>
          </div>
        </div>
        {editingDesign ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              className="mt-textarea"
              placeholder="简短 Markdown：目标 + 关键约束/接口 + 验收要点"
              value={designDraft}
              onChange={(e) => setDesignDraft(e.target.value)}
            />
            <div className="mt-row">
              <button
                type="button"
                className="mt-primary"
                disabled={busyAction !== null}
                onClick={() =>
                  void runBusy('save-design', async () => {
                    await onUpdateModule({ design: designDraft });
                    setEditingDesign(false);
                  })
                }
              >
                保存设计（rev+1）
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`mt-design-box${designExpanded ? '' : ' clamped'}`}
            onClick={() => node.design && setDesignExpanded((v) => !v)}
          >
            {node.design || '（暂无设计要点，可在 Plan 阶段沉淀）'}
          </div>
        )}
      </div>

      {/* Stop / Next progress */}
      <div className="mt-field">
        <div className="mt-label-row">
          <span className="mt-label">进度摘要</span>
          <button
            type="button"
            className="mt-ghost"
            onClick={() => setEditingProgress((v) => !v)}
          >
            {editingProgress ? '取消' : '微调'}
          </button>
        </div>

        {editingProgress ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              className="mt-input"
              placeholder="停在（≤100字）"
              maxLength={100}
              value={stopDraft}
              onChange={(e) => setStopDraft(e.target.value)}
            />
            <input
              className="mt-input"
              placeholder="下一步（≤100字）"
              maxLength={100}
              value={nextDraft}
              onChange={(e) => setNextDraft(e.target.value)}
            />
            <div className="mt-row">
              <button
                type="button"
                className="mt-primary"
                disabled={busyAction !== null}
                onClick={() =>
                  void runBusy('save-prog', async () => {
                    await onSaveProgress({ stop: stopDraft, next: nextDraft });
                    setEditingProgress(false);
                  })
                }
              >
                保存进度
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-design-box">
            <div>
              <span className="mt-muted">停在：</span>
              {node.stop || '—'}
            </div>
            <div>
              <span className="mt-muted">下一步：</span>
              {node.next || '—'}
            </div>
          </div>
        )}
      </div>

      {/* Linked code files */}
      {node.linkedFiles && node.linkedFiles.length > 0 && (
        <div className="mt-field">
          <div className="mt-label-row">
            <span className="mt-label">关联代码（点击在侧栏打开）</span>
          </div>
          <div className="mt-chips">
            {node.linkedFiles.map((f) => (
              <button
                key={f}
                type="button"
                className="mt-chip"
                title={f}
                onClick={() => openWorkspaceFile(effectiveGit.workingDir || workspacePath, f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sparse cross-subtree dependsOn */}
      {node.dependsOn && node.dependsOn.length > 0 && (
        <div className="mt-field">
          <div className="mt-label-row">
            <span className="mt-label">跨子树依赖</span>
          </div>
          <div className="mt-chips">
            {node.dependsOn.map((depId) => {
              const dep = allModules[depId];
              if (!dep) return null;
              return (
                <button
                  key={depId}
                  type="button"
                  className="mt-chip"
                  onClick={() => onSelectNode(depId)}
                >
                  {dep.name} · {dep.status}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Drift notice */}
      {drift.outdated && currentStageSession && (
        <div className="mt-banner warn">
          <div>
            <strong>上下文有更新：</strong>
            {drift.reasons.join('；')}。下次发消息时 Hook 会静默同步（零额外轮次）。
          </div>
          <div className="mt-row">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void runBusy('push-ctx', onPushContext)}
              title="直接调用 send-message 推送，会唤醒该会话跑一轮确认"
            >
              {busyAction === 'push-ctx' ? '推送中…' : '立即推送（触发一轮确认）'}
            </button>
          </div>
        </div>
      )}

      {/* Session section */}
      <div className="mt-field">
        <div className="mt-label-row">
          <span className="mt-label">会话与绑定（当前阶段：{node.stage}）</span>
          <span className="mt-muted">
            {observation.state === 'running'
              ? '运行中…'
              : observation.available
                ? `${observation.stepCount} 步`
                : '未绑定'}
          </span>
        </div>

        {/* Dedicated per-stage quick-jump bar (jumps directly without mutating mod.stage) */}
        {(() => {
          const activeSessions = (node.sessions || []).filter((s) => !s.archived);
          const stageBindings = MODULE_STAGES.map((st) => {
            const pinned = node.stageSessions?.[st];
            const matched = activeSessions.find((s) => s.stage === st)?.conversationId;
            const cid = pinned || matched || '';
            return { stage: st, cid, obs: stageObservations?.[st] };
          }).filter((item) => Boolean(item.cid));
          if (stageBindings.length === 0) return null;
          return (
            <div className="mt-chips" style={{ marginBottom: 8 }}>
              {stageBindings.map(({ stage: st, cid, obs }) => {
                const isRunning = obs?.state === 'running';
                const isHere = cid === hostConvId;
                return (
                  <button
                    key={st}
                    type="button"
                    className="mt-chip"
                    style={
                      isRunning
                        ? { borderColor: 'var(--mt-ok-fg)', color: 'var(--mt-ok-fg)' }
                        : isHere
                          ? { borderColor: 'var(--mt-accent)' }
                          : undefined
                    }
                    onClick={() => openNativeConversation(cid)}
                    title={`直达 ${st} 会话（${shortId(cid)}），不修改模块当前阶段`}
                  >
                    {st}
                    {isRunning ? ' ●运行中' : isHere ? ' ·当前' : ''} ↗
                  </button>
                );
              })}
            </div>
          );
        })()}

        <div className="mt-row" style={{ marginBottom: 6 }}>
          <code>{shortId(currentStageSession)}</code>
          {currentStageSession && currentStageSession === hostConvId && (
            <span className="mt-pill ok">当前窗口</span>
          )}
        </div>

        {observation.latestReply && (
          <div className="mt-design-box clamped" style={{ marginBottom: 6 }} title={observation.latestReply}>
            {observation.latestReply}
          </div>
        )}

        <div className="mt-row">
          <button
            type="button"
            className="mt-primary"
            disabled={busyAction !== null}
            onClick={() => {
              setSessionPanel({ mode: 'bootstrap', stage: node.stage });
              setSessionTitleDraft('');
              setGrillMeChecked(node.stage === 'Plan');
              setCopiedPreview('');
            }}
            title="推荐：复制开场指令，点左上角「+」新建原生交互会话后粘贴发送（支持 /grill-me 弹窗与终端审批）"
          >
            复制开场指令（推荐）
          </button>

          {currentStageSession && (
            <button
              type="button"
              onClick={() => openNativeConversation(currentStageSession)}
            >
              定位当前阶段会话 ↗
            </button>
          )}

          {hostConvId && currentStageSession !== hostConvId && (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => {
                setSessionPanel({ mode: 'bind', stage: node.stage });
                setSessionTitleDraft('');
                setCopiedPreview('');
              }}
              title="将当前正在聊天的原生会话绑定到本模块当前阶段，下轮自动注入完整上下文"
            >
              绑定当前会话
            </button>
          )}

          <button
            type="button"
            className="mt-ghost"
            disabled={busyAction !== null}
            onClick={() => {
              setSessionPanel({
                mode: 'bg-create',
                stage: node.stage,
                dedicated: Boolean(currentStageSession),
              });
              setSessionTitleDraft('');
              setCopiedPreview('');
            }}
            title="后台直建（受宿主限制为非交互模式，无法弹出 /grill-me 或终端审批弹窗）"
          >
            后台新建（非交互）
          </button>

          {currentStageSession && (
            <button
              type="button"
              className="mt-ghost"
              disabled={busyAction !== null}
              onClick={() => void runBusy('unbind', () => onUnbindSession(currentStageSession))}
            >
              解绑
            </button>
          )}
        </div>

        {sessionPanel?.mode === 'bootstrap' && (
          <div className="mt-inline-create" style={{ marginTop: 8 }}>
            <div className="mt-label">
              复制「{node.name}」({sessionPanel.stage}) 原生开场指令
            </div>
            <div className="mt-muted" style={{ fontSize: 11.5 }}>
              复制后点左上角 <b>「+ 新建会话」</b> 粘贴发送，将自动自绑定、命名并带入完整上下文（完整支持 /grill-me 弹窗与终端审批）。
            </div>
            <input
              className="mt-input"
              placeholder="自定义会话主题（可选，如：首版设计、修中文乱码）"
              value={sessionTitleDraft}
              autoFocus
              disabled={busyAction !== null}
              onChange={(e) => setSessionTitleDraft(e.target.value)}
            />
            {sessionPanel.stage === 'Plan' && (
              <label className="mt-row" style={{ fontSize: 12, cursor: 'pointer', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={grillMeChecked}
                  onChange={(e) => setGrillMeChecked(e.target.checked)}
                />
                <span>附带 Grill-me 交互式访谈（原生 ask_question 逐题对齐）</span>
              </label>
            )}
            <div className="mt-row">
              <button
                type="button"
                className="mt-primary"
                disabled={busyAction !== null}
                onClick={() =>
                  void runBusy('copy-bootstrap', async () => {
                    const res = await onCopyBootstrapPrompt(
                      sessionPanel.stage,
                      sessionTitleDraft.trim() || undefined,
                      sessionPanel.stage === 'Plan' ? grillMeChecked : false,
                    );
                    if (res.prompt) setCopiedPreview(res.prompt);
                  })
                }
              >
                {busyAction === 'copy-bootstrap' ? '生成中…' : '复制开场指令'}
              </button>
              <button
                type="button"
                className="mt-ghost"
                disabled={busyAction !== null}
                onClick={() => {
                  setSessionPanel(null);
                  setCopiedPreview('');
                }}
              >
                收起
              </button>
            </div>
            {copiedPreview && (
              <textarea
                className="mt-textarea"
                readOnly
                rows={4}
                value={copiedPreview}
                onFocus={(e) => e.currentTarget.select()}
                style={{ fontSize: 11 }}
              />
            )}
          </div>
        )}

        {sessionPanel?.mode === 'bind' && (
          <div className="mt-inline-create" style={{ marginTop: 8 }}>
            <div className="mt-label">
              将当前会话（<code>{shortId(hostConvId)}</code>）绑定到「{node.name}」({sessionPanel.stage})
            </div>
            <input
              className="mt-input"
              placeholder="自定义会话主题（可选，留空默认使用模块名）"
              value={sessionTitleDraft}
              autoFocus
              disabled={busyAction !== null}
              onChange={(e) => setSessionTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runBusy('bind-cur', async () => {
                    await onBindCurrent(true, sessionTitleDraft.trim() || undefined);
                    setSessionPanel(null);
                    setSessionTitleDraft('');
                  });
                } else if (e.key === 'Escape') {
                  setSessionPanel(null);
                }
              }}
            />
            <div className="mt-row">
              <button
                type="button"
                className="mt-primary"
                disabled={busyAction !== null}
                onClick={() =>
                  void runBusy('bind-cur', async () => {
                    await onBindCurrent(true, sessionTitleDraft.trim() || undefined);
                    setSessionPanel(null);
                    setSessionTitleDraft('');
                  })
                }
              >
                {busyAction === 'bind-cur' ? '绑定中…' : '确认绑定'}
              </button>
              <button
                type="button"
                className="mt-ghost"
                disabled={busyAction !== null}
                onClick={() => setSessionPanel(null)}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {sessionPanel?.mode === 'bg-create' && (
          <div className="mt-inline-create" style={{ marginTop: 8 }}>
            <div className="mt-label">
              后台新建「{node.name}」({sessionPanel.stage}) 会话（非交互）
            </div>
            <div className="mt-banner warn" style={{ padding: '6px 8px', fontSize: 11.5 }}>
              ⚠️ 宿主限制：侧栏后台直建的会话为非交互模式，调用 /grill-me（ask_question）或需要弹窗确认的终端命令会被自动取消。建议优先使用「复制开场指令（推荐）」。
            </div>
            <input
              className="mt-input"
              placeholder="本次改动标题（可选，如：修中文乱码、加 JSON 格式）"
              value={sessionTitleDraft}
              autoFocus
              disabled={busyAction !== null}
              onChange={(e) => setSessionTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runBusy('create-named-sess', async () => {
                    await onCreateSession(
                      sessionPanel.stage,
                      sessionPanel.dedicated,
                      sessionTitleDraft.trim() || undefined,
                    );
                    setSessionPanel(null);
                    setSessionTitleDraft('');
                  });
                } else if (e.key === 'Escape') {
                  setSessionPanel(null);
                }
              }}
            />
            <div className="mt-row">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  void runBusy('create-named-sess', async () => {
                    await onCreateSession(
                      sessionPanel.stage,
                      sessionPanel.dedicated,
                      sessionTitleDraft.trim() || undefined,
                    );
                    setSessionPanel(null);
                    setSessionTitleDraft('');
                  })
                }
              >
                {busyAction === 'create-named-sess' ? '创建中…' : '仍要后台创建'}
              </button>
              <button
                type="button"
                className="mt-ghost"
                disabled={busyAction !== null}
                onClick={() => setSessionPanel(null)}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {node.sessions && node.sessions.length > 1 && (
          <details style={{ marginTop: 8 }}>
            <summary className="mt-muted" style={{ cursor: 'pointer' }}>
              历史会话 / 过往改动（{node.sessions.length}）
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
              {node.sessions.map((s) => (
                <div
                  key={s.conversationId}
                  className="mt-row"
                  style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}
                >
                  <span
                    className="mt-muted"
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={`${s.title} (${s.conversationId})`}
                  >
                    [{s.stage}] {s.title || shortId(s.conversationId)}
                  </span>
                  <button
                    type="button"
                    className="mt-ghost"
                    style={{ flexShrink: 0 }}
                    onClick={() => openNativeConversation(s.conversationId)}
                  >
                    打开
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
